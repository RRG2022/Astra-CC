import React, { useEffect, useRef } from 'react';

const LiveTerminal = ({ taskId }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const previousLengthRef = useRef(0);

  useEffect(() => {
    let term;
    import('@xterm/xterm').then(({ Terminal }) => {
      import('@xterm/addon-fit').then(({ FitAddon }) => {
        if (!terminalRef.current) return;
        term = new Terminal({
          fontFamily: 'Fira Code, monospace',
          fontSize: 12,
          theme: { background: '#0d1117', foreground: '#c9d1d9' }
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        setTimeout(() => fitAddon.fit(), 10);
        xtermRef.current = term;
      });
    });
    return () => {
      if (term) term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!taskId) return;
    if (xtermRef.current) {
      xtermRef.current.clear();
      previousLengthRef.current = 0;
    }
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8789/api/tools/terminal/stream/${taskId}`);
        const data = await res.json();
        if (data.output && xtermRef.current) {
          const newChunk = data.output.substring(previousLengthRef.current);
          if (newChunk) {
            xtermRef.current.write(newChunk.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
            previousLengthRef.current = data.output.length;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [taskId]);

  return <div ref={terminalRef} style={{ width: '100%', height: '300px', padding: '0.5rem', boxSizing: 'border-box', overflow: 'hidden', background: '#0d1117', borderRadius: '4px', marginTop: '0.5rem' }} />;
};

export default LiveTerminal;
