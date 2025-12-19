import React, { useState, useEffect, useRef, useCallback } from 'react';

// Curated list of popular Google Fonts with their weights
const GOOGLE_FONTS = [
  { name: 'Inter', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Roboto', weights: ['300', '400', '500', '700', '900'], category: 'sans-serif' },
  { name: 'Open Sans', weights: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif' },
  { name: 'Lato', weights: ['300', '400', '700', '900'], category: 'sans-serif' },
  { name: 'Montserrat', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Poppins', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Source Sans Pro', weights: ['300', '400', '600', '700', '900'], category: 'sans-serif' },
  { name: 'Nunito', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Raleway', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Ubuntu', weights: ['300', '400', '500', '700'], category: 'sans-serif' },
  { name: 'Nunito Sans', weights: ['300', '400', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Rubik', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Work Sans', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Quicksand', weights: ['300', '400', '500', '600', '700'], category: 'sans-serif' },
  { name: 'Mulish', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Barlow', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Manrope', weights: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif' },
  { name: 'DM Sans', weights: ['400', '500', '700'], category: 'sans-serif' },
  { name: 'Karla', weights: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif' },
  { name: 'Lexend', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Outfit', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Plus Jakarta Sans', weights: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif' },
  { name: 'Space Grotesk', weights: ['300', '400', '500', '600', '700'], category: 'sans-serif' },
  { name: 'Sora', weights: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif' },
  { name: 'Albert Sans', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Figtree', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  { name: 'Geist', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif' },
  // Serif fonts
  { name: 'Playfair Display', weights: ['400', '500', '600', '700', '800', '900'], category: 'serif' },
  { name: 'Merriweather', weights: ['300', '400', '700', '900'], category: 'serif' },
  { name: 'Lora', weights: ['400', '500', '600', '700'], category: 'serif' },
  { name: 'PT Serif', weights: ['400', '700'], category: 'serif' },
  { name: 'Noto Serif', weights: ['400', '700'], category: 'serif' },
  { name: 'Libre Baskerville', weights: ['400', '700'], category: 'serif' },
  { name: 'Source Serif Pro', weights: ['400', '600', '700'], category: 'serif' },
  { name: 'Crimson Text', weights: ['400', '600', '700'], category: 'serif' },
  { name: 'EB Garamond', weights: ['400', '500', '600', '700', '800'], category: 'serif' },
  { name: 'Cormorant Garamond', weights: ['300', '400', '500', '600', '700'], category: 'serif' },
  { name: 'DM Serif Display', weights: ['400'], category: 'serif' },
  { name: 'Fraunces', weights: ['300', '400', '500', '600', '700', '800', '900'], category: 'serif' },
  // Display fonts
  { name: 'Oswald', weights: ['300', '400', '500', '600', '700'], category: 'display' },
  { name: 'Bebas Neue', weights: ['400'], category: 'display' },
  { name: 'Anton', weights: ['400'], category: 'display' },
  { name: 'Alfa Slab One', weights: ['400'], category: 'display' },
  { name: 'Righteous', weights: ['400'], category: 'display' },
  { name: 'Passion One', weights: ['400', '700', '900'], category: 'display' },
  { name: 'Permanent Marker', weights: ['400'], category: 'display' },
  { name: 'Pacifico', weights: ['400'], category: 'display' },
  { name: 'Lobster', weights: ['400'], category: 'display' },
  { name: 'Abril Fatface', weights: ['400'], category: 'display' },
  // Monospace fonts
  { name: 'Fira Code', weights: ['300', '400', '500', '600', '700'], category: 'monospace' },
  { name: 'JetBrains Mono', weights: ['300', '400', '500', '600', '700', '800'], category: 'monospace' },
  { name: 'Source Code Pro', weights: ['300', '400', '500', '600', '700', '900'], category: 'monospace' },
  { name: 'Roboto Mono', weights: ['300', '400', '500', '600', '700'], category: 'monospace' },
  { name: 'IBM Plex Mono', weights: ['300', '400', '500', '600', '700'], category: 'monospace' },
  { name: 'Space Mono', weights: ['400', '700'], category: 'monospace' },
  // System fonts (no loading needed)
  { name: 'Arial', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Helvetica', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Georgia', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Times New Roman', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Verdana', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Tahoma', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'Trebuchet MS', weights: ['400', '700'], category: 'system', isSystem: true },
  { name: 'System UI', weights: ['400', '500', '600', '700'], category: 'system', isSystem: true },
];

// Track which fonts have been loaded
const loadedFonts = new Set();

const loadGoogleFont = (fontName) => {
  if (loadedFonts.has(fontName)) return;
  
  const font = GOOGLE_FONTS.find(f => f.name === fontName);
  if (!font || font.isSystem) return;
  
  const weights = font.weights.join(';');
  const fontNameEncoded = fontName.replace(/ /g, '+');
  const link = document.createElement('link');
  link.href = `https://fonts.googleapis.com/css2?family=${fontNameEncoded}:wght@${weights}&display=swap`;
  link.rel = 'stylesheet';
  document.head.appendChild(link);
  loadedFonts.add(fontName);
};

const FontPicker = ({ value, onChange, customFonts = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleFonts, setVisibleFonts] = useState([]);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const searchInputRef = useRef(null);

  // Combine Google Fonts with custom fonts
  const allFonts = [
    ...GOOGLE_FONTS,
    ...customFonts.map(f => ({ ...f, category: 'custom' }))
  ];

  // Filter fonts based on search
  const filteredFonts = allFonts.filter(font =>
    font.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group fonts by category
  const groupedFonts = {
    'Sans Serif': filteredFonts.filter(f => f.category === 'sans-serif'),
    'Serif': filteredFonts.filter(f => f.category === 'serif'),
    'Display': filteredFonts.filter(f => f.category === 'display'),
    'Monospace': filteredFonts.filter(f => f.category === 'monospace'),
    'System': filteredFonts.filter(f => f.category === 'system'),
    'Custom': filteredFonts.filter(f => f.category === 'custom'),
  };

  // Load the currently selected font
  useEffect(() => {
    if (value) {
      loadGoogleFont(value);
    }
  }, [value]);

  // Load visible fonts as they appear
  useEffect(() => {
    visibleFonts.forEach(fontName => {
      loadGoogleFont(fontName);
    });
  }, [visibleFonts]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Intersection Observer to load fonts as they become visible
  useEffect(() => {
    if (!isOpen || !listRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const fontName = entry.target.dataset.font;
            if (fontName) {
              setVisibleFonts(prev => {
                if (prev.includes(fontName)) return prev;
                return [...prev, fontName];
              });
            }
          }
        });
      },
      { root: listRef.current, threshold: 0.1 }
    );

    const items = listRef.current.querySelectorAll('[data-font]');
    items.forEach(item => observer.observe(item));

    return () => observer.disconnect();
  }, [isOpen, filteredFonts]);

  const handleSelect = (fontName) => {
    onChange(fontName);
    setIsOpen(false);
    setSearchQuery('');
  };

  const getFontData = (fontName) => {
    return allFonts.find(f => f.name === fontName);
  };

  const selectedFont = getFontData(value);

  return (
    <div className="font-picker" ref={containerRef}>
      <button
        type="button"
        className="font-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
        style={{ fontFamily: value || 'inherit' }}
      >
        <span className="font-picker-value">{value || 'Select font...'}</span>
        <span className="font-picker-arrow">▾</span>
      </button>

      {isOpen && (
        <div className="font-picker-dropdown">
          <div className="font-picker-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search fonts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="font-picker-search-input"
            />
          </div>

          <div className="font-picker-list" ref={listRef}>
            {Object.entries(groupedFonts).map(([category, fonts]) => {
              if (fonts.length === 0) return null;
              
              return (
                <div key={category} className="font-picker-group">
                  <div className="font-picker-group-label">{category}</div>
                  {fonts.map(font => (
                    <button
                      key={font.name}
                      type="button"
                      data-font={font.name}
                      className={`font-picker-item ${value === font.name ? 'selected' : ''}`}
                      onClick={() => handleSelect(font.name)}
                      style={{ fontFamily: `"${font.name}", ${font.category === 'serif' ? 'serif' : 'sans-serif'}` }}
                    >
                      <span className="font-picker-item-name">{font.name}</span>
                      {font.category === 'custom' && (
                        <span className="font-picker-item-badge">Custom</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}

            {filteredFonts.length === 0 && (
              <div className="font-picker-empty">
                No fonts found matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Export the font list for use in settings
export const getAllGoogleFonts = () => GOOGLE_FONTS;
export const getFontByName = (name) => GOOGLE_FONTS.find(f => f.name === name);
export { loadGoogleFont };

export default FontPicker;
