import { setConfig } from '../src/config.js';

const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg);

async function render() {
  const s = await ask({ type: 'status' });
  const cfg = s.config;
  $('setup').hidden = !!s.active;
  $('main').hidden = !s.active;
  $('set-work').textContent = cfg.labels.work;
  $('set-personal').textContent = cfg.labels.personal;
  if (!s.active) return;

  for (const id of ['work', 'personal']) {
    const active = s.active === id;
    $(`label-${id}`).textContent = cfg.labels[id];
    $(`meta-${id}`).textContent = active ? 'Open now' : s.saved[id] ? 'Signed in' : 'Sign-in needed';
    $(`now-${id}`).textContent = active ? 'Active' : '';
    document.querySelector(`.acct[data-id="${id}"]`).setAttribute('aria-pressed', String(active));
  }
  $('carry').checked = cfg.carryPrompt;

  const limit = s.limit && s.limit.account === s.active;
  $('limit').hidden = !limit;
  if (limit) {
    const to = s.active === 'work' ? 'personal' : 'work';
    $('limit').textContent = `${cfg.labels[s.active]} seems to have hit its usage limit. You can switch to ${cfg.labels[to]}.`;
  }
}

function say(text) {
  $('msg').hidden = !text;
  $('msg').textContent = text || '';
}

document.querySelectorAll('[data-set]').forEach((b) =>
  b.addEventListener('click', async () => {
    await ask({ type: 'set-active', id: b.dataset.set });
    render();
  })
);

document.querySelectorAll('.acct').forEach((b) =>
  b.addEventListener('click', async () => {
    const id = b.dataset.id;
    say('Switching...');
    const r = await ask({ type: 'switch', id });
    if (r?.error) return say(`Problem: ${r.error}`);
    await render();
    const { config } = await ask({ type: 'status' });
    say(
      !r.changed
        ? `${config.labels[id]} is already open.`
        : r.loggedIn
          ? `Switched to ${config.labels[id]}.`
          : `Now sign in to claude.ai with your ${config.labels[id]} account (Google works). It will be remembered next time.`
    );
  })
);

$('carry').addEventListener('change', (e) => setConfig({ carryPrompt: e.target.checked }));

$('history').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
