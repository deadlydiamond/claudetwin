// Runs inside each claude.ai webview.
// 1) remembers the last prompt you sent, 2) watches for a usage-limit banner,
// 3) can paste a prompt into the composer when the host asks.
const { ipcRenderer } = require('electron');

let patterns = [];
let lastReported = { text: '', at: 0 };

const EXCLUDE =
  '[contenteditable="true"], textarea, pre, code, [data-testid="user-message"], .font-claude-message, .font-claude-response, .font-user-message';
const CANDIDATES = '[role="alert"], [role="status"], p, div, span';

const findComposer = () =>
  document.querySelector('.ProseMirror[contenteditable="true"]') ||
  document.querySelector('[contenteditable="true"]') ||
  document.querySelector('textarea');

const readText = (el) => {
  if (!el) return '';
  return (el.tagName === 'TEXTAREA' ? el.value : el.innerText || '').trim();
};

// ---- 1. Track the last prompt, then the reply to it ------------------------
let assistantSelectors = [];
let lastPromptAt = 0;

const chatMeta = () => ({
  chatUrl: location.href,
  chatTitle: document.title.replace(/\s*[-–|]\s*Claude\s*$/i, '').trim(),
});

function capturePrompt() {
  const text = readText(findComposer());
  if (!text || Date.now() - lastPromptAt < 800) return;
  lastPromptAt = Date.now();
  ipcRenderer.sendToHost('prompt', { text, ...chatMeta() });
  watchReply();
}

// Best effort: wait until the newest assistant message stops changing.
let replyTimer = null;
function watchReply() {
  clearInterval(replyTimer);
  if (!assistantSelectors.length) return;
  let last = '';
  let stable = 0;
  let ticks = 0;
  replyTimer = setInterval(() => {
    ticks++;
    const nodes = document.querySelectorAll(assistantSelectors.join(','));
    const node = nodes[nodes.length - 1];
    const text = node ? (node.innerText || '').trim() : '';
    const streaming = !!document.querySelector('button[aria-label*="stop" i]');
    if (text && text === last && !streaming) stable++;
    else stable = 0;
    last = text;
    if (stable >= 2) {
      clearInterval(replyTimer);
      ipcRenderer.sendToHost('reply', { text, ...chatMeta() });
    } else if (ticks > 400) clearInterval(replyTimer); // ~10 min cap
  }, 1500);
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const composer = findComposer();
    if (composer && composer.contains(e.target)) capturePrompt();
  },
  true
);

window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target.closest && e.target.closest('button[aria-label*="send" i]')) capturePrompt();
  },
  true
);

// ---- 2. Detect usage-limit messages ----------------------------------------
function isVisible(el) {
  return !!(el.offsetParent || el.getClientRects().length);
}

function test(el) {
  if (!el || el.nodeType !== 1 || el.closest(EXCLUDE)) return false;
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length < 8 || text.length > 300) return false;
  if (!patterns.some((re) => re.test(text)) || !isVisible(el)) return false;

  const fresh = text !== lastReported.text || Date.now() - lastReported.at > 60_000;
  if (fresh) {
    lastReported = { text, at: Date.now() };
    ipcRenderer.sendToHost('limit', text);
  }
  return true;
}

function scan(root) {
  if (!root || root.nodeType !== 1 || root.closest(EXCLUDE)) return;
  if (test(root)) return;
  const nodes = root.querySelectorAll(CANDIDATES);
  for (let i = 0; i < nodes.length && i < 400; i++) if (test(nodes[i])) return;
}

let pending = new Set();
let timer = null;
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
    if (m.type === 'characterData' && m.target.parentElement) pending.add(m.target.parentElement);
  }
  if (!timer) {
    timer = setTimeout(() => {
      const batch = pending;
      pending = new Set();
      timer = null;
      if (patterns.length) batch.forEach(scan);
    }, 400);
  }
});

function start() {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
if (document.body) start();
else window.addEventListener('DOMContentLoaded', start);

ipcRenderer.on('config', (_e, cfg) => {
  patterns = (cfg.limitPatterns || []).map((p) => new RegExp(p, 'i'));
  assistantSelectors = cfg.assistantSelectors || [];
  if (document.body) scan(document.body);
});

ipcRenderer.on('rescan', () => {
  lastReported = { text: '', at: 0 };
  if (document.body) scan(document.body);
});

// ---- 3. Paste (and optionally send) a prompt -------------------------------
ipcRenderer.on('fill', (_e, { text, send }) => {
  const attempt = (n = 0) => {
    const composer = findComposer();
    if (!composer) {
      if (n < 40) setTimeout(() => attempt(n + 1), 250);
      return;
    }
    composer.focus();
    if (composer.tagName === 'TEXTAREA') {
      composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }
    if (send) {
      setTimeout(() => {
        const btn = document.querySelector('button[aria-label*="send" i]:not([disabled])');
        if (btn) btn.click();
        else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }, 450);
    }
  };
  attempt();
});
