const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  togglePanel: show => ipcRenderer.send('panel:toggle', show),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  openDataFolder: () => ipcRenderer.send('open:data-folder'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: patch => ipcRenderer.send('settings:update', patch),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: callback => ipcRenderer.on('update:state', (_event, update) => callback(update)),
  onSettings: callback => ipcRenderer.on('settings:changed', (_event, settings) => callback(settings)),
  onUsage: callback => ipcRenderer.on('usage:update', (_event, data) => callback(data)),
  onError: callback => ipcRenderer.on('usage:error', (_event, message) => callback(message)),
  onPanelState: callback => ipcRenderer.on('panel:state', (_event, expanded) => callback(expanded))
});
