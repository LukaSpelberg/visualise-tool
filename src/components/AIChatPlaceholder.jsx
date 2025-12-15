import React, { useRef, useState, useEffect } from 'react';
import buildIcon from '../assets/icons/build.svg';
import animateIcon from '../assets/icons/animate.svg';
import componentsIcon from '../assets/icons/components.svg';
import settingsIcon from '../assets/icons/settings.svg';

const AIChatPlaceholder = ({
  activeTab: controlledActiveTab,
  onActiveTabChange,
  isCreatingComponent,
  componentForm = {},
  onComponentFormChange,
  fieldsComplete,
  hasImage,
  analysisReady,
  onBuild,
  buildState = {}
}) => {
  const textareaRef = useRef(null);
  const [value, setValue] = useState('');
  const [chatMode, setChatMode] = useState('Agent');
  const [internalActiveTab, setInternalActiveTab] = useState('build');
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = tab => {
    if (onActiveTabChange) onActiveTabChange(tab);
    if (controlledActiveTab === undefined) setInternalActiveTab(tab);
  };

  const baseHeight = 48; // px
  const maxHeight = baseHeight * 2; // 200% of original

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, maxHeight);
    ta.style.height = `${next}px`;
    ta.style.overflow = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value]);

  const buildDisabled = !fieldsComplete || !analysisReady || buildState?.status === 'building';

  return (
    <section className="panel panel-chat">
      <div className="panel-header">
        <h2>AI Assistant</h2>
        <span className="status-pill">Agent</span>
      </div>

      {/* Modes row - icons should be placed in public/assets/icons/ */}
      <div className="assistant-modes">
        {[
          { id: 'build', label: 'Build', icon: buildIcon },
          { id: 'animate', label: 'Animate', icon: animateIcon },
          { id: 'components', label: 'Components', icon: componentsIcon },
          { id: 'settings', label: 'Settings', icon: settingsIcon }
        ].map(item => (
          <button
            key={item.id}
            type="button"
            className={`mode-button ${item.id === activeTab ? 'selected' : ''}`}
            onClick={() => setActiveTab(item.id)}
            title={item.label}
          >
            <span
              className="mode-icon"
              style={{ ['--icon-url']: `url(${item.icon})` }}
              aria-hidden
            />
            <span className="mode-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Only show chat-body and input when not on components tab */}
      {isCreatingComponent ? (
        <div className={`component-form ${!fieldsComplete ? 'component-form-glow' : ''}`}>
          <label>
            <div>Name</div>
            <input type="text" className="component-input" value={componentForm.name || ''} onChange={e => onComponentFormChange?.({ name: e.target.value })} />
          </label>
          <label>
            <div>Use case</div>
            <textarea className="component-input component-textarea" value={componentForm.useCase || ''} onChange={e => onComponentFormChange?.({ useCase: e.target.value })} />
          </label>
          <label>
            <div>Coding language</div>
            <select className="component-input" value={componentForm.language || 'React'} onChange={e => onComponentFormChange?.({ language: e.target.value })}>
              <option>React</option>
              <option>Svelte</option>
              <option>HTML</option>
              <option>Vue</option>
              <option>Plain HTML/CSS</option>
            </select>
          </label>

          <div className="component-hint-row">
            {!fieldsComplete && <span className="component-hint">Fill every field to unlock image upload.</span>}
            {fieldsComplete && !hasImage && <span className="component-hint">Great. Upload the design image next.</span>}
            {hasImage && !analysisReady && <span className="component-hint">Waiting for the image interpretation…</span>}
            {analysisReady && <span className="component-hint">Image interpreted. You can build now.</span>}
          </div>

          <div className="build-button-row">
            <button
              type="button"
              className={`build-button ${buildDisabled ? 'disabled' : ''}`}
              onClick={onBuild}
              disabled={buildDisabled}
            >
              {buildState?.status === 'building' ? 'Building…' : 'Build'}
            </button>
            {buildState?.status === 'building' && <div className="build-inline-loader" aria-label="Building" />}
            {buildState?.status === 'error' && <div className="build-inline-error">{buildState.error}</div>}
            {buildState?.status === 'done' && buildState.filePath && (
              <div className="build-inline-success">Built to {buildState.filePath}</div>
            )}
          </div>
        </div>
      ) : activeTab !== 'components' && (
        <>
          <div className="chat-body">
            <p>Chat responses and actions will show here.</p>
          </div>

          {/* Rich Text Wrapper: border/background/rounded on this parent */}
          <div className="chat-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              placeholder="Type anything to start building..."
              value={value}
              onChange={e => setValue(e.target.value)}
            />

            <div className="chat-footer">
              <div className="chat-footer-left">
                <select
                  className="chat-mode"
                  value={chatMode}
                  onChange={e => setChatMode(e.target.value)}
                  aria-label="Chat mode"
                >
                    <option>Agent</option>
                    <option>Ask</option>
                </select>
              </div>

              <div className="chat-footer-right">
                <button type="button" className="chat-send" title="Send">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 11L21 3L14 21L11 14L3 11Z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default AIChatPlaceholder;
