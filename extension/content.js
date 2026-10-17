// Runs on claude.ai. 1) logs each prompt and its reply to the ClaudeTwin connector,
// 2) spots a usage-limit message so the toolbar can suggest a switch,
// 3) pastes a carried prompt into the composer after an account switch.
// claude.ai's markup can change; if logging stops, update the selectors below.
(() => {
  const ASSISTANT = ['.font-claude-response', '.font-claude-message', '[data-is-streaming]'];
  const LIMITS = [
    /usage limit/i,
    /reached your (message|usage) limit/i,
    /out of (free )?messages/i,
    /message limit/i,
    /limit reached/i,
    /out of extra usage/i,
  ];
  const EXCLUDE =
    '[contenteditable="true"], textarea, pre, code, [data-testid="user-message"], .font-claude-message, .font-claude-response, .font-user-message';

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  const findComposer = () =>
    document.querySelector('.ProseMirror[contenteditable="true"]') ||
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('textarea');

  const readText = (el) => (el ? (el.tagName === 'TEXTAREA' ? el.value : el.innerText || '').trim() : '');

  const chatMeta = () => ({
    chatUrl: location.href,
    chatTitle: document.title.replace(/\s*[-–|]\s*Claude\s*$/i, '').trim(),
  });

  // ---- 1. Prompt, then the reply once it stops streaming --------------------
  let lastPromptAt = 0;
  let replyTimer = null;

  function capturePrompt() {
    const text = readText(findComposer());
    if (!text || Date.now() - lastPromptAt < 800) return;
    lastPromptAt = Date.now();
    send({ type: 'log', entry: { role: 'user', text, ...chatMeta() } });
    watchReply();
  }

  function watchReply() {
    clearInterval(replyTimer);
    let last = '';
    let stable = 0;
    let ticks = 0;
    replyTimer = setInterval(() => {
      ticks++;
      const nodes = document.querySelectorAll(ASSISTANT.join(','));
      const node = nodes[nodes.length - 1];
      const text = node ? (node.innerText || '').trim() : '';
      const streaming = !!document.querySelector('button[aria-label*="stop" i]');
      stable = text && text === last && !streaming ? stable + 1 : 0;
      last = text;
      if (stable >= 2) {
        clearInterval(replyTimer);
        send({ type: 'log', entry: { role: 'assistant', text, ...chatMeta() } });
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
      if (e.target.closest?.('button[aria-label*="send" i]')) capturePrompt();
    },
    true
  );

  // ---- 2. Usage-limit messages -----------------------------------------------
  let lastLimit = { text: '', at: 0 };

  function test(el) {
    if (!el || el.nodeType !== 1 || el.closest(EXCLUDE)) return false;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 8 || text.length > 300) return false;
    if (!LIMITS.some((re) => re.test(text)) || !el.getClientRects().length) return false;
    if (text !== lastLimit.text || Date.now() - lastLimit.at > 60_000) {
      lastLimit = { text, at: Date.now() };
      send({ type: 'limit', text });
    }
    return true;
  }

  function scan(root) {
    if (!root || root.nodeType !== 1 || root.closest(EXCLUDE)) return;
    if (test(root)) return;
    const nodes = root.querySelectorAll('[role="alert"], [role="status"], p, div, span');
    for (let i = 0; i < nodes.length && i < 400; i++) if (test(nodes[i])) return;
  }

  let pending = new Set();
  let timer = null;
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
      if (m.type === 'characterData' && m.target.parentElement) pending.add(m.target.parentElement);
    }
    if (!timer) {
      timer = setTimeout(() => {
        const batch = pending;
        pending = new Set();
        timer = null;
        batch.forEach(scan);
      }, 400);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // ---- 3. Paste a prompt (never sends it; the user presses Enter) ------------
  function fill(text) {
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
    };
    attempt();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'fill') fill(msg.text);
  });

  chrome.runtime.sendMessage({ type: 'pending-fill' }).then((text) => text && fill(text)).catch(() => {});
})();
