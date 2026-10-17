// Account switching swaps claude.ai cookies between saved slots.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessions } from '../src/sessions.js';

// In-memory stand-in for chrome.cookies + chrome.storage.local.
function fakeChrome(initial = []) {
  let jar = initial.map((c) => ({ ...c }));
  const store = {};
  const key = (c) => `${c.domain}|${c.path}|${c.name}`;
  return {
    jar: () => jar,
    cookies: {
      async getAll({ domain }) {
        return jar.filter((c) => c.domain.replace(/^\./, '').endsWith(domain)).map((c) => ({ ...c }));
      },
      async remove({ url, name }) {
        const host = new URL(url).hostname;
        jar = jar.filter((c) => !(c.name === name && c.domain.replace(/^\./, '') === host));
      },
      async set(d) {
        const domain = d.domain ?? new URL(d.url).hostname;
        const c = { name: d.name, value: d.value, domain, path: d.path ?? '/', hostOnly: !d.domain };
        jar = jar.filter((x) => key(x) !== key(c)).concat(c);
      },
    },
    storage: {
      async get(k) {
        return { [k]: store[k] };
      },
      async set(obj) {
        Object.assign(store, structuredClone(obj));
      },
    },
  };
}

const session = (value) => ({ name: 'sessionKey', value, domain: '.claude.ai', path: '/', secure: true, httpOnly: true });
const value = (chrome, name = 'sessionKey') => chrome.jar().find((c) => c.name === name)?.value;

test('first switch saves the live session to the current slot and clears the jar for the new one', async () => {
  const chrome = fakeChrome([session('WORK')]);
  const s = createSessions(chrome);
  await s.setActive('work');

  const r = await s.switchTo('personal');
  assert.equal(r.loggedIn, false);
  assert.equal(value(chrome), undefined, 'personal slot starts logged out so the user can sign in');
  assert.equal(await s.getActive(), 'personal');
});

test('switching back and forth restores each account', async () => {
  const chrome = fakeChrome([session('WORK')]);
  const s = createSessions(chrome);
  await s.setActive('work');
  await s.switchTo('personal');
  await chrome.cookies.set({ url: 'https://claude.ai/', domain: '.claude.ai', name: 'sessionKey', value: 'PERSONAL' });

  const toWork = await s.switchTo('work');
  assert.equal(toWork.loggedIn, true);
  assert.equal(value(chrome), 'WORK');

  await s.switchTo('personal');
  assert.equal(value(chrome), 'PERSONAL');
});

test('a refreshed session is saved, not the stale one', async () => {
  const chrome = fakeChrome([session('WORK-1')]);
  const s = createSessions(chrome);
  await s.setActive('work');
  await chrome.cookies.set({ url: 'https://claude.ai/', domain: '.claude.ai', name: 'sessionKey', value: 'WORK-2' });
  await s.switchTo('personal');
  await s.switchTo('work');
  assert.equal(value(chrome), 'WORK-2');
});

test('switching to the active account changes nothing', async () => {
  const chrome = fakeChrome([session('WORK')]);
  const s = createSessions(chrome);
  await s.setActive('work');
  const r = await s.switchTo('work');
  assert.equal(r.changed, false);
  assert.equal(value(chrome), 'WORK');
});

test('every claude.ai cookie moves with the account, not just sessionKey', async () => {
  const chrome = fakeChrome([session('WORK'), { name: 'lastActiveOrg', value: 'org-w', domain: 'claude.ai', path: '/' }]);
  const s = createSessions(chrome);
  await s.setActive('work');
  await s.switchTo('personal');
  assert.equal(chrome.jar().length, 0);
  await s.switchTo('work');
  assert.equal(value(chrome, 'lastActiveOrg'), 'org-w');
});

test('status reports which slots hold a saved login', async () => {
  const chrome = fakeChrome([session('WORK')]);
  const s = createSessions(chrome);
  await s.setActive('work');
  await s.switchTo('personal');
  assert.deepEqual(await s.status(), { active: 'personal', saved: { work: true, personal: false } });
});
