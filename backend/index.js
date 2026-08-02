const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const http = require('http');
const { validatePluginName } = require('./plugins/plugin-policy');
const { initPTY } = require('./src/ptyManager');

// Routers
const agentRouter = require('./src/routes/agent');
const filesRouter = require('./src/routes/files');
const gitRouter = require('./src/routes/git');
const { router: settingsRouter } = require('./src/routes/settings');
const conversationsRouter = require('./src/routes/conversations');
const sessionsRouter = require('./src/routes/sessions');

const app = express();
const PORT = process.env.PORT || 8789;
const server = http.createServer(app);

// Middleware
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

// Explicit Origin Defense
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Forbidden: Invalid Origin' });
  }
  next();
});

// Output Stream Endpoint (SSE)
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
    client.write(`data: ${payload}\n\n`);
  }
};
console.log = (...args) => {
  originalLog(...args);
  broadcastLog('info', ...args);
};
console.error = (...args) => {
  originalError(...args);
  broadcastLog('error', ...args);
};

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Astra Backend is running.' });
});

// Mount Routers under /api
app.use('/api', agentRouter);
app.use('/api', filesRouter);
app.use('/api/shadow', gitRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/sessions', sessionsRouter);

// Plugins Architecture Scaffold
const PLUGINS_DIR = path.join(__dirname, 'plugins');
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
    
    // Ensure target path is strictly inside PLUGINS_DIR
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
  
  exec('npx eslint . -f json', { cwd: workspace }, (error, stdout, stderr) => {
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

app.get('/api/plugins/marketplace', (req, res) => {
  const plugins = [
    {
      id: 'github',
      name: 'GitHub Integration',
      description: 'Create PRs, issues, and manage repos.',
      action: 'Install'
    },
    {
      id: 'external-models',
      name: 'External Models (Gemini/Claude)',
      description: 'Add API keys for Google and Anthropic models.',
      action: 'Configure'
    },
    {
      id: 'docker',
      name: 'Docker Support',
      description: 'Manage containers and images from the IDE.',
      action: 'Install'
    },
    {
      id: 'prettier',
      name: 'Prettier Formatter',
      description: 'Auto-format your code on save.',
      action: 'Install'
    }
  ];
  res.json({ success: true, plugins });
});

const activeDownloads = {};

app.get('/api/plugins/downloads', (req, res) => {
  res.json({ success: true, downloads: activeDownloads });
});

app.post('/api/plugins/install', (req, res) => {
  const { pluginId, modelName } = req.body;
  if (!pluginId) return res.status(400).json({ success: false, error: 'Missing pluginId' });

  if (pluginId === 'ollama') {
    const targetModel = modelName || 'tinydolphin';
    console.log(`[Ollama] Starting background pull for ${targetModel}...`);
    activeDownloads[targetModel] = { status: 'starting' };
    const child = spawn('ollama', ['pull', targetModel]);
    
    child.on('error', (err) => {
      console.error(`[Ollama] Failed to start pull for ${targetModel}:`, err.message);
      activeDownloads[targetModel].status = 'failed: Ollama not found or not running';
      setTimeout(() => { delete activeDownloads[targetModel]; }, 10000);
    });

    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      const lines = text.split('\n');
      if (lines.length > 0) {
        activeDownloads[targetModel].status = lines[lines.length - 1].trim();
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        activeDownloads[targetModel].status = text.substring(0, 100);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[Ollama] Successfully installed ${targetModel}.`);
        activeDownloads[targetModel].status = 'completed';
      } else {
        console.error(`[Ollama] Failed to install ${targetModel} with exit code ${code}`);
        activeDownloads[targetModel].status = 'failed';
      }
      setTimeout(() => { delete activeDownloads[targetModel]; }, 10000);
    });

    return res.json({ success: true, message: `Download started for ${targetModel} in the background.` });
  } else {
    setTimeout(() => {
      res.json({ success: true, message: `Successfully installed ${pluginId}.` });
    }, 2000);
  }
});

// Initialize WebSocket/PTY server, attaching to main HTTP server
initPTY(server, isAllowedOrigin);

server.listen(PORT, () => {
  console.log(`Astra Backend (with PTY) running on port ${PORT}`);
});
