# Visualise Tool

Visualise Tool is an Electron-based prototype of a design-focused code editor. It integrates the Monaco code editor with AI-powered capabilities to reverse-engineer UI components from screenshots and generate code directly within a development workspace.

## Features

* **AI-Powered Component Generation**: Uses Google Gemini and local Ollama models to analyze UI screenshots and convert them into technical specifications and functional code.
* **Integrated Monaco Editor**: Provides a professional code editing experience using the same engine that powers VS Code.
* **Local Preview Server**: Features a built-in Express server that handles static files and provides SPA (Single Page Application) fallbacks for real-time visual feedback.
* **Integrated Terminal**: Includes a full-featured terminal powered by `xterm.js` and `node-pty`, allowing for command-line operations without leaving the app.
* **Design System Integration**: Allows users to define color palettes and typography settings that the AI respects when generating new components.
* **Project Management**: Supports directory browsing, file creation, renaming, and deletion through a native-like project tree.

## Tech Stack

* **Shell**: Electron
* **Bundler**: Vite
* **Frontend**: React
* **Editor**: Monaco Editor (`@monaco-editor/react`)
* **Terminal**: `xterm.js` and `node-pty`
* **Backend/Server**: Express and Node.js
* **AI**: Google Gemini API and Ollama (local LLMs)

## Getting Started

### Prerequisites

* **Node.js**: Recommended version 18 or later.
* **Ollama**: Required for local AI component building. Ensure the models specified in `electron/main.js` (e.g., `qwen2.5-coder:7b`) are installed locally.
* **Gemini API Key**: Required for image analysis features.

### Installation

1. Clone the repository.
2. Install dependencies:
```bash
npm install

```


3. Set up environment variables in a `.env` file:
```env
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-1.5-flash
NODE_ENV=development

```



### Development

To start the development environment (Vite renderer and Electron shell):

```bash
npm run dev

```

### Production

To build the project:

```bash
npm run build

```

To start the built application:

```bash
npm start

```

## Project Structure

* `electron/`: Contains the main process logic, IPC handlers, and terminal management.
* `src/`: React source code for the editor and UI components.
* `dist/`: Output directory for the production build.
* `package.json`: Project dependencies and scripts.
* `vite.config.js`: Configuration for the Vite build tool.
