import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import url from 'url';
import fs from 'fs/promises';
import os from 'os';
import * as pty from 'node-pty';
import express from 'express';
import getPort from 'get-port';

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');

const isDev = process.env.NODE_ENV === 'development';
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';

let mainWindow;

const IGNORED_DIRECTORIES = new Set(['.git', '.vscode', 'node_modules']);
const terminals = new Map();
let nextTerminalId = 1;

// Preview server state
let previewServer = null;
let previewPort = null;

const getShellConfig = () => {
  if (process.platform === 'win32') {
    return {
      shell: 'powershell.exe',
      args: []
    };
  }
  return {
    shell: process.env.SHELL || '/bin/bash',
    args: []
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
      sandbox: false,
      webviewTag: true // Enable webview tag
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

  ipcMain.handle('terminal-create', (event, { cwd, cols = 80, rows = 24 } = {}) => {
    try {
      const { shell, args } = getShellConfig();
      const workingDir = cwd || os.homedir();

      // eslint-disable-next-line no-console
      console.log(`[terminal-create] Spawning PTY: ${shell} in ${workingDir}`);

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workingDir,
        env: process.env
      });

      const id = nextTerminalId++;
      terminals.set(id, { ptyProcess, webContents: event.sender });

      // Handle data from PTY
      ptyProcess.onData(data => {
        try {
          event.sender.send('terminal-data', { id, data });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[main] terminal-data send error', err);
        }
      });

      // Handle exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        terminals.delete(id);
        try {
          event.sender.send('terminal-exit', { id, code: exitCode, signal });
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
    if (entry?.ptyProcess) {
      entry.ptyProcess.write(data);
    }
  });

  ipcMain.on('terminal-resize', (_event, { id, cols, rows }) => {
    const entry = terminals.get(id);
    if (entry?.ptyProcess) {
      try {
        entry.ptyProcess.resize(cols, rows);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[main] terminal-resize error', err);
      }
    }
  });

  ipcMain.on('terminal-dispose', (_event, { id }) => {
    const entry = terminals.get(id);
    if (entry?.ptyProcess) {
      entry.ptyProcess.kill();
    }
    terminals.delete(id);
  });

  // Preview server handlers
  ipcMain.handle('start-preview-server', async (_event, { folderPath }) => {
    try {
      // Stop existing server if running
      if (previewServer) {
        await new Promise((resolve) => {
          previewServer.close(() => resolve());
        });
        previewServer = null;
        previewPort = null;
      }

      // Find a free port
      const port = await getPort({ port: [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 4000, 5000, 8000, 8080, 9000] });
      
      // Create express server
      const app = express();
      app.use(express.static(folderPath));
      
      // Start server
      await new Promise((resolve, reject) => {
        const server = app.listen(port, (err) => {
          if (err) reject(err);
          else {
            previewServer = server;
            previewPort = port;
            // eslint-disable-next-line no-console
            console.log(`[preview-server] Started on port ${port}`);
            resolve();
          }
        });
      });

      return { success: true, url: `http://localhost:${port}` };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[preview-server] Error starting server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-preview-server', async () => {
    try {
      if (previewServer) {
        await new Promise((resolve) => {
          previewServer.close(() => resolve());
        });
        // eslint-disable-next-line no-console
        console.log('[preview-server] Stopped');
        previewServer = null;
        previewPort = null;
      }
      return { success: true };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[preview-server] Error stopping server:', error);
      return { success: false, error: error.message };
    }
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
