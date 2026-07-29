const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');

const app = express();

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

// Execute a plugin dynamically
app.post('/api/plugins/execute', (req, res) => {
  const { pluginName, args } = req.body;
  const pluginPath = path.join(PLUGINS_DIR, pluginName + '.js');
  if (fs.existsSync(pluginPath)) {
    try {
      const plugin = require(pluginPath);
      if (typeof plugin.execute === 'function') {
        const result = plugin.execute(args);
        return res.json({ success: true, result });
      }
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  res.status(404).json({ success: false, error: 'Plugin not found or invalid' });
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


const { exec: execCmd } = require('child_process');
app.post('/api/problems', (req, res) => {
  const { workspace } = req.body;
  if (!workspace) return res.json({ problems: [] });
  
  execCmd('npx eslint . -f json', { cwd: workspace }, (error, stdout, stderr) => {
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
      // Fallback if no eslint
      res.json({ problems: [] });
    }
  });
});

// Start Express Server
const PORT = process.env.PORT || 8789;
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));

// Ollama API configuration
const OLLAMA_BASE_URL = 'http://localhost:11434';

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Astra Backend is running.' });
});

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function getSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  }
  return { apiKeys: { openai: '', anthropic: '', gemini: '' } };
}

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.post('/api/settings', (req, res) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// Proxy to get models from Ollama + External
app.get('/api/models', async (req, res) => {
    let externalModels = [];
    try {
      const settings = getSettings();
      if (settings.apiKeys.openai) externalModels.push({ name: 'gpt-4o', family: 'openai' });
      if (settings.apiKeys.anthropic) externalModels.push({ name: 'claude-3-opus', family: 'anthropic' });
      if (settings.apiKeys.gemini) externalModels.push({ name: 'gemini-1.5-pro', family: 'google' });
  
      const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
      const data = response.data;
      data.models = [...externalModels, ...(data.models || [])];
      res.json(data);
    } catch (error) {
      console.error('Error fetching models from Ollama:', error.message);
      res.json({ models: externalModels });
    }
});

app.post('/api/models/pull', (req, res) => {
  const { model } = req.body;
  // Spawn ollama pull in background
  const p = require('child_process').spawn('ollama', ['pull', model], { stdio: 'ignore', detached: true });
  p.unref();
  res.json({ success: true, message: `Started pulling ${model} in background` });
});

// Multi-Agent Orchestration scaffold
app.post('/api/orchestrate', (req, res) => {
  const { task, agents } = req.body;
  // Scaffold: Simulate multiple agents debating/working.
  const logs = [
    { role: 'planner', text: 'Analyzing task: ' + task },
    { role: 'planner', text: 'Breaking down into sub-tasks and delegating to ' + agents.join(', ') },
    { role: 'coder', text: 'Writing initial implementation...' },
    { role: 'reviewer', text: 'Reviewing code. Found 2 issues. Suggesting fixes.' },
    { role: 'coder', text: 'Applying fixes.' },
    { role: 'planner', text: 'Task completed successfully.' }
  ];
  
  // Simulate delay
  setTimeout(() => {
    res.json({ success: true, message: 'Orchestration finished', logs });
  }, 1500);
});

// Proxy to generate a response from Ollama (streaming or single response)
app.post('/api/generate', async (req, res) => {
  try {
    const { model, prompt, stream } = req.body;
    
    if (stream) {
      const response = await axios({
        method: 'post',
        url: `${OLLAMA_BASE_URL}/api/generate`,
        data: { model, prompt, stream: true },
        responseType: 'stream'
      });
      
      response.data.pipe(res);
    } else {
      const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model,
        prompt,
        stream: false
      });
      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in generation:', error.message);
    res.status(500).json({ error: 'Generation failed.' });
  }
});

