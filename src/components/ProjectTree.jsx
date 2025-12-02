import React, { useMemo, useState, useEffect, useCallback } from 'react';

const normalizePath = value => {
  if (!value) return '';
  let result = value.replace(/\\/g, '/');
  while (result.endsWith('/') && result.length > 1) {
    result = result.slice(0, -1);
  }
  return result.toLowerCase();
};

const TreeNode = ({
  node,
  depth,
  activeFilePath,
  onSelectFile,
  creating,
  newName,
  setNewName,
  doCreate,
  renaming,
  renameName,
  setRenameName,
  doRename
}) => {
  const [expanded, setExpanded] = useState(false);
  const padding = { paddingLeft: `${depth * 12}px` };
  const isRenamingSelf = renaming?.path === node.path;

  useEffect(() => {
    if (creating?.parentPath === node.path) {
      setExpanded(true);
    }
  }, [creating, node.path]);

  useEffect(() => {
    if (renaming?.path === node.path) {
      setExpanded(true);
    }
  }, [renaming, node.path]);

  if (node.type === 'folder') {
    return (
      <li className="tree-node folder" key={node.path}>
        {isRenamingSelf ? (
          <input
            autoFocus
            style={padding}
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') doRename(node.path);
              if (e.key === 'Escape') doRename(null, true);
            }}
          />
        ) : (
          <button
            type="button"
            className="tree-folder"
            style={padding}
            onClick={() => setExpanded(prev => !prev)}
          >
            <span className="twisty">{expanded ? '▾' : '▸'}</span>
            {node.name}
          </button>
        )}
        {expanded ? (
          <ul>
            {creating?.parentPath === node.path && (
              <li className="tree-node file" style={{ paddingLeft: `${(depth + 1) * 12}px` }}>
                <input
                  autoFocus
                  value={newName}
                  placeholder={creating?.type === 'folder' ? 'NewFolder' : 'newfile.txt'}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') doCreate(node.path);
                    if (e.key === 'Escape') doCreate(null, true);
                  }}
                />
              </li>
            )}
            {node.children?.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                onSelectFile={onSelectFile}
                creating={creating}
                newName={newName}
                setNewName={setNewName}
                doCreate={doCreate}
                renaming={renaming}
                renameName={renameName}
                setRenameName={setRenameName}
                doRename={doRename}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (isRenamingSelf) {
    return (
      <li className="tree-node file" key={node.path}>
        <input
          autoFocus
          style={padding}
          value={renameName}
          onChange={e => setRenameName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') doRename(node.path);
            if (e.key === 'Escape') doRename(null, true);
          }}
        />
      </li>
    );
  }

  const isActive = activeFilePath === node.path;
  return (
    <li className="tree-node file" key={node.path}>
      <button
        type="button"
        className={isActive ? 'active' : ''}
        style={padding}
        onClick={() => onSelectFile(node.path)}
      >
        {node.name}
      </button>
    </li>
  );
};

