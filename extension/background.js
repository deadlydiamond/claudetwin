// ClaudeTwin service worker: account switching, connector calls, prompt carry.
import { createSessions } from './src/sessions.js';
import { getConfig, connector, other } from './src/config.js';

const sessions = createSessions({ cookies: chrome.cookies, storage: chrome.storage.local });
const CLAUDE = 'https://claude.ai/*';

// Short-lived state lives in session storage so a sleeping worker keeps it.
const getS = async (k) => (await chrome.storage.session.get(k))[k];
const setS = (obj) => chrome.storage.session.set(obj);

async function updateBadge() {
  const [{ active }, cfg, limit] = await Promise.all([sessions.status(), getConfig(), getS('limit')]);
  if (limit && limit.account === active) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e5a00d' });
  } else if (active) {
    chrome.action.setBadgeText({ text: cfg.labels[active].slice(0, 1).toUpperCase() });
    chrome.action.setBadgeBackgroundColor({ color: cfg.colors[active] });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
  chrome.action.setTitle({ title: active ? `ClaudeTwin: ${cfg.labels[active]}` : 'ClaudeTwin' });
}

function carryText(cfg, fromId, prompt) {
  if (!cfg.connectorUrl) return prompt;
  return (
    `[ClaudeTwin] Main ${cfg.labels[fromId]} account se aa raha hoon. ` +
    `Pehle claudetwin ke get_handoff aur list_recent se pichla context lo, phir isi kaam ko continue karo:\n\n${prompt}`
  );
}

async function switchTo(id, { carry } = {}) {
  const cfg = await getConfig();
  const from = await sessions.getActive();
  const last = await getS('lastPrompt');
  const result = await sessions.switchTo(id);
  await setS({ limit: null });
  await updateBadge();
  if (!result.changed) return result;

  // Every open claude.ai tab belonged to the old account. Send the most visible one
  // to a fresh chat and reload the rest.
  const tabs = await chrome.tabs.query({ url: CLAUDE });
  const [focused] = await chrome.tabs.query({ url: CLAUDE, active: true, lastFocusedWindow: true });
  const main = focused || tabs[0];
  if (main) {
    await chrome.tabs.update(main.id, { url: 'https://claude.ai/new', active: true });
    for (const t of tabs) if (t.id !== main.id) chrome.tabs.reload(t.id);
  }
  const tab = main || (await chrome.tabs.create({ url: 'https://claude.ai/new' }));

  const wantCarry = carry ?? cfg.carryPrompt;
  if (wantCarry && result.loggedIn && last?.text && last.account === from) {
    await setS({ pendingFill: { tabId: tab.id, text: carryText(cfg, from, last.text) } });
  }
  return result;
}

async function logEntry(entry) {
  const cfg = await getConfig();
  const active = await sessions.getActive();
  if (!active) return;
  if (entry.role === 'user') await setS({ lastPrompt: { text: entry.text, account: active } });
  const c = cfg.logMessages && connector(cfg, active);
  if (c) await c.log(entry).catch(() => {}); // offline: history just misses this entry
}

// Any configured token works for reading; prefer the active account's.
async function readClient() {
  const cfg = await getConfig();
  const active = (await sessions.getActive()) || 'work';
  return connector(cfg, active) || connector(cfg, other(active));
}

const handlers = {
  status: async () => ({ ...(await sessions.status()), limit: await getS('limit'), config: await getConfig() }),
  'set-active': async ({ id }) => (await sessions.setActive(id), updateBadge()),
  switch: ({ id, carry }) => switchTo(id, { carry }),
  forget: async ({ id }) => (await sessions.forget(id), updateBadge()),
  log: ({ entry }) => logEntry(entry),
  limit: async ({ text }) => {
    const active = await sessions.getActive();
    if (active) await setS({ limit: { account: active, text, at: Date.now() } });
    await updateBadge();
  },
  'pending-fill': async (_msg, sender) => {
    const p = await getS('pendingFill');
    if (!p || p.tabId !== sender.tab?.id) return null;
    await setS({ pendingFill: null });
    return p.text;
  },
  history: async ({ q }) => {
    const c = await readClient();
    if (!c) return { error: 'not-configured' };
    try {
      const [{ items }, { handoff }] = await Promise.all([c.history(q), c.handoff()]);
      return { items, handoff };
    } catch (err) {
      return { error: err.message };
    }
  },
  'open-chat': async ({ url, space }) => {
    const active = await sessions.getActive();
    if (space && space !== active && space !== 'shared') await switchTo(space, { carry: false });
    const [tab] = await chrome.tabs.query({ url: CLAUDE, active: true, lastFocusedWindow: true });
    if (tab) chrome.tabs.update(tab.id, { url, active: true });
    else chrome.tabs.create({ url });
  },
  fill: async ({ text }) => {
    const [tab] = await chrome.tabs.query({ url: CLAUDE, active: true, lastFocusedWindow: true });
    const target = tab || (await chrome.tabs.query({ url: CLAUDE }))[0];
    if (!target) return { error: 'claude.ai ka koi tab khula nahi' };
    await chrome.tabs.sendMessage(target.id, { type: 'fill', text });
    chrome.tabs.update(target.id, { active: true });
    return { ok: true };
  },
  'open-panel': async ({ windowId }) => chrome.sidePanel.open({ windowId }),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender))
    .then((r) => reply(r ?? null))
    .catch((err) => reply({ error: err.message }));
  return true; // async reply
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'switch-other') return;
  const active = await sessions.getActive();
  if (active) switchTo(other(active));
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
