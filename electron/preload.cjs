const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenwriterMenu', {
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('screenwriter-menu-command', listener);
    return () => ipcRenderer.removeListener('screenwriter-menu-command', listener);
  },
});
