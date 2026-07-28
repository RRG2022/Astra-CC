const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');

const sseBlock = `// Output Stream Endpoint (SSE)
const outputClients = new Set();
app.get('/api/output/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  const client = res;
  outputClients.add(client);
  req.on('close', () => {
    outputClients.delete(client);
  });
});

// Override console to intercept logs
const originalLog = console.log;
const originalError = console.error;
const broadcastLog = (type, ...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const payload = JSON.stringify({ type, msg, timestamp: new Date().toISOString() });
  for (const client of outputClients) {
    client.write(\`data: \${payload}\\n\\n\`);
  }
};
console.log = (...args) => {
  originalLog(...args);
  broadcastLog('info', ...args);
};
console.error = (...args) => {
  originalError(...args);
  broadcastLog('error', ...args);
};\n`;

c = c.replace('// Start Express Server', sseBlock + '\n// Start Express Server');
fs.writeFileSync('I:/Astra/backend/index.js', c);
console.log('Backend updated');
