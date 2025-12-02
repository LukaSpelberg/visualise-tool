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

const EditorPane = ({ fileName, warnings, errors, code, onChange, dirty, onSave }) => {
  const language = useMemo(() => guessLanguage(fileName), [fileName]);
  const isEmpty = code === null;

  return (
    <section className="panel panel-editor">
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
          <button className="toggle-button" type="button">
            Code view
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
