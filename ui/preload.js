const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisBridge', {
  appVersion: '1.0.0',

  // Userspace backend
  getUserspaceConfig: () => ipcRenderer.invoke('userspace:get-config'),
  healthcheckUserspace: () => ipcRenderer.invoke('userspace:health'),
  synthesizeTts: (payload) => ipcRenderer.invoke('tts:synthesize', payload),
  synthesizeTtsStream: (payload) => ipcRenderer.invoke('tts:synthesize-stream', payload),
  cancelTtsStream: (requestId) => ipcRenderer.send('tts:stream-cancel', requestId),
  onTtsStreamEvent: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('tts:stream-event', handler);
    return () => ipcRenderer.removeListener('tts:stream-event', handler);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  minimizeNow: () => ipcRenderer.invoke('window:minimize-now'),
  closeWindow: () => ipcRenderer.send('window:close'),
  restoreWindow: () => ipcRenderer.send('window:restore'),
  moveWindow: (bounds) => ipcRenderer.send('window:move', bounds),
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds'),
  minimizeAnimationDone: () => ipcRenderer.send('window:minimize-animation-done'),

  // Window state events (main → renderer)
  onMinimizeToSphere: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:minimize-to-sphere', handler);
    return () => ipcRenderer.removeListener('window:minimize-to-sphere', handler);
  },
  onRestoreFromSphere: (callback) => {
    const handler = (event, text) => callback(text);
    ipcRenderer.on('window:restore-from-sphere', handler);
    return () => ipcRenderer.removeListener('window:restore-from-sphere', handler);
  },
  onSphereReady: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:sphere-ready', handler);
    return () => ipcRenderer.removeListener('window:sphere-ready', handler);
  },

  // Sphere mode: toggle click-through
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('window:set-ignore-mouse', ignore),
});
