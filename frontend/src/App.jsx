import { useAgentRuntime } from './lib/useAgentRuntime.js';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Editor from '@monaco-editor/react';
import { Play, FileText, Check, AlertCircle, Terminal, FileCode, Folder, XOctagon, CheckCircle, AlertTriangle, Paperclip, Mic, MicOff, Copy, Edit2, X, ChevronDown, ChevronRight, MessageSquare, Plus, RefreshCw, Save, Settings, Trash2, ArrowUp, Send, Search, Users, Puzzle, Brain } from 'lucide-react';
import InteractiveTerminal from './components/InteractiveTerminal';
import LiveTerminal from './components/LiveTerminal';
import FileExplorer from './components/FileExplorer';
import './index.css';

const CURATED_OLLAMA_MODELS = [
  { id: 'llama3.1', name: 'Llama 3.1', size: '8B', desc: 'Meta\'s latest highly capable open model.' },
  { id: 'llama3', name: 'Llama 3', size: '8B', desc: 'Meta\'s powerful 8B parameter model.' },
  { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', size: '7B', desc: 'Alibaba\'s state-of-the-art coding model.' },
  { id: 'mistral', name: 'Mistral', size: '7B', desc: 'The 7B model by Mistral AI, highly capable.' },
  { id: 'mixtral', name: 'Mixtral', size: '8x7B', desc: 'Mistral\'s sparse mixture of experts model.' },
  { id: 'phi3', name: 'Phi 3 Mini', size: '3.8B', desc: 'Microsoft\'s lightweight and capable model.' },
  { id: 'gemma2', name: 'Gemma 2', size: '9B', desc: 'Google\'s Gemma 2 open models.' },
  { id: 'llava', name: 'Llava', size: '7B', desc: 'Vision-language model capable of image chat.' },
  { id: 'codellama', name: 'Code Llama', size: '7B', desc: 'Meta\'s code generation model.' },
  { id: 'tinydolphin', name: 'TinyDolphin', size: '1.1B', desc: 'Very small experimental model.' },
];

