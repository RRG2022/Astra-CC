const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { validatePluginName } = require('../plugins/plugin-policy');

// Routers
const agentRouter = require('./routes/agent');
const filesRouter = require('./routes/files');
const gitRouter = require('./routes/git');
const { router: settingsRouter } = require('./routes/settings');
const conversationsRouter = require('./routes/conversations');
const sessionsRouter = require('./routes/sessions');

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Builds the Astra express app. Performs no side effects outside the returned
 * object: no listening, no token generation, no writing to the frontend env
 * file. `index.js` owns those. Keeping this pure is what lets the integration
 * tests boot a real server on an ephemeral port.
 */
function createApp({
  token,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  requestLogging = true,
  patchConsole = false
} = {}) {
  if (!token) throw new Error('createApp requires a token');

  const app = express();
  const outputClients = new Set();

  const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin);

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '50mb' }));
  if (requestLogging) app.use(morgan('dev'));

  // Explicit Origin Defense & Auth Token
  app.use((req, res, next) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      return res.status(403).json({ error: 'Forbidden: Invalid Origin' });
    }

    if (req.path === '/api/health') return next();

    const authHeader = req.headers['authorization'];
    const presented = authHeader ? authHeader.split(' ')[1] : req.query.token;
    if (presented !== token) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Token' });
    }
    next();
  });

  // Output Stream Endpoint (SSE)
  app.get('/api/output/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    outputClients.add(res);
    req.on('close', () => outputClients.delete(res));
  });

  const broadcastLog = (type, ...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    const payload = JSON.stringify({ type, msg, timestamp: new Date().toISOString() });
    for (const client of outputClients) {
      client.write(`data: ${payload}\n\n`);
    }
  };

  if (patchConsole) {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => { originalLog(...args); broadcastLog('info', ...args); };
    console.error = (...args) => { originalError(...args); broadcastLog('error', ...args); };
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Astra Backend is running.' });
  });

  app.use('/api', agentRouter);
  app.use('/api', filesRouter);
  app.use('/api/shadow', gitRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/sessions', sessionsRouter);

  // Plugins Architecture Scaffold
  const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR);
  }

  app.get('/api/plugins', (req, res) => {
    try {
      const plugins = fs.readdirSync(PLUGINS_DIR)
        .filter(f => f.endsWith('.js'))
        .map(f => ({ name: f.replace('.js', ''), path: path.join(PLUGINS_DIR, f) }));
      res.json(plugins);
    } catch (error) {
      res.json([]);
    }
  });

  app.post('/api/plugins/execute', (req, res) => {
    const { pluginName, args } = req.body;
    try {
      const validPluginName = validatePluginName(pluginName);
      const pluginPath = path.resolve(PLUGINS_DIR, validPluginName + '.js');

      const relative = path.relative(PLUGINS_DIR, pluginPath);
      if (relative === '..' || relative.startsWith('..' + path.sep) || relative.startsWith('../') || path.isAbsolute(relative)) {
        return res.status(403).json({ success: false, error: 'Plugin path escapes plugins directory boundary' });
      }

      if (fs.existsSync(pluginPath)) {
        const plugin = require(pluginPath);
        if (typeof plugin.execute === 'function') {
          const result = plugin.execute(args);
          return res.json({ success: true, result });
        }
      }
      res.status(404).json({ success: false, error: 'Plugin not found or invalid' });
    } catch (e) {
      return res.status(403).json({ success: false, error: e.message });
    }
  });

  // ESLint Problems Endpoint
  app.post('/api/problems', (req, res) => {
    const { workspace } = req.body;
    if (!workspace) return res.json({ problems: [] });

    exec('npx eslint . -f json', { cwd: workspace }, (error, stdout) => {
      try {
        const results = JSON.parse(stdout);
        const problems = [];
        results.forEach(fileRes => {
          fileRes.messages.forEach(msg => {
            problems.push({
              file: fileRes.filePath.replace(workspace, ''),
              line: msg.line,
              message: msg.message,
              severity: msg.severity
            });
          });
        });
        res.json({ problems });
      } catch (e) {
        console.error('Linting parsing error', e.message);
        res.json({ problems: [] });
      }
    });
  });

  return { app, isAllowedOrigin, broadcastLog };
}

module.exports = { createApp, DEFAULT_ALLOWED_ORIGINS };
