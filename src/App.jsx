import React, { useCallback, useEffect, useState } from 'react';
import EditorPane from './components/EditorPane.jsx';
import ProjectTree from './components/ProjectTree.jsx';
import AIChatPlaceholder from './components/AIChatPlaceholder.jsx';
import TerminalPane from './components/TerminalPane.jsx';
import TopNav from './components/TopNav.jsx';
// inline create handled inside ProjectTree

const findFirstFile = nodes => {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node;
    }
    if (node.children?.length) {
      const child = findFirstFile(node.children);
      if (child) {
        return child;
      }
    }
  }
  return null;
};

const getNameFromPath = filePath => {
  if (!filePath) {
    return 'No file selected';
  }
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const App = () => {
  const [fileBridge, setFileBridge] = useState(null);
  const [folderPath, setFolderPath] = useState('');
  const [tree, setTree] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState('');
  const [code, setCode] = useState(null);
  const [fsError, setFsError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const updateBridge = () => {
      if (window.editorAPI) {
        setFileBridge(window.editorAPI);
      }
    };

    window.addEventListener('editor-api-ready', updateBridge);
    updateBridge();

    return () => {
      window.removeEventListener('editor-api-ready', updateBridge);
    };
  }, []);

  // Fallback: poll briefly for the editorAPI in case the event was missed.
  useEffect(() => {
    if (fileBridge || typeof window === 'undefined') return undefined;

    let attempts = 0;
    const maxAttempts = 25; // ~5 seconds
    const interval = setInterval(() => {
      attempts += 1;
      if (window.editorAPI) {
        setFileBridge(window.editorAPI);
        clearInterval(interval);
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [fileBridge]);

  const hasFileSystemAccess = Boolean(fileBridge?.selectFolder);
  const hasTerminalAccess = Boolean(fileBridge?.startTerminal);

  const [savedContent, setSavedContent] = useState(null);
  const dirty = code !== null && savedContent !== null && code !== savedContent;

  useEffect(() => {
    if (!hasTerminalAccess && terminalOpen) {
      setTerminalOpen(false);
    }
  }, [hasTerminalAccess, terminalOpen]);

  const toggleTerminal = useCallback(() => {
    if (!hasTerminalAccess) {
      window.alert('The integrated terminal is only available in the Electron shell.');
      return;
    }
    setTerminalOpen(prev => !prev);
  }, [hasTerminalAccess]);

  const saveFile = useCallback(async () => {
    if (!fileBridge?.saveFile || !activeFilePath) return;
    try {
      const res = await fileBridge.saveFile({ filePath: activeFilePath, content: code });
      if (res?.filePath) {
        setSavedContent(code);
        // eslint-disable-next-line no-console
        console.log('[save] saved', res.filePath);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[save] error', err);
    }
  }, [fileBridge, activeFilePath, code]);

  // handle Ctrl+S
  useEffect(() => {
    const onKey = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const saveKey = isMac ? (e.metaKey && e.key === 's') : (e.ctrlKey && e.key === 's');
      if (saveKey) {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveFile]);

  // Debug logging to help trace whether the Electron bridge is available
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[renderer] window.editorAPI present?', typeof window !== 'undefined' && !!window.editorAPI);
    // eslint-disable-next-line no-console
    console.log('[renderer] fileBridge present?', !!fileBridge, fileBridge);
  }, [fileBridge]);

  const openFile = useCallback(
    async filePath => {
      if (!fileBridge?.readFile || !filePath) {
        return;
      }

      const response = await fileBridge.readFile(filePath);
      if (response?.error) {
        setFsError(response.error);
        return;
      }

      setFsError('');
      setActiveFilePath(filePath);
      setCode(response?.content ?? '');
      setSavedContent(response?.content ?? '');
    },
    [fileBridge]
  );

  const handleChooseFolder = useCallback(async () => {
    if (!fileBridge?.selectFolder) {
      setFsError('Folder selection is only available inside the Electron shell.');
      return;
    }

    setIsLoading(true);
    try {
      const selection = await fileBridge.selectFolder();
      if (!selection) {
        return;
      }

      setFolderPath(selection.folderPath);
      setTree(selection.tree);

      const firstFile = findFirstFile(selection.tree);
      if (firstFile) {
        await openFile(firstFile.path);
      } else {
        setActiveFilePath('');
        setCode(null);
      }
    } catch (error) {
      setFsError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [fileBridge, openFile]);

  const refreshTree = useCallback(async (pathToRead) => {
    if (!fileBridge?.readTree) return null;
    try {
      const res = await fileBridge.readTree(pathToRead || folderPath);
      if (res?.success) {
        setTree(res.tree);
        return res.tree;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('readTree error', err);
    }
    return null;
  }, [fileBridge, folderPath]);

  const [createRequest, setCreateRequest] = useState(null);

  const onCreateEntry = useCallback(({ basePath, type }) => {
    // signal ProjectTree to start inline creation
    setCreateRequest({ basePath, type });
  }, []);

  const clearCreateRequest = useCallback(() => setCreateRequest(null), []);

  const handleSelectFile = useCallback(
    filePath => {
      openFile(filePath);
    },
    [openFile]
  );

  const activeFileName = getNameFromPath(activeFilePath);

  return (
    <div className="app-shell">
      <TopNav
        onOpenFolder={handleChooseFolder}
        onNewFile={() => onCreateEntry?.({ basePath: folderPath || '.', type: 'file' })}
        onNewFolder={() => onCreateEntry?.({ basePath: folderPath || '.', type: 'folder' })}
        hasFileSystemAccess={hasFileSystemAccess}
        onToggleTerminal={toggleTerminal}
        isTerminalOpen={terminalOpen}
        terminalAvailable={hasTerminalAccess}
      />
      <div className="workspace">
        <AIChatPlaceholder />
        <div className={`editor-column ${terminalOpen ? 'has-terminal' : ''}`}>
          <div className="editor-pane-wrapper">
            <EditorPane
              fileName={activeFileName}
              code={code}
              onChange={setCode}
              warnings={0}
              errors={0}
              dirty={dirty}
              onSave={saveFile}
            />
          </div>
          <TerminalPane
            isOpen={terminalOpen}
            bridge={fileBridge}
            cwd={folderPath}
            onClose={() => setTerminalOpen(false)}
          />
        </div>
        <ProjectTree
          folderPath={folderPath}
          tree={tree}
          activeFilePath={activeFilePath}
          onSelectFile={handleSelectFile}
          onChooseFolder={handleChooseFolder}
          createRequest={createRequest}
          clearCreateRequest={clearCreateRequest}
          onRefresh={refreshTree}
          isLoading={isLoading}
          fsError={fsError}
          hasFileSystemAccess={hasFileSystemAccess}
        />
      </div>
      {/* Inline creation handled inside ProjectTree; modal removed */}
      {import.meta.env.DEV && (
        <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 60 }}>
          <button
            type="button"
            onClick={async () => {
              // eslint-disable-next-line no-console
              console.log('[debug] fileBridge:', fileBridge);
              if (!fileBridge?.selectFolder) {
                // eslint-disable-next-line no-console
                console.warn('[debug] selectFolder not available');
                return;
              }
              try {
                const res = await fileBridge.selectFolder();
                // eslint-disable-next-line no-console
                console.log('[debug] selectFolder result:', res);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[debug] selectFolder error:', err);
              }
            }}
          >
            Test selectFolder
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
