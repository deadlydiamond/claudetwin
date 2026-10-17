// Settings and the connector client, shared by the worker, popup, panel and options.
export const ACCOUNTS = ['work', 'personal'];
const KEY = 'twin.config';

export const DEFAULTS = {
  labels: { work: 'Company', personal: 'Personal' },
  colors: { work: '#4f8cff', personal: '#b06cff' },
  connectorUrl: '',
  tokens: { work: '', personal: '' },
  carryPrompt: true,
  logMessages: true,
};

export async function getConfig() {
  const { [KEY]: saved } = await chrome.storage.local.get(KEY);
  const c = { ...DEFAULTS, ...(saved || {}) };
  c.labels = { ...DEFAULTS.labels, ...(saved?.labels || {}) };
  c.tokens = { ...DEFAULTS.tokens, ...(saved?.tokens || {}) };
  c.colors = DEFAULTS.colors;
  return c;
}

export async function setConfig(patch) {
  const current = await getConfig();
  await chrome.storage.local.set({ [KEY]: { ...current, ...patch } });
}

export const other = (id) => (id === 'work' ? 'personal' : 'work');

// Returns null when the connector or this account's token is not set.
export function connector(cfg, accountId) {
  const token = cfg.tokens[accountId];
  if (!cfg.connectorUrl || !token) return null;
  const base = cfg.connectorUrl.trim().replace(/\/+$/, '');
  const call = async (path, init = {}) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'token galat hai' : `HTTP ${res.status}`);
    return res.json();
  };
  return {
    log: (entry) =>
      call('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) }),
    history: (q) => call(`/api/history?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    handoff: () => call('/api/handoff'),
  };
}
