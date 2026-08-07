const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');

function initPTY(server, isAllowedOrigin, ASTRA_TOKEN) {
  const wss = new WebSocket.Server({
    server,
    path: '/api/pty',
    verifyClient: ({ origin, req }, done) => {
      if (!isAllowedOrigin(origin)) {
        console.error(`[PTY] Rejected WebSocket connection from origin: ${origin}`);
        return done(false, 403, 'Forbidden: Invalid Origin');
      }
      
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.searchParams.get('token') !== ASTRA_TOKEN) {
        return done(false, 401, 'Unauthorized: Invalid Token');
      }
      
      done(true);
    }
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cwd = url.searchParams.get('cwd') || process.cwd();
    
    // Cross-platform shell support: MacOS/Linux uses bash/zsh, Windows uses powershell.exe
    let shell = 'bash';
    if (os.platform() === 'win32') {
      shell = 'powershell.exe';
    } else {
      // Prefer zsh if available on macOS, otherwise bash
      try {
        if (os.platform() === 'darwin' && fs.existsSync('/bin/zsh')) {
          shell = 'zsh';
        }
      } catch (e) {}
    }
    
    let validCwd = process.cwd();
    if (cwd) {
      try {
        if (fs.existsSync(cwd)) validCwd = cwd;
      } catch(e) {}
    }

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: parseInt(url.searchParams.get('cols') || '80', 10),
        rows: parseInt(url.searchParams.get('rows') || '24', 10),
        cwd: validCwd,
        env: process.env
      });
    } catch (err) {
      console.error('Failed to spawn PTY:', err);
      ws.send('\r\nError: Failed to open terminal in the specified directory.\r\n');
      ws.close();
      return;
    }

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (msg) => {
      ptyProcess.write(msg.toString());
    });

    ws.on('close', () => {
      ptyProcess.kill();
    });
    
    ws.on('resize', (msg) => {
      try {
        const { cols, rows } = JSON.parse(msg);
        ptyProcess.resize(cols, rows);
      } catch(e) {}
    });
  });

  return wss;
}

module.exports = { initPTY };
