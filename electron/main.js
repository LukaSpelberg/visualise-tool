import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import url from 'url';
import fs from 'fs/promises';
import os from 'os';
import * as pty from 'node-pty';
import express from 'express';
import getPort from 'get-port';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');

const isDev = process.env.NODE_ENV === 'development';
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';

let mainWindow;

const IGNORED_DIRECTORIES = new Set(['.git', '.vscode', 'node_modules']);
const terminals = new Map();
let nextTerminalId = 1;

const OLLAMA_MODEL = 'bsahane/Qwen2.5-VL-7B-Instruct:Q4_K_M_benxh';
const DEFAULT_SYSTEM_PROMPT = 'You are a UI reverse-engineering assistant. Given a screenshot, describe the UI in concise build instructions for a frontend engineer. Mention layout regions, element types (buttons, inputs, cards), hierarchy, alignment, spacing, sizes, and notable styles. Avoid speculation about app logic; focus on what is visually observable.';
const DEFAULT_USER_PROMPT = 'Analyse this UI screenshot and describe how to recreate it. Prefer short sentences that a frontend engineer can follow. Mention components, layout, sizing, spacing, text, and any media like iframes or images.';

// Preview server state
let previewServer = null;
let previewPort = null;
const BUILD_DIR_CANDIDATES = ['dist', 'build', 'public'];
const COMMON_DEV_PORTS = [3000, 5173, 4173, 8080, 8000, 4200];
let devProcess = null;
let devProcessInfo = null; // { cwd, script }

const pathExists = async target => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const resolveStaticTarget = async basePath => {
  for (const dirName of BUILD_DIR_CANDIDATES) {
    const candidateRoot = path.join(basePath, dirName);
    const candidateIndex = path.join(candidateRoot, 'index.html');
    if (await pathExists(candidateIndex)) {
      return { root: candidateRoot, indexPath: candidateIndex, source: dirName };
    }
  }

  const rootIndex = path.join(basePath, 'index.html');
  if (await pathExists(rootIndex)) {
    return { root: basePath, indexPath: rootIndex, source: 'root-index' };
  }

  return null;
};

const readPackageJson = async basePath => {
  const pkgPath = path.join(basePath, 'package.json');
  if (!(await pathExists(pkgPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(pkgPath, 'utf-8');
    return { pkg: JSON.parse(raw), pkgPath };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[preview-server] Failed to parse package.json at ${pkgPath}:`, error);
    return null;
  }
};

const stopExistingPreviewServer = async () => {
  if (previewServer) {
    await new Promise(resolve => {
      previewServer.close(() => resolve());
    });
    // eslint-disable-next-line no-console
    console.log('[preview-server] Stopped');
    previewServer = null;
    previewPort = null;
  }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const checkPortAvailableUrl = port => `http://localhost:${port}`;

const pingPort = port =>
  new Promise(resolve => {
    const urlToTry = checkPortAvailableUrl(port);
    const client = urlToTry.startsWith('https') ? https : http;
    const req = client
      .get(urlToTry, res => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, url: urlToTry, status: res.statusCode });
      })
      .on('error', () => resolve({ ok: false, url: urlToTry }));

    req.setTimeout(800, () => {
      req.destroy();
      resolve({ ok: false, url: urlToTry });
    });
  });

const findRunningDevServer = async (skipPorts = []) => {
  for (const port of COMMON_DEV_PORTS) {
    if (skipPorts.includes(port)) continue;
    if (isDev && port === 5173) continue; // avoid picking the editor's own dev server
    const result = await pingPort(port);
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log(`[preview-server] Found running dev server at ${result.url} (status ${result.status || 'unknown'})`);
      return result.url;
    }
  }
  return null;
};

const waitForDevServer = async (timeoutMs = 20000, intervalMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const urlFound = await findRunningDevServer();
    if (urlFound) return urlFound;
    await delay(intervalMs);
  }
  return null;
};

const stopDevProcess = async () => {
  if (devProcess && devProcessInfo?.startedByApp) {
    try {
      devProcess.kill();
    } catch (e) {
      // ignore
    }
  }
  devProcess = null;
  devProcessInfo = null;
};

