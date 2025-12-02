import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import url from 'url';
import fs from 'fs/promises';
import { spawn as spawnProcess } from 'child_process';

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');

const isDev = process.env.NODE_ENV === 'development';
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';

let mainWindow;

const IGNORED_DIRECTORIES = new Set(['.git', '.vscode', 'node_modules']);
const terminals = new Map();
let nextTerminalId = 1;

const getShellConfig = () => {
  if (process.platform === 'win32') {
    return {
      command: process.env.COMSPEC || 'powershell.exe',
      args: ['-NoLogo']
    };
  }
  return {
    command: process.env.SHELL || '/bin/bash',
    args: ['-i']
  };
};

const buildTree = async currentPath => {
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const nodes = await Promise.all(
    dirEntries
      .filter(entry => !IGNORED_DIRECTORIES.has(entry.name))
      .map(async entry => {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          return {
            type: 'folder',
            name: entry.name,
            path: absolutePath,
            children: await buildTree(absolutePath)
          };
        }
        return {
          type: 'file',
          name: entry.name,
          path: absolutePath
        };
      })
  );

  return nodes.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'folder' ? -1 : 1;
  });
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1f27',
    webPreferences: {
      // use CommonJS preload so Electron can require it even when project is ESM
      preload: path.join(process.cwd(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    if (openDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadURL(
      url.format({
        pathname: path.join(process.cwd(), 'dist', 'index.html'),
        protocol: 'file:',
        slashes: true
      })
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const registerIpcHandlers = () => {
  ipcMain.handle('select-folder', async () => {
    // log that the IPC was called
    // eslint-disable-next-line no-console
    console.log('[main] select-folder invoked');

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0];
    const tree = await buildTree(folderPath);
    return { folderPath, tree };
  });

  ipcMain.handle('read-file', async (_event, filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { filePath, content };
    } catch (error) {
      return { filePath, error: error.message };
    }
  });

  ipcMain.handle('create-entry', async (_event, { basePath, name, type }) => {
    // eslint-disable-next-line no-console
    console.log('[main] create-entry', { basePath, name, type });
    try {
      const target = path.join(basePath, name);
      if (type === 'folder') {
        await fs.mkdir(target, { recursive: true });
        // eslint-disable-next-line no-console
        console.log('[main] create-entry success', target);
        return { success: true, path: target };
      }
      // default: create file
      await fs.writeFile(target, '', 'utf-8');
      // eslint-disable-next-line no-console
      console.log('[main] create-entry success', target);
      return { success: true, path: target };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[main] create-entry error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rename-entry', async (_event, { path: targetPath, newName }) => {
    // eslint-disable-next-line no-console
    console.log('[main] rename-entry', { targetPath, newName });
    try {
      const parent = path.dirname(targetPath);
      const destination = path.join(parent, newName);
      await fs.rename(targetPath, destination);
      // eslint-disable-next-line no-console
      console.log('[main] rename-entry success', destination);
      return { success: true, path: destination };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[main] rename-entry error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-entry', async (_event, { path: targetPath }) => {
    // eslint-disable-next-line no-console
    console.log('[main] delete-entry', { targetPath });
    try {
      // attempt to remove directory or file
      // fs.rm with recursive works for both files and directories
      await fs.rm(targetPath, { recursive: true, force: true });
      // eslint-disable-next-line no-console
      console.log('[main] delete-entry success', targetPath);
      return { success: true };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[main] delete-entry error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('read-tree', async (_event, folderPath) => {
    try {
      const tree = await buildTree(folderPath);
      return { success: true, tree };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-file', async (_event, { filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return { filePath };
    } catch (error) {
      return { filePath, error: error.message };
    }
  });

  ipcMain.handle('terminal-create', (event, { cwd } = {}) => {
    try {
      const { command, args } = getShellConfig();
      const workingDir = cwd || process.cwd();
      const child = spawnProcess(command, args, {
        cwd: workingDir,
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: 'pipe'
      });

      const id = nextTerminalId++;
      terminals.set(id, { child, webContents: event.sender });

      child.stdout?.on('data', data => {
        try {
          event.sender.send('terminal-data', { id, data: data.toString() });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[main] terminal-data send error', err);
        }
      });

      child.stderr?.on('data', data => {
        try {
          event.sender.send('terminal-data', { id, data: data.toString() });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[main] terminal-stderr send error', err);
        }
      });

      child.on('exit', (code, signal) => {
        terminals.delete(id);
        try {
          event.sender.send('terminal-exit', { id, code, signal });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[main] terminal-exit send error', err);
        }
      });

      return { success: true, id };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[main] terminal-create error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('terminal-write', (_event, { id, data }) => {
    const entry = terminals.get(id);
    if (entry?.child?.stdin?.writable) {
      entry.child.stdin.write(data);
    }
  });

  ipcMain.on('terminal-resize', () => {
    // no-op: pseudo-terminal resizing is not supported with stdio pipes
  });

  ipcMain.on('terminal-dispose', (_event, { id }) => {
    const entry = terminals.get(id);
    if (entry?.child) {
      entry.child.kill();
    }
    terminals.delete(id);
  });
};

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
