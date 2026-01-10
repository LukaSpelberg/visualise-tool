
import React, { useState, useRef, useEffect } from 'react';

// You might need to adjust the icon import path depending on your project structure
// Assuming we can use a simple SVG or FontAwesome if icons aren't available as components
const ClockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
);

const VersionHistory = ({
    history,
    onRestore,
    className = ''
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const formatTime = (timestamp) => {
        const diff = (Date.now() - timestamp) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (!history || !history.versions) return null;

    return (
        <div className={`version-history-container ${className}`} ref={dropdownRef}>
            <button
                type="button"
                className={`version-history-btn ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Version History"
            >
                <ClockIcon />
            </button>

            {isOpen && (
                <div className="version-history-dropdown">
                    <div className="version-history-header">History</div>
                    <div className="version-history-list">
                        {[...history.versions].reverse().map((version, reverseIndex) => {
                            // Calculate actual index since we reversed the mapping
                            const index = history.versions.length - 1 - reverseIndex;
                            const isActive = index === history.currentIndex;

                            return (
                                <button
                                    key={version.id}
                                    className={`version-item ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                        onRestore(index);
                                        setIsOpen(false);
                                    }}
                                >
                                    <div className="version-info">
                                        <span className="version-desc">{version.description}</span>
                                        <span className="version-time">{formatTime(version.timestamp)}</span>
                                    </div>
                                    {isActive && <span className="version-check">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VersionHistory;
