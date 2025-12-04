const { contextBridge, ipcRenderer } = require('electron');

const api = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFile: filePath => ipcRenderer.invoke('read-file', filePath),
  saveFile: payload => ipcRenderer.invoke('save-file', payload),
  createEntry: payload => ipcRenderer.invoke('create-entry', payload),
  readTree: folderPath => ipcRenderer.invoke('read-tree', folderPath),
  renameEntry: payload => ipcRenderer.invoke('rename-entry', payload),
  deleteEntry: payload => ipcRenderer.invoke('delete-entry', payload),
  startTerminal: options => ipcRenderer.invoke('terminal-create', options),
  writeToTerminal: ({ id, data }) => ipcRenderer.send('terminal-write', { id, data }),
  resizeTerminal: ({ id, cols, rows }) => ipcRenderer.send('terminal-resize', { id, cols, rows }),
  disposeTerminal: id => ipcRenderer.send('terminal-dispose', { id }),
  onTerminalData: handler => {
    if (!handler) return () => {};
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('terminal-data', wrapped);
    return () => ipcRenderer.removeListener('terminal-data', wrapped);
  },
  onTerminalExit: handler => {
    if (!handler) return () => {};
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('terminal-exit', wrapped);
    return () => ipcRenderer.removeListener('terminal-exit', wrapped);
  },
  startPreviewServer: ({ folderPath }) => ipcRenderer.invoke('start-preview-server', { folderPath }),
  stopPreviewServer: () => ipcRenderer.invoke('stop-preview-server')
};

contextBridge.exposeInMainWorld('editorAPI', api);

try {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('editor-api-ready'));
  }
  // eslint-disable-next-line no-console
  console.log('[preload.cjs] editorAPI exposed');
} catch (e) {
  // ignore
}

module.exports = api;
