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
import dotenv from 'dotenv';

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');
dotenv.config();

const isDev = process.env.NODE_ENV === 'development';
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';

let mainWindow;

const IGNORED_DIRECTORIES = new Set(['.git', '.vscode', 'node_modules']);
const terminals = new Map();
let nextTerminalId = 1;

const OLLAMA_MODEL = 'bsahane/Qwen2.5-VL-7B-Instruct:Q4_K_M_benxh';
const OLLAMA_BUILD_MODEL = 'qwen2.5-coder:7b';
const normalizeGeminiModel = value => (value || '').replace(/^models\//i, '') || 'gemini-1.5-flash';
const GEMINI_MODEL = normalizeGeminiModel(process.env.GEMINI_MODEL || 'gemini-1.5-flash');
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_SYSTEM_PROMPT = `
You are an expert UI/UX Technical Analyst specializing in Design Systems. Your goal is to analyze a UI screenshot of a single component and reverse-engineer it into a purely visual technical specification.

## CORE RULES
1. **NO HALLUCINATIONS**: Only describe elements that are strictly visible. If you see a text block, do not call it an input field unless there is a clear border/placeholder. 
2. **COMPONENT IDENTIFICATION**: First, identify what the component is (e.g., Article Card, Navigation Bar, Modal, Button, Sidebar).
3. **TECHNICAL ACCURACY**: Estimate pixel values (px), colors (hex or descriptive), and layout techniques (Flexbox/Grid).
4. **VIBE & FEEL**: Pay close attention to border-radius, shadows, gradients, and font-weights.

## OUTPUT FORMAT
You must provide the analysis in the following Markdown structure:

### 1. Component Identity
* **Type**: [e.g., Card, Button, Input Group]
* **Purpose**: [Brief guess at function, e.g., "Displaying a blog post summary"]

### 2. Visual Inventory (List every visible item)
* [Element Name]: [Location] - [Visual description]
    * *Example: Avatar Image: Bottom Left - Circular, approx 32px.*

### 3. Layout & Box Model
* **Container Width**: [Estimate, e.g., Full width or fixed 400px]
* **Padding**: [Estimate, e.g., 16px all around]
* **Layout Strategy**: [Flexbox (Row/Column) or Grid]
* **Alignment**: [e.g., Content is aligned to the bottom-left]

### 4. Typography & Content
* **Headings**: [Font-size estimate, weight, color]
* **Subtext/Metadata**: [Font-size estimate, weight, color]
* **Text Positioning**: [e.g., Overlaying the image, absolute positioned]

### 5. Styling & "The Vibe"
* **Background**: [Solid color, Gradient, or Image URL placeholder]
* **Border Radius**: [Estimate, e.g., 12px, 24px, or Pill-shape]
* **Shadows/Effects**: [e.g., Soft drop shadow, background blur, overlay gradient]
`;
const DEFAULT_USER_PROMPT = `
Analyze the attached screenshot. It contains a single UI component. 

Dissect the visual hierarchy and styling details. Be highly specific about spacing (padding/margins) and the relationship between elements (e.g., is the text on top of an image?). 

If there are images, describe their aspect ratio and corner rounding.

If the image contains more than a single component or does not look like a component, Return an error that this image is too complex and goes beyond your scope.
`;
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

const stripCodeFences = text => {
  if (!text) return '';
  const fenceMatch = text.match(/```[\s\S]*?```/);
  if (fenceMatch) {
    return fenceMatch[0].replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return text.trim();
};

const languageToExtension = language => {
  if (!language) return 'txt';
  const normalized = language.toLowerCase();
  if (normalized.includes('tsx')) return 'tsx';
  if (normalized.includes('typescript')) return 'tsx';
  if (normalized.includes('react')) return 'jsx';
  if (normalized.includes('jsx')) return 'jsx';
  if (normalized.includes('svelte')) return 'svelte';
  if (normalized.includes('vue')) return 'vue';
  if (normalized.includes('html')) return 'html';
  if (normalized.includes('css')) return 'css';
  if (normalized.includes('python')) return 'py';
  return 'txt';
};

const slugify = value => {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'component';
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
      return { success: true, filePath, content };
    } catch (error) {
      return { success: false, filePath, error: error.message };
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

  ipcMain.handle('save-file', async (_event, { filePath, content, encoding }) => {
    try {
      // Support base64 encoding for binary files
      if (encoding === 'base64') {
        const buffer = Buffer.from(content, 'base64');
        await fs.writeFile(filePath, buffer);
      } else {
        await fs.writeFile(filePath, content, 'utf-8');
      }
      return { success: true, filePath };
    } catch (error) {
      return { success: false, filePath, error: error.message };
    }
  });

  ipcMain.handle('ensure-dir', async (_event, { dirPath }) => {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true, path: dirPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-file-binary', async (_event, { filePath, dataUrl }) => {
    try {
      // Ensure the directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Extract base64 data from data URL
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const buffer = Buffer.from(base64Data, 'base64');

      await fs.writeFile(filePath, buffer);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('copy-file', async (_event, { sourcePath, targetPath }) => {
    try {
      // Ensure the target directory exists
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.copyFile(sourcePath, targetPath);
      return { success: true, filePath: targetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('gemini-analyze-image', async (_event, { imageBase64, prompt, systemPrompt, mimeType }) => {
    try {
      if (!imageBase64) {
        return { success: false, error: 'No image provided.' };
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'Missing GEMINI_API_KEY in environment.' };
      }

      const stripped = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const inferredMime = mimeType || imageBase64.match(/^data:(.*?);base64,/i)?.[1] || 'image/png';

      const urlToCall = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const payload = {
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemPrompt || DEFAULT_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt || DEFAULT_USER_PROMPT },
              { inlineData: { mimeType: inferredMime, data: stripped } }
            ]
          }
        ]
      };

      const res = await fetch(urlToCall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Gemini error ${res.status}: ${text}` };
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const combinedText = parts
        .map(part => part?.text)
        .filter(Boolean)
        .join('\n')
        .trim();

      return { success: true, text: combinedText || '' };
    } catch (error) {
      return { success: false, error: error.message };
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

  ipcMain.handle('build-component', async (_event, { folderPath, name, useCase, language, analysis, userSettings }) => {
    try {
      const trimmedName = (name || '').trim();
      const trimmedUseCase = (useCase || '').trim();
      const trimmedAnalysis = (analysis || '').trim();

      // Build design system context from user settings
      let designSystemContext = '';
      if (userSettings) {
        const parts = [];

        // Colors
        if (userSettings.colors && Array.isArray(userSettings.colors)) {
          const colorLines = userSettings.colors.map(c => `  - ${c.name}: ${c.value}`).join('\n');
          parts.push(`**Color Palette:**\n${colorLines}`);
        }

        // Typography
        if (userSettings.fonts) {
          const fontLines = Object.entries(userSettings.fonts).map(([el, config]) => {
            const caseStr = config.case && config.case !== 'none' ? `, text-transform: ${config.case}` : '';
            return `  - ${el.toUpperCase()}: ${config.family}, ${config.weight} weight, ${config.size}px${caseStr}`;
          }).join('\n');
          parts.push(`**Typography:**\n${fontLines}`);
        }

        // Code Language preference
        if (userSettings.codeLanguage) {
          parts.push(`**Preferred Framework:** ${userSettings.codeLanguage}`);
        }

        if (parts.length > 0) {
          designSystemContext = `\n\n**USER'S DESIGN SYSTEM (use these values):**\n${parts.join('\n\n')}`;
        }
      }

      if (!folderPath) {
        return { success: false, error: 'Open a folder before building the component.' };
      }

      if (!trimmedName || !trimmedUseCase || !trimmedAnalysis) {
        return { success: false, error: 'Name, use case, and image interpretation are required to build.' };
      }

      const targetDir = path.join(folderPath, 'componentAI');
      await fs.mkdir(targetDir, { recursive: true });

      // Generate 4 variations with different temperatures for variety
      const variations = [
        { id: 1, temperature: 0.2 },
        { id: 2, temperature: 0.4 },
        { id: 3, temperature: 0.6 },
        { id: 4, temperature: 0.8 }
      ];

      const results = await Promise.all(
        variations.map(async (variation) => {
          const prompt = `You are an expert front-end engineer. Build a single-file ${language || 'React'} component named "${trimmedName}".
Use case: ${trimmedUseCase}.

Image interpretation (authoritative):
${trimmedAnalysis}
${designSystemContext}

Requirements:
- Return ONLY the final source code, no markdown fences, no commentary.
- Keep dependencies minimal; prefer inline CSS or component-scoped styles.
- If React/TSX/JSX, export a default component that renders the UI.
- If HTML, include inline styles and keep everything self contained.
- Use the colors from the user's design system palette above. Match color names to appropriate uses (e.g., primary for main actions, accent for highlights). If the interpetation suggests colors not in the palette, follow the interpretation. if they look like close matches to the palette, prefer the palette colors.
-  Use the typography settings from the design system. Apply the correct font-family, font-weight, font-size, and text-transform for each heading/text element.
- Preserve any spacing and layout hints present in the interpretation.
- Follow the interpretation as closely as possible.
`;

          try {
            const res = await fetch('http://localhost:11434/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: OLLAMA_BUILD_MODEL,
                prompt,
                stream: false,
                options: { temperature: variation.temperature }
              })
            });

            if (!res.ok) {
              const text = await res.text();
              throw new Error(`Ollama build error ${res.status}: ${text}`);
            }

            const data = await res.json();
            const raw = data?.response?.trim() || '';
            const code = stripCodeFences(raw);

            const extension = languageToExtension(language);
            const tempFileName = `${slugify(trimmedName)}-var${variation.id}.${extension}`;
            const tempFilePath = path.join(targetDir, tempFileName);

            return {
              id: variation.id,
              code,
              tempFilePath,
              extension,
              success: true
            };
          } catch (error) {
            return {
              id: variation.id,
              success: false,
              error: error.message
            };
          }
        })
      );

      // Check if any variation succeeded
      const successful = results.filter(r => r.success);
      if (successful.length === 0) {
        return { success: false, error: 'All variations failed to build.' };
      }

      return {
        success: true,
        variations: results,
        targetDir,
        baseFileName: slugify(trimmedName)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-component-variation', async (_event, { selectedId, variations, targetDir, baseFileName, extension }) => {
    try {
      // Find the selected variation
      const selected = variations.find(v => v.id === selectedId && v.success);
      if (!selected) {
        return { success: false, error: 'Selected variation not found.' };
      }

      // Save the selected variation with the final name
      const finalFileName = `${baseFileName}.${extension}`;
      const finalFilePath = path.join(targetDir, finalFileName);
      await fs.writeFile(finalFilePath, selected.code, 'utf-8');

      // Delete all temporary variation files (they were never written, so nothing to delete)
      // Just return success
      return {
        success: true,
        filePath: finalFilePath,
        code: selected.code
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('edit-component-element', async (_event, { element, prompt, fullCode, language, userSettings }) => {
    try {
      if (!element || !prompt || !fullCode) {
        return { success: false, error: 'Element info, prompt, and code are required.' };
      }

      // Build design system context from user settings
      let designSystemContext = '';
      if (userSettings) {
        const parts = [];

        if (userSettings.colors && Array.isArray(userSettings.colors)) {
          const colorLines = userSettings.colors.map(c => `  - ${c.name}: ${c.value}`).join('\n');
          parts.push(`**Color Palette:**\n${colorLines}`);
        }

        if (userSettings.fonts) {
          const fontLines = Object.entries(userSettings.fonts).map(([el, config]) => {
            const caseStr = config.case && config.case !== 'none' ? `, text-transform: ${config.case}` : '';
            return `  - ${el.toUpperCase()}: ${config.family}, ${config.weight} weight, ${config.size}px${caseStr}`;
          }).join('\n');
          parts.push(`**Typography:**\n${fontLines}`);
        }

        if (parts.length > 0) {
          designSystemContext = `\n\n**USER'S DESIGN SYSTEM (use these values when applicable):**\n${parts.join('\n\n')}`;
        }
      }

      const editPrompt = `You are an expert front-end developer. A user has selected a specific element in their ${language || 'React'} component and wants to modify it.

**Selected Element:**
\`\`\`html
${element.fullOuterHTML}
\`\`\`

**User's Edit Request:**
${prompt}
${designSystemContext}

**Full Component Code:**
\`\`\`
${fullCode}
\`\`\`

**Your Task:**
Modify the component code to apply the user's requested changes to the selected element. Return ONLY the complete updated component code with the changes applied. No markdown fences, no explanations, just the raw code.

Important:
- Preserve all other elements and functionality
- Only modify what the user requested
- Maintain the same code structure and style
- If the edit involves CSS changes, apply them appropriately (inline styles, className, etc.)
- When applying colors or typography, prefer values from the user's design system if available
`;

      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_BUILD_MODEL,
          prompt: editPrompt,
          stream: false,
          options: { temperature: 0.3 }
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama edit error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const raw = data?.response?.trim() || '';
      const updatedCode = stripCodeFences(raw);

      return {
        success: true,
        updatedCode
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // BUILD FEATURE - Design to Code
  // ============================================

  // Helper for exponential backoff
  const fetchWithRetry = async (url, options, retries = 3, backoff = 1000) => {
    try {
      const res = await fetch(url, options);
      if (res.status === 503 && retries > 0) {
        console.warn(`[Gemini] 503 Service Unavailable. Retrying in ${backoff}ms... (${retries} retries left)`);
        await delay(backoff);
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      return res;
    } catch (error) {
      if (retries > 0) {
        console.warn(`[Gemini] Fetch error: ${error.message}. Retrying in ${backoff}ms... (${retries} retries left)`);
        await delay(backoff);
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      throw error;
    }
  };

  // Helper: Scan project for existing components
  const scanProjectComponents = async (folderPath) => {
    const components = [];
    const componentDir = path.join(folderPath, 'componentAI');

    console.log('[Build] Scanning for components in:', componentDir);

    try {
      const files = await fs.readdir(componentDir);
      console.log('[Build] Found files in componentAI:', files);

      for (const file of files) {
        const filePath = path.join(componentDir, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile() && /\.(jsx?|tsx?|vue|svelte|html?)$/i.test(file)) {
          console.log('[Build] Loading component:', file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Extract a brief summary (first 100 lines or component definition)
            const lines = content.split('\n').slice(0, 100);
            components.push({
              name: file.replace(/\.[^.]+$/, ''),
              fileName: file,
              path: filePath,
              code: content,
              summary: lines.join('\n')
            });
          } catch (e) {
            console.log('[Build] Error reading file:', file, e.message);
          }
        }
      }
    } catch (e) {
      console.log('[Build] componentAI folder not found or error:', e.message);
    }

    console.log('[Build] Total components found:', components.length);
    return components;
  };

  // Helper: Load style guide
  const loadStyleGuide = async (folderPath) => {
    try {
      const settingsPath = path.join(folderPath, '.visualise-settings.json');
      const content = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      if (settings.enabled === false) return null;
      return settings;
    } catch (e) {
      return null;
    }
  };

  // Helper: Detect project structure
  const detectProjectStructure = async (folderPath) => {
    const structure = {
      type: 'unknown',
      hasPackageJson: false,
      hasSrcFolder: false,
      framework: null, // 'react', 'vue', 'svelte', 'next', 'html'
      suggestedOutputDir: folderPath
    };

    try {
      // Check for package.json
      const pkgPath = path.join(folderPath, 'package.json');
      try {
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);
        structure.hasPackageJson = true;

        // Detect framework
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) {
          structure.framework = 'next';
          structure.type = 'nextjs';
        } else if (deps.react) {
          structure.framework = 'react';
          structure.type = 'react';
        } else if (deps.vue) {
          structure.framework = 'vue';
          structure.type = 'vue';
        } else if (deps.svelte) {
          structure.framework = 'svelte';
          structure.type = 'svelte';
        }
      } catch (e) {
        // No package.json - likely plain HTML
        structure.type = 'html';
        structure.framework = 'html'; // Explicitly set framework to html
      }

      // Check for src folder
      try {
        await fs.stat(path.join(folderPath, 'src'));
        structure.hasSrcFolder = true;

        if (structure.framework === 'next') {
          // Next.js logic...
          try {
            await fs.stat(path.join(folderPath, 'app'));
            structure.suggestedOutputDir = path.join(folderPath, 'app');
          } catch {
            structure.suggestedOutputDir = path.join(folderPath, 'pages') || path.join(folderPath, 'src');
          }
        } else if (structure.framework === 'html' || structure.type === 'unknown') {
          // FORCE ROOT for HTML, even if src exists (it might be for assets)
          structure.suggestedOutputDir = folderPath;
        } else {
          // For React/Vue etc, default to src
          structure.suggestedOutputDir = path.join(folderPath, 'src');
        }
      } catch (e) {
        // No src folder
      }
    } catch (e) {
      // Error detecting structure
    }

    return structure;
  };

  // Helper: Scan Image Bank
  const scanImageBank = async (folderPath) => {
    const imagesDir = path.join(folderPath, 'src', 'assets', 'images');
    try {
      const files = await fs.readdir(imagesDir);
      // Filter for images
      const images = files.filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f));
      return images.map(img => `src/assets/images/${img}`);
    } catch (e) {
      return [];
    }
  };

  // Format style guide for prompt
  const formatStyleGuideForPrompt = (styleGuide) => {
    if (!styleGuide) return '';

    const parts = [];

    if (styleGuide.colors && Array.isArray(styleGuide.colors)) {
      const colorLines = styleGuide.colors.map(c => `  - ${c.name}: ${c.value}`).join('\n');
      parts.push(`**Colors:**\n${colorLines}`);
    }

    if (styleGuide.fonts) {
      const fontLines = Object.entries(styleGuide.fonts).map(([el, config]) => {
        const caseStr = config.case && config.case !== 'none' ? `, text-transform: ${config.case}` : '';
        return `  - ${el.toUpperCase()}: ${config.family}, ${config.weight} weight, ${config.size}px${caseStr}`;
      }).join('\n');
      parts.push(`**Typography:**\n${fontLines}`);
    }

    if (styleGuide.codeLanguage) {
      parts.push(`**Preferred Framework:** ${styleGuide.codeLanguage}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
  };

  // Format components for prompt
  const formatComponentsForPrompt = (components) => {
    if (!components || components.length === 0) return 'No existing components found.';

    return components.map(c => {
      // Extract props from component code (basic extraction)
      const propsMatch = c.code.match(/(?:interface\s+\w+Props|type\s+\w+Props|props:\s*{[^}]+}|const\s+\w+\s*=\s*\({[^}]+}\))/);
      const propsHint = propsMatch ? propsMatch[0].slice(0, 200) : 'Props not detected';

      // Increased from 500 to 3000 chars to give better context
      return `**${c.name}** (${c.fileName})
Props: ${propsHint}
\`\`\`
${c.code.slice(0, 3000)}${c.code.length > 3000 ? '\n// ... (truncated)' : ''}
\`\`\``;
    }).join('\n\n');
  };

  // Analyze build design with Gemini
  ipcMain.handle('analyze-build-design', async (_event, { imageBase64, mimeType, folderPath, userMessage }) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'Missing GEMINI_API_KEY in environment.' };
      }

      if (!folderPath) {
        return { success: false, error: 'No project folder open.' };
      }

      // Gather context
      const [components, styleGuide, projectStructure, availableImages] = await Promise.all([
        scanProjectComponents(folderPath),
        loadStyleGuide(folderPath),
        detectProjectStructure(folderPath),
        scanImageBank(folderPath)
      ]);

      const styleGuideText = formatStyleGuideForPrompt(styleGuide);
      const componentsText = formatComponentsForPrompt(components);
      const imagesText = availableImages.length > 0
        ? availableImages.join('\n')
        : 'No images found in src/assets/images';

      const systemPrompt = `You are an expert UI developer assistant. You help users build web pages and applications from design images.

Your task is to analyze the provided design image and create a detailed build plan.

**Available Components in this project:**
${componentsText}

**Available Images (use these exact paths):**
${imagesText}

**Project Style Guide:**
${styleGuideText || 'No style guide configured.'}

**Project Structure:**
- Type: ${projectStructure.type}
- Framework: ${projectStructure.framework || 'None detected'}
- Has src folder: ${projectStructure.hasSrcFolder}

**Instructions:**
1. Analyze the design image carefully
2. Identify which existing components can be reused. 
   - **Reuse Strategy:** Reuse the structure/class names of existing components.
   - **Adaptation:** You MUST update the content (text, images, links) of reused components to match the design. Do NOT leave placeholders if the design shows real content.
   - **Props:** If the component accepts props (e.g. \`image\`, \`title\`), pass the correct values from the design.
3. Identify what new components need to be created
4. Select appropriate images from the **Available Images** list for any placeholders.
5. Create a detailed build plan.

**FILE STRUCTURE RULES:**
- If the Project Type is "html" or "unknown" (Plain HTML/CSS):
  - Place \`index.html\` in the ROOT directory (do not put it in src/).
  - Place CSS files in a \`styles/\` folder.
  - Place JS files in a \`script/\` folder.
  - Fix all relative paths in imports to match this structure (e.g. \`<link href="styles/main.css">\`).
- If the Project Type is "react", "vue", etc., follow standard conventions (usually src/ folder).

**CRITICAL OUTPUT RULES:**
- You MUST return your response in TWO DISTINCT PARTS.
- The parts MUST be separated by the exact string: "---DETAILED_PROMPT---"
- Do NOT omit this separator.
- PART 2 is the most important part; it is used by a code generator.

**OUTPUT FORMAT:**

PART 1 (User-facing summary):
- Describe what you see in the design
- List which existing components you'll reuse and how you will adapt them (e.g. "Will reuse Card component but change image to X")
- List what new files you'll create
- Explain your approach briefly

---DETAILED_PROMPT---

PART 2 (Detailed build prompt for code generation):
- Exact file structure with full paths
- For each file: complete specifications including:
  - Imports needed
  - Component structure
  - HTML/JSX elements with exact hierarchy
  - CSS specifications (colors, spacing, fonts from style guide)
  - **Props/Content Adaptation:** Explicitly state how to adapt reused components (e.g. "Use 'Card' component code but replace \`src='placeholder.jpg'\` with \`src='src/assets/images/real.jpg'\`").
  - **New Elements:** For any new buttons, inputs, etc., explicitly specify the font-family, colors, and border-radius from the Style Guide.
  - Image paths (use exact paths from Available Images)
  - Responsive breakpoints if applicable
  - If reusing a component, explicitly state: "Reuse existing component [Name]: [Path]" and provide the code snippet to copy if needed.
- Be extremely detailed - the code generator needs exact specifications
- DO NOT use markdown formatting for Part 2, just plain text instructions.`;

      const userPrompt = userMessage
        ? `Here's the design I want to build. ${userMessage}`
        : 'Analyze this design and create a detailed build plan.';

      const urlToCall = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const res = await fetchWithRetry(urlToCall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } },
              { text: userPrompt }
            ]
          }]
        })
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Gemini error ${res.status}: ${text}` };
      }

      const data = await res.json();
      const fullResponse = (data?.candidates || [])
        .flatMap(c => c?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n')
        .trim();

      // Split response into summary and detailed prompt
      const parts = fullResponse.split('---DETAILED_PROMPT---');

      if (parts.length < 2) {
        // Fallback or error if separator is missing
        // If the model ignored instructions, we might have just a summary or just a plan.
        // We'll log it and try to return what we have, but warn.
        console.warn('[Gemini] Missing separator ---DETAILED_PROMPT---');
        return {
          success: false,
          error: 'The AI analysis was incomplete (missing build plan). Please try again.'
        };
      }

      const summary = parts[0]?.trim() || 'Analysis complete.';
      const detailedPrompt = parts[1]?.trim() || '';

      if (!detailedPrompt) {
        return {
          success: false,
          error: 'The AI generated an empty build plan. Please try again.'
        };
      }

      return {
        success: true,
        summary,
        detailedPrompt,
        components: components.map(c => ({ name: c.name, fileName: c.fileName })),
        styleGuide,
        projectStructure,
        files: [] // Will be determined during build
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Refine build plan based on user feedback
  ipcMain.handle('refine-build-plan', async (_event, { currentPlan, userFeedback, folderPath }) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'Missing GEMINI_API_KEY in environment.' };
      }

      const styleGuideText = formatStyleGuideForPrompt(currentPlan.styleGuide);

      const prompt = `You previously created this build plan:

**Summary:**
${currentPlan.summary}

**Detailed Prompt:**
${currentPlan.detailedPrompt}

The user has this feedback: "${userFeedback}"

Please update the build plan based on this feedback. Respond in the same two-part format:
PART 1: Updated user-facing summary
---DETAILED_PROMPT---
PART 2: Updated detailed build prompt

Style Guide to use:
${styleGuideText || 'No style guide configured.'}`;

      const urlToCall = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const res = await fetchWithRetry(urlToCall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Gemini error ${res.status}: ${text}` };
      }

      const data = await res.json();
      const fullResponse = (data?.candidates || [])
        .flatMap(c => c?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n')
        .trim();

      const parts = fullResponse.split('---DETAILED_PROMPT---');
      const summary = parts[0]?.trim() || fullResponse;
      const detailedPrompt = parts[1]?.trim() || fullResponse;

      return {
        success: true,
        summary,
        detailedPrompt,
        components: currentPlan.components,
        styleGuide: currentPlan.styleGuide,
        files: []
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Execute the build with Ollama
  ipcMain.handle('execute-build', async (_event, { buildPlan, folderPath }) => {
    try {
      if (!buildPlan?.detailedPrompt) {
        return { success: false, error: 'No build plan provided.' };
      }

      const projectStructure = await detectProjectStructure(folderPath);
      const styleGuideText = formatStyleGuideForPrompt(buildPlan.styleGuide);

      // Load existing component code for context
      const components = await scanProjectComponents(folderPath);
      const componentsContext = components.length > 0
        ? `\n\n**Existing Components (import and reuse these):**\n${components.map(c => `${c.fileName}:\n\`\`\`\n${c.code}\n\`\`\``).join('\n\n')}`
        : '';

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'Missing GEMINI_API_KEY in environment.' };
      }

      const buildPrompt = `You are an expert front-end developer. Build the following based on the detailed specifications.

**Project Info:**
- Type: ${projectStructure.type}
- Framework: ${projectStructure.framework || 'Plain HTML/CSS/JS'}
- Output directory: ${projectStructure.suggestedOutputDir}

**Style Guide:**
${styleGuideText || 'Use sensible defaults.'}
${componentsContext}

**DETAILED BUILD SPECIFICATIONS:**
${buildPlan.detailedPrompt}

**CRITICAL INSTRUCTIONS:**
1. **Reuse & Adapt:** When using an existing component:
   - Use the provided code structure.
   - **IMPORTANT:** You MUST update the *content* (text, images, links) to match the specifications. Do NOT keep placeholders if the spec asks for real data/images.
   - For React/Vue: Pass props as specified.
   - For HTML: Edit the HTML content directly while keeping classes/structure.
2. **Style New Elements:** For any element NOT part of an existing component (buttons, inputs, cards):
   - You MUST apply the fonts and colors from the **Style Guide**.
   - Do NOT use browser default styles.
3. **Generate COMPLETE Code:**
   - Write the FULL file content.
   - Include ALL imports.
4. Follow the framework conventions (${projectStructure.framework || 'plain HTML'})
5. **Make it Interactive:**
   - Detect implied interactivity (mobile menus, sliders, modals, tabs).
   - You MUST implement the JavaScript to make these work.
   - If Vanilla JS: create a scripts/main.js or similar and link it, or use inline scripts if appropriate.
        - If React / Vue: use state to handle the interactions.

** OUTPUT FORMAT:**
        For each file, output in this exact format:
=== FILE: path / to / file.ext ===
        [complete file content]
        === END FILE ===

          Generate all files now: `;

      const urlToCall = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const res = await fetchWithRetry(urlToCall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt }] }]
        })
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Gemini error ${res.status}: ${text}` };
      }

      const data = await res.json();
      const response = (data?.candidates || [])
        .flatMap(c => c?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n')
        .trim();

      // Parse the response to extract files
      // We support multiple formats because LLMs are unpredictable
      const createdFiles = [];
      const lines = response.split('\n');
      let currentFile = null;
      let currentContent = [];

      // Regex patterns for file headers
      // 1. ===FILE: path/to/file=== (Standard)
      // 2. ### FILE: path/to/file (Common markdown)
      // 3. ### File 1: path/to/file (Numbered markdown)
      // 4. **File:** path/to/file (Bold label)
      // 5. File: path/to/file (Simple label)
      // Regex patterns for file headers
      // We accept various formats to be robust against model variations
      const headerPatterns = [
        /^===\s*FILE:\s*(.+?)===/i,       // Matches "===FILE:...", "=== FILE: ... ==="
        /^###\s*FILE.*:\s*(.+)/i,  // Relaxed: matches "### File 1:", "### FILE:", etc.
        /^\*\*\s*File.*:\s*\*\*\s*(.+)/i,
        /^File.*:\s*(.+)/i
      ];

      // Helper to check if a line is a file header
      const matchHeader = (line) => {
        for (const pattern of headerPatterns) {
          const match = line.match(pattern);
          if (match && match[1]) {
            // Strip backticks, whitespace, and any trailing non-path chars
            // also strip trailing === if the regex was loose
            return match[1].replace(/===$/, '').trim().replace(/^`+|`+$/g, '');
          }
        }
        return null;
      };

      // Helper to check if a line is a file footer
      const matchFooter = (line) => {
        const t = line.trim();
        return t === '===END FILE===' || t === '=== END FILE ===' || t === '```';
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const filename = matchHeader(line);

        if (filename) {
          if (currentFile) {
            await saveParsedFile(currentFile, currentContent.join('\n'), folderPath, projectStructure, createdFiles);
          }
          currentFile = filename;
          currentContent = [];

          // Skip preamble (empty lines, code fences)
          // We look ahead to skip optional code fences or blank lines so we get clean content
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j].trim();
            // If it's empty or starts with backticks (start of partial fence or language specifier)
            if (nextLine === '' || nextLine.startsWith('```')) {
              j++;
            } else {
              break;
            }
          }
          i = j - 1; // loop increment will make it j
        } else if (currentFile) {
          if (matchFooter(line)) {
            // End of file
            await saveParsedFile(currentFile, currentContent.join('\n'), folderPath, projectStructure, createdFiles);
            currentFile = null;
            currentContent = [];
          } else {
            currentContent.push(line);
          }
        }
      }

      // Save any remaining file
      if (currentFile && currentContent.length > 0) {
        await saveParsedFile(currentFile, currentContent.join('\n'), folderPath, projectStructure, createdFiles);
      }

      // Helper to save files
      async function saveParsedFile(relativePath, content, folderPath, projectStructure, createdFiles) {
        // Cleaning
        let cleanContent = stripCodeFences(content);

        let fullPath;
        if (path.isAbsolute(relativePath)) {
          fullPath = relativePath;
        } else if (relativePath.startsWith('componentAI/')) {
          fullPath = path.join(folderPath, relativePath);
        } else {
          // Clean up path if it has leading slashes or .
          const cleanPath = relativePath.replace(/^[./\\]+/, '');
          fullPath = path.join(projectStructure.suggestedOutputDir, cleanPath);

          // Special case: if the user's prompt put it in src/ but suggested output is also src/, avoid src/src/
          if (projectStructure.suggestedOutputDir.endsWith('src') && cleanPath.startsWith('src/')) {
            fullPath = path.join(folderPath, cleanPath);
          }
        }

        try {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, cleanContent, 'utf-8');
          createdFiles.push({
            path: path.relative(folderPath, fullPath),
            fullPath
          });
        } catch (e) {
          console.error('Failed to write file:', fullPath, e);
        }
      }

      if (createdFiles.length === 0) {
        // Fallback: if no files parsed, save the whole response as a single file
        const fallbackPath = path.join(folderPath, 'build-output.txt');
        await fs.writeFile(fallbackPath, response, 'utf-8');
        return {
          success: false,
          error: 'Could not parse generated files. Raw output saved to build-output.txt'
        };
      }

      return {
        success: true,
        files: createdFiles
      };
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
