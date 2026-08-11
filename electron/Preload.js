const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  minimize:     () => ipcRenderer.invoke('window:minimize'),
  maximize:     () => ipcRenderer.invoke('window:maximize'),
  close:        () => ipcRenderer.invoke('window:close'),
  isMaximized:  () => ipcRenderer.invoke('window:isMaximized'),
  onStateChanged: (callback) => {
    ipcRenderer.on('window:state-changed', (_event, state) => callback(state))
  }
})