import React, { useState } from 'react';
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

        <div className="create-header-right" aria-hidden />
      </div>

      <div className="components-body">
        <div className="create-upload-area">
          <div className="create-upload-box">
            <div className="create-upload-inner">
              <img src={imageIcon} alt="upload" />
              <div className="create-upload-text">Upload an image of the design</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CreateComponentPage;
