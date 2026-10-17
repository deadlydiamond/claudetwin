const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twin', {
  getConfig: () => ipcRenderer.invoke('config'),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (state) => ipcRenderer.send('state:set', state),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key)),
  log: (accountId, entry) => ipcRenderer.send('twin:log', { accountId, entry }),
  history: (accountId, q) => ipcRenderer.invoke('twin:history', { accountId, q }),
});
