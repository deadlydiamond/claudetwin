const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// claude.ai / Google sign-in can reject the default Electron user agent,
// so present a plain Chrome UA instead.
app.userAgentFallback = app.userAgentFallback
  .split(' ')
  .filter((part) => !/^(Electron|claudetwin|ClaudeTwin)\//i.test(part))
  .join(' ');

const userDir = () => app.getPath('userData');
const statePath = () => path.join(userDir(), 'state.json');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Bundled config, overridable by <userData>/config.json
function loadConfig() {
  const base = readJSON(path.join(__dirname, 'config.json'), {});
  const user = readJSON(path.join(userDir(), 'config.json'), {});
  return { ...base, ...user };
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 760,
    minHeight: 520,
    title: 'ClaudeTwin',
    backgroundColor: '#131316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Lock down every <webview>: our preload only, no node, claude.ai only.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preloadURL;
    webPreferences.preload = path.join(__dirname, 'webview-preload.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!/^https:\/\/claude\.ai\//.test(params.src || '')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Sign-in popups stay in-app (same session as the account); other links open in the system browser.
const POPUP_ALLOWED =
  /^https:\/\/(accounts\.google\.com|appleid\.apple\.com|([a-z0-9-]+\.)*claude\.ai|([a-z0-9-]+\.)*anthropic\.com)(\/|$)/i;

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    if (POPUP_ALLOWED.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          webPreferences: { session: contents.session },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Keyboard shortcuts still work while focus is inside a webview.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    if (['1', '2', '\\', 'h'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      win?.webContents.send('shortcut', input.key);
    }
  });
});

ipcMain.handle('config', () => loadConfig());

// ---- ClaudeTwin connector (network calls live here, not in the page) -------
function twin(accountId) {
  const c = loadConfig().connector || {};
  const token = c.tokens?.[accountId];
  if (!c.url || !token) return null;
  return { base: c.url.replace(/\/+$/, ''), headers: { authorization: `Bearer ${token}` }, logMessages: c.logMessages !== false };
}

ipcMain.on('twin:log', async (_event, { accountId, entry }) => {
  const t = twin(accountId);
  if (!t || !t.logMessages) return;
  try {
    await fetch(`${t.base}/api/log`, {
      method: 'POST',
      headers: { ...t.headers, 'content-type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* offline: history just misses this entry */
  }
});

ipcMain.handle('twin:history', async (_event, { accountId, q }) => {
  const t = twin(accountId);
  if (!t) return { error: 'not-configured' };
  try {
    const url = `${t.base}/api/history?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const res = await fetch(url, { headers: t.headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('state:get', () => readJSON(statePath(), {}));
ipcMain.on('state:set', (_event, state) => {
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    /* best effort */
  }
});
ipcMain.on('notify', (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
