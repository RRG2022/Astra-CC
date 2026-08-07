import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getWsUrl } from '../lib/api.js';

const InteractiveTerminal = ({ workspacePath, sessionId }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const wsRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Fira Code, monospace',
      fontSize: 14,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    
    // Fit needs a small delay to ensure container has dimensions
    setTimeout(() => fitAddon.fit(), 10);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const cwd = workspacePath ? encodeURIComponent(workspacePath) : '';
    const ws = new WebSocket(getWsUrl(`/api/pty?cwd=${cwd}&cols=${term.cols}&rows=${term.rows}`));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        event.data.text().then(text => term.write(text));
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cols: term.cols, rows: term.rows }));
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      ws.close();
    };
  }, [workspacePath]);

  return (
    <div 
      ref={terminalRef} 
      style={{ width: '100%', height: '100%', padding: '0.5rem', boxSizing: 'border-box', overflow: 'hidden' }}
    />
  );
};

export default InteractiveTerminal;
