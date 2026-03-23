const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisBridge', {
  appVersion: '1.0.0',
  getUserspaceConfig: () => ipcRenderer.invoke('userspace:get-config'),
  healthcheckUserspace: () => ipcRenderer.invoke('userspace:health')
});
