import { contextBridge, ipcRenderer } from 'electron';

const api = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFile: filePath => ipcRenderer.invoke('read-file', filePath),
  saveFile: payload => ipcRenderer.invoke('save-file', payload),
  writeFile: (filePath, content, options) => ipcRenderer.invoke('save-file', { filePath, content, ...options }),
  writeFileBinary: (filePath, dataUrl) => ipcRenderer.invoke('write-file-binary', { filePath, dataUrl }),
  copyFile: (sourcePath, targetPath) => ipcRenderer.invoke('copy-file', { sourcePath, targetPath }),
  ensureDir: dirPath => ipcRenderer.invoke('ensure-dir', { dirPath }),
  createEntry: payload => ipcRenderer.invoke('create-entry', payload),
  readTree: folderPath => ipcRenderer.invoke('read-tree', folderPath),
  renameEntry: payload => ipcRenderer.invoke('rename-entry', payload),
  deleteEntry: payload => ipcRenderer.invoke('delete-entry', payload),
  analyzeImageWithGemini: payload => ipcRenderer.invoke('gemini-analyze-image', payload),
  analyzeImageWithOllama: payload => ipcRenderer.invoke('ollama-analyze-image', payload),
  buildComponent: payload => ipcRenderer.invoke('build-component', payload),
  selectComponentVariation: payload => ipcRenderer.invoke('select-component-variation', payload),
  editComponentElement: payload => ipcRenderer.invoke('edit-component-element', payload),
  // Build feature
  analyzeBuildDesign: payload => ipcRenderer.invoke('analyze-build-design', payload),
  refineBuildPlan: payload => ipcRenderer.invoke('refine-build-plan', payload),
  executeBuild: payload => ipcRenderer.invoke('execute-build', payload)
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