// Proxy to generate chat (chat endpoint for conversation history)
app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages, stream, tools } = req.body;
    
    const attemptRequest = async (useTools) => {
      const payload = { model, messages, stream, tools: useTools ? tools : undefined };
      if (!useTools) delete payload.tools;
      
      return await axios({
        method: 'post',
        url: `${OLLAMA_BASE_URL}/api/chat`,
        data: payload,
        responseType: stream ? 'stream' : 'json',
        validateStatus: false // Prevent Axios from throwing on 400
      });
    };

    let response = await attemptRequest(true);

    if (response.status === 400) {
      let errMsg = '';
      if (stream) {
        errMsg = await new Promise((resolve) => {
           let data = '';
           response.data.on('data', chunk => data += chunk.toString());
           response.data.on('end', () => resolve(data));
        });
      } else {
        errMsg = JSON.stringify(response.data);
      }
      
      if (errMsg.includes('does not support tools')) {
        console.log(`[Ollama] Model ${model} does not support tools. Retrying without tools...`);
        // Strip out any tool-related messages to avoid invalid role errors on retry
        const cleanedMessages = messages.filter(m => m.role !== 'tool').map(m => {
          const { tool_calls, ...rest } = m;
          return rest;
        });
        
        const retryPayload = { model, messages: cleanedMessages, stream };
        const retryResponse = await axios({
          method: 'post',
          url: `${OLLAMA_BASE_URL}/api/chat`,
          data: retryPayload,
          responseType: stream ? 'stream' : 'json'
        });
        
        if (stream) {
          return retryResponse.data.pipe(res);
        } else {
          return res.json(retryResponse.data);
        }
      } else {
         return res.status(400).send(errMsg);
      }
    }

    if (stream) {
      response.data.pipe(res);
    } else {
      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in chat generation:', error.message);
    res.status(500).json({ error: 'Chat generation failed.' });
  }
});

// Agent Tool: File System (Read)
app.post('/api/tools/fs/read', (req, res) => {
  const { filePath, workspacePath } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }
  
  try {
    const absolutePath = workspacePath ? path.resolve(workspacePath, filePath) : path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `File not found: ${absolutePath}` });
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Agent Tool: File System (List Directory)
app.post('/api/tools/fs/list', (req, res) => {
  const { directoryPath, workspacePath } = req.body;
  
  try {
    const absolutePath = directoryPath && workspacePath 
        ? path.resolve(workspacePath, directoryPath) 
        : (directoryPath ? path.resolve(directoryPath) : workspacePath);
        
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `Directory not found: ${absolutePath}` });
    }
    
    if (!fs.statSync(absolutePath).isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${absolutePath}` });
    }

    const items = fs.readdirSync(absolutePath).map(file => {
      try {
        const stats = fs.statSync(path.join(absolutePath, file));
        return {
          name: file,
          isDirectory: stats.isDirectory(),
          size: stats.size
        };
      } catch(e) {
        return { name: file, isDirectory: false, size: 0, error: true };
      }
    });
    
    res.json({ success: true, path: absolutePath, items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Agent Tool: File System (Grep Search)
app.post('/api/tools/fs/grep', (req, res) => {
  const { query, directoryPath, workspacePath } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }
  
  try {
    const absolutePath = directoryPath && workspacePath 
        ? path.resolve(workspacePath, directoryPath) 
        : (directoryPath ? path.resolve(directoryPath) : (workspacePath || process.cwd()));
        
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `Directory not found: ${absolutePath}` });
    }

    const results = [];
    
    function searchRecursive(currentPath) {
      if (results.length >= 50) return; // Limit to 50 results
      
      let items;
      try {
        items = fs.readdirSync(currentPath);
      } catch(e) { return; }
      
      for (const item of items) {
        if (results.length >= 50) break;
        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build' || item === '.next') continue;
        
        const itemPath = path.join(currentPath, item);
        let stat;
        try {
          stat = fs.statSync(itemPath);
        } catch(e) { continue; }
        
        if (stat.isDirectory()) {
          searchRecursive(itemPath);
        } else if (stat.isFile()) {
          try {
            // Only read first 250KB to avoid large binaries
            if (stat.size > 250000) continue;
            
            const content = fs.readFileSync(itemPath, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, index) => {
              if (line.includes(query) && results.length < 50) {
                results.push({
                  file: path.relative(workspacePath || absolutePath, itemPath),
                  line: index + 1,
                  content: line.trim()
                });
              }
            });
          } catch(e) {
            // skip unreadable/binary
          }
        }
      }
    }
    
    searchRecursive(absolutePath);
    res.json({ success: true, count: results.length, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const crypto = require('crypto');
const activeTasks = {};

app.post('/api/tools/terminal/run', (req, res) => {
  const { command, workspacePath, cwd } = req.body;
  
  try {
    const executionDir = cwd ? path.resolve(workspacePath, cwd) : workspacePath;
    
    if (!executionDir.startsWith(workspacePath)) {
      return res.status(403).json({ error: 'Command execution outside workspace is forbidden' });
    }

    const taskId = crypto.randomUUID();
    let output = '';

    // Use PowerShell explicitly as requested by the user
    const child = spawn('powershell.exe', ['-Command', command], { cwd: executionDir });
    activeTasks[taskId] = { child, output };

    child.stdout.on('data', data => {
      activeTasks[taskId].output += data.toString();
    });
    child.stderr.on('data', data => {
      activeTasks[taskId].output += data.toString();
    });

    let isDone = false;
    
    child.on('close', (code) => {
      isDone = true;
      if (!res.headersSent) {
        res.json({
          success: code === 0,
          stdout: activeTasks[taskId].output.trim(),
          stderr: ''
        });
      }
    });

    // Wait up to 5 seconds. If not done, send to background.
    setTimeout(() => {
      if (!isDone && !res.headersSent) {
        res.json({
          success: true,
          stdout: `[Task sent to background] Task ID: ${taskId}\nPartial Output:\n${activeTasks[taskId].output.trim()}`,
          taskId
        });
      }
    }, 5000);

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/tools/terminal/stream/:taskId', (req, res) => {
  const task = activeTasks[req.params.taskId];
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ output: task.output });
});

// Search in Workspace
app.post('/api/fs/search', (req, res) => {
  const { workspacePath, query } = req.body;
  if (!workspacePath || !query) {
    return res.status(400).json({ success: false, error: 'workspacePath and query are required' });
  }

  const results = [];
  const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.agents', '.dart_tool', '.vscode'];

  function searchDir(dirPath) {
    if (results.length > 150) return; // Limit results
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length > 150) return;
        const fullPath = path.join(dirPath, entry.name).replace(/\\/g, '/');
        
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.includes(entry.name)) {
            searchDir(fullPath);
          }
        } else if (entry.isFile()) {
          try {
            let matchedFilename = false;
            if (entry.name.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                file: fullPath,
                line: 1,
                text: '(Filename match)'
              });
              matchedFilename = true;
              if (results.length > 150) return;
            }

            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
            
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    file: fullPath,
                    line: i + 1,
                    text: lines[i].trim().substring(0, 120)
                  });
                  if (results.length > 150) return;
                }
              }
            }
          } catch (e) {
            // Ignore read errors
          }
        }
      }
    } catch (e) {
      console.error('Search error in ' + dirPath, e);
    }
  }

  searchDir(workspacePath);
  res.json({ success: true, results });
});

// Filesystem browsing endpoint
app.post('/api/fs/list', async (req, res) => {
  const { dirPath } = req.body;
  try {
    const items = await fs.promises.readdir(dirPath || 'C:\\', { withFileTypes: true });
    
    const directories = items.map(item => ({
      name: item.name,
      path: path.join(dirPath || 'C:\\', item.name),
      isDirectory: item.isDirectory()
    }));
    
    // Sort directories first, then files alphabetically
    directories.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, directories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Native folder browser endpoint
app.get('/api/fs/browse-native', (req, res) => {
  const scriptPath = path.join(__dirname, 'browse.ps1');
  exec(`powershell.exe -STA -ExecutionPolicy Bypass -File "${scriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, error: error.message });
    }
    const selectedPath = stdout.trim();
    if (selectedPath) {
      res.json({ success: true, path: selectedPath });
    } else {
      res.json({ success: false, error: 'User cancelled' });
    }
  });
});

// Agent Tool: File System (Write)
app.post('/api/tools/fs/write', (req, res) => {
  const { filePath, content, workspacePath } = req.body;
  
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }
  
  try {
    const absolutePath = workspacePath ? path.resolve(workspacePath, filePath) : path.resolve(filePath);
    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(absolutePath, content, 'utf8');
    res.json({ success: true, message: `File written to ${absolutePath}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// (Removed duplicate terminal/run)

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

    return res.json({ success: true, message: `Download started for ${targetModel} in the background. Check your terminal for progress.` });
  } else {
    // For other plugins, simulate a short installation delay
    setTimeout(() => {
      res.json({ success: true, message: `Successfully installed ${pluginId}.` });
    }, 2000);
  }
});

const wss = new WebSocket.Server({ server, path: '/api/pty' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cwd = url.searchParams.get('cwd') || process.cwd();
  
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: parseInt(url.searchParams.get('cols') || '80', 10),
    rows: parseInt(url.searchParams.get('rows') || '24', 10),
    cwd: cwd,
    env: process.env
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('message', (msg) => {
    // msg could be a buffer in newer ws versions, convert to string
    ptyProcess.write(msg.toString());
  });

  ws.on('close', () => {
    ptyProcess.kill();
  });
  
  // Handle terminal resize
  ws.on('resize', (msg) => {
    try {
      const { cols, rows } = JSON.parse(msg);
      ptyProcess.resize(cols, rows);
    } catch(e) {}
  });
});

server.listen(PORT, () => {
  console.log(`Astra Backend (with PTY) running on http://localhost:${PORT}`);
});
