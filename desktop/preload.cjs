/* preload.cjs — the only bridge the panel gets into the desktop shell.
 * contextIsolation stays on; the panel just learns whether an update check is
 * possible and gets its status events. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status)),
  appVersion: () => process.env.npm_package_version || null,
});
