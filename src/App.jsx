import React, { useCallback, useEffect, useState } from 'react';
import EditorPane from './components/EditorPane.jsx';
import ProjectTree from './components/ProjectTree.jsx';
import AIChatPlaceholder from './components/AIChatPlaceholder.jsx';
import TerminalPane from './components/TerminalPane.jsx';
import VisualPreview from './components/VisualPreview.jsx';
import TopNav from './components/TopNav.jsx';
import ComponentsPage from './components/ComponentsPage.jsx';
import CreateComponentPage from './components/CreateComponentPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import BuildPlanPreview from './components/BuildPlanPreview.jsx';
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
  const [viewMode, setViewMode] = useState('code'); // 'code' | 'visual'
  const [previewUrl, setPreviewUrl] = useState('');
  const [aiActiveTab, setAiActiveTab] = useState('build');
  // Open tabs: array of { path, name, content, savedContent }
  const [openTabs, setOpenTabs] = useState([]);
  // Build plan preview state
  const [activeBuildPlan, setActiveBuildPlan] = useState(null);
  const [buildPlanOpen, setBuildPlanOpen] = useState(false);
  const [creatingComponent, setCreatingComponent] = useState(false);
  const [componentForm, setComponentForm] = useState({ name: '', useCase: '', language: 'React' });
  const [componentAnalysis, setComponentAnalysis] = useState('');
  const [componentHasImage, setComponentHasImage] = useState(false);
  const [componentBuild, setComponentBuild] = useState({
    status: 'idle',
    variations: [],
    targetDir: '',
    baseFileName: '',
    extension: '',
    selectedVariation: null,
    error: ''
  });
  const [componentFiles, setComponentFiles] = useState([]);
  const [isTestMode, setIsTestMode] = useState(false);

  const resetComponentWorkflow = useCallback(() => {
    setComponentForm({ name: '', useCase: '', language: 'React' });
    setComponentAnalysis('');
    setComponentHasImage(false);
    setIsTestMode(false);
    setComponentBuild({
      status: 'idle',
      variations: [],
      targetDir: '',
      baseFileName: '',
      extension: '',
      selectedVariation: null,
      error: ''
    });
  }, []);

  const extractComponentFiles = useCallback(nodes => {
    if (!nodes) return [];
    const results = [];
    const walk = list => {
      list.forEach(item => {
        if (item.type === 'folder' && item.name === 'componentAI') {
          (item.children || []).forEach(child => {
            if (child.type === 'file') {
              results.push({ name: child.name, path: child.path });
            }
          });
        } else if (item.type === 'folder' && item.children?.length) {
          walk(item.children);
        }
      });
    };
    walk(nodes);
    return results;
  }, []);

  // wrapper so we can clear component-creation mode when switching away
  const handleAiTabChange = tab => {
    setAiActiveTab(tab);
    if (tab !== 'components') {
      setCreatingComponent(false);
      resetComponentWorkflow();
    }
  };

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

  const componentFieldsComplete = Boolean(
    componentForm.name.trim() && componentForm.useCase.trim() && componentForm.language.trim()
  );
  const analysisReady = componentAnalysis.trim().length > 0;

  const handleComponentFormChange = useCallback(updates => {
    setComponentForm(prev => ({ ...prev, ...updates }));
    setComponentBuild(prev => (prev.status === 'idle' ? prev : {
      status: 'idle',
      variations: [],
      targetDir: '',
      baseFileName: '',
      extension: '',
      selectedVariation: null,
      error: ''
    }));
  }, []);

  const handleAnalysisChange = useCallback(value => {
    setComponentAnalysis(value);
    setComponentBuild(prev => (prev.status === 'idle' ? prev : {
      status: 'idle',
      variations: [],
      targetDir: '',
      baseFileName: '',
      extension: '',
      selectedVariation: null,
      error: ''
    }));
  }, []);

  const handleImageStatusChange = useCallback(hasImage => {
    setComponentHasImage(hasImage);
    if (!hasImage) {
      handleAnalysisChange('');
    }
  }, [handleAnalysisChange]);

  const guessLanguageLabel = useCallback(fileName => {
    const ext = fileName?.split('.').pop()?.toLowerCase() || '';
    if (ext === 'jsx' || ext === 'tsx' || ext === 'js' || ext === 'ts') return 'React';
    if (ext === 'svelte') return 'Svelte';
    if (ext === 'vue') return 'Vue';
    if (ext === 'html' || ext === 'htm') return 'HTML';
    return 'Plain HTML/CSS';
  }, []);

  const handleOpenComponent = useCallback(async filePath => {
    if (!fileBridge?.readFile || !filePath) return;
    try {
      const res = await fileBridge.readFile(filePath);
      if (res?.error) {
        window.alert(res.error);
        return;
      }
      const namePart = getNameFromPath(filePath).replace(/\.[^.]+$/, '');
      const language = guessLanguageLabel(filePath);
      setComponentForm({ name: namePart, useCase: 'Existing component', language });
      setComponentAnalysis('');
      setComponentHasImage(false);
      setComponentBuild({
        status: 'done-selected',
        variations: [],
        targetDir: '',
        baseFileName: '',
        extension: '',
        selectedVariation: {
          id: 1,
          code: res.content || '',
          filePath,
          success: true
        },
        error: ''
      });
      setAiActiveTab('components');
      setCreatingComponent(true);
    } catch (err) {
      window.alert(err?.message || 'Failed to open component');
    }
  }, [fileBridge, guessLanguageLabel]);

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

  const toggleViewMode = useCallback(async () => {
    if (viewMode === 'code') {
      // Switch to visual mode - start preview server
      if (!fileBridge?.startPreviewServer) {
        window.alert('Preview server is only available in the Electron shell.');
        return;
      }
      if (!folderPath) {
        window.alert('Please open a folder first.');
        return;
      }

      try {
        const result = await fileBridge.startPreviewServer({ folderPath });
        if (result?.success) {
          setPreviewUrl(result.url);
          setViewMode('visual');
        } else if (result?.needsRuntime) {
          const suggested = result.suggestedCommand ? `\nTry: ${result.suggestedCommand}` : '';
          // Non-blocking notification to avoid interfering with terminal input focus
          console.warn(result.error || 'This project needs a dev server running.', suggested);
        } else {
          window.alert(`Failed to start preview server: ${result?.error || 'Unknown error'}`);
        }
      } catch (error) {
        window.alert(`Error starting preview: ${error.message}`);
      }
    } else {
      // Switch back to code mode
      setViewMode('code');
      if (fileBridge?.stopPreviewServer) {
        fileBridge.stopPreviewServer().catch(err => {
          // eslint-disable-next-line no-console
          console.error('Error stopping preview server:', err);
        });
      }
    }
  }, [viewMode, fileBridge, folderPath]);

  const saveFile = useCallback(async () => {
    if (!fileBridge?.saveFile || !activeFilePath) return;
    try {
      const res = await fileBridge.saveFile({ filePath: activeFilePath, content: code });
      if (res?.filePath) {
        setSavedContent(code);
        // Update the tab's savedContent
        setOpenTabs(prev => prev.map(tab =>
          tab.path === activeFilePath ? { ...tab, savedContent: code, content: code } : tab
        ));
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

      // Check if file is already open in a tab
      const existingTab = openTabs.find(tab => tab.path === filePath);
      if (existingTab) {
        setActiveFilePath(filePath);
        setCode(existingTab.content);
        setSavedContent(existingTab.savedContent);
        setFsError('');
        return;
      }

      const response = await fileBridge.readFile(filePath);
      if (response?.error) {
        setFsError(response.error);
        return;
      }

      const content = response?.content ?? '';
      const fileName = getNameFromPath(filePath);

      // Add new tab
      setOpenTabs(prev => [...prev, {
        path: filePath,
        name: fileName,
        content,
        savedContent: content
      }]);

      setFsError('');
      setActiveFilePath(filePath);
      setCode(content);
      setSavedContent(content);
    },
    [fileBridge, openTabs]
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
      setComponentFiles(extractComponentFiles(selection.tree));

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
        setComponentFiles(extractComponentFiles(res.tree));
        return res.tree;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('readTree error', err);
    }
    return null;
  }, [fileBridge, folderPath]);

  const handleBuildComponent = useCallback(async () => {
    if (!componentFieldsComplete || !analysisReady) return;

    if (!window.editorAPI?.buildComponent) {
      window.alert('Component builder is only available in the Electron shell.');
      return;
    }

    if (!folderPath) {
      window.alert('Open a folder before building a component.');
      return;
    }

    setComponentBuild({
      status: 'building',
      variations: [],
      targetDir: '',
      baseFileName: '',
      extension: '',
      selectedVariation: null,
      error: ''
    });

    try {
      // Load user settings from project file to provide as context
      let userSettings = null;
      try {
        const settingsPath = `${folderPath}/.visualise-settings.json`;
        const settingsResult = await fileBridge?.readFile?.(settingsPath);
        if (settingsResult?.success && settingsResult.content) {
          const parsed = JSON.parse(settingsResult.content);
          // Only use settings if they're enabled
          if (parsed.enabled !== false) {
            userSettings = parsed;
          }
        }
      } catch (e) {
        // Settings file doesn't exist, continue without it
      }

      const res = await window.editorAPI.buildComponent({
        folderPath,
        name: componentForm.name,
        useCase: componentForm.useCase,
        language: componentForm.language,
        analysis: componentAnalysis,
        userSettings
      });

      if (!res?.success) {
        setComponentBuild({
          status: 'error',
          variations: [],
          targetDir: '',
          baseFileName: '',
          extension: '',
          selectedVariation: null,
          error: res?.error || 'Build failed.'
        });
        return;
      }

      setComponentBuild({
        status: 'done',
        variations: res.variations || [],
        targetDir: res.targetDir || '',
        baseFileName: res.baseFileName || '',
        extension: res.variations?.[0]?.extension || '',
        selectedVariation: null,
        error: ''
      });
    } catch (err) {
      setComponentBuild({
        status: 'error',
        variations: [],
        targetDir: '',
        baseFileName: '',
        extension: '',
        selectedVariation: null,
        error: err?.message || 'Unexpected build error.'
      });
    }
  }, [analysisReady, componentAnalysis, componentFieldsComplete, componentForm.language, componentForm.name, componentForm.useCase, folderPath]);

  const handleSelectVariation = useCallback(async (selectedId) => {
    if (!window.editorAPI?.selectComponentVariation) {
      window.alert('Component selection is only available in the Electron shell.');
      return;
    }

    try {
      const res = await window.editorAPI.selectComponentVariation({
        selectedId,
        variations: componentBuild.variations,
        targetDir: componentBuild.targetDir,
        baseFileName: componentBuild.baseFileName,
        extension: componentBuild.extension
      });

      if (!res?.success) {
        window.alert(res?.error || 'Failed to select variation.');
        return;
      }

      // Update state to show the selected variation
      const selectedVariation = componentBuild.variations.find(v => v.id === selectedId);
      setComponentBuild(prev => ({
        ...prev,
        status: 'done-selected',
        selectedVariation: {
          ...selectedVariation,
          filePath: res.filePath,
          code: res.code
        }
      }));

      // Refresh the tree to show the new file
      const newTree = await refreshTree();
      if (newTree) {
        setComponentFiles(extractComponentFiles(newTree));
      }
    } catch (err) {
      window.alert(err?.message || 'Failed to select variation.');
    }
  }, [componentBuild.variations, componentBuild.targetDir, componentBuild.baseFileName, componentBuild.extension, refreshTree, extractComponentFiles]);

  const handleEditElement = useCallback(async ({ element, prompt, fullCode }) => {
    if (!window.editorAPI?.editComponentElement) {
      window.alert('Element editing is only available in the Electron shell.');
      return;
    }

    try {
      // Load user settings from project file to provide as context
      let userSettings = null;
      try {
        const settingsPath = `${folderPath}/.visualise-settings.json`;
        const settingsResult = await fileBridge?.readFile?.(settingsPath);
        if (settingsResult?.success && settingsResult.content) {
          const parsed = JSON.parse(settingsResult.content);
          // Only use settings if they're enabled
          if (parsed.enabled !== false) {
            userSettings = parsed;
          }
        }
      } catch (e) {
        // Settings file doesn't exist, continue without it
      }

      const res = await window.editorAPI.editComponentElement({
        element,
        prompt,
        fullCode,
        language: componentForm.language,
        userSettings
      });

      if (!res?.success) {
        window.alert(res?.error || 'Failed to edit element.');
        return;
      }

      // Update the component code with the edited version
      setComponentBuild(prev => ({
        ...prev,
        selectedVariation: {
          ...prev.selectedVariation,
          code: res.updatedCode
        }
      }));

      // Save to file if it exists
      if (componentBuild.selectedVariation?.filePath && fileBridge?.writeFile) {
        await fileBridge.writeFile(componentBuild.selectedVariation.filePath, res.updatedCode);
      }
      return res;
    } catch (err) {
      window.alert(err?.message || 'Failed to edit element.');
      return null;
    }
  }, [componentForm.language, componentBuild.selectedVariation?.filePath, fileBridge]);

  const [createRequest, setCreateRequest] = useState(null);

  const onCreateEntry = useCallback(({ basePath, type }) => {
    // signal ProjectTree to start inline creation
    setCreateRequest({ basePath, type });
  }, []);

  const clearCreateRequest = useCallback(() => setCreateRequest(null), []);

  // Close a tab
  const closeTab = useCallback((filePath) => {
    setOpenTabs(prev => {
      const filtered = prev.filter(tab => tab.path !== filePath);
      // If closing the active tab, switch to another one
      if (filePath === activeFilePath && filtered.length > 0) {
        const lastTab = filtered[filtered.length - 1];
        setActiveFilePath(lastTab.path);
        setCode(lastTab.content);
        setSavedContent(lastTab.savedContent);
      } else if (filtered.length === 0) {
        setActiveFilePath('');
        setCode(null);
        setSavedContent(null);
      }
      return filtered;
    });
  }, [activeFilePath]);

  // Switch to a tab
  const switchTab = useCallback((filePath) => {
    // Save current tab's content first
    if (activeFilePath) {
      setOpenTabs(prev => prev.map(tab =>
        tab.path === activeFilePath ? { ...tab, content: code } : tab
      ));
    }

    const tab = openTabs.find(t => t.path === filePath);
    if (tab) {
      setActiveFilePath(filePath);
      setCode(tab.content);
      setSavedContent(tab.savedContent);
    }
  }, [activeFilePath, code, openTabs]);

  // Sync code changes to the current tab
  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    setOpenTabs(prev => prev.map(tab =>
      tab.path === activeFilePath ? { ...tab, content: newCode } : tab
    ));
  }, [activeFilePath]);

  const handleSelectFile = useCallback(
    filePath => {
      // Save current tab's content before switching
      if (activeFilePath) {
        setOpenTabs(prev => prev.map(tab =>
          tab.path === activeFilePath ? { ...tab, content: code } : tab
        ));
      }
      openFile(filePath);
    },
    [openFile, activeFilePath, code]
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
        <AIChatPlaceholder
          activeTab={aiActiveTab}
          onActiveTabChange={handleAiTabChange}
          isCreatingComponent={creatingComponent}
          componentForm={componentForm}
          onComponentFormChange={handleComponentFormChange}
          fieldsComplete={componentFieldsComplete}
          hasImage={componentHasImage}
          analysisReady={analysisReady}
          onBuild={handleBuildComponent}
          buildState={componentBuild}
          folderPath={folderPath}
          fileBridge={fileBridge}
          onOpenBuildPlan={(plan) => {
            setActiveBuildPlan(plan);
            setBuildPlanOpen(true);
          }}
        />
        {viewMode === 'code' ? (
          aiActiveTab === 'components' ? (
            creatingComponent ? (
              // show the create screen
              <CreateComponentPage
                onBack={() => {
                  resetComponentWorkflow();
                  setCreatingComponent(false);
                }}
                fieldsComplete={componentFieldsComplete}
                analysis={componentAnalysis}
                onAnalysisChange={handleAnalysisChange}
                hasImage={componentHasImage}
                onImageStatusChange={handleImageStatusChange}
                componentForm={componentForm}
                buildState={componentBuild}
                onSelectVariation={handleSelectVariation}
                onUpdateCode={code => {
                  setComponentBuild(prev => ({
                    ...prev,
                    selectedVariation: {
                      ...prev.selectedVariation,
                      code
                    }
                  }));
                }}
                onEditElement={handleEditElement}
                isTestMode={isTestMode}
              />
            ) : (
              <ComponentsPage
                onImport={handleChooseFolder}
                onCreate={() => {
                  resetComponentWorkflow();
                  setCreatingComponent(true);
                }}
                onCreateTest={() => {
                  resetComponentWorkflow();
                  setIsTestMode(true);
                  setComponentForm({ name: 'TestComponent', useCase: 'Testing the component builder', language: 'React' });
                  setComponentAnalysis('');
                  setCreatingComponent(true);
                }}
                components={componentFiles}
                onOpenComponent={handleOpenComponent}
              />
            )
          ) : aiActiveTab === 'settings' ? (
            <SettingsPage
              folderPath={folderPath}
              fileBridge={fileBridge}
            />
          ) : (
            <>
              <div className={`editor-column ${terminalOpen ? 'has-terminal' : ''}`}>
                <div className="editor-pane-wrapper">
                  {buildPlanOpen && activeBuildPlan ? (
                    <BuildPlanPreview
                      plan={activeBuildPlan}
                      onSendFeedback={(feedback) => {
                        // This will be handled by passing a callback from BuildChat
                        if (window.__buildPlanFeedbackHandler) {
                          window.__buildPlanFeedbackHandler(feedback);
                        }
                        setBuildPlanOpen(false);
                        setActiveBuildPlan(null);
                      }}
                      onClose={() => {
                        setBuildPlanOpen(false);
                        setActiveBuildPlan(null);
                      }}
                      openTabs={openTabs}
                      activeFilePath={activeFilePath}
                      onTabClick={(path) => {
                        setBuildPlanOpen(false);
                        setActiveBuildPlan(null);
                        switchTab(path);
                      }}
                      onTabClose={closeTab}
                    />
                  ) : (
                    <EditorPane
                      fileName={activeFileName}
                      code={code}
                      onChange={handleCodeChange}
                      warnings={0}
                      errors={0}
                      dirty={dirty}
                      onSave={saveFile}
                      viewMode={viewMode}
                      onToggleView={toggleViewMode}
                      openTabs={openTabs}
                      activeFilePath={activeFilePath}
                      onTabClick={switchTab}
                      onTabClose={closeTab}
                    />
                  )}
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
            </>
          )
        ) : (
          <VisualPreview url={previewUrl} onBack={toggleViewMode} />
        )}
      </div>
      {/* Inline creation handled inside ProjectTree; modal removed */}
      {/* Developer debug button removed - left in codebase nothing for end users */}
    </div>
  );
};

export default App;
