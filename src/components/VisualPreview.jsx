import React, { useEffect, useRef, useState } from 'react';

const VisualPreview = ({ url, onBack, onReload }) => {
  const webviewRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !url) {
      return undefined;
    }

    setStatus('loading');
    setError('');

    const handleDomReady = () => {
      setStatus('ready');
    };

    const handleFailLoad = event => {
      if (event.isMainFrame) {
        setStatus('error');
        setError(event.errorDescription || 'Failed to load preview');
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleFailLoad);

    // Force refresh when url changes
    webview.src = url;

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [url]);

  const handleReload = () => {
    if (webviewRef.current) {
      setStatus('loading');
      setError('');
      webviewRef.current.reload();
    }
    onReload?.();
  };

  return (
    <div className="visual-preview-container">
      <div className="visual-preview-bar">
        <span className={`preview-url ${status === 'error' ? 'error' : ''}`}>
          {status === 'error' ? error || 'Failed to load preview' : url || 'Preview not started'}
        </span>
        <div className="preview-actions">
          <button className="toggle-button" type="button" onClick={handleReload} disabled={!url}>
            Reload
          </button>
          <button className="toggle-button" type="button" onClick={onBack}>
            Code view
          </button>
        </div>
      </div>
      <div className="preview-stage">
        {status === 'loading' && <div className="preview-status">Loading preview…</div>}
        {status === 'error' && <div className="preview-status error">{error || 'Failed to load preview'}</div>}
        <webview
          key={url}
          ref={webviewRef}
          className={`preview-webview ${status === 'ready' ? 'visible' : ''}`}
          nodeintegration="false"
          webpreferences="contextIsolation=yes"
          allowpopups="true"
          style={{ display: url ? 'flex' : 'none' }}
        />
      </div>
    </div>
  );
};

export default VisualPreview;