const spawnDevProcess = (cwd, script) => {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', script], {
    cwd,
    shell: true,
    env: {
      ...process.env,
      BROWSER: 'none'
    }
  });

  devProcess = child;
  devProcessInfo = { cwd, script, startedByApp: true };

  child.stdout?.on('data', data => {
    // eslint-disable-next-line no-console
    console.log(`[preview-dev] ${data.toString().trimEnd()}`);
  });
  child.stderr?.on('data', data => {
    // eslint-disable-next-line no-console
    console.error(`[preview-dev-err] ${data.toString().trimEnd()}`);
  });
  child.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.log(`[preview-dev] exited code=${code} signal=${signal}`);
    devProcess = null;
    devProcessInfo = null;
  });

  return child;
};

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

  ipcMain.handle('ollama-analyze-image', async (_event, { imageBase64, prompt, systemPrompt }) => {
    try {
      if (!imageBase64) {
        return { success: false, error: 'No image provided.' };
      }

      const stripped = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const payload = {
        model: OLLAMA_MODEL,
        prompt: prompt || DEFAULT_USER_PROMPT,
        system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        images: [stripped],
        stream: false
      };

      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Ollama error ${res.status}: ${text}` };
      }

      const data = await res.json();
      return { success: true, text: data?.response || '' };
    } catch (error) {
      return { success: false, error: error.message };
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
      await stopExistingPreviewServer();

      const pkgInfo = await readPackageJson(folderPath);
      let target = await resolveStaticTarget(folderPath);

      if (!target && pkgInfo?.pkg) {
        const scripts = pkgInfo.pkg.scripts || {};
        const preferredScript = scripts.dev ? 'dev' : scripts.start ? 'start' : null;

        if (preferredScript) {
          // If we already started a dev process for this folder, reuse it.
          if (devProcess && devProcessInfo?.cwd === folderPath) {
            const reused = await waitForDevServer(5000, 500);
            if (reused) {
              return { success: true, url: reused, servedFrom: reused, spaFallback: false, externalDevServer: false, reusedDevProcess: true };
            }
          }

          // Try to detect an already-running dev server (maybe user started it manually)
          const runningUrl = await findRunningDevServer();
          if (runningUrl) {
            return { success: true, url: runningUrl, servedFrom: runningUrl, spaFallback: false, externalDevServer: true };
          }

          // Start the dev script ourselves
          spawnDevProcess(folderPath, preferredScript);
          const awaited = await waitForDevServer();
          if (awaited) {
            return { success: true, url: awaited, servedFrom: awaited, spaFallback: false, externalDevServer: false, startedScript: preferredScript };
          }

          await stopDevProcess();
          return {
            success: false,
            needsRuntime: true,
            error: `Started 'npm run ${preferredScript}' but no dev server responded on common ports. Please check the script output in your project.`
          };
        }
      }

      if (!target) {
        // Fall back to serving the folder directly (best effort for static sites)
        target = { root: folderPath, indexPath: null, source: 'raw-root' };
      }

      // Find a free port
      const port = await getPort({ port: [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 4000, 5000, 8000, 8080, 9000] });

      // Create express server
      const app = express();

      // Serve the resolved static root
      app.use(express.static(target.root));

      // SPA fallback: on any GET that accepts HTML and was not found, return index.html
      if (target.indexPath) {
        app.use((req, res, next) => {
          if (req.method !== 'GET') return next();
          const accept = req.headers.accept || '';
          if (accept && !accept.includes('text/html')) return next();
          return res.sendFile(target.indexPath);
        });
      }

      // Start server
      await new Promise((resolve, reject) => {
        const server = app.listen(port, (err) => {
          if (err) reject(err);
          else {
            previewServer = server;
            previewPort = port;
            // eslint-disable-next-line no-console
            console.log(`[preview-server] Started on port ${port} serving ${target.root} (${target.source})`);
            resolve();
          }
        });
      });

      return { success: true, url: `http://localhost:${port}`, servedFrom: target.root, spaFallback: Boolean(target.indexPath) };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[preview-server] Error starting server:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-preview-server', async () => {
    try {
      await stopExistingPreviewServer();
      await stopDevProcess();
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
