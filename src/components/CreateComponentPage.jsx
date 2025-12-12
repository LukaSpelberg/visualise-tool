import React, { useState, useRef } from 'react';
import desktopIcon from '../assets/icons/desktop.svg';
import laptopIcon from '../assets/icons/laptop.svg';
import mobileIcon from '../assets/icons/mobile.svg';
import imageIcon from '../assets/icons/image.svg';

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

const CreateComponentPage = ({ onBack }) => {
  const [device, setDevice] = useState('desktop');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const analyzeImage = async base64 => {
    setIsLoading(true);
    setError('');
    setAnalysis('');

    try {
      if (!window.editorAPI?.analyzeImageWithOllama) {
        setError('Ollama bridge is not available in this build.');
        return;
      }

      const result = await window.editorAPI.analyzeImageWithOllama({ imageBase64: base64 });
      if (!result?.success) {
        setError(result?.error || 'Analysis failed.');
        return;
      }

      setAnalysis(result.text?.trim() || 'No description returned.');
    } catch (err) {
      setError(err?.message || 'Unexpected error.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = e => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));

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
    setAnalysis('');
    setError('');
  };

  const inputId = 'design-upload';

  const triggerFileDialog = () => {
    if (fileInputRef?.current) fileInputRef.current.click();
  };

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
          {previewUrl ? (
            <div className="header-action-row">
              <button type="button" className="header-action-button" onClick={triggerFileDialog}>Change image</button>
              <button type="button" className="header-action-button header-action-clear" onClick={handleClear}>Clear</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="components-body">
        <div className="create-upload-area">
          <input
            id={inputId}
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!previewUrl ? (
            <label className="create-upload-box" htmlFor={inputId}>
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
            </div>
          )}

          <div className="create-analysis">
            {isLoading && <div className="create-status">Analyzing screenshot with Ollama…</div>}
            {error && <div className="create-error">{error}</div>}
            {previewUrl && analysis?.trim() !== '' && (
              <div className="create-analysis-result">
                <div className="create-analysis-label">Build instructions</div>
                <textarea
                  className="create-analysis-textarea"
                  value={analysis}
                  onChange={e => setAnalysis(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default CreateComponentPage;
