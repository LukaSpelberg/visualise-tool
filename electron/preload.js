import { contextBridge, ipcRenderer } from 'electron';

const api = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFile: filePath => ipcRenderer.invoke('read-file', filePath),
  saveFile: payload => ipcRenderer.invoke('save-file', payload),
  createEntry: payload => ipcRenderer.invoke('create-entry', payload),
  readTree: folderPath => ipcRenderer.invoke('read-tree', folderPath),
  analyzeImageWithGemini: payload => ipcRenderer.invoke('gemini-analyze-image', payload),
  analyzeImageWithOllama: payload => ipcRenderer.invoke('ollama-analyze-image', payload),
  buildComponent: payload => ipcRenderer.invoke('build-component', payload),
  selectComponentVariation: payload => ipcRenderer.invoke('select-component-variation', payload)
};

contextBridge.exposeInMainWorld('editorAPI', api);

if (typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('editor-api-ready'));
}
// Helpful debug message to show that preload ran.
try {
  // eslint-disable-next-line no-console
  console.log('[preload] editorAPI exposed');
} catch (e) {}
