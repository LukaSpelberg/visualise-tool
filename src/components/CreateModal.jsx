import React, { useEffect, useRef, useState } from 'react';

const CreateModal = ({ open, type, basePath, onConfirm, onClose }) => {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog">
        <h3>Create new {type === 'folder' ? 'folder' : 'file'}</h3>
        <p className="muted">Path: {basePath}</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={type === 'folder' ? 'NewFolder' : 'newfile.txt'}
        />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onConfirm(name)} disabled={!name.trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateModal;
