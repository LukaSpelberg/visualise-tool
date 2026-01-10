import React, { useMemo } from 'react';
import Editor from '@monaco-editor/react';

const guessLanguage = fileName => {
  const extension = fileName?.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'cs':
      return 'csharp';
    case 'py':
      return 'python';
    default:
      return 'plaintext';
  }
};

const EditorPane = ({ 
  fileName, 
  warnings, 
  errors, 
  code, 
  onChange, 
  dirty, 
  onSave, 
  viewMode, 
  onToggleView,
  openTabs = [],
  activeFilePath,
  onTabClick,
  onTabClose
}) => {
  const language = useMemo(() => guessLanguage(fileName), [fileName]);
  const isEmpty = code === null;

  // Check if a specific tab is dirty
  const isTabDirty = (tab) => tab.content !== tab.savedContent;

  return (
    <section className="panel panel-editor">
      {/* Tabs bar */}
      {openTabs.length > 0 && (
        <div className="editor-tabs">
          {openTabs.map(tab => (
            <div 
              key={tab.path}
              className={`editor-tab ${tab.path === activeFilePath ? 'active' : ''}`}
              onClick={() => onTabClick?.(tab.path)}
            >
              <span className="editor-tab-name">
                {tab.name}
                {isTabDirty(tab) && <span className="editor-tab-dirty">●</span>}
              </span>
              {tab.path === activeFilePath && (
                <button 
                  className="editor-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose?.(tab.path);
                  }}
                  title="Close"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      
      <div className="editor-bar">
        <div className="tab-info">
          <span className="file-name">{fileName}</span>
          {dirty && <span className="unsaved-dot" title="Unsaved changes">●</span>}
          <span className="pill pill-warning">{warnings} warnings</span>
          <span className="pill pill-error">{errors} errors</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && (
            <button className="toggle-button" type="button" onClick={onSave} title="Save (Ctrl+S)">
              Save
            </button>
          )}
          <button 
            className={`toggle-button ${viewMode === 'visual' ? 'active' : ''}`}
            type="button" 
            onClick={onToggleView}
            title={viewMode === 'visual' ? 'Switch to code view' : 'Switch to visual preview'}
          >
            {viewMode === 'visual' ? 'Code view' : 'Visual preview'}
          </button>
        </div>
      </div>
      <div className="editor-wrapper">
        {isEmpty ? (
          <div className="editor-empty">
            <p>Select a folder and choose a file from the tree to begin editing.</p>
          </div>
        ) : (
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true
            }}
            onChange={value => onChange(value ?? '')}
          />
        )}
      </div>
    </section>
  );
};

export default EditorPane;
