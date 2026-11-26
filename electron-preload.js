const { contextBridge, ipcRenderer } = require('electron');

const config = ipcRenderer.sendSync('desktop:get-config');

contextBridge.exposeInMainWorld('mangDesktop', config || {});
