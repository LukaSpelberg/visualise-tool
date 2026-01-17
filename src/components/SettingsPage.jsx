import React, { useState, useCallback, useEffect, useRef } from 'react';
import FontPicker, { getAllGoogleFonts, getFontByName, loadGoogleFont } from './FontPicker.jsx';

const DEFAULT_COLORS = [
  { id: 'primary', name: 'Primary', value: '#4f8ef7' },
  { id: 'secondary', name: 'Secondary', value: '#6c757d' },
  { id: 'accent', name: 'Accent', value: '#45d07b' }
];

const DEFAULT_FONTS = {
  h1: { family: 'Inter', weight: '700', size: '48', case: 'none' },
  h2: { family: 'Inter', weight: '700', size: '36', case: 'none' },
  h3: { family: 'Inter', weight: '600', size: '28', case: 'none' },
  h4: { family: 'Inter', weight: '600', size: '24', case: 'none' },
  h5: { family: 'Inter', weight: '500', size: '20', case: 'none' },
  h6: { family: 'Inter', weight: '500', size: '18', case: 'none' },
  p: { family: 'Inter', weight: '400', size: '16', case: 'none' },
  a: { family: 'Inter', weight: '400', size: '16', case: 'none' }
};

const DEFAULT_SETTINGS = {
  enabled: true,
  colors: DEFAULT_COLORS,
  codeLanguage: 'React',
  fonts: DEFAULT_FONTS,
  customFonts: []
};

const WEIGHT_LABELS = {
  '100': 'Thin',
  '200': 'ExtraLight',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'SemiBold',
  '700': 'Bold',
  '800': 'ExtraBold',
  '900': 'Black'
};

const LANGUAGE_OPTIONS = [
  'React',
  'Svelte',
  'Vue',
  'HTML',
  'Plain HTML/CSS',
  'TypeScript React',
  'Next.js',
  'Astro'
];

const SETTINGS_FILENAME = '.visualise-settings.json';

