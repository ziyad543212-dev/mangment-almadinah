const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSetup', {
  save(configuration) {
    return ipcRenderer.invoke('desktop-setup:save', configuration);
  }
});
