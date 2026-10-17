/* global parseReset */
const $ = (s) => document.querySelector(s);
const now = () => Date.now();

let cfg;
let state;
const views = {};
const tabs = {};
const lastPrompt = {}; // in memory only, never written to disk

// ---- boot ------------------------------------------------------------------
async function init() {
  cfg = await window.twin.getConfig();
  const saved = await window.twin.getState();
  state = {
    active: cfg.accounts[0].id,
    autoSwitch: true,
    autoSend: false,
    split: false,
    accounts: {},
    ...saved,
  };
  for (const a of cfg.accounts) state.accounts[a.id] = { blockedUntil: 0, ...(state.accounts[a.id] || {}) };
  if (!cfg.accounts.some((a) => a.id === state.active)) state.active = cfg.accounts[0].id;

  buildUI();
  render();
  setInterval(tick, 15_000);
  window.twin.onShortcut(handleShortcut);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && handleShortcut(e.key)) e.preventDefault();
  });
}

const account = (id) => cfg.accounts.find((a) => a.id === id);
const label = (id) => account(id)?.label || id;
const isBlocked = (id) => state.accounts[id].blockedUntil > now();
const connectorReady = () => !!(cfg.connector?.url && cfg.accounts.some((a) => cfg.connector.tokens?.[a.id]));

function save() {
  window.twin.setState({
    active: state.active,
    autoSwitch: state.autoSwitch,
    autoSend: state.autoSend,
    split: state.split,
    accounts: state.accounts,
  });
}

// ---- UI construction -------------------------------------------------------
function buildUI() {
  for (const a of cfg.accounts) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.style.setProperty('--accent', a.color);
    tab.innerHTML = `<span class="dot"></span><span class="name"></span><span class="status"></span>`;
    tab.querySelector('.name').textContent = a.label;
    tab.title = 'Click: switch · Right-click: limit mark / clear';
    tab.addEventListener('click', () => switchTo(a.id));
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleManualBlock(a.id);
    });
    $('#tabs').appendChild(tab);
    tabs[a.id] = tab;

    const wv = document.createElement('webview');
    wv.setAttribute('partition', `persist:${a.id}`);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', cfg.startUrl);
    wv.dataset.id = a.id;
    wv.style.setProperty('--accent', a.color);
    wv.addEventListener('dom-ready', () =>
      wv.send('config', { limitPatterns: cfg.limitPatterns, assistantSelectors: cfg.assistantSelectors })
    );
    wv.addEventListener('ipc-message', (e) => onWebviewMessage(a.id, e.channel, e.args[0]));
    wv.addEventListener('focus', () => {
      if (state.split && state.active !== a.id) {
        state.active = a.id;
        save();
        render();
      }
    });
    $('#views').appendChild(wv);
    views[a.id] = wv;
  }

  const bind = (id, key) => {
    const el = $(id);
    el.checked = !!state[key];
    el.addEventListener('change', () => {
      state[key] = el.checked;
      save();
      if (key === 'autoSwitch' && el.checked) tick();
    });
  };
  bind('#autoSwitch', 'autoSwitch');
  bind('#autoSend', 'autoSend');

  $('#splitBtn').addEventListener('click', toggleSplit);
  $('#reloadBtn').addEventListener('click', () => views[state.active].reload());
  $('#historyBtn').addEventListener('click', toggleHistory);
  $('#historyClose').addEventListener('click', toggleHistory);
  let searchTimer;
  $('#historySearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadHistory, 300);
  });
}

// ---- messages from claude.ai pages -----------------------------------------
function onWebviewMessage(id, channel, payload) {
  if (channel === 'prompt') {
    lastPrompt[id] = payload.text;
    window.twin.log(id, { role: 'user', ...payload });
  } else if (channel === 'reply') {
    window.twin.log(id, { role: 'assistant', ...payload });
  } else if (channel === 'limit') {
    onLimit(id, payload);
  }
}

function onLimit(id, text) {
  const acc = state.accounts[id];
  if (isBlocked(id)) return; // already known
  acc.blockedUntil = parseReset(text) ?? now() + (cfg.defaultBlockHours || 5) * 3_600_000;
  save();
  render();

  if (!state.autoSwitch || state.active !== id) {
    toast(`${label(id)} ki limit khatam · reset ${fmtTime(acc.blockedUntil)}`);
    return;
  }
  const other = nextAvailable(id);
  if (!other) {
    window.twin.notify('ClaudeTwin', `Dono accounts limited. Pehla reset ${fmtTime(earliestReset())}`);
    return;
  }
  switchTo(other);
  const msg = `${label(id)} ki limit khatam → ${label(other)} par switch`;
  window.twin.notify('ClaudeTwin', msg);
  if (cfg.carryPrompt && lastPrompt[id]) {
    views[other].send('fill', { text: carryText(id, lastPrompt[id]), send: state.autoSend });
    toast(`${msg} · prompt ${state.autoSend ? 'send' : 'paste'} kar diya`);
  } else {
    toast(msg);
  }
}

// With the connector, the next account pulls full context instead of starting cold.
function carryText(fromId, prompt) {
  if (!connectorReady()) return prompt;
  return (
    `[ClaudeTwin] ${label(fromId)} account ki limit khatam ho gayi. ` +
    `Pehle claudetwin ke get_handoff aur list_recent se pichla context lo, phir isi kaam ko continue karo:\n\n${prompt}`
  );
}

// ---- switching -------------------------------------------------------------
function nextAvailable(exceptId) {
  return cfg.accounts.map((a) => a.id).find((id) => id !== exceptId && !isBlocked(id)) || null;
}

function earliestReset() {
  return Math.min(...cfg.accounts.map((a) => state.accounts[a.id].blockedUntil).filter((t) => t > now()));
}

function switchTo(id) {
  if (!views[id]) return;
  state.active = id;
  save();
  render();
  views[id].focus();
}

function toggleSplit() {
  state.split = !state.split;
  save();
  render();
}

function toggleManualBlock(id) {
  const acc = state.accounts[id];
  if (isBlocked(id)) {
    acc.blockedUntil = 0;
    toast(`${label(id)} available mark kar diya`);
  } else {
    acc.blockedUntil = now() + (cfg.defaultBlockHours || 5) * 3_600_000;
    toast(`${label(id)} limited mark kar diya`);
    if (state.autoSwitch && state.active === id) {
      const other = nextAvailable(id);
      if (other) switchTo(other);
    }
  }
  save();
  render();
}

function tick() {
  let changed = false;
  for (const a of cfg.accounts) {
    const acc = state.accounts[a.id];
    if (acc.blockedUntil && acc.blockedUntil <= now()) {
      acc.blockedUntil = 0;
      changed = true;
      toast(`${a.label} dobara available hai`);
      views[a.id].send('rescan');
    }
  }
  if (state.autoSwitch && isBlocked(state.active)) {
    const other = nextAvailable(state.active);
    if (other) {
      switchTo(other);
      changed = false;
    }
  }
  if (changed) save();
  render();
}

function handleShortcut(key) {
  const k = String(key).toLowerCase();
  if (k === '1' || k === '2') {
    const a = cfg.accounts[Number(k) - 1];
    if (a) switchTo(a.id);
    return true;
  }
  if (k === '\\') return toggleSplit(), true;
  if (k === 'h') return toggleHistory(), true;
  return false;
}

// ---- central history -------------------------------------------------------
function toggleHistory() {
  const panel = $('#history');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    $('#historySearch').focus();
    loadHistory();
  }
}

async function loadHistory() {
  const list = $('#historyList');
  if (!connectorReady()) {
    list.innerHTML = `<p class="empty">Central history ke liye connector chahiye.<br>config.json mein <code>connector.url</code> aur tokens daalein.</p>`;
    return;
  }
  const askAs = cfg.connector.tokens[state.active] ? state.active : cfg.accounts.find((a) => cfg.connector.tokens[a.id]).id;
  const res = await window.twin.history(askAs, $('#historySearch').value.trim());
  if (res.error) {
    list.innerHTML = `<p class="empty">Connector se rabta nahi hua (${escapeHtml(res.error)}).</p>`;
    return;
  }
  if (!res.items.length) {
    list.innerHTML = `<p class="empty">Abhi kuch nahi mila.</p>`;
    return;
  }
  list.innerHTML = '';
  for (const item of res.items) list.appendChild(historyItem(item));
}

function historyItem(item) {
  const acc = account(item.space);
  const el = document.createElement('div');
  el.className = `hitem ${item.kind === 'handoff' ? 'handoff' : item.role}`;
  el.style.setProperty('--accent', acc?.color || '#8a8a93');

  const who = item.kind === 'handoff' ? 'Handoff' : item.role === 'user' ? 'Aap' : 'Claude';
  const title = item.kind === 'handoff' ? item.title : item.chatTitle;
  const body = item.kind === 'handoff' ? item.summary : item.text;

  el.innerHTML = `
    <div class="hmeta"><span class="badge"></span><span class="who"></span><span class="when"></span></div>
    <div class="htitle"></div>
    <div class="htext"></div>
    <div class="hactions"></div>`;
  el.querySelector('.badge').textContent = acc?.label || item.space;
  el.querySelector('.who').textContent = who;
  el.querySelector('.when').textContent = fmtWhen(item.at);
  el.querySelector('.htitle').textContent = title || '';
  el.querySelector('.htext').textContent = body.length > 280 ? `${body.slice(0, 280)}…` : body;

  const actions = el.querySelector('.hactions');
  if (item.chatUrl && views[item.space] && /^https:\/\/claude\.ai\//.test(item.chatUrl)) {
    actions.appendChild(
      button('Chat kholein', () => {
        switchTo(item.space);
        views[item.space].loadURL(item.chatUrl);
      })
    );
  }
  actions.appendChild(
    button(`${label(state.active)} mein paste`, () => views[state.active].send('fill', { text: body, send: false }))
  );
  return el;
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

// ---- rendering -------------------------------------------------------------
function render() {
  for (const a of cfg.accounts) {
    const tab = tabs[a.id];
    const blocked = isBlocked(a.id);
    tab.classList.toggle('active', state.active === a.id);
    tab.classList.toggle('limited', blocked);
    tab.querySelector('.status').textContent = blocked
      ? `${fmtTime(state.accounts[a.id].blockedUntil)} · ${fmtLeft(state.accounts[a.id].blockedUntil)}`
      : 'Available';
    views[a.id].classList.toggle('shown', state.split || state.active === a.id);
    views[a.id].classList.toggle('focused', state.split && state.active === a.id);
  }
  $('#views').classList.toggle('split', state.split);
  $('#splitBtn').classList.toggle('on', state.split);

  const banner = $('#banner');
  const allBlocked = cfg.accounts.every((a) => isBlocked(a.id));
  banner.hidden = !allBlocked;
  if (allBlocked) banner.textContent = `Dono accounts ki limit khatam. Sabse pehle reset: ${fmtTime(earliestReset())} (${fmtLeft(earliestReset())})`;
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => (t.hidden = true), 250);
  }, 4500);
}

// ---- formatting ------------------------------------------------------------
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function fmtLeft(ms) {
  const mins = Math.max(0, Math.round((ms - now()) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

function fmtWhen(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

init();