const PERSONAS = {
  'repo_builder': {
    name: 'Repo Builder',
    prompt: 'You are Astra, an elite, lightning-fast Software Engineering Agent. You have access to local file system and terminal tools. Your job is to build, refactor, and scaffold code repositories. You must act autonomously: orchestrate multiple tools in sequence to finish complex work rapidly without stopping. CRITICAL RULES: 1. NEVER ask the user to run commands. YOU MUST use the run_command tool yourself to execute terminal commands (like npm, mvn, etc.). 2. Always use the appropriate tools to read code before modifying it, write files to save changes, and run tests or build commands via the terminal. Do not ask for permission to use tools, just execute them immediately. ALL FILE PATHS MUST BE RELATIVE to the active workspace.'
  },
  'app_admin': {
    name: 'App Admin',
    prompt: 'You are Astra, an expert System Administration and DevOps Agent, hyper-specialized in Flutter and Supabase architectures. Your job is to manage applications, monitor logs, check system health, calculate database/hosting costing and pricing, and execute administrative bash scripts. You must provide rock-solid, production-grade solutions. CRITICAL RULE: You are STRICTLY an App Admin. You must NEVER write software, NEVER scaffold code repositories, and NEVER modify source code files. If the user asks you to write code or build a repo, firmly decline and instruct them to switch to the "Repo Builder" persona. ALL FILE PATHS MUST BE RELATIVE to the active workspace.'
  }
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the local filesystem',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from the workspace root' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file on the local filesystem. Creates directories if they do not exist.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from the workspace root' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a bash/terminal command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to execute' },
          reason: { type: 'string', description: 'Explanation of WHY you need to run this command before executing it' },
          cwd: { type: 'string', description: 'Relative path to working directory (optional). Defaults to workspace root.' }
        },
        required: ['command', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories in a given path',
      parameters: {
        type: 'object',
        properties: {
          directoryPath: { type: 'string', description: 'Relative path to directory' }
        },
        required: ['directoryPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for a string pattern across files in the workspace (ignores node_modules and .git automatically)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The text or regex pattern to search for' },
          directoryPath: { type: 'string', description: 'Relative path to directory to search in (optional). Defaults to workspace root.' }
        },
        required: ['query']
      }
    }
  }
];
const ToolExecution = ({ tool }) => {
  const [expanded, setExpanded] = useState(false);

  let taskId = null;
  if (tool.result && typeof tool.result === 'string' && tool.result.includes('taskId')) {
    try {
      const parsed = JSON.parse(tool.result);
      if (parsed.taskId) taskId = parsed.taskId;
    } catch(e) {}
  }

  return (
    <div className="tool-execution-log" style={{ opacity: tool.status === 'running' ? 0.7 : 1 }}>
      <div className="tool-execution-header" onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', background: '#252526', border: '1px solid var(--border-color)', borderRadius: expanded || tool.status === 'running' ? '4px 4px 0 0' : '4px' }}>
        {tool.status === 'running' ? <div className="tool-spinner" style={{ width: '12px', height: '12px', border: '2px solid #ccc', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        <span style={{ fontSize: '0.85rem' }}>
          {tool.status === 'running' ? 'Running' : 'Executed'} <strong style={{ color: '#4fc1ff' }}>{tool.name}</strong>
        </span>
      </div>
      {(expanded || tool.status === 'running') && (
        <div className="tool-execution-body" style={{ padding: '0.5rem', background: '#1e1e1e', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 4px 4px', fontSize: '0.8rem', color: '#ccc', overflowX: 'auto' }}>
          {tool.status === 'running' ? (
            <div>
              <div style={{ color: '#888', marginBottom: '0.25rem' }}>Arguments:</div>
              <pre style={{ margin: 0 }}>{JSON.stringify(tool.arguments, null, 2)}</pre>
            </div>
          ) : (
            taskId ? (
              <div>
                <div style={{ color: '#888', marginBottom: '0.5rem' }}>[Task sent to background]</div>
                <LiveTerminal taskId={taskId} />
              </div>
            ) : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tool.result}</pre>
            )
          )}
        </div>
      )}
    </div>
  );
};

function App() {
  const [models, setModels] = useState([]);
  const [traceLogs, setTraceLogs] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('astra_model') || '');
  useEffect(() => { if (selectedModel) localStorage.setItem('astra_model', selectedModel); }, [selectedModel]);
  const [selectedPersona, setSelectedPersona] = useState('repo_builder');
  const [workspacePath, setWorkspacePath] = useState(() => localStorage.getItem('astra_workspace') || '');
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('astra_memory');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [];
    } catch(e) {
      return [];
    }
  });
  const [input, setInput] = useState(() => localStorage.getItem('astra_current_input') || '');

  const [activeTool, setActiveTool] = useState(null);
  const [openFilesMain, setOpenFilesMain] = useState([]);
  const [activeFileIdMain, setActiveFileIdMain] = useState(null);
  const [openFilesSplit, setOpenFilesSplit] = useState([]);
  const [activeFileIdSplit, setActiveFileIdSplit] = useState(null);
  const [activeTask, setActiveTask] = useState(null);
  const [showTerminalPane, setShowTerminalPane] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [minimapEnabled, setMinimapEnabled] = useState(false);
  const [shells, setShells] = useState([{ id: 'shell-1' }]);
  const [activeTerminalTab, setActiveTerminalTab] = useState('shell-1');
  const [outputLogs, setOutputLogs] = useState([]);
  const [problems, setProblems] = useState(null);
  const [isLinting, setIsLinting] = useState(false);


  const [authorityLevel, setAuthorityLevel] = useState(() => localStorage.getItem('astra_authority_level') || 'Supervised');
  const [pendingTool, setPendingTool] = useState(null);
  const [tools, setTools] = useState(() => {
    const saved = localStorage.getItem('astra_tools');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [
        { id: 'web_search', name: 'Web Search', enabled: true, builtIn: true },
        { id: 'file_system', name: 'File System', enabled: true, builtIn: true },
        { id: 'code_execution', name: 'Code Execution', enabled: true, builtIn: true }
      ];
    } catch(e) {
      return [];
    }
  });
  const [showAddTool, setShowAddTool] = useState(false);
  const [newToolForm, setNewToolForm] = useState({ name: '', endpoint: '', description: '' });

  useEffect(() => {
    localStorage.setItem('astra_tools', JSON.stringify(tools));
  }, [tools]);

  const handleToggleTool = (id) => {
    setTools(tools.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };
  const [showBrowser, setShowBrowser] = useState(false);
  const [toastNotification, setToastNotification] = useState(null);
  const [fsNodes, setFsNodes] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(250);
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [isLeftDragging, setIsLeftDragging] = useState(false);
  const [activeActivity, setActiveActivity] = useState('explorer');
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);

  const showToast = (msg) => {
    setToastNotification(msg);
    setTimeout(() => setToastNotification(null), 3000);
  };

  const startRightResizing = useCallback((e) => {
    setIsRightDragging(true);
  }, []);

  const startLeftResizing = useCallback((e) => {
    setIsLeftDragging(true);
  }, []);

  useEffect(() => {
    const sse = new EventSource('http://localhost:8789/api/output/stream');
    sse.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setOutputLogs(prev => [...prev, log]);
      } catch (err) {}
    };
    return () => sse.close();
  }, []);
  useEffect(() => {
    fetch('http://localhost:8789/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data && data.apiKeys) {
          setSettingsForm(data.apiKeys);
        }
      })
      .catch(err => console.error('Error fetching settings:', err));
  }, []);

  const runLinter = async () => {
    setIsLinting(true);
    try {
      const res = await fetch('http://localhost:8789/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspacePath })
      });
      const data = await res.json();
      setProblems(data.problems || []);
    } catch (e) {
      setProblems([]);
    } finally {
      setIsLinting(false);
    }
  };

  const startOrchestration = async () => {
    if (!orchestrationTask.trim()) return;
    setOrchHistory(prev => {
      const filtered = prev.filter(q => q !== orchestrationTask.trim());
      return [orchestrationTask.trim(), ...filtered].slice(0, 50);
    });
    setOrchHistoryIndex(-1);
    setIsOrchestrating(true);
    setOrchestrationLogs([{ role: 'system', text: 'Starting multi-agent orchestration for: ' + orchestrationTask }]);
    try {
      const res = await fetch('http://localhost:8789/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: orchestrationTask, agents: ['planner', 'coder', 'reviewer'] })
      });
      const data = await res.json();
      setOrchestrationLogs(prev => [...prev, ...data.logs]);
    } catch (e) {
      setOrchestrationLogs(prev => [...prev, { role: 'error', text: 'Failed to start orchestration.' }]);
    } finally {
      setIsOrchestrating(false);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isRightDragging) {
        const newWidth = document.body.clientWidth - e.clientX;
        if (newWidth > 300 && newWidth < 800) {
          setSidebarWidth(newWidth);
        }
      } else if (isLeftDragging) {
        // Activity bar width is 48px, so we subtract that from clientX
        const newWidth = e.clientX - 48;
        if (newWidth > 150 && newWidth < 600) {
          setLeftSidebarWidth(newWidth);
        }
      }
    };
    const handleMouseUp = () => {
      setIsRightDragging(false);
      setIsLeftDragging(false);
    };
    if (isRightDragging || isLeftDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isRightDragging, isLeftDragging]);

  const [promptHistory, setPromptHistory] = useState(() => {
    const saved = localStorage.getItem('astra_prompt_history');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [];
    } catch(e) {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem('astra_prompt_history', JSON.stringify(promptHistory));
  }, [promptHistory]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempPrompt, setTempPrompt] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const editorRefMain = useRef(null);
  const editorRefSplit = useRef(null);

  const handleEditorMainMount = (editor) => {
    editorRefMain.current = editor;
  };

  const handleEditorSplitMount = (editor) => {
    editorRefSplit.current = editor;
  };

  const executeEditorAction = (actionId) => {
    if (activeFileIdSplit && editorRefSplit.current && editorRefSplit.current.hasTextFocus()) {
      editorRefSplit.current.trigger('keyboard', actionId, null);
    } else if (editorRefMain.current) {
      editorRefMain.current.trigger('keyboard', actionId, null);
    }
    setActiveMenu(null);
  };

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    localStorage.setItem('astra_workspace', workspacePath);
    localStorage.setItem('astra_memory', JSON.stringify(messages));
    localStorage.setItem('astra_prompt_history', JSON.stringify(promptHistory));
    localStorage.setItem('astra_current_input', input);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool, workspacePath, promptHistory, input]);

  useEffect(() => {
    if (pendingTool) {
      const toolName = pendingTool.call?.function?.name || 'tool';

      // Custom In-App Toast Notification
      setToastNotification({
        title: 'Permission Required',
        message: `Astra wants to execute: ${toolName}`,
        timestamp: Date.now()
      });

      // Play a short subtle beep
      try {
        const audio = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audio.createOscillator();
        const gainNode = audio.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audio.destination);
        oscillator.type = 'sine';
        oscillator.frequency.value = 600;
        gainNode.gain.setValueAtTime(0, audio.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, audio.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, audio.currentTime + 0.3);
        oscillator.start(audio.currentTime);
        oscillator.stop(audio.currentTime + 0.3);
      } catch (e) {
        console.error('Audio notification failed:', e);
      }
    }
  }, [pendingTool]);

  const clearMemory = () => {
    if (window.confirm("Are you sure you want to clear Astra's memory?")) {
      setMessages([]);
      localStorage.removeItem('astra_memory');
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachments(prev => [...prev, { name: file.name, content: event.target.result }]);
      };
      reader.readAsText(file); // assuming text files for context
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
    } else {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Your browser does not support Speech Recognition.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(prev => prev ? prev + ' ' + transcript : transcript);
      };
      recognition.onerror = (e) => {
        console.error('Speech recognition error', e);
        setIsListening(false);
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.start();
      setIsListening(true);
    }
  };

  const regenerateLast = () => {
    if (messages.length === 0 || isGenerating) return;

    let lastUserIdx = messages.length - 1;
    while (lastUserIdx >= 0 && messages[lastUserIdx].role !== 'user') {
      lastUserIdx--;
    }

    if (lastUserIdx >= 0) {
      const userMessage = messages[lastUserIdx].content;
      // Strip attachments out if they were baked in
      const strippedMessage = userMessage.split('\n\n--- Attached File:')[0];
      const newMessages = messages.slice(0, lastUserIdx);
      setMessages(newMessages);
      handleSend(strippedMessage, newMessages);
    }
  };

  const handleEditMessage = (msgContent, index) => {
    if (isGenerating) return;
    // Strip attachments out if they were baked in
    const strippedMessage = msgContent.split('\n\n--- Attached File:')[0];
    setInput(strippedMessage);
    const newMessages = messages.slice(0, index);
    setMessages(newMessages);
  };

  const handleRegenerateFrom = (index) => {
    if (isGenerating) return;
    const userMessage = messages[index].content;
    const strippedMessage = userMessage.split('\n\n--- Attached File:')[0];
    const newMessages = messages.slice(0, index);
    setMessages(newMessages);
    handleSend(strippedMessage, newMessages);
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
  };

  const fetchDir = async (pathStr = '') => {
    try {
      const res = await fetch('http://localhost:8789/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: pathStr })
      });
      const data = await res.json();
      if (data.success) {
        setFsNodes(data.directories);
      }
    } catch (e) {
      console.error(e);
    }
  };
  const [repoSelectorPath, setRepoSelectorPath] = useState('');
  const [repoSelectorNodes, setRepoSelectorNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeMenu, setActiveMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ openai: '', anthropic: '', gemini: '' });
  const [orchestrationTask, setOrchestrationTask] = useState('');
  const [orchestrationLogs, setOrchestrationLogs] = useState([]);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [showWebSearchConfig, setShowWebSearchConfig] = useState(false);
  const [showPluginInstaller, setShowPluginInstaller] = useState(false);
  const [pluginInstallStates, setPluginInstallStates] = useState({});
  const [marketplacePlugins, setMarketplacePlugins] = useState([]);
  const [activeDownloads, setActiveDownloads] = useState({});
  const [ollamaSearch, setOllamaSearch] = useState('');
  const [showOllamaDropdown, setShowOllamaDropdown] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('http://localhost:8789/api/plugins/downloads')
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setActiveDownloads(data.downloads || {});
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showPluginInstaller && marketplacePlugins.length === 0) {
      fetch('http://localhost:8789/api/plugins/marketplace')
        .then(res => res.json())
        .then(data => {
          if (data && data.success && data.plugins) {
            setMarketplacePlugins(data.plugins);
          }
        })
        .catch(err => console.error('Failed to load marketplace plugins', err));
    }
  }, [showPluginInstaller]);

  const [fsEnabled, setFsEnabled] = useState(() => {
    return localStorage.getItem('astra_fs_enabled') !== 'false';
  });

  const handleToggleFs = () => {
    setFsEnabled(prev => {
      const next = !prev;
      localStorage.setItem('astra_fs_enabled', next);
      return next;
    });
  };

  const handleInstallPlugin = async (pluginId, modelName = null) => {
    setPluginInstallStates(prev => ({ ...prev, [pluginId]: 'installing' }));
    try {
      const res = await fetch('http://localhost:8789/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId, modelName })
      });
      const data = await res.json();
      if (data.success) {
        setPluginInstallStates(prev => ({ ...prev, [pluginId]: 'installed' }));
        setToastNotification({ title: 'Success', message: data.message });
      } else {
        setPluginInstallStates(prev => ({ ...prev, [pluginId]: 'error' }));
        setToastNotification({ title: 'Error', message: data.error });
      }
    } catch (e) {
      setPluginInstallStates(prev => ({ ...prev, [pluginId]: 'error' }));
      setToastNotification({ title: 'Error', message: 'Failed to connect to backend.' });
    }
  };

  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('astra_search_history');
    return saved ? JSON.parse(saved) : [];
  });
  useEffect(() => {
    localStorage.setItem('astra_search_history', JSON.stringify(searchHistory));
  }, [searchHistory]);

  const [searchHistoryIndex, setSearchHistoryIndex] = useState(-1);
  const [orchHistory, setOrchHistory] = useState(() => {
    const saved = localStorage.getItem('astra_orch_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [orchHistoryIndex, setOrchHistoryIndex] = useState(-1);

  useEffect(() => {
    localStorage.setItem('astra_orch_history', JSON.stringify(orchHistory));
  }, [orchHistory]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);

    setSearchHistory(prev => {
      const filtered = prev.filter(q => q !== searchQuery.trim());
      return [searchQuery.trim(), ...filtered].slice(0, 50);
    });
    setSearchHistoryIndex(-1);

    try {
      const res = await fetch('http://localhost:8789/api/fs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, query: searchQuery })
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.results);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRunActiveFile = async () => {
    if (!activeFileIdMain) return;

    // Auto-save if unsaved
    await handleSaveFile(activeFileIdMain);

    let command = '';
    if (activeFileIdMain.endsWith('.js') || activeFileIdMain.endsWith('.jsx')) {
      command = `node "${activeFileIdMain}"`;
    } else if (activeFileIdMain.endsWith('.py')) {
      command = `python "${activeFileIdMain}"`;
    } else if (activeFileIdMain.endsWith('.ts')) {
      command = `npx ts-node "${activeFileIdMain}"`;
    } else {
      setToastNotification({ type: 'warning', message: 'No default runner for this file type' });
      setTimeout(() => setToastNotification(null), 3000);
      return;
    }

    try {
      const res = await fetch('http://localhost:8789/api/tools/terminal/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, workspacePath, cwd: '.' })
      });
      const data = await res.json();
      if (data.taskId) {
        setActiveTask(data.taskId);
        setShowTerminalPane(true);
        setActiveTerminalTab('task');
        setToastNotification({ type: 'success', message: `Running ${activeFileIdMain.split('/').pop()}` });
        setTimeout(() => setToastNotification(null), 3000);
      }
    } catch (err) {
      console.error(err);
      setToastNotification({ type: 'error', message: 'Failed to run file' });
      setTimeout(() => setToastNotification(null), 3000);
    }
    setActiveMenu(null);
  };

  const handleNewTerminal = () => {
    const newId = `shell-${Date.now()}`;
    setShells([...shells, { id: newId }]);
    setActiveTerminalTab(newId);
    setShowTerminalPane(true);
    setActiveMenu(null);
  };

  const handleCloseTerminal = () => {
    if (activeTerminalTab.startsWith('shell-')) {
      const newShells = shells.filter(s => s.id !== activeTerminalTab);
      setShells(newShells);
      setActiveTerminalTab(newShells[0] ? newShells[0].id : 'problems');
    }
    setActiveMenu(null);
  };

  const handleSaveFile = async (filePath) => {
    const fileObj = openFilesMain.find(f => f.name === filePath) || openFilesSplit.find(f => f.name === filePath);
    if (!fileObj || !fileObj.unsaved) return;
    try {
      const res = await fetch('http://localhost:8789/api/tools/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, content: fileObj.content, workspacePath })
      });
      const data = await res.json();
      if (data.success) {
        showToast('File saved successfully');
        setOpenFilesMain(prev => prev.map(f => f.name === filePath ? { ...f, unsaved: false } : f));
        setOpenFilesSplit(prev => prev.map(f => f.name === filePath ? { ...f, unsaved: false } : f));
      }
    } catch(e) {
      console.error('Save failed', e);
      showToast('Error saving file');
    }
  };

  const handleNewFile = () => {
    let i = 1;
    while (openFilesMain.some(f => f.name === `Untitled-${i}`)) i++;
    const newName = `Untitled-${i}`;
    setOpenFilesMain(prev => [...prev, { name: newName, content: '', unsaved: true }]);
    setActiveFileIdMain(newName);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFileIdMain) handleSaveFile(activeFileIdMain);
        if (activeFileIdSplit) handleSaveFile(activeFileIdSplit);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFileIdMain, activeFileIdSplit, openFilesMain, openFilesSplit, workspacePath]);


  // Auto-hide toast notification after 5 seconds
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => {
        setToastNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  const fetchRepoDir = async (pathStr = '') => {
    try {
      const res = await fetch('http://localhost:8789/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: pathStr })
      });
      const data = await res.json();
      if (data.success) {
        setRepoSelectorNodes(data.directories);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleBrowse = () => {
    const startPath = workspacePath || 'C:/';
    setRepoSelectorPath(startPath);
    fetchRepoDir(startPath);
    setShowBrowser(true);
  };

  const fetchModels = async () => {
    try {
      const res = await fetch('http://localhost:8789/api/models');
      const data = await res.json();
      if (data.models) {
        setModels(data.models);
        if (data.models.length > 0) {
          const qwenModel = data.models.find(m => m.name.includes('qwen2.5-coder:14b'));
          setSelectedModel(qwenModel ? qwenModel.name : data.models[0].name);
        } else {
          setSelectedModel('');
        }
      }
      setModelsLoaded(true);
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setModelsLoaded(true);
    }
  };

  const stopGeneration = () => {
    runtime.cancel();
    setActiveTool(null);
  };

  const executeTool = async (toolCall) => {
    const name = toolCall.function ? toolCall.function.name : toolCall.name; const argsObj = toolCall.function ? toolCall.function.arguments : toolCall.arguments;
    setActiveTool(`Running ${name}...`);

    try {
      if (name === 'read_file') {
        const res = await fetch('http://localhost:8789/api/tools/fs/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...argsObj, workspacePath })
        });
        const data = await res.json();
        if (data.success) {
          setOpenFilesMain(prev => {
            const exists = prev.find(f => f.name === argsObj.filePath);
            if (!exists) return [...prev, { name: argsObj.filePath, content: data.content }];
            return prev.map(f => f.name === argsObj.filePath ? { ...f, content: data.content } : f);
          });
          setActiveFileIdMain(argsObj.filePath);
        }
        return JSON.stringify(data);
      }
      else if (name === 'write_file') {
        const res = await fetch('http://localhost:8789/api/tools/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...argsObj, workspacePath })
        });
        const data = await res.json();
        if (data.success) {
          setOpenFilesMain(prev => {
            const exists = prev.find(f => f.name === argsObj.filePath);
            if (!exists) return [...prev, { name: argsObj.filePath, content: argsObj.content }];
            return prev.map(f => f.name === argsObj.filePath ? { ...f, content: argsObj.content } : f);
          });
          setActiveFileIdMain(argsObj.filePath);
        }
        return JSON.stringify(data);
      }
      else if (name === 'run_command') {
        const res = await fetch('http://localhost:8789/api/tools/terminal/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...argsObj, workspacePath })
        });
        const data = await res.json();
        if (data.taskId) {
          setActiveTask(data.taskId);
          setShowTerminalPane(true);
          setActiveTerminalTab('task');
        }
        return JSON.stringify(data);
      }
      else if (name === 'list_dir') {
        const res = await fetch('http://localhost:8789/api/tools/fs/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...argsObj, workspacePath })
        });
        const data = await res.json();
        return JSON.stringify(data);
      }
      else if (name === 'grep_search') {
        const res = await fetch('http://localhost:8789/api/tools/fs/grep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...argsObj, workspacePath })
        });
        const data = await res.json();
        return JSON.stringify(data);
      }
      return JSON.stringify({ error: 'Unknown tool' });
    } catch(err) {
      return JSON.stringify({ error: err.message });
    } finally {
      setActiveTool(null);
    }
  };


  const onMessageUpdate = useCallback((agentMsgIndex, update) => {
    setMessages(prev => {
      const newMessages = [...prev];
      const msg = { ...newMessages[agentMsgIndex] };
      if (update.content !== undefined) msg.content += update.content;
      if (update.content_replace !== undefined) msg.content = update.content_replace;
      if (update.tool_execution) {
        msg.tool_executions = [...(msg.tool_executions || []), update.tool_execution];
      }
      if (update.tool_execution_result) {
        msg.tool_executions = (msg.tool_executions || []).map(t =>
          t.id === update.tool_execution_result.id ? { ...t, ...update.tool_execution_result } : t
        );
      }
      newMessages[agentMsgIndex] = msg;
      return newMessages;
    });
  }, []);

  const onTraceLog = useCallback((entry) => {
    setTraceLogs(prev => [entry, ...prev].slice(0, 100));
  }, []);

  const requestApproval = useCallback((call) => {
    return new Promise((resolve) => setPendingTool({ call, resolve }));
  }, []);

  const runtime = useAgentRuntime({
    onMessageUpdate,
    onTraceLog,
    executeTool,
    requestApproval,
    model: selectedModel,
    tools: selectedModel.toLowerCase().includes('llama') || selectedModel.toLowerCase().includes('gpt') ? TOOLS : [],
    workspacePath,
    authorityLevel,
    maxIterations: 10
  });

  const isGenerating = runtime.isStreaming || runtime.isExecutingTool;

  const handleSend = async (overrideInput = null, overrideMessages = null) => {
    const textToSubmit = overrideInput !== null ? overrideInput : input;
    if (!textToSubmit.trim() && attachments.length === 0) return;

    let userText = textToSubmit.trim();
    if (overrideInput === null) {
      if (userText) {
        setPromptHistory(prev => {
          const filtered = prev.filter(q => q !== userText);
          return [userText, ...filtered].slice(0, 50);
        });
      }
      setHistoryIndex(-1);
      setTempPrompt('');
      setInput('');
      if (isListening) toggleListening(); // Stop mic if sending
    }

    if (attachments.length > 0) {
      const attachmentText = attachments.map(a => `\n--- Attached File: ${a.name} ---\n${a.content}\n--- End of ${a.name} ---\n`).join('');
      userText = `${userText}\n\n${attachmentText}`;
      setAttachments([]); // Clear attachments after sending
    }

    const currentMessages = overrideMessages !== null ? overrideMessages : messages;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: userText };
    setMessages([...currentMessages, userMessage]);



    const agentMsgIndex = currentMessages.length + 1;
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', tool_executions: [] }]);



    try {
      let systemPrompt = PERSONAS[selectedPersona].prompt;
      if (workspacePath) {
        systemPrompt += '\nYour active workspace is located at: ' + workspacePath;
      }

      let currentContext = [
        { role: 'system', content: systemPrompt },
        ...currentMessages,
        userMessage
      ];

      await runtime.run(currentContext, agentMsgIndex);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Generation stopped by user');
        return;
      }
      console.error('Chat error:', err);
      setMessages(prev => {
        const newMessages = [...prev];
        const msg = { ...newMessages[agentMsgIndex] };
        msg.content += '\n\n**Error generating response.**';
        newMessages[agentMsgIndex] = msg;
        return newMessages;
      });
    } finally {


    }
  };

  return (
    <>
      {showAddTool && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Add Custom Tool</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tool Name</label>
              <input type="text" placeholder="e.g. Jira Ticket Fetcher" value={newToolForm.name} onChange={e => setNewToolForm({...newToolForm, name: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>API Endpoint URL</label>
              <input type="text" placeholder="https://api.example.com/v1/..." value={newToolForm.endpoint} onChange={e => setNewToolForm({...newToolForm, endpoint: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Description (for the agent)</label>
              <textarea placeholder="Tell the agent when to use this tool..." value={newToolForm.description} onChange={e => setNewToolForm({...newToolForm, description: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', resize: 'vertical', minHeight: '60px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={() => setShowAddTool(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                if (newToolForm.name && newToolForm.endpoint) {
                  const newTool = { id: 'custom_' + Date.now(), name: newToolForm.name, endpoint: newToolForm.endpoint, description: newToolForm.description, enabled: true, builtIn: false };
                  setTools([...tools, newTool]);
                  setNewToolForm({ name: '', endpoint: '', description: '' });
                  setShowAddTool(false);
                  showToast('Custom tool added successfully');
                }
              }} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Add Tool</button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Settings</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>OpenAI API Key</label>
              <input type="password" value={settingsForm.openai || ''} onChange={e => setSettingsForm({...settingsForm, openai: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Anthropic API Key</label>
              <input type="password" value={settingsForm.anthropic || ''} onChange={e => setSettingsForm({...settingsForm, anthropic: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gemini API Key</label>
              <input type="password" value={settingsForm.gemini || ''} onChange={e => setSettingsForm({...settingsForm, gemini: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Agent Authority Level</label>
              <select value={authorityLevel} onChange={e => {
                setAuthorityLevel(e.target.value);
                localStorage.setItem('astra_authority_level', e.target.value);
              }} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }}>
                <option value="Strict">Strict (Approve everything)</option>
                <option value="Supervised">Supervised (Approve modifying tools)</option>
                <option value="Autonomous">Autonomous (No approval required)</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                fetch('http://localhost:8789/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ apiKeys: settingsForm })
                })
                .then(res => res.json())
                .then(data => {
                  if (data.success) {
                    showToast('Settings saved successfully');
                    setShowSettings(false);
                  }
                });
              }} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showBrowser && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '8px', width: '450px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Select Repository</h3>
              <button onClick={() => setShowBrowser(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><XOctagon size={16} /></button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => { setRepoSelectorPath('C:\\'); fetchRepoDir('C:\\'); }} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>C:\</button>
              <button onClick={() => { setRepoSelectorPath('D:\\'); fetchRepoDir('D:\\'); }} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>D:\</button>
              <button onClick={() => { setRepoSelectorPath('E:\\'); fetchRepoDir('E:\\'); }} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>E:\</button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={repoSelectorPath}
                onChange={(e) => setRepoSelectorPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchRepoDir(repoSelectorPath); }}
                style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                placeholder="Type path (e.g. D:\Projects) and press Enter"
              />
              <button
                onClick={() => fetchRepoDir(repoSelectorPath)}
                style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}
              >
                Go
              </button>
              <button
                onClick={() => {
                  const parts = repoSelectorPath.replace(/\\/g, '/').split('/').filter(Boolean);
                  parts.pop();
                  const newPath = parts.length > 0 ? parts.join('/') + '/' : 'C:/';
                  setRepoSelectorPath(newPath);
                  fetchRepoDir(newPath);
                }}
                title="Go Up One Folder"
                style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <ArrowUp size={18} />
              </button>
            </div>

            <div style={{ height: '300px', overflowY: 'auto', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem' }}>
              <div
                className="fs-node"
                onClick={() => {
                  const parts = repoSelectorPath.replace(/\\/g, '/').split('/').filter(Boolean);
                  parts.pop();
                  const newPath = parts.length > 0 ? parts.join('/') + '/' : 'C:/';
                  setRepoSelectorPath(newPath);
                  fetchRepoDir(newPath);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}
              >
                <Folder size={16} /> ..
              </div>
              {repoSelectorNodes.map((node, i) => (
                <div key={i} className="fs-node" onClick={() => {
                  setRepoSelectorPath(node.path);
                  fetchRepoDir(node.path);
                }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  <Folder size={16} /> {node.name}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setShowBrowser(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
              <button onClick={() => {
                setWorkspacePath(repoSelectorPath);
                fetchDir(repoSelectorPath);
                setShowBrowser(false);
              }} style={{ background: '#2563eb', border: 'none', padding: '0.5rem 1rem', color: '#fafafa', cursor: 'pointer', borderRadius: '4px' }}>Select This Repository</button>
            </div>
          </div>
        </div>
      )}
      <div className="app-container" onClick={(e) => { if (activeMenu && !e.target.closest(".menu-bar")) setActiveMenu(null); }}>
      <header style={{ display: 'flex', padding: 0, background: 'var(--surface-color)', overflow: 'visible', borderBottom: '1px solid var(--border-color)', position: 'relative', zIndex: 50 }}>
        <div style={{ flex: 1, padding: '0.25rem 1rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 16, height: 16, background: 'linear-gradient(135deg, #6366f1, #a855f7, #ec4899)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontWeight: 'bold', fontSize: '10px' }}>A</span>
            </div>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', letterSpacing: '1px' }}>Astra</span>
          </div>
          <div className="menu-bar" style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>File</span>
              {activeMenu === 'file' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '150px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); handleNewFile(); }}>New File</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setShowBrowser(true); }}>Open Folder</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={() => { setActiveMenu(null); if (activeFileIdMain) handleSaveFile(activeFileIdMain); }}>Save</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={() => {
                    setActiveMenu(null);
                    if (activeFileIdMain) {
                      setOpenFilesMain(prev => prev.filter(x => x.name !== activeFileIdMain));
                      setActiveFileIdMain(openFilesMain[0]?.name !== activeFileIdMain ? openFilesMain[0]?.name : openFilesMain[1]?.name || null);
                    }
                  }}>Close File</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}>Edit</span>
              {activeMenu === 'edit' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('undo')}>Undo</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('redo')}>Redo</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.clipboardCutAction')}>Cut</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.clipboardCopyAction')}>Copy</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.clipboardPasteAction')}>Paste</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('actions.find')}>Find</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.startFindReplaceAction')}>Replace</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'selection' ? null : 'selection')}>Selection</span>
              {activeMenu === 'selection' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.selectAll')}>Select All</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.smartSelect.expand')}>Expand Selection</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.smartSelect.shrink')}>Shrink Selection</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.copyLinesUpAction')}>Copy Line Up</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.copyLinesDownAction')}>Copy Line Down</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.moveLinesUpAction')}>Move Line Up</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.moveLinesDownAction')}>Move Line Down</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}>View</span>
              {activeMenu === 'view' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setWordWrap(!wordWrap); setActiveMenu(null); }}>
                    Word Wrap <span>{wordWrap && '✓'}</span>
                  </span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setMinimapEnabled(!minimapEnabled); setActiveMenu(null); }}>
                    Minimap <span>{minimapEnabled && '✓'}</span>
                  </span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setShowTerminalPane(!showTerminalPane); setActiveMenu(null); }}>
                    Terminal Panel <span>{showTerminalPane && '✓'}</span>
                  </span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'go' ? null : 'go')}>Go</span>
              {activeMenu === 'go' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.gotoLine')}>Go to Line/Column...</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.quickOutline')}>Go to Symbol in File...</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.revealDefinition')}>Go to Definition</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.referenceSearch.trigger')}>Go to References</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'run' ? null : 'run')}>Run</span>
              {activeMenu === 'run' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={handleRunActiveFile}>
                    <Play size={14} style={{ display: 'inline', marginRight: '8px' }} />
                    Run Active File
                  </span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => executeEditorAction('editor.action.showHover')}>Show Hover</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'terminal' ? null : 'terminal')}>Terminal</span>
              {activeMenu === 'terminal' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={handleNewTerminal}>New Terminal</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={handleNewTerminal}>Split Terminal</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={handleCloseTerminal}>Close Terminal</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setShowTerminalPane(!showTerminalPane); setActiveMenu(null); }}>
                    Toggle Panel <span>{showTerminalPane && '✓'}</span>
                  </span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'settings' ? null : 'settings')}>Settings</span>
              {activeMenu === 'settings' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setShowSettings(true); }}>Preferences...</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Color Theme switching coming soon!' }); setTimeout(() => setToastNotification(null), 3000); }}>Color Theme...</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Keyboard Shortcuts UI coming soon!' }); setTimeout(() => setToastNotification(null), 3000); }}>Keyboard Shortcuts...</span>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}>Help</span>
              {activeMenu === 'help' && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Welcome to Astra IDE! Try creating a file to get started.' }); setTimeout(() => setToastNotification(null), 4000); }}>Welcome</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Documentation opens in a new tab...' }); setTimeout(() => setToastNotification(null), 3000); }}>Documentation</span>
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Astra IDE v1.0.0' }); setTimeout(() => setToastNotification(null), 3000); }}>About</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ width: '5px' }}></div>

        <div style={{
          width: sidebarWidth,
          padding: '0.5rem 1rem',
          display: 'flex',
          alignItems: 'center',
          borderLeft: '1px solid var(--border-color)',
        }}>
          <div className="header-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', width: '100%', justifyContent: 'flex-start' }}>
            <div className="selector-group" title="Workspace" style={{ flex: '1 1 auto', minWidth: '120px' }}>
              <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                <input
                  type="text"
                  id="workspace"
                  className="workspace-input"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="Workspace path..."
                  style={{ background: '#1e1e1e', border: 'none', height: 32, flex: 1, minWidth: 0 }}
                />
                <button onClick={handleBrowse} className="browse-btn" title="Browse Workspace" style={{ background: '#1e1e1e', border: 'none', borderRadius: 4, padding: '0 0.5rem', cursor: 'pointer', color: 'var(--text-primary)', flexShrink: 0 }}><Folder size={14}/></button>
              </div>
            </div>
            <div className="selector-group" title="Persona" style={{ flex: '1 1 auto', minWidth: '100px' }}>
              <select
                id="persona"
                value={selectedPersona}
                onChange={(e) => setSelectedPersona(e.target.value)}
                style={{ background: '#1e1e1e', border: 'none', height: 32, width: '100%' }}
              >
                {Object.entries(PERSONAS).map(([key, data]) => (
                  <option key={key} value={key}>{data.name}</option>
                ))}
              </select>
            </div>
            <button onClick={clearMemory} disabled={isGenerating || messages.length === 0} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }} title="Clear Memory">Clear</button>
          </div>
        </div>
      </header>

      <div className="workspace-container">
        {/* Left Activity Bar */}
        <div className="activity-bar" style={{ width: '48px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem 0', gap: '1.5rem', background: 'var(--surface-color)' }}>
          <button onClick={() => { if(activeActivity === 'explorer') { setIsLeftSidebarOpen(!isLeftSidebarOpen); } else { setActiveActivity('explorer'); setIsLeftSidebarOpen(true); } }} style={{ background: 'transparent', border: 'none', color: activeActivity === 'explorer' && isLeftSidebarOpen ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Explorer"><FileText size={24} strokeWidth={1.5} /></button>
          <button onClick={() => { if(activeActivity === 'search') { setIsLeftSidebarOpen(!isLeftSidebarOpen); } else { setActiveActivity('search'); setIsLeftSidebarOpen(true); } }} style={{ background: 'transparent', border: 'none', color: activeActivity === 'search' && isLeftSidebarOpen ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Search"><AlertCircle size={24} strokeWidth={1.5} /></button>
          <button onClick={() => { if(activeActivity === 'orchestrate') { setIsLeftSidebarOpen(!isLeftSidebarOpen); } else { setActiveActivity('orchestrate'); setIsLeftSidebarOpen(true); } }} style={{ background: 'transparent', border: 'none', color: activeActivity === 'orchestrate' && isLeftSidebarOpen ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Orchestration"><Users size={24} strokeWidth={1.5} /></button>
          <button onClick={() => { if(activeActivity === 'tools') { setIsLeftSidebarOpen(!isLeftSidebarOpen); } else { setActiveActivity('tools'); setIsLeftSidebarOpen(true); } }} style={{ background: 'transparent', border: 'none', color: activeActivity === 'tools' && isLeftSidebarOpen ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Tools & Plugins"><Puzzle size={24} strokeWidth={1.5} /></button>
          <button onClick={() => setShowTerminalPane(!showTerminalPane)} style={{ background: 'transparent', border: 'none', color: showTerminalPane ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', marginTop: 'auto' }} title="Terminal"><Terminal size={24} strokeWidth={1.5} /></button>
        </div>

        {/* Left Sidebar */}
        {isLeftSidebarOpen && (
          <div className="sidebar-panel" style={{ width: leftSidebarWidth, borderRight: '1px solid var(--border-color)', background: '#18181b', display: 'flex', flexDirection: 'column' }}>
            {activeActivity === 'trace' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                  Trace Logs
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem 1rem' }}>
                  {traceLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No trace logs recorded yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {traceLogs.map((log, idx) => (
                        <div key={idx} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                            <span style={{ fontWeight: 600 }}>Turn {traceLogs.length - idx}</span>
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <span style={{ color: '#aaa' }}>Model: </span> <span style={{ color: '#fff' }}>{log.model}</span>
                          </div>
                          <JSONPreview title="Request Payload (apiMessages & tools)" data={log.requestPayload} />
                          <JSONPreview title="Raw Response Buffer (NDJSON chunks)" data={log.rawBuffer} isString={true} />
                          <JSONPreview title="Parsed Tool Calls" data={log.parsedToolCalls} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {activeActivity === 'explorer' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Explorer</div>
                <div className="fs-browser-inline" style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', background: '#1e1e1e' }}>
                  {!fsEnabled ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center', marginTop: '2rem' }}>
                      File System access is currently disabled. Go to Tools & Plugins to enable it.
                    </div>
                  ) : (
                    <FileExplorer
                      workspacePath={workspacePath}
                    onFileSelect={(fileData) => {
                      setOpenFilesMain(prev => prev.find(f => f.name === fileData.name) ? prev : [...prev, fileData]);
                      setActiveFileIdMain(fileData.name);
                    }}
                    onFileSelectSplit={(fileData) => {
                      setOpenFilesSplit(prev => prev.find(f => f.name === fileData.name) ? prev : [...prev, fileData]);
                      setActiveFileIdSplit(fileData.name);
                    }}
                  />
                  )}
                </div>
              </>
            )}
            {activeActivity === 'search' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Search</div>
                <div style={{ padding: '0 1rem 1rem', flex: 1, overflowY: 'auto' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      list="search-history-list"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearch();
                        else if (e.key === 'ArrowUp') {
                          if (searchHistory.length > 0 && searchHistoryIndex < searchHistory.length - 1) {
                            e.preventDefault();
                            const nextIndex = searchHistoryIndex + 1;
                            setSearchHistoryIndex(nextIndex);
                            setSearchQuery(searchHistory[nextIndex]);
                          }
                        } else if (e.key === 'ArrowDown') {
                          if (searchHistoryIndex >= 0) {
                            e.preventDefault();
                            const prevIndex = searchHistoryIndex - 1;
                            setSearchHistoryIndex(prevIndex);
                            setSearchQuery(prevIndex >= 0 ? searchHistory[prevIndex] : '');
                          }
                        }
                      }}
                      placeholder="Search files..."
                      style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', borderRadius: '4px', outline: 'none' }}
                    />
                    <datalist id="search-history-list">
                      {searchHistory.map((h, i) => <option key={i} value={h} />)}
                    </datalist>
                    <button
                      onClick={handleSearch}
                      disabled={isSearching}
                      style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
                    >
                      <Search size={16} />
                    </button>
                  </div>

                  {isSearching ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching...</div>
                  ) : searchResults ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {searchResults.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No results found.</div>
                      ) : (
                        searchResults.map((res, i) => (
                          <div
                            key={i}
                            onClick={async () => {
                              try {
                                const fileRes = await fetch('http://localhost:8789/api/tools/fs/read', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ filePath: res.file, workspacePath })
                                });
                                const fileData = await fileRes.json();
                                if (fileData.success) {
                                  const fData = { name: res.file, content: fileData.content };
                                  setOpenFilesMain(prev => prev.find(f => f.name === fData.name) ? prev : [...prev, fData]);
                                  setActiveFileIdMain(fData.name);
                                }
                              } catch(e) {}
                            }}
                            style={{ background: 'var(--surface-color)', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border-color)' }}
                          >
                            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.25rem', wordBreak: 'break-all' }}>{res.file.split('/').pop()} <span style={{ color: 'var(--text-secondary)' }}>:{res.line}</span></div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.text}</div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Type to search your workspace.</div>
                  )}
                </div>
              </>
            )}
            {activeActivity === 'orchestrate' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Orchestration</div>
                <div style={{ padding: '0 1rem 1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                  <textarea
                    value={orchestrationTask}
                    onChange={e => {
                      setOrchestrationTask(e.target.value);
                      setOrchHistoryIndex(-1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        startOrchestration();
                      } else if (e.key === 'ArrowUp') {
                        if (orchHistory.length > 0 && orchHistoryIndex < orchHistory.length - 1) {
                          e.preventDefault();
                          const nextIndex = orchHistoryIndex + 1;
                          setOrchHistoryIndex(nextIndex);
                          setOrchestrationTask(orchHistory[nextIndex]);
                        }
                      } else if (e.key === 'ArrowDown') {
                        if (orchHistoryIndex >= 0) {
                          e.preventDefault();
                          const prevIndex = orchHistoryIndex - 1;
                          setOrchHistoryIndex(prevIndex);
                          setOrchestrationTask(prevIndex >= 0 ? orchHistory[prevIndex] : '');
                        }
                      }
                    }}
                    placeholder="Describe a complex task for multiple agents..."
                    style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', resize: 'vertical', minHeight: '80px', outline: 'none' }}
                  />
                  <button onClick={startOrchestration} disabled={isOrchestrating} style={{ background: 'var(--text-primary)', color: 'var(--bg-color)', border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {isOrchestrating ? 'Orchestrating...' : 'Start Orchestration'}
                  </button>
                  <div style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {orchestrationLogs.map((log, i) => (
                      <div key={i} style={{ padding: '0.5rem', background: 'var(--bg-color)', borderRadius: '4px', borderLeft: log.role === 'error' ? '3px solid #f87171' : '3px solid #a855f7' }}>
                        <strong style={{ display: 'block', marginBottom: '0.25rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{log.role}</strong>
                        {log.text}
                      </div>
                    ))}
                    {orchestrationLogs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No logs yet.</div>}
                  </div>
                </div>
              </>
            )}
            {activeActivity === 'tools' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Tools & Plugins</div>
                <div style={{ padding: '0 1rem 1rem', flex: 1, overflowY: 'auto' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ background: 'var(--surface-color)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>Web Search</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Allow agents to browse the internet.</p>
                      <button onClick={() => setShowWebSearchConfig(true)} style={{ marginTop: '0.75rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Configure</button>
                    </div>
                    <div style={{ background: 'var(--surface-color)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>File System</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Full read/write access to local files.</p>
                      <button onClick={handleToggleFs} style={{ marginTop: '0.75rem', background: fsEnabled ? 'var(--text-primary)' : 'var(--surface-color)', border: fsEnabled ? 'none' : '1px solid var(--border-color)', color: fsEnabled ? 'var(--bg-color)' : 'var(--text-secondary)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: fsEnabled ? 'bold' : 'normal' }}>
                        {fsEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div onClick={() => setShowPluginInstaller(true)} style={{ background: 'var(--surface-color)', padding: '1rem', borderRadius: '4px', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>+ Install New Plugin</span>
                    </div>
                  </div>
                </div>
              </>
            )}

          </div>
        )}

        {/* Left Resizer */}
        {isLeftSidebarOpen && (
          <div className={`resizer ${isLeftDragging ? 'active' : ''}`} onMouseDown={startLeftResizing} />
        )}

        {/* Central Area: Editor / Terminal */}
        <div className="central-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Editor Pane (Top) */}
          <div className="editor-pane" style={{ flex: activeTask ? '1 1 60%' : '1 1 100%', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: openFilesSplit.length > 0 ? '1px solid var(--border-color)' : 'none' }}>
              {openFilesMain.length === 0 ? (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 100, height: 100, margin: '0 auto', opacity: 0.1, background: 'var(--text-primary)', borderRadius: '50%' }}></div>
                    <h2 style={{ marginTop: '1rem', fontWeight: 400 }}>Astra Editor</h2>
                    <p>Select a file to view</p>
                  </div>
                </div>
              ) : (
                <div className="code-viewer-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="code-viewer-header" style={{ display: 'flex', padding: '0', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
                    {openFilesMain.map(f => (
                      <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: activeFileIdMain === f.name ? 'var(--bg-color)' : 'transparent', borderTop: activeFileIdMain === f.name ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer', borderRight: '1px solid var(--border-color)' }} onClick={() => setActiveFileIdMain(f.name)}>
                        <span style={{ fontSize: '0.85rem', color: activeFileIdMain === f.name ? 'var(--text-primary)' : 'var(--text-secondary)' }}>📄 {f.name.split('/').pop()}{f.unsaved ? ' *' : ''}</span>
                        <button onClick={(e) => { e.stopPropagation(); setOpenFilesMain(prev => prev.filter(x => x.name !== f.name)); if(activeFileIdMain === f.name) setActiveFileIdMain(openFilesMain[0]?.name !== f.name ? openFilesMain[0]?.name : openFilesMain[1]?.name || null) }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="code-viewer-content" style={{ flex: 1, overflow: 'hidden' }}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      path={activeFileIdMain || 'temp'}
                      defaultLanguage={activeFileIdMain?.split('.').pop() || 'javascript'}
                      value={openFilesMain.find(f => f.name === activeFileIdMain)?.content || ''}
                      onMount={handleEditorMainMount}
                      onChange={(value) => {
                        setOpenFilesMain(prev => prev.map(f => f.name === activeFileIdMain ? { ...f, content: value, unsaved: true } : f));
                      }}
                      options={{ readOnly: false, minimap: { enabled: minimapEnabled }, wordWrap: wordWrap ? 'on' : 'off' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {openFilesSplit.length > 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="code-viewer-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="code-viewer-header" style={{ display: 'flex', padding: '0', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
                    {openFilesSplit.map(f => (
                      <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: activeFileIdSplit === f.name ? 'var(--bg-color)' : 'transparent', borderTop: activeFileIdSplit === f.name ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer', borderRight: '1px solid var(--border-color)' }} onClick={() => setActiveFileIdSplit(f.name)}>
                        <span style={{ fontSize: '0.85rem', color: activeFileIdSplit === f.name ? 'var(--text-primary)' : 'var(--text-secondary)' }}>📄 {f.name.split('/').pop()}{f.unsaved ? ' *' : ''}</span>
                        <button onClick={(e) => { e.stopPropagation(); setOpenFilesSplit(prev => prev.filter(x => x.name !== f.name)); if(activeFileIdSplit === f.name) setActiveFileIdSplit(openFilesSplit[0]?.name !== f.name ? openFilesSplit[0]?.name : openFilesSplit[1]?.name || null) }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="code-viewer-content" style={{ flex: 1, overflow: 'hidden' }}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      path={activeFileIdSplit || 'temp'}
                      defaultLanguage={activeFileIdSplit?.split('.').pop() || 'javascript'}
                      value={openFilesSplit.find(f => f.name === activeFileIdSplit)?.content || ''}
                      onMount={handleEditorSplitMount}
                      onChange={(value) => {
                        setOpenFilesSplit(prev => prev.map(f => f.name === activeFileIdSplit ? { ...f, content: value, unsaved: true } : f));
                      }}
                      options={{ readOnly: false, minimap: { enabled: minimapEnabled }, wordWrap: wordWrap ? 'on' : 'off' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Terminal Pane (Bottom) */}
          {showTerminalPane && (
            <div className="terminal-pane" style={{ flex: '0 0 35%', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="code-viewer-header" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 1rem', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span onClick={() => setActiveTerminalTab('problems')} style={{ cursor: 'pointer', color: activeTerminalTab === 'problems' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'problems' ? '1px solid var(--text-primary)' : 'none' }}>Problems</span>
                  <span onClick={() => setActiveTerminalTab('output')} style={{ cursor: 'pointer', color: activeTerminalTab === 'output' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'output' ? '1px solid var(--text-primary)' : 'none' }}>Output</span>

                  {shells.map((sh, idx) => (
                    <div key={sh.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span
                        onClick={() => setActiveTerminalTab(sh.id)}
                        style={{ cursor: 'pointer', color: activeTerminalTab === sh.id ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === sh.id ? '1px solid var(--text-primary)' : 'none' }}>
                        Terminal {idx + 1}
                      </span>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const newShells = shells.filter(s => s.id !== sh.id);
                        setShells(newShells);
                        if (activeTerminalTab === sh.id) {
                          setActiveTerminalTab(newShells[0] ? newShells[0].id : 'problems');
                        }
                      }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }} title="Close Shell"><X size={12} /></button>
                    </div>
                  ))}
                  <button onClick={() => {
                    const newId = `shell-${Date.now()}`;
                    setShells([...shells, { id: newId }]);
                    setActiveTerminalTab(newId);
                  }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="New Shell"><Plus size={14} /></button>

                  {activeTask && (
                    <span
                      onClick={() => setActiveTerminalTab('task')}
                      style={{ cursor: 'pointer', color: activeTerminalTab === 'task' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'task' ? '1px solid var(--text-primary)' : 'none' }}>
                      Task: {activeTask.split('-')[0]}...
                    </span>
                  )}
                </div>
                <button onClick={() => setShowTerminalPane(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><XOctagon size={16} /></button>
              </div>
              <div className="live-terminal-content" style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
                {shells.map(sh => (
                  <div key={sh.id} style={{ display: activeTerminalTab === sh.id ? 'block' : 'none', height: '100%' }}>
                    <InteractiveTerminal workspacePath={workspacePath} sessionId={sh.id} />
                  </div>
                ))}
                {activeTerminalTab === 'task' && activeTask ? <LiveTerminal taskId={activeTask} /> : null}
                {activeTerminalTab === 'problems' && (
                  <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 1rem' }}>
                      <h3 style={{ margin: 0 }}>Problems</h3>
                      <button onClick={runLinter} disabled={isLinting} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.25rem 0.5rem', cursor: 'pointer', borderRadius: '4px' }}>
                        {isLinting ? 'Linting...' : 'Run Linter'}
                      </button>
                    </div>
                    {problems === null ? (
                      <div style={{ color: 'var(--text-secondary)', padding: '0 1rem' }}>Click "Run Linter" to scan workspace.</div>
                    ) : problems.length === 0 ? (
                      <div style={{ color: '#4ade80', padding: '0 1rem' }}>No problems detected in the workspace!</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {problems.map((p, i) => (
                          <div key={i} style={{ padding: '0.25rem 1rem', display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                            <span style={{ color: p.severity === 2 ? '#f87171' : '#facc15', width: '20px' }}>{p.severity === 2 ? '✖' : '⚠'}</span>
                            <span style={{ flex: 1 }}>{p.message}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{p.file}:{p.line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {activeTerminalTab === 'output' && (
                  <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {outputLogs.map((log, i) => (
                      <div key={i} style={{ color: log.type === 'error' ? '#f87171' : 'var(--text-primary)', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--text-secondary)', marginRight: '0.5rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        {log.msg}
                      </div>
                    ))}
                    {outputLogs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No output from backend...</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Resizer */}
        <div className={`resizer ${isRightDragging ? 'active' : ''}`} onMouseDown={startRightResizing} />

        {/* Chat Sidebar */}
        <div className="chat-sidebar" style={{ width: sidebarWidth }}>
          <div className="messages" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
                How can I help you today?
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role === 'user' ? 'user' : 'agent'}`}>
                <ReactMarkdown
                  components={{
                    code({node, inline, className, children, ...props}) {
                      const match = /language-(\w+)/.exec(className || '')
                      if (!inline && match && match[1] === 'thought') {
                        return (
                          <div style={{ background: '#2c2c2c', color: '#a0a0a0', padding: '0.75rem', borderRadius: '4px', borderLeft: '3px solid #666', fontStyle: 'italic', marginBottom: '1rem', fontSize: '0.85rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontWeight: 'bold', color: '#bbb' }}>
                              <Brain size={14} /> Thought Process
                            </div>
                            {String(children).replace(/\n$/, '')}
                          </div>
                        );
                      }
                      return !inline && match ? (
                        <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" {...props}>
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>{children}</code>
                      )
                    }
                  }}
                >
                  {msg.content ? msg.content.replace(/<think>/g, '```thought\n').replace(/<\/think>/g, '\n```\n') : ''}
                </ReactMarkdown>
                {msg.tool_executions && msg.tool_executions.map((t, i) => <ToolExecution key={i} tool={t} />)}
                <div className="message-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}>

                    {msg.role === 'user' ? (
                      <>
                        <button className="action-btn" title="Edit Prompt" onClick={() => handleEditMessage(msg.content, idx)}>
                          <Edit2 size={14} />
                        </button>
                        <button className="action-btn" title="Regenerate from here" onClick={() => handleRegenerateFrom(idx)}>
                          <RefreshCw size={14} />
                        </button>
                      </>
                    ) : null}
                    <button className="action-btn" title="Copy to Clipboard" onClick={() => handleCopy(msg.content)}>
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {activeTool && (
                <div className="tool-indicator">
                  <div className="tool-spinner"></div>
                  {activeTool}
                </div>
              )}

              {/* Permission Inline Block */}
              {pendingTool && (
                <div style={{ background: '#2c2c2c', border: '1px solid #d35400', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e67e22', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    <AlertTriangle size={18} /> Permission Required
                  </div>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>Astra wants to execute: <strong>{(pendingTool.call.function ? pendingTool.call.function.name : pendingTool.call.name)}</strong></p>
                  <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '0.5rem', borderRadius: '4px', overflowX: 'auto', fontSize: '0.8rem', margin: '0 0 1rem 0', border: '1px solid var(--border-color)' }}>
                    {JSON.stringify((pendingTool.call.function ? pendingTool.call.function.arguments : pendingTool.call.arguments), null, 2)}
                  </pre>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => pendingTool.resolve(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><X size={14}/> Reject</button>
                    <button onClick={() => pendingTool.resolve(true)} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Check size={14}/> Approve</button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

          <div style={{ padding: '0 1rem 1rem 1rem' }}>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {attachments.map((file, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#2d2d30', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                    <Paperclip size={12} /> {file.name}
                    <button onClick={() => removeAttachment(i)} style={{ background: 'transparent', border: 'none', padding: 0, marginLeft: '0.25rem', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="input-area" style={{ background: '#1e1e1e', borderRadius: '8px', padding: '0.5rem', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
              <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              <textarea
                placeholder={`Ask ${PERSONAS[selectedPersona].name} to do something...`}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setHistoryIndex(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  } else if (e.key === 'ArrowUp') {
                    if (promptHistory.length > 0 && historyIndex < promptHistory.length - 1) {
                      e.preventDefault();
                      if (historyIndex === -1) setTempPrompt(input);
                      const nextIndex = historyIndex + 1;
                      setHistoryIndex(nextIndex);
                      setInput(promptHistory[nextIndex]);
                    }
                  } else if (e.key === 'ArrowDown') {
                    if (historyIndex >= 0) {
                      e.preventDefault();
                      const prevIndex = historyIndex - 1;
                      setHistoryIndex(prevIndex);
                      setInput(prevIndex >= 0 ? promptHistory[prevIndex] : tempPrompt);
                    }
                  }
                }}
                rows={2}
                style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', resize: 'none', color: '#fff', padding: '0.5rem', outline: 'none', fontFamily: 'inherit', fontSize: '0.9rem', textAlign: 'left' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', padding: '0 0.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach File"
                    style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px' }}
                  >
                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span>
                  </button>
                  <div style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0 0.5rem', display: 'flex', alignItems: 'center', height: '24px' }}>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', outline: 'none', padding: 0, maxWidth: '140px', textOverflow: 'ellipsis' }}
                    >
                      {!modelsLoaded && <option>Loading...</option>}
                      {modelsLoaded && models.length === 0 && <option value="">No local models</option>}
                      {models.map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    onClick={toggleListening}
                    title="Voice Typing"
                    style={{ color: isListening ? '#ef4444' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '4px', transition: 'all 0.2s ease' }}
                  >
                    {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>

                  {isGenerating ? (
                    <button onClick={stopGeneration} title="Stop Generation" style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '32px' }}>
                      <div style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '2px' }}></div>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSend(null, null)}
                      disabled={!input.trim() && attachments.length === 0}
                      title="Send"
                      style={{
                        color: (!input.trim() && attachments.length === 0) ? 'var(--text-secondary)' : 'var(--bg-color)',
                        background: (!input.trim() && attachments.length === 0) ? 'var(--border-color)' : 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '0 12px',
                        height: '32px',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        transition: 'all 0.2s ease',
                        opacity: (!input.trim() && attachments.length === 0) ? 0.6 : 1
                      }}
                    >
                      <Send size={14} /> Send
                    </button>
                  )}
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>


      {/* Toast Notification */}
      {Object.keys(activeDownloads).length > 0 && (
        <div style={{ position: 'fixed', bottom: '1rem', left: '1rem', zIndex: 500, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {Object.entries(activeDownloads).map(([model, info]) => (
            <div key={model} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.75rem', color: 'var(--text-primary)', fontSize: '0.8rem', width: '250px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Downloading {model}</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {info.status}
              </div>
            </div>
          ))}
        </div>
      )}

      {toastNotification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'var(--bg-color)',
          border: '1px solid var(--border-color)',
          borderLeft: '4px solid #f1c40f',
          padding: '1rem',
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          animation: 'slideInRight 0.3s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{toastNotification.title}</span>
            <button onClick={() => setToastNotification(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
          </div>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{toastNotification.message}</span>
        </div>
      )}

      {/* Web Search Config Modal */}
      {showWebSearchConfig && (
        <div className="modal-overlay" onClick={() => setShowWebSearchConfig(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '400px' }}>
            <div className="modal-header">
              <h2>Configure Web Search</h2>
              <button onClick={() => setShowWebSearchConfig(false)} className="close-btn"><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '0.9rem' }}>Search Provider</label>
                <select style={{ width: '100%', padding: '0.5rem', background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', marginBottom: '1rem' }}>
                  <option>Brave Search (Recommended)</option>
                  <option>Google Custom Search</option>
                  <option>Bing Search</option>
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '0.9rem' }}>API Key</label>
                <input type="password" placeholder="Enter API Key" style={{ width: '100%', padding: '0.5rem', background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }} />
              </div>
            </div>
            <div className="modal-footer" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setShowWebSearchConfig(false)} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => setShowWebSearchConfig(false)} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Plugin Installer Modal */}
      {showPluginInstaller && (
        <div className="modal-overlay" onClick={() => setShowPluginInstaller(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '500px' }}>
            <div className="modal-header">
              <h2>Install Plugin</h2>
              <button onClick={() => setShowPluginInstaller(false)} className="close-btn"><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>Download Local Models</h4>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Search and pull Ollama models in the background.</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type="text"
                        value={ollamaSearch}
                        onChange={(e) => {
                          setOllamaSearch(e.target.value);
                          setShowOllamaDropdown(true);
                        }}
                        onFocus={() => setShowOllamaDropdown(true)}
                        onBlur={() => setTimeout(() => setShowOllamaDropdown(false), 200)}
                        placeholder="Search for a model (e.g. qwen2.5-coder)"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)', outline: 'none' }}
                      />
                      {showOllamaDropdown && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 1000, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                          {CURATED_OLLAMA_MODELS.filter(m => m.id.toLowerCase().includes(ollamaSearch.toLowerCase()) || m.name.toLowerCase().includes(ollamaSearch.toLowerCase())).length > 0 ? (
                            CURATED_OLLAMA_MODELS.filter(m => m.id.toLowerCase().includes(ollamaSearch.toLowerCase()) || m.name.toLowerCase().includes(ollamaSearch.toLowerCase())).map(model => (
                              <div
                                key={model.id}
                                onMouseDown={() => {
                                  setOllamaSearch(model.id);
                                  setShowOllamaDropdown(false);
                                }}
                                style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              >
                                <div>
                                  <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{model.name} <span style={{ color: 'var(--text-secondary)', fontWeight: 'normal' }}>({model.id})</span></div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{model.desc}</div>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-accent)', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{model.size}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              Press Download to pull custom model "{ollamaSearch}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if(ollamaSearch) {
                          handleInstallPlugin('ollama', ollamaSearch);
                          setOllamaSearch('');
                        }
                      }}
                      disabled={pluginInstallStates['ollama'] === 'installing'}
                      style={{ background: 'var(--text-primary)', color: 'var(--bg-color)', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >
                      {pluginInstallStates['ollama'] === 'installing' ? 'Starting...' : 'Download'}
                    </button>
                  </div>
                </div>
                {marketplacePlugins.map((plugin) => (
                  <div key={plugin.id} style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>{plugin.name}</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{plugin.description}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (plugin.action === 'Configure') {
                          setShowSettings(true);
                          setShowPluginInstaller(false);
                        } else {
                          handleInstallPlugin(plugin.id);
                        }
                      }}
                      disabled={pluginInstallStates[plugin.id] === 'installing' || pluginInstallStates[plugin.id] === 'installed'}
                      style={{
                        background: pluginInstallStates[plugin.id] === 'installed' ? 'var(--bg-color)' : 'var(--text-primary)',
                        border: pluginInstallStates[plugin.id] === 'installed' ? '1px solid #2ecc71' : 'none',
                        color: pluginInstallStates[plugin.id] === 'installed' ? '#2ecc71' : 'var(--bg-color)',
                        padding: '0.4rem 0.8rem', borderRadius: '4px',
                        cursor: pluginInstallStates[plugin.id] === 'installing' || pluginInstallStates[plugin.id] === 'installed' ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem', fontWeight: 'bold'
                      }}>
                      {pluginInstallStates[plugin.id] === 'installing' ? 'Installing... ⏳' : pluginInstallStates[plugin.id] === 'installed' ? 'Installed ✅' : plugin.action}
                    </button>
                  </div>
                ))}

                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', textAlign: 'center' }}>
                  <a href="https://marketplace.visualstudio.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    Explore External Ecosystem Marketplace
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


    </>
  );
}


const JSONPreview = ({ data, title, isString = false }) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <details style={{ marginBottom: '0.5rem', cursor: 'pointer' }} onToggle={(e) => setExpanded(e.target.open)}>
      <summary style={{ color: 'var(--accent-color)' }}>{title}</summary>
      {expanded && (
        <pre style={{ margin: '0.5rem 0', background: '#111', padding: '0.5rem', borderRadius: '4px', overflowX: 'auto', color: '#ccc', whiteSpace: isString ? 'pre-wrap' : 'pre', wordBreak: isString ? 'break-all' : 'normal' }}>
          {(() => {
            try {
              const str = isString ? data : JSON.stringify(data, null, 2);
              if (str && str.length > 50000) {
                return str.substring(0, 50000) + '\n... [TRUNCATED FOR PERFORMANCE]';
              }
              return str || String(data);
            } catch (e) {
              return `Error rendering trace: ${e.message}`;
            }
          })()}
        </pre>
      )}
    </details>
  );
};

export default App;
