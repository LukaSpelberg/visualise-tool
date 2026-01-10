import React, { useState, useRef, useEffect, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import desktopIcon from '../assets/icons/desktop.svg';
import laptopIcon from '../assets/icons/laptop.svg';
import mobileIcon from '../assets/icons/mobile.svg';
import imageIcon from '../assets/icons/image.svg';
import VersionHistory from './VersionHistory.jsx';
import { useVersionHistory } from '../hooks/useVersionHistory.js';

const DeviceSelector = ({ value, onChange }) => {
  const devices = [
    { id: 'desktop', icon: desktopIcon, label: 'Desktop' },
    { id: 'laptop', icon: laptopIcon, label: 'Laptop' },
    { id: 'mobile', icon: mobileIcon, label: 'Mobile' }
  ];

  return (
    <div className="device-selector">
      {devices.map(d => (
        <button
          key={d.id}
          type="button"
          className={`mode-button ${value === d.id ? 'selected' : ''}`}
          onClick={() => onChange(d.id)}
          title={d.label}
        >
          <span className="mode-icon" style={{ ['--icon-url']: `url(${d.icon})` }} aria-hidden />
        </button>
      ))}
    </div>
  );
};

const CreateComponentPage = ({
  onBack,
  fieldsComplete,
  analysis,
  onAnalysisChange,
  hasImage,
  onImageStatusChange,
  buildState = {},
  componentForm = {},
  onSelectVariation,
  isTestMode = false,
  onEditElement,
  onUpdateCode
}) => {
  // Version history hook
  const {
    versions,
    currentIndex,
    addVersion,
    goToVersion,
    currentVersion,
    reset: resetHistory
  } = useVersionHistory(null, 'Initial Build');

  // State variables (restored)
  const [device, setDevice] = useState('desktop');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [buildView, setBuildView] = useState('visual');
  const [editMode, setEditMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef(null);
  const previewIframeRef = useRef(null);
  const typingInterval = useRef(null);
  const typingPhase = useRef('typing');
  const typingIndex = useRef(0);
  const typingChar = useRef(0);
  const [typingText, setTypingText] = useState('');

  // Initialize history when a variation is selected
  const [currentVariationId, setCurrentVariationId] = useState(null);

  useEffect(() => {
    const varId = buildState?.selectedVariation?.id;
    // Only reset if we change variation locally OR if we just built/selected a fresh one
    // But be careful not to reset if we just undid/redid (which also updates selectedVariation)
    // We can detecting "undo/redo" by comparing *currentVersion* to *newProps*. 
    // If they match, it's likely our own doing.
    // If they mismatch, it's a "fresh" selection.

    // Simplification: logic to reset history only when ID changes
    if (varId && varId !== currentVariationId) {
      setCurrentVariationId(varId);
      resetHistory(buildState.selectedVariation.code, 'Initial Build');
    }
  }, [buildState?.selectedVariation?.id, buildState?.selectedVariation?.code, resetHistory, currentVariationId]);

  // Handle restoring a version
  const handleRestoreVersion = (index) => {
    goToVersion(index);
    const version = versions[index];
    if (version && onUpdateCode) {
      onUpdateCode(version.data);
    }
  };

  // Pending prompt to attach to the next code change
  const pendingPromptRef = useRef(null);

  const handleSubmitEdit = async () => {
    if (!editPrompt.trim() || !selectedElement || !onEditElement) return;

    setIsEditing(true);
    try {
      pendingPromptRef.current = editPrompt;
      const res = await onEditElement({
        element: selectedElement,
        prompt: editPrompt,
        fullCode: codeForDisplay
      });

      // If onEditElement returns the new code, use it to update history immediately
      if (res && res.updatedCode) {
        addVersion(res.updatedCode, editPrompt);
        pendingPromptRef.current = null;
      }

      setEditPrompt('');
      setSelectedElement(null);
    } catch (err) {
      console.error('Edit failed:', err);
    } finally {
      setIsEditing(false);
    }
  };

  // Also watch for code changes if we couldn't capture it in handleSubmitEdit
  useEffect(() => {
    // If code changed and it matches what we expect from a pending prompt...
    // Actually, handling it in handleSubmitEdit is safer if we update App.jsx
  }, []);


  const handleToggleEditMode = () => {
    setEditMode(!editMode);
    setSelectedElement(null);
    setEditPrompt('');
  };



  useEffect(() => {
    if (buildState?.status === 'done-selected') {
      setBuildView('visual');
      setEditMode(false);
      setSelectedElement(null);
      setEditPrompt('');
    }
  }, [buildState?.status]);

  // Enable/disable element selection in iframe
  useEffect(() => {
    if (!editMode || buildView !== 'visual' || !previewIframeRef.current) {
      return;
    }

    const iframe = previewIframeRef.current;

    const setupInspector = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) return;

        // Inject inspector styles
        let styleEl = iframeDoc.getElementById('inspector-styles');
        if (!styleEl) {
          styleEl = iframeDoc.createElement('style');
          styleEl.id = 'inspector-styles';
          styleEl.textContent = `
            .inspector-highlight {
              outline: 2px solid #00d9ff !important;
              outline-offset: 2px !important;
              cursor: pointer !important;
            }
            .inspector-selected {
              outline: 3px solid #00ff88 !important;
              outline-offset: 2px !important;
              background: rgba(0, 255, 136, 0.1) !important;
            }
          `;
          iframeDoc.head.appendChild(styleEl);
        }

        // Add hover and click handlers
        const handleMouseOver = (e) => {
          if (e.target.classList.contains('inspector-selected')) return;
          e.target.classList.add('inspector-highlight');
        };

        const handleMouseOut = (e) => {
          e.target.classList.remove('inspector-highlight');
        };

        const handleClick = (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Remove previous selection
          const prevSelected = iframeDoc.querySelector('.inspector-selected');
          if (prevSelected) {
            prevSelected.classList.remove('inspector-selected', 'inspector-highlight');
          }

          // Add new selection
          e.target.classList.add('inspector-selected');
          e.target.classList.remove('inspector-highlight');

          // Extract element info
          const tagName = e.target.tagName.toLowerCase();
          const classes = Array.from(e.target.classList)
            .filter(c => !c.startsWith('inspector-'))
            .join(' ');
          const innerHTML = e.target.innerHTML;
          const outerHTML = e.target.outerHTML;

          setSelectedElement({
            tagName,
            classes,
            innerHTML: innerHTML.length > 200 ? innerHTML.substring(0, 200) + '...' : innerHTML,
            outerHTML: outerHTML.length > 500 ? outerHTML.substring(0, 500) + '...' : outerHTML,
            fullOuterHTML: outerHTML
          });
        };

        iframeDoc.body.addEventListener('mouseover', handleMouseOver);
        iframeDoc.body.addEventListener('mouseout', handleMouseOut);
        iframeDoc.body.addEventListener('click', handleClick);

        return () => {
          iframeDoc.body.removeEventListener('mouseover', handleMouseOver);
          iframeDoc.body.removeEventListener('mouseout', handleMouseOut);
          iframeDoc.body.removeEventListener('click', handleClick);

          // Clean up styles
          const selected = iframeDoc.querySelector('.inspector-selected');
          if (selected) {
            selected.classList.remove('inspector-selected', 'inspector-highlight');
          }
        };
      } catch (err) {
        console.error('Failed to setup inspector:', err);
      }
    };

    // Wait for iframe to load
    const timer = setTimeout(setupInspector, 100);
    iframe.addEventListener('load', setupInspector);

    return () => {
      clearTimeout(timer);
      iframe.removeEventListener('load', setupInspector);
    };
  }, [editMode, buildView]);

  const cookingSentences = useMemo(
    () => [
      'Letting the algorithm cook…',
      'Formulating the master plan…',
      'Preparing something legendary…',
      'Locked in and processing…',
      'Making the magic happen…',
      'In the lab working…',
      'Manifesting the data…',
      'Brewing up the results…',
      'Crafting the experience…',
      'Doing the heavy lifting…',
      'Trusting the process…',
      'Cooking up the logic…',
      'Dialing in the details…',
      'Serving up excellence…',
      'Vibing with the database…'
    ],
    []
  );

  useEffect(() => {
    const sentences = cookingSentences;
    const startTyping = () => {
      clearInterval(typingInterval.current);
      typingPhase.current = 'typing';
      typingIndex.current = 0;
      typingChar.current = 0;
      setTypingText('');

      typingInterval.current = setInterval(() => {
        const currentSentence = sentences[typingIndex.current % sentences.length];
        if (typingPhase.current === 'typing') {
          typingChar.current += 1;
          const next = currentSentence.slice(0, typingChar.current);
          setTypingText(next);
          if (typingChar.current >= currentSentence.length) {
            typingPhase.current = 'deleting';
          }
        } else {
          typingChar.current -= 1;
          const next = currentSentence.slice(0, Math.max(typingChar.current, 0));
          setTypingText(next);
          if (typingChar.current <= 0) {
            typingPhase.current = 'typing';
            typingIndex.current += 1;
          }
        }
      }, 80);
    };

    if (buildState?.status === 'building') {
      startTyping();
    } else {
      clearInterval(typingInterval.current);
      setTypingText('');
    }
    return () => clearInterval(typingInterval.current);
  }, [buildState?.status, cookingSentences]);

  const analyzeImage = async base64 => {
    setIsLoading(true);
    setError('');
    onAnalysisChange?.('');

    try {
      if (!window.editorAPI?.analyzeImageWithGemini) {
        setError('Gemini bridge is not available in this build.');
        return;
      }

      const result = await window.editorAPI.analyzeImageWithGemini({ imageBase64: base64 });
      if (!result?.success) {
        setError(result?.error || 'Analysis failed.');
        return;
      }

      onAnalysisChange?.(result.text?.trim() || 'No description returned.');
    } catch (err) {
      setError(err?.message || 'Unexpected error.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = e => {
    if (!fieldsComplete) {
      setError('Please fill Name, Use case, and Coding language before uploading an image.');
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    onImageStatusChange?.(true);

    const reader = new FileReader();
    reader.onload = event => {
      const base64 = event.target?.result;
      if (base64) {
        analyzeImage(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setPreviewUrl('');
    onAnalysisChange?.('');
    setError('');
    onImageStatusChange?.(false);
  };

  const inputId = 'design-upload';

  const triggerFileDialog = () => {
    if (!fieldsComplete) return;
    if (fileInputRef?.current) fileInputRef.current.click();
  };

  const uploadClass = [
    'create-upload-box',
    fieldsComplete && !hasImage ? 'create-upload-box-glow' : '',
    !fieldsComplete ? 'create-upload-box-locked' : ''
  ].filter(Boolean).join(' ');

  const codeForDisplay = buildState?.selectedVariation?.code || '';
  const langLower = (componentForm.language || '').toLowerCase();
  const isHtmlLike = langLower.includes('html');
  const isReactLike = langLower.includes('react') || langLower.includes('jsx') || langLower.includes('tsx') || langLower.includes('javascript');

  const previewDocHtml = useMemo(() => {
    if (!codeForDisplay) return '';
    if (codeForDisplay.includes('<html')) return codeForDisplay;
    return `<html><head><style>body{margin:0;padding:16px;background:#0b0d12;color:#f5f5f7;font-family:Segoe UI,system-ui,sans-serif;} *{box-sizing:border-box;}</style></head><body>${codeForDisplay}</body></html>`;
  }, [codeForDisplay]);

  const previewDocReact = useMemo(() => {
    if (!codeForDisplay) return '';
    const jsonCode = JSON.stringify(codeForDisplay);
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>html,body,#root{margin:0;padding:0;height:100%;background:#0b0d12;color:#f5f5f7;font-family:Segoe UI,system-ui,sans-serif;}*{box-sizing:border-box;}</style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <script>
    (function(){
      const showError = (msg) => {
        const rootEl = document.getElementById('root');
        rootEl.style.padding = '16px';
        rootEl.style.color = '#ff9b9b';
        rootEl.style.fontFamily = 'monospace';
        rootEl.style.whiteSpace = 'pre-wrap';
        rootEl.textContent = 'Preview error: ' + msg;
      };
      try {
        if (!window.Babel || !window.React || !window.ReactDOM) {
          throw new Error('Preview runtime missing React/Babel.');
        }
        const source = ${jsonCode};
        
        // Strip import/export statements and transform JSX for browser execution
        // Remove import statements (React is already available globally)
        let processedSource = source
          .replace(/^\\s*import\\s+.*?['"](.*?)['"];?\\s*$/gm, '')
          .replace(/^\\s*import\\s+{[^}]*}\\s+from\\s+['"].*?['"];?\\s*$/gm, '')
          .replace(/^\\s*import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"].*?['"];?\\s*$/gm, '');
        
        // Transform export default to assignment
        processedSource = processedSource
          .replace(/^\\s*export\\s+default\\s+/gm, 'const __DefaultExport__ = ')
          .replace(/^\\s*export\\s+/gm, '');
        
        // Add the default export return at the end
        processedSource += '\\nif (typeof __DefaultExport__ !== "undefined") { module.exports.default = __DefaultExport__; }';
        
        let transformed;
        try {
          transformed = Babel.transform(processedSource, {
            presets: ['react', 'typescript'],
            filename: 'Component.tsx'
          }).code;
        } catch (transformErr) {
          showError(transformErr && transformErr.message ? transformErr.message : String(transformErr));
          console.error('Babel transform error:', transformErr);
          return;
        }

        const module = { exports: {} };
        const exports = module.exports;
        const fn = new Function('module', 'exports', 'React', 'ReactDOM', transformed);
        try {
          fn(module, exports, React, ReactDOM);
        } catch (execErr) {
          showError(execErr && execErr.message ? execErr.message : String(execErr));
          console.error('Execution error:', execErr);
          return;
        }

        const mod = module.exports;
        const Component = mod && mod.default ? mod.default : (typeof mod === 'function' ? mod : (() => React.createElement('div', null, 'No default export found')));
        const rootEl = document.getElementById('root');
        const root = ReactDOM.createRoot(rootEl);
        root.render(React.createElement(Component));
      } catch (err) {
        showError(err && err.message ? err.message : String(err));
        console.error('Preview error:', err);
      }
    })();
  <\/script>
</body>
</html>`;
  }, [codeForDisplay]);

  return (
    <section className="panel panel-components create-page">
      <div className="panel-header components-header create-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button type="button" className="create-back-button" onClick={onBack} aria-label="Back">←</button>
          <h2 style={{ margin: 0 }}>Components</h2>
        </div>

        <div className="device-selector-centered">
          <DeviceSelector value={device} onChange={setDevice} />
        </div>

        <div className="create-header-right">
          <VersionHistory
            history={{ versions, currentIndex }}
            onRestore={handleRestoreVersion}
          />
          {previewUrl ? (
            <div className="header-action-row">
              <button type="button" className="header-action-button" onClick={triggerFileDialog}>Change image</button>
              <button type="button" className="header-action-button header-action-clear" onClick={handleClear}>Clear</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="components-body">
        {buildState?.status === 'building' ? (
          <div className="build-full-section">
            <div className="typing-loader">
              <div className="typing-line">{typingText}&nbsp;</div>
              <div className="typing-cursor" />
            </div>
          </div>
        ) : buildState?.status === 'done' ? (
          <div className="build-full-section">
            <div className="variations-grid-container">
              <div className="variations-header">
                <div className="variations-title">Choose your favorite design</div>
                <div className="variations-subtitle">Select one of the 4 variations below</div>
              </div>
              <div className="variations-grid">
                {buildState.variations?.map((variation) => {
                  const varCode = variation.code || '';
                  const varPreviewHtml = varCode.includes('<html') ? varCode :
                    `<html><head><style>body{margin:0;padding:16px;background:#0b0d12;color:#f5f5f7;font-family:Segoe UI,system-ui,sans-serif;} *{box-sizing:border-box;}</style></head><body>${varCode}</body></html>`;

                  // Generate React preview without useMemo (can't use hooks in loops)
                  let varPreviewReact = '';
                  if (varCode) {
                    const jsonCode = JSON.stringify(varCode);
                    varPreviewReact = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>html,body,#root{margin:0;padding:0;height:100%;background:#0b0d12;color:#f5f5f7;font-family:Segoe UI,system-ui,sans-serif;}*{box-sizing:border-box;}</style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <script>
    (function(){
      const showError = (msg) => {
        const rootEl = document.getElementById('root');
        rootEl.style.padding = '16px';
        rootEl.style.color = '#ff9b9b';
        rootEl.style.fontFamily = 'monospace';
        rootEl.style.whiteSpace = 'pre-wrap';
        rootEl.textContent = 'Preview error: ' + msg;
      };
      try {
        if (!window.Babel || !window.React || !window.ReactDOM) {
          throw new Error('Preview runtime missing React/Babel.');
        }
        const source = ${jsonCode};
        let processedSource = source
          .replace(/^\\s*import\\s+.*?['"](.*?)['"];?\\s*$/gm, '')
          .replace(/^\\s*import\\s+{[^}]*}\\s+from\\s+['"].*?['"];?\\s*$/gm, '')
          .replace(/^\\s*import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"].*?['"];?\\s*$/gm, '');
        processedSource = processedSource
          .replace(/^\\s*export\\s+default\\s+/gm, 'const __DefaultExport__ = ')
          .replace(/^\\s*export\\s+/gm, '');
        processedSource += '\\nif (typeof __DefaultExport__ !== "undefined") { module.exports.default = __DefaultExport__; }';
        let transformed;
        try {
          transformed = Babel.transform(processedSource, {
            presets: ['react', 'typescript'],
            filename: 'Component.tsx'
          }).code;
        } catch (transformErr) {
          showError(transformErr && transformErr.message ? transformErr.message : String(transformErr));
          return;
        }
        const module = { exports: {} };
        const exports = module.exports;
        const fn = new Function('module', 'exports', 'React', 'ReactDOM', transformed);
        try {
          fn(module, exports, React, ReactDOM);
        } catch (execErr) {
          showError(execErr && execErr.message ? execErr.message : String(execErr));
          return;
        }
        const mod = module.exports;
        const Component = mod && mod.default ? mod.default : (typeof mod === 'function' ? mod : (() => React.createElement('div', null, 'No default export found')));
        const rootEl = document.getElementById('root');
        const root = ReactDOM.createRoot(rootEl);
        root.render(React.createElement(Component));
      } catch (err) {
        showError(err && err.message ? err.message : String(err));
      }
    })();
  <\/script>
</body>
</html>`;
                  }

                  return (
                    <button
                      key={variation.id}
                      type="button"
                      className="variation-card"
                      onClick={() => onSelectVariation?.(variation.id)}
                      disabled={!variation.success}
                    >
                      <div className="variation-preview">
                        {variation.success ? (
                          isHtmlLike && varPreviewHtml ? (
                            <iframe title={`variation-${variation.id}`} srcDoc={varPreviewHtml} className="variation-iframe" />
                          ) : isReactLike && varPreviewReact ? (
                            <iframe title={`variation-${variation.id}`} srcDoc={varPreviewReact} className="variation-iframe" />
                          ) : (
                            <div className="variation-unavailable">Preview unavailable</div>
                          )
                        ) : (
                          <div className="variation-error">Failed to build</div>
                        )}
                      </div>
                      <div className="variation-label">Variation {variation.id}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : buildState?.status === 'done-selected' ? (
          <div className="build-full-section">
            <div className="build-result-card">
              <div className="build-result-head">
                <div className="build-result-title">Component ready</div>
                {buildState.selectedVariation?.filePath && <div className="build-result-path">Saved to {buildState.selectedVariation.filePath}</div>}
                {buildView === 'visual' && (
                  <button
                    type="button"
                    className={`edit-mode-toggle ${editMode ? 'active' : ''}`}
                    onClick={handleToggleEditMode}
                  >
                    {editMode ? '✓ Edit Mode' : '✏️ Edit Mode'}
                  </button>
                )}
              </div>
              {editMode && selectedElement && (
                <div className="element-editor-panel">
                  <div className="element-info">
                    <div className="element-info-label">Selected Element:</div>
                    <div className="element-info-tag">
                      &lt;{selectedElement.tagName}
                      {selectedElement.classes && ` class="${selectedElement.classes}"`}&gt;
                    </div>
                  </div>
                  <div className="element-prompt-section">
                    <textarea
                      className="element-prompt-input"
                      value={editPrompt}
                      onChange={e => setEditPrompt(e.target.value)}
                      placeholder="Describe how you want to modify this element... (e.g., 'make it blue', 'add padding', 'change the text to...')"
                      rows={3}
                    />
                    <button
                      type="button"
                      className="element-submit-button"
                      onClick={handleSubmitEdit}
                      disabled={!editPrompt.trim() || isEditing}
                    >
                      {isEditing ? 'Applying changes...' : 'Apply Edit'}
                    </button>
                  </div>
                </div>
              )}
              <div className="build-result-tabs">
                <button
                  type="button"
                  className={buildView === 'visual' ? 'active' : ''}
                  onClick={() => setBuildView('visual')}
                >
                  Visualize
                </button>
                <button
                  type="button"
                  className={buildView === 'code' ? 'active' : ''}
                  onClick={() => setBuildView('code')}
                >
                  Code
                </button>
              </div>
              {buildView === 'visual' ? (
                <div className="build-result-preview">
                  {isHtmlLike && previewDocHtml ? (
                    <iframe ref={previewIframeRef} title="component-preview" srcDoc={previewDocHtml} className="build-preview-iframe" />
                  ) : isReactLike && previewDocReact ? (
                    <iframe ref={previewIframeRef} title="component-preview" srcDoc={previewDocReact} className="build-preview-iframe" />
                  ) : (
                    <div className="build-preview-unavailable">Visual preview is available for React/JSX/HTML outputs.</div>
                  )}
                </div>
              ) : (
                <div className="build-result-editor">
                  <Editor
                    height="360px"
                    language={(componentForm.language || 'javascript').toLowerCase().includes('html') ? 'html' : 'javascript'}
                    theme="vs-dark"
                    value={codeForDisplay}
                    options={{ minimap: { enabled: false }, readOnly: true, fontSize: 14 }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="create-upload-area">
            {isTestMode ? (
              <div className="test-mode-form">
                <div>
                  <div className="test-mode-label">Build Instructions</div>
                  <textarea
                    className="test-mode-textarea"
                    value={analysis || ''}
                    onChange={e => onAnalysisChange?.(e.target.value)}
                    placeholder="Enter the component description and requirements here..."
                  />
                </div>
              </div>
            ) : (
              <>
                <input
                  id={inputId}
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={!fieldsComplete}
                  onChange={handleFileChange}
                />

                {!previewUrl ? (
                  <label
                    className={uploadClass}
                    htmlFor={fieldsComplete ? inputId : undefined}
                    aria-disabled={!fieldsComplete}
                    onClick={fieldsComplete ? undefined : e => e.preventDefault()}
                  >
                    <div className="create-upload-inner">
                      <img src={imageIcon} alt="upload" />
                      <div className="create-upload-text">Upload an image of the design</div>
                    </div>
                  </label>
                ) : (
                  <div className="create-preview-block">
                    <div className="create-preview">
                      <img src={previewUrl} alt="Uploaded design" className="create-preview-image" />
                    </div>
                    <div style={{ height: 8 }} />
                    {selectedFile?.name && <div className="create-upload-filename">{selectedFile.name}</div>}
                  </div>
                )}

                <div className="create-analysis">
                  {isLoading && <div className="create-status">Analyzing screenshot with Gemini…</div>}
                  {error && <div className="create-error">{error}</div>}
                  {previewUrl && analysis?.trim() !== '' && (
                    <div className="create-analysis-result">
                      <div className="create-analysis-label">Build instructions</div>
                      <textarea
                        className="create-analysis-textarea"
                        value={analysis || ''}
                        onChange={e => onAnalysisChange?.(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {buildState?.status === 'error' && (
              <div className="build-full-section">
                <div className="build-result-error">{buildState.error}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default CreateComponentPage;
