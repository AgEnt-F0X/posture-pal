// Small, audited bridge: the page can ask the main process to show a native
// tray-balloon notification. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posturepalDesktop', {
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  isDesktop: true,
});
