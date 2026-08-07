const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createApp } = require('./src/app');
const { initPTY } = require('./src/ptyManager');

// Generate and sync auth token
const ASTRA_TOKEN = crypto.randomBytes(32).toString('hex');
const envPath = path.resolve(__dirname, '../frontend/.env.local');
fs.writeFileSync(envPath, `VITE_ASTRA_TOKEN=${ASTRA_TOKEN}\n`);

const PORT = process.env.PORT || 8789;

const { app, isAllowedOrigin } = createApp({
  token: ASTRA_TOKEN,
  requestLogging: true,
  patchConsole: true
});

const server = http.createServer(app);

// Initialize WebSocket/PTY server, attaching to main HTTP server
initPTY(server, isAllowedOrigin, ASTRA_TOKEN);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Astra Backend (with PTY) running on http://127.0.0.1:${PORT}`);
});
