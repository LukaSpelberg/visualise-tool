import React, { useEffect, useRef, useState } from 'react';

const TopNav = ({
  onOpenFolder,
  onNewFile,
  onNewFolder,
  hasFileSystemAccess,
  onToggleTerminal,
  isTerminalOpen,
  terminalAvailable
}) => {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const handleMenuToggle = () => {
    setFileMenuOpen(prev => !prev);
  };

  const closeMenu = () => setFileMenuOpen(false);

  useEffect(() => {
    const handleClickOutside = event => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setFileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="top-nav">
      <div className="menu-group">
        <div className="menu-item" ref={menuRef}>
          <button className="menu-button" type="button" onClick={handleMenuToggle}>
            File
          </button>
          {fileMenuOpen && (
            <div className="dropdown">
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onOpenFolder?.();
                }}
                disabled={!hasFileSystemAccess}
              >
                Open Folder…
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onNewFile?.();
                }}
                disabled={!hasFileSystemAccess}
              >
                New File…
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onNewFolder?.();
                }}
                disabled={!hasFileSystemAccess}
              >
                New Folder…
              </button>
            </div>
          )}
        </div>
        {['Edit', 'View'].map(label => (
          <button key={label} className="menu-button" type="button">
            {label}
          </button>
        ))}
        <button
          className={`menu-button ${isTerminalOpen ? 'active' : ''}`}
          type="button"
          onClick={onToggleTerminal}
          disabled={!terminalAvailable}
          title={terminalAvailable ? 'Toggle terminal' : 'Available in the Electron shell'}
        >
          Terminal
        </button>
      </div>
      <input className="search-input" placeholder="Search..." />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          title={hasFileSystemAccess ? 'File system access available' : 'No native file access'}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: hasFileSystemAccess ? '#45d07b' : '#555'
          }}
        />
        <div className="profile-circle" aria-label="Profile" />
      </div>
    </header>
  );
};

export default TopNav;