const ProjectTree = ({
  folderPath,
  tree,
  activeFilePath,
  onSelectFile,
  onChooseFolder,
  createRequest,
  clearCreateRequest,
  onRefresh,
  isLoading,
  fsError,
  hasFileSystemAccess
}) => {
  const rootPath = folderPath || '.';
  const folderLabel = useMemo(() => folderPath || 'No folder open', [folderPath]);
  const [contextMenu, setContextMenu] = useState(null);
  const [creating, setCreating] = useState(null);
  const [newName, setNewName] = useState('');

  const [renaming, setRenaming] = useState(null);
  const [renameName, setRenameName] = useState('');

  const normalizedRoot = useMemo(() => normalizePath(rootPath), [rootPath]);
  const isRootPath = useCallback(target => normalizePath(target || '') === normalizedRoot, [normalizedRoot]);

  const getParentPath = useCallback(
    targetPath => {
      if (!targetPath) return rootPath;
      const trimmed = targetPath.replace(/[\\/]+$/, '');
      const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      if (index <= 0) {
        return trimmed || rootPath;
      }
      return trimmed.slice(0, index);
    },
    [rootPath]
  );

  useEffect(() => {
    if (createRequest) {
      setCreating({ parentPath: createRequest.basePath, type: createRequest.type });
      setNewName('');
      clearCreateRequest?.();
    }
  }, [createRequest, clearCreateRequest]);

  const handleContext = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  };

  const closeContext = () => setContextMenu(null);

  const onCreateRequested = type => {
    const node = contextMenu?.node;
    const base = node
      ? node.type === 'folder'
        ? node.path
        : getParentPath(node.path)
      : rootPath;
    closeContext();
    setCreating({ parentPath: base, type });
    setNewName('');
  };

  const onRenameRequested = node => {
    if (!node || isRootPath(node.path)) {
      closeContext();
      return;
    }
    closeContext();
    setRenaming({ path: node.path, type: node.type, parentPath: getParentPath(node.path) });
    setRenameName(node.name || '');
  };

  const doRename = async (targetPath, cancel) => {
    if (cancel) {
      setRenaming(null);
      setRenameName('');
      return;
    }
    const newNameValue = renameName?.trim();
    if (!newNameValue) return;
    try {
      if (!window.editorAPI?.renameEntry) {
        alert('Rename is only available in the Electron shell');
        return;
      }
      if (isRootPath(targetPath)) {
        alert('Cannot rename the root folder.');
        return;
      }
      const res = await window.editorAPI.renameEntry({ path: targetPath, newName: newNameValue });
      if (!res?.success) {
        alert('Rename failed: ' + (res?.error || 'unknown'));
        return;
      }
      await onRefresh?.(rootPath);
      setRenaming(null);
      setRenameName('');
    } catch (err) {
      alert('Rename error: ' + err?.message);
    }
  };

  const doDelete = async targetPath => {
    closeContext();
    if (isRootPath(targetPath)) {
      alert('Cannot delete the root folder.');
      return;
    }
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete '${targetPath}'? This cannot be undone.`);
    if (!ok) return;
    try {
      if (!window.editorAPI?.deleteEntry) {
        alert('Delete is only available in the Electron shell');
        return;
      }
      const res = await window.editorAPI.deleteEntry({ path: targetPath });
      if (!res?.success) {
        alert('Delete failed: ' + (res?.error || 'unknown'));
        return;
      }
      await onRefresh?.(rootPath);
    } catch (err) {
      alert('Delete error: ' + err?.message);
    }
  };

  const doCreate = async (parentPath, cancel) => {
    if (cancel) {
      setCreating(null);
      setNewName('');
      return;
    }
    const base = parentPath || creating?.parentPath || rootPath;
    const name = newName?.trim();
    if (!name) return;
    try {
      if (!window.editorAPI?.createEntry) {
        alert('Create is only available in the Electron shell');
        return;
      }
      const res = await window.editorAPI.createEntry({ basePath: base, name, type: creating?.type || 'file' });
      if (!res?.success) {
        alert('Create failed: ' + (res?.error || 'unknown'));
        return;
      }
      await onRefresh?.(rootPath);
      setCreating(null);
      setNewName('');
    } catch (err) {
      alert('Create error: ' + err?.message);
    }
  };

  const isRootCreate = creating && isRootPath(creating.parentPath);

  return (
    <aside className="panel panel-tree">
      <div className="panel-header tree-header">
        <div>
          <h2>Project</h2>
          <p className="folder-path" title={folderLabel}>
            {folderLabel}
          </p>
        </div>
        <button
          className="open-folder-button"
          type="button"
          onClick={onChooseFolder}
          disabled={isLoading || !hasFileSystemAccess}
        >
          {isLoading ? 'Loading…' : 'Open Folder'}
        </button>
      </div>
      <div className="tree-body">
        {!hasFileSystemAccess && (
          <p className="tree-placeholder">Launch the Electron shell to access your local file system.</p>
        )}
        {hasFileSystemAccess && !tree?.length && !isLoading && (
          <p className="tree-placeholder">No folder selected yet.</p>
        )}
        {hasFileSystemAccess && folderPath ? (
          <ul className="tree-list" onContextMenu={e => handleContext(e, { path: rootPath, type: 'folder' })}>
            {isRootCreate && (
              <li className="tree-node file" style={{ paddingLeft: '8px' }}>
                <input
                  autoFocus
                  value={newName}
                  placeholder={creating?.type === 'folder' ? 'NewFolder' : 'newfile.txt'}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') doCreate(rootPath);
                    if (e.key === 'Escape') doCreate(null, true);
                  }}
                />
              </li>
            )}
            {tree?.length ? (
              tree.map(node => (
                <div key={node.path} onContextMenu={e => handleContext(e, node)}>
                  <TreeNode
                    node={node}
                    depth={0}
                    activeFilePath={activeFilePath}
                    onSelectFile={onSelectFile}
                    creating={creating}
                    newName={newName}
                    setNewName={setNewName}
                    doCreate={doCreate}
                    renaming={renaming}
                    renameName={renameName}
                    setRenameName={setRenameName}
                    doRename={doRename}
                  />
                </div>
              ))
            ) : (
              !isRootCreate && <li className="tree-placeholder">Folder is empty.</li>
            )}
          </ul>
        ) : null}
        {fsError && <p className="tree-error">{fsError}</p>}
        {contextMenu && (
          <div
            className="context-menu"
            style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
            onMouseLeave={closeContext}
          >
            <button type="button" onClick={() => onCreateRequested('file')}>
              New File
            </button>
            <button type="button" onClick={() => onCreateRequested('folder')}>
              New Folder
            </button>
            <button
              type="button"
              onClick={() => onRenameRequested(contextMenu.node)}
              disabled={!contextMenu.node || isRootPath(contextMenu.node.path)}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => doDelete(contextMenu.node.path)}
              disabled={!contextMenu.node || isRootPath(contextMenu.node.path)}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export default ProjectTree;