const SettingsPage = ({ folderPath, fileBridge }) => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsFileExists, setSettingsFileExists] = useState(false);
  const [images, setImages] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [selectedFontElement, setSelectedFontElement] = useState(null);
  const [newColorName, setNewColorName] = useState('');
  const [newColorValue, setNewColorValue] = useState('#888888');
  const [showAddColor, setShowAddColor] = useState(false);
  const [showFontImport, setShowFontImport] = useState(false);
  const [googleFontUrl, setGoogleFontUrl] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const fileInputRef = useRef(null);
  const fontFileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const hasLoadedRef = useRef(false);

  // Get folder name from path
  const getFolderName = (path) => {
    if (!path) return '';
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  };

  // Load settings from project folder on mount or when project changes
  useEffect(() => {
    const loadProjectSettings = async () => {
      if (!folderPath || !fileBridge?.readFile) {
        setIsLoading(false);
        setSettingsFileExists(false);
        return;
      }

      // Use proper path joining for Windows compatibility
      const settingsPath = folderPath.replace(/\\/g, '/') + '/' + SETTINGS_FILENAME;
      console.log('Loading settings from:', settingsPath);

      try {
        const result = await fileBridge.readFile(settingsPath);
        console.log('Load result:', result);
        if (result?.success && result.content) {
          const parsed = JSON.parse(result.content);
          // Migrate old format to new format if needed
          if (parsed.colors && !Array.isArray(parsed.colors)) {
            parsed.colors = Object.entries(parsed.colors).map(([id, value]) => ({
              id,
              name: id.charAt(0).toUpperCase() + id.slice(1),
              value
            }));
          }
          if (parsed.fonts && typeof Object.values(parsed.fonts)[0] === 'string') {
            const newFonts = {};
            Object.entries(parsed.fonts).forEach(([key, family]) => {
              newFonts[key] = { family, weight: '400', size: '16', case: 'none' };
            });
            parsed.fonts = newFonts;
          }
          // Ensure enabled property exists
          if (parsed.enabled === undefined) {
            parsed.enabled = true;
          }
          console.log('Loaded settings:', parsed);
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
          setSettingsFileExists(true);
          hasLoadedRef.current = true;
        } else {
          console.log('No settings file found');
          setSettingsFileExists(false);
          hasLoadedRef.current = true;
        }
      } catch (e) {
        // File doesn't exist or couldn't be read
        console.log('No project settings found:', e);
        setSettingsFileExists(false);
        hasLoadedRef.current = true;
      }
      setIsLoading(false);
    };

    hasLoadedRef.current = false;
    setSettingsFileExists(false);
    setIsLoading(true);
    loadProjectSettings();
  }, [folderPath, fileBridge]);

  // Save settings to project folder with debounce
  const saveProjectSettings = useCallback(async (newSettings) => {
    if (!folderPath || !fileBridge?.saveFile) {
      console.warn('Cannot save: no folderPath or fileBridge.saveFile');
      return;
    }

    // Use proper path joining for Windows compatibility
    const settingsPath = folderPath.replace(/\\/g, '/') + '/' + SETTINGS_FILENAME;

    try {
      setSaveStatus('saving');
      console.log('Saving settings to:', settingsPath);
      const result = await fileBridge.saveFile({
        filePath: settingsPath,
        content: JSON.stringify(newSettings, null, 2)
      });
      console.log('Save result:', result);

      if (!result?.success) {
        console.error('Failed to save project settings:', result?.error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(''), 3000);
        return;
      }

      console.log('Settings saved successfully to:', settingsPath);
      setSaveStatus('saved');
      // Clear the "saved" status after 2 seconds
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      console.error('Failed to save project settings:', e);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  }, [folderPath, fileBridge]);

  // Enable project settings - creates the settings file
  const handleEnableSettings = useCallback(async () => {
    if (!folderPath || !fileBridge?.saveFile) return;

    const settingsPath = folderPath.replace(/\\/g, '/') + '/' + SETTINGS_FILENAME;

    try {
      setSaveStatus('saving');
      const result = await fileBridge.saveFile({
        filePath: settingsPath,
        content: JSON.stringify(DEFAULT_SETTINGS, null, 2)
      });

      if (!result?.success) {
        console.error('Failed to create settings file:', result?.error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(''), 3000);
        return;
      }

      console.log('Settings file created:', settingsPath);
      setSettings(DEFAULT_SETTINGS);
      setSettingsFileExists(true);
      hasLoadedRef.current = true;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      console.error('Failed to create settings file:', e);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  }, [folderPath, fileBridge]);

  // Disconnect - delete the settings file
  const handleDisconnect = useCallback(async () => {
    if (!folderPath || !fileBridge?.deleteEntry) return;

    const settingsPath = folderPath.replace(/\\/g, '/') + '/' + SETTINGS_FILENAME;

    try {
      await fileBridge.deleteEntry({ path: settingsPath });
      console.log('Settings file deleted:', settingsPath);
      setSettingsFileExists(false);
      setSettings(DEFAULT_SETTINGS);
      hasLoadedRef.current = false;
      setShowDisconnectConfirm(false);
    } catch (e) {
      console.error('Failed to delete settings file:', e);
      setShowDisconnectConfirm(false);
    }
  }, [folderPath, fileBridge]);

  // Toggle enabled/disabled
  const handleToggleEnabled = useCallback((enabled) => {
    setSettings(prev => ({ ...prev, enabled }));
  }, []);

  // Debounced save whenever settings change (only if file exists)
  useEffect(() => {
    // Don't save while loading or before initial load completes or if file doesn't exist
    if (isLoading || !hasLoadedRef.current || !settingsFileExists) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule a new save after 500ms of no changes
    saveTimeoutRef.current = setTimeout(() => {
      saveProjectSettings(settings);
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [settings, isLoading, settingsFileExists, saveProjectSettings]);

  // Load images from the project's image folder
  useEffect(() => {
    const loadImages = async () => {
      if (!folderPath || !fileBridge?.readTree) return;

      try {
        const res = await fileBridge.readTree(folderPath);
        if (res?.success) {
          const imageList = findImageFiles(res.tree, folderPath);
          setImages(imageList);
        }
      } catch (err) {
        console.error('Failed to load images:', err);
      }
    };

    loadImages();
  }, [folderPath, fileBridge]);

  const findImageFiles = (nodes, basePath) => {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
    const results = [];

    const walk = (list) => {
      list.forEach(item => {
        if (item.type === 'file') {
          const ext = item.name.toLowerCase().slice(item.name.lastIndexOf('.'));
          if (imageExtensions.includes(ext)) {
            results.push({
              name: item.name,
              path: item.path,
              relativePath: item.path.replace(basePath, '').replace(/^[/\\]/, '')
            });
          }
        } else if (item.type === 'folder' && item.children?.length) {
          walk(item.children);
        }
      });
    };

    walk(nodes);
    return results;
  };

  const getAllFonts = useCallback(() => {
    const googleFonts = getAllGoogleFonts();
    const customFonts = (settings.customFonts || []).map(f => ({
      name: f.name,
      weights: f.weights || ['400']
    }));
    return [...googleFonts, ...customFonts];
  }, [settings.customFonts]);

  const getWeightsForFont = useCallback((fontName) => {
    // First check Google Fonts
    const googleFont = getFontByName(fontName);
    if (googleFont) return googleFont.weights;

    // Then check custom fonts
    const customFont = (settings.customFonts || []).find(f => f.name === fontName);
    if (customFont) return customFont.weights || ['400'];

    return ['400'];
  }, [settings.customFonts]);

  const handleColorChange = (colorId, value) => {
    setSettings(prev => ({
      ...prev,
      colors: prev.colors.map(c => c.id === colorId ? { ...c, value } : c)
    }));
  };

  const handleAddColor = () => {
    if (!newColorName.trim()) return;
    const id = newColorName.toLowerCase().replace(/\s+/g, '-');
    setSettings(prev => ({
      ...prev,
      colors: [...prev.colors, { id, name: newColorName.trim(), value: newColorValue }]
    }));
    setNewColorName('');
    setNewColorValue('#888888');
    setShowAddColor(false);
  };

  const handleRemoveColor = (colorId) => {
    setSettings(prev => ({
      ...prev,
      colors: prev.colors.filter(c => c.id !== colorId)
    }));
  };

  const handleLanguageChange = (value) => {
    setSettings(prev => ({ ...prev, codeLanguage: value }));
  };

  const handleFontPropertyChange = (element, property, value) => {
    setSettings(prev => ({
      ...prev,
      fonts: {
        ...prev.fonts,
        [element]: { ...prev.fonts[element], [property]: value }
      }
    }));
  };

  const handleAddGoogleFont = () => {
    // Extract font name from Google Fonts URL
    const match = googleFontUrl.match(/family=([^:&]+)/);
    if (match) {
      const fontName = decodeURIComponent(match[1].replace(/\+/g, ' '));
      // Try to extract weights
      const weightsMatch = googleFontUrl.match(/wght@([^&]+)/);
      let weights = ['400'];
      if (weightsMatch) {
        weights = weightsMatch[1].split(';').filter(w => /^\d+$/.test(w));
      }

      setSettings(prev => ({
        ...prev,
        customFonts: [...(prev.customFonts || []), { name: fontName, weights, url: googleFontUrl }]
      }));

      // Add the font to the document
      const link = document.createElement('link');
      link.href = googleFontUrl;
      link.rel = 'stylesheet';
      document.head.appendChild(link);

      setGoogleFontUrl('');
      setShowFontImport(false);
    }
  };

  const handleFontFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, '');

    // Create a font face from the file
    const reader = new FileReader();
    reader.onload = async () => {
      const fontFace = new FontFace(fontName, reader.result);
      try {
        await fontFace.load();
        document.fonts.add(fontFace);

        setSettings(prev => ({
          ...prev,
          customFonts: [...(prev.customFonts || []), { name: fontName, weights: ['400'], isLocal: true }]
        }));

        setShowFontImport(false);
      } catch (err) {
        console.error('Failed to load font:', err);
        setUploadStatus('Failed to load font file');
        setTimeout(() => setUploadStatus(''), 3000);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    await uploadImages(files);
  }, [folderPath, fileBridge]);

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    await uploadImages(files);
    e.target.value = '';
  }, [folderPath, fileBridge]);

  const uploadImages = async (files) => {
    if (!folderPath || !fileBridge?.writeFile) {
      setUploadStatus('Please open a project folder first.');
      setTimeout(() => setUploadStatus(''), 3000);
      return;
    }

    const imageFiles = files.filter(file =>
      file.type.startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(file.name)
    );

    if (imageFiles.length === 0) {
      setUploadStatus('No valid image files selected.');
      setTimeout(() => setUploadStatus(''), 3000);
      return;
    }

    setUploadStatus(`Uploading ${imageFiles.length} image(s)...`);

    try {
      const imagesFolder = `${folderPath}/src/assets/images`;

      if (fileBridge.ensureDir) {
        await fileBridge.ensureDir(imagesFolder);
      }

      for (const file of imageFiles) {
        const reader = new FileReader();

        await new Promise((resolve, reject) => {
          reader.onload = async () => {
            try {
              const targetPath = `${imagesFolder}/${file.name}`;
              if (fileBridge.writeFileBinary) {
                await fileBridge.writeFileBinary(targetPath, reader.result);
              } else if (fileBridge.copyFile && file.path) {
                await fileBridge.copyFile(file.path, targetPath);
              } else {
                const base64 = reader.result.split(',')[1];
                await fileBridge.writeFile(targetPath, base64, { encoding: 'base64' });
              }
              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      setUploadStatus(`Successfully uploaded ${imageFiles.length} image(s)!`);

      if (fileBridge.readTree) {
        const res = await fileBridge.readTree(folderPath);
        if (res?.success) {
          const imageList = findImageFiles(res.tree, folderPath);
          setImages(imageList);
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
      setUploadStatus(`Upload failed: ${err.message}`);
    }

    setTimeout(() => setUploadStatus(''), 3000);
  };

  const copyImagePath = (relativePath) => {
    navigator.clipboard.writeText(relativePath);
    setUploadStatus(`Copied: ${relativePath}`);
    setTimeout(() => setUploadStatus(''), 2000);
  };

  const selectedFontConfig = selectedFontElement ? settings.fonts[selectedFontElement] : null;
  const availableWeights = selectedFontConfig ? getWeightsForFont(selectedFontConfig.family) : [];

  if (isLoading) {
    return (
      <section className="panel panel-settings">
        <div className="panel-header settings-header">
          <h2 style={{ margin: 0 }}>Settings</h2>
        </div>
        <div className="panel-body settings-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#888', fontSize: '14px' }}>Loading project settings...</p>
        </div>
      </section>
    );
  }

  if (!folderPath) {
    return (
      <section className="panel panel-settings">
        <div className="panel-header settings-header">
          <h2 style={{ margin: 0 }}>Settings</h2>
        </div>
        <div className="panel-body settings-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
          <p style={{ color: '#888', fontSize: '14px' }}>No project open</p>
          <p style={{ color: '#666', fontSize: '12px' }}>Open a folder to configure project-specific settings</p>
        </div>
      </section>
    );
  }

  // Onboarding screen - show when settings file doesn't exist yet
  if (!settingsFileExists) {
    return (
      <section className="panel panel-settings">
        <div className="panel-header settings-header">
          <h2 style={{ margin: 0 }}>Settings</h2>
        </div>
        <div className="panel-body settings-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="settings-onboarding">
            <div className="settings-onboarding-icon">⚙️</div>
            <h3 className="settings-onboarding-title">Enable Project Settings</h3>
            <p className="settings-onboarding-description">
              Project settings let you customize colors, typography, and preferences that the AI will use when generating components for this project.
            </p>
            <div className="settings-onboarding-path">
              <span className="settings-onboarding-path-label">Project folder:</span>
              <span className="settings-onboarding-path-value">{folderPath}</span>
            </div>
            <p className="settings-onboarding-note">
              This will create a <code>.visualise-settings.json</code> file in your project folder.
            </p>
            <button
              className="settings-onboarding-btn"
              onClick={handleEnableSettings}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Creating...' : "Let's Go"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-settings">
      <div className="panel-header settings-header">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <div className="settings-save-status">
          {saveStatus === 'saving' && <span className="save-indicator saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="save-indicator saved">✓ Saved</span>}
          {saveStatus === 'error' && <span className="save-indicator error">Failed to save</span>}
        </div>
      </div>

      <div className="panel-body settings-body">
        <div className="settings-stack">
          {/* Enabled Toggle & Disconnect */}
          <div className="settings-section settings-control-section">
            <div className="settings-control-row">
              <div className="settings-control-left">
                <label className="settings-toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => handleToggleEnabled(e.target.checked)}
                    className="settings-toggle-checkbox"
                  />
                  <span className="settings-toggle-switch"></span>
                  <span className="settings-toggle-text">
                    {settings.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
                {!settings.enabled && (
                  <span className="settings-disabled-hint">AI won't use these settings</span>
                )}
              </div>
              <button
                className="settings-disconnect-btn"
                onClick={() => setShowDisconnectConfirm(true)}
                title="Remove settings file from project"
              >
                Disconnect
              </button>
            </div>

            {showDisconnectConfirm && (
              <div className="settings-disconnect-confirm">
                <p>Delete <code>.visualise-settings.json</code> from this project?</p>
                <div className="settings-disconnect-actions">
                  <button className="settings-btn-danger" onClick={handleDisconnect}>
                    Yes, Delete
                  </button>
                  <button className="settings-btn-cancel" onClick={() => setShowDisconnectConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Colors Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Colors</h3>
            <p className="settings-section-description">
              Set your preferred color palette. The AI will use these colors when generating components.
            </p>
            <div className="settings-color-list">
              {settings.colors.map((color) => (
                <div key={color.id} className="settings-color-row">
                  <div className="settings-color-input-wrapper">
                    <input
                      type="color"
                      value={color.value}
                      onChange={(e) => handleColorChange(color.id, e.target.value)}
                      className="settings-color-picker"
                    />
                    <input
                      type="text"
                      value={color.value}
                      onChange={(e) => handleColorChange(color.id, e.target.value)}
                      className="settings-color-text"
                      placeholder="#000000"
                    />
                  </div>
                  <span className="settings-color-name">{color.name}</span>
                  <button
                    type="button"
                    className="settings-color-remove"
                    onClick={() => handleRemoveColor(color.id)}
                    title="Remove color"
                  >
                    ×
                  </button>
                </div>
              ))}

              {showAddColor ? (
                <div className="settings-color-add-form">
                  <div className="settings-color-input-wrapper">
                    <input
                      type="color"
                      value={newColorValue}
                      onChange={(e) => setNewColorValue(e.target.value)}
                      className="settings-color-picker"
                    />
                    <input
                      type="text"
                      value={newColorValue}
                      onChange={(e) => setNewColorValue(e.target.value)}
                      className="settings-color-text"
                      placeholder="#000000"
                    />
                  </div>
                  <input
                    type="text"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.target.value)}
                    className="settings-color-name-input"
                    placeholder="Color name (e.g., Warning)"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddColor()}
                  />
                  <button
                    type="button"
                    className="settings-btn-confirm"
                    onClick={handleAddColor}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="settings-btn-cancel"
                    onClick={() => setShowAddColor(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="settings-add-color-btn"
                  onClick={() => setShowAddColor(true)}
                >
                  + Add Color
                </button>
              )}
            </div>
          </div>

          {/* Language Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Code Language</h3>
            <p className="settings-section-description">
              Choose your preferred framework or language for generated code.
            </p>
            <select
              value={settings.codeLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="settings-select"
            >
              {LANGUAGE_OPTIONS.map(lang => (
                <option key={lang} value={lang} disabled={lang !== 'Plain HTML/CSS'}>
                  {lang} {lang !== 'Plain HTML/CSS' ? '(Coming Soon)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Typography Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Typography</h3>
            <p className="settings-section-description">
              Define fonts for different text elements. Click an element to configure its typography.
            </p>

            <div className="settings-typography-container">
              <div className="settings-font-list">
                {Object.entries(settings.fonts).map(([element, config]) => (
                  <button
                    key={element}
                    type="button"
                    className={`settings-font-row ${selectedFontElement === element ? 'selected' : ''}`}
                    onClick={() => setSelectedFontElement(selectedFontElement === element ? null : element)}
                  >
                    <span className="settings-font-element">{element.toUpperCase()}</span>
                    <span className="settings-font-preview" style={{ fontFamily: config.family }}>
                      {config.family} · {WEIGHT_LABELS[config.weight] || config.weight} · {config.size}px
                    </span>
                  </button>
                ))}
              </div>

              {selectedFontElement && selectedFontConfig && (
                <div className="settings-typography-panel">
                  <div className="settings-panel-header">
                    <span>Typography - {selectedFontElement.toUpperCase()}</span>
                    <button
                      type="button"
                      className="settings-panel-close"
                      onClick={() => setSelectedFontElement(null)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="settings-panel-body">
                    {/* Font Family */}
                    <div className="settings-panel-field">
                      <label>Font</label>
                      <FontPicker
                        value={selectedFontConfig.family}
                        onChange={(fontName) => handleFontPropertyChange(selectedFontElement, 'family', fontName)}
                        customFonts={settings.customFonts || []}
                      />
                      <button
                        type="button"
                        className="settings-import-font-btn"
                        onClick={() => setShowFontImport(!showFontImport)}
                      >
                        + Import Custom Font
                      </button>
                    </div>

                    {showFontImport && (
                      <div className="settings-font-import-area">
                        <div className="settings-import-option">
                          <label>Google Fonts URL</label>
                          <div className="settings-import-row">
                            <input
                              type="text"
                              value={googleFontUrl}
                              onChange={(e) => setGoogleFontUrl(e.target.value)}
                              placeholder="https://fonts.googleapis.com/css2?family=..."
                              className="settings-import-input"
                            />
                            <button
                              type="button"
                              className="settings-btn-confirm"
                              onClick={handleAddGoogleFont}
                              disabled={!googleFontUrl}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                        <div className="settings-import-divider">or</div>
                        <div className="settings-import-option">
                          <label>Upload Font File</label>
                          <input
                            ref={fontFileInputRef}
                            type="file"
                            accept=".ttf,.otf,.woff,.woff2"
                            onChange={handleFontFileUpload}
                            style={{ display: 'none' }}
                          />
                          <button
                            type="button"
                            className="settings-upload-font-btn"
                            onClick={() => fontFileInputRef.current?.click()}
                          >
                            Choose .ttf / .otf file
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Weight */}
                    <div className="settings-panel-field">
                      <label>Boldness</label>
                      <select
                        value={selectedFontConfig.weight}
                        onChange={(e) => handleFontPropertyChange(selectedFontElement, 'weight', e.target.value)}
                        className="settings-panel-select"
                      >
                        {availableWeights.map(w => (
                          <option key={w} value={w}>{WEIGHT_LABELS[w] || w}</option>
                        ))}
                      </select>
                    </div>

                    {/* Size */}
                    <div className="settings-panel-field">
                      <label>Size (px)</label>
                      <input
                        type="number"
                        value={selectedFontConfig.size}
                        onChange={(e) => handleFontPropertyChange(selectedFontElement, 'size', e.target.value)}
                        className="settings-panel-input"
                        min="8"
                        max="200"
                      />
                    </div>

                    {/* Case */}
                    <div className="settings-panel-field">
                      <label>Case</label>
                      <div className="settings-case-toggle">
                        {[
                          { value: 'none', label: '—', title: 'None' },
                          { value: 'uppercase', label: 'AG', title: 'UPPERCASE' },
                          { value: 'lowercase', label: 'ag', title: 'lowercase' },
                          { value: 'capitalize', label: 'Ag', title: 'Capitalize' }
                        ].map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`settings-case-btn ${selectedFontConfig.case === opt.value ? 'active' : ''}`}
                            onClick={() => handleFontPropertyChange(selectedFontElement, 'case', opt.value)}
                            title={opt.title}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Preview */}
                    <div className="settings-panel-field">
                      <label>Preview</label>
                      <div
                        className="settings-font-preview-box"
                        style={{
                          fontFamily: selectedFontConfig.family,
                          fontWeight: selectedFontConfig.weight,
                          fontSize: `${Math.min(parseInt(selectedFontConfig.size) || 16, 32)}px`,
                          textTransform: selectedFontConfig.case === 'none' ? 'none' : selectedFontConfig.case
                        }}
                      >
                        The quick brown fox jumps over the lazy dog
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Image Bank Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Image Bank</h3>
            <p className="settings-section-description">
              Upload images to your project. The AI can reference these when building components.
              Images are saved to <code>src/assets/images/</code>
            </p>

            <div
              className={`settings-image-dropzone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div className="settings-dropzone-content">
                <div className="settings-dropzone-icon">📁</div>
                <div className="settings-dropzone-text">
                  Click or drag images here to upload
                </div>
                <div className="settings-dropzone-hint">
                  PNG, JPG, SVG, WebP, GIF
                </div>
              </div>
            </div>

            {uploadStatus && (
              <div className="settings-upload-status">{uploadStatus}</div>
            )}

            {images.length > 0 && (
              <div className="settings-image-grid">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="settings-image-item"
                    onClick={() => copyImagePath(img.relativePath)}
                    title={`Click to copy path: ${img.relativePath}`}
                  >
                    <div className="settings-image-preview">
                      {img.name.endsWith('.svg') ? (
                        <div className="settings-image-placeholder">SVG</div>
                      ) : (
                        <div className="settings-image-placeholder">IMG</div>
                      )}
                    </div>
                    <div className="settings-image-name">{img.name}</div>
                  </div>
                ))}
              </div>
            )}

            {images.length === 0 && !uploadStatus && (
              <div className="settings-no-images">
                No images found in your project yet. Upload some to get started!
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SettingsPage;
