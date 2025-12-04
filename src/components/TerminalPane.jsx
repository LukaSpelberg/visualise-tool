import React, { useCallback, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const terminalTheme = {
  background: '#0c0e14',
  foreground: '#f5f5f7',
  cursor: '#4f8ef7',
  selectionBackground: '#264f78'
};

export default function TerminalPane({ isOpen, bridge, cwd, onClose }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const terminalIdRef = useRef(null);
  const dataUnsubRef = useRef(null);
  const exitUnsubRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const inputDisposableRef = useRef(null);
  const mouseDownCleanupRef = useRef(null);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const cleanupTerminal = useCallback(() => {
    if (inputDisposableRef.current) {
      inputDisposableRef.current.dispose();
      inputDisposableRef.current = null;
    }
    if (mouseDownCleanupRef.current) {
      mouseDownCleanupRef.current();
      mouseDownCleanupRef.current = null;
    }
    dataUnsubRef.current?.();
    exitUnsubRef.current?.();
    dataUnsubRef.current = null;
    exitUnsubRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    if (terminalIdRef.current && bridge?.disposeTerminal) {
      bridge.disposeTerminal(terminalIdRef.current);
    }
    terminalIdRef.current = null;

    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    fitAddonRef.current = null;
  }, [bridge]);

  useEffect(() => {
    if (!isOpen) {
      cleanupTerminal();
      return undefined;
    }

    if (!bridge?.startTerminal || !containerRef.current) {
      return undefined;
    }

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Fira Code", monospace',
      theme: terminalTheme,
      disableStdin: false,
      cursorBlink: true,
      allowProposedApi: true
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    // Ensure the xterm instance receives keyboard focus immediately
    setTimeout(() => {
      focusTerminal();
    }, 0);

    if (containerRef.current) {
      const handler = () => focusTerminal();
      containerRef.current.addEventListener('mousedown', handler, { capture: true });
      mouseDownCleanupRef.current = () => {
        containerRef.current?.removeEventListener('mousedown', handler, { capture: true });
      };
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const unsubscribeData = bridge.onTerminalData?.(({ id, data }) => {
      if (id === terminalIdRef.current) {
        term.write(data);
      }
    });
    const unsubscribeExit = bridge.onTerminalExit?.(({ id, code }) => {
      if (id === terminalIdRef.current) {
        term.writeln(`\r\nProcess exited with code ${code ?? 0}`);
      }
    });
    dataUnsubRef.current = unsubscribeData;
    exitUnsubRef.current = unsubscribeExit;

    inputDisposableRef.current = term.onData(data => {
      if (terminalIdRef.current) {
        bridge.writeToTerminal?.({ id: terminalIdRef.current, data });
      }
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminalIdRef.current) {
        bridge.resizeTerminal?.({ id: terminalIdRef.current, cols: term.cols, rows: term.rows });
      }
    });
    observer.observe(containerRef.current);
    resizeObserverRef.current = observer;

    const startTerminal = async () => {
      const response = await bridge.startTerminal({ cwd, cols: term.cols, rows: term.rows });
      if (!response?.success) {
        term.writeln(`\r\nFailed to launch terminal: ${response?.error || 'unknown error'}`);
        return;
      }
      terminalIdRef.current = response.id;
      focusTerminal();
    };

    startTerminal();

    return () => {
      cleanupTerminal();
    };
  }, [isOpen, cwd, bridge, cleanupTerminal]);

  if (!isOpen) {
    return null;
  }

  if (!bridge?.startTerminal) {
    return (
      <section className="panel terminal-panel">
        <div className="terminal-header">
          <span>Terminal</span>
          <button className="terminal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="terminal-body terminal-placeholder">
          Launch the Electron app to access the integrated terminal.
        </div>
      </section>
    );
  }

  return (
    <section className="panel terminal-panel">
      <div className="terminal-header">
        <span>Terminal {cwd ? `— ${cwd}` : ''}</span>
        <button className="terminal-close" type="button" onClick={onClose}>
          Hide
        </button>
      </div>
      <div className="terminal-body" ref={containerRef} tabIndex={-1} />
    </section>
  );
}
