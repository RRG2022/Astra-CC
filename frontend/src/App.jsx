import { useAgentSession } from './lib/useAgentSession.js';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkspaceStore } from './lib/stores/useWorkspaceStore';
import { useUIStore } from './lib/stores/useUIStore';
import { useFileStore } from './lib/stores/useFileStore';
import { useAgentStore } from './lib/stores/useAgentStore';
import { PERSONAS, TOOLS } from './lib/constants';
import { apiFetch } from './lib/api';

// Components
import SettingsModal from './components/SettingsModal';
import WorkspaceBrowser from './components/WorkspaceBrowser';
import MenuBar from './components/MenuBar';
import ActivityBar from './components/ActivityBar';
import LeftSidebar from './components/LeftSidebar';
import TerminalPane from './components/TerminalPane';
import ToastOverlay from './components/ToastOverlay';
import ChatHeader from './components/ChatHeader';
import EditorPanel from './components/EditorPanel';
import ChatSidebar from './components/ChatSidebar';

import './index.css';

function App() {
  // Zustand Store selectors
  const { workspacePath, fetchDir } = useWorkspaceStore();
  const { openFilesMain, setOpenFilesMain, activeFileIdMain, setActiveFileIdMain, openFilesSplit, setOpenFilesSplit, activeFileIdSplit, setActiveFileIdSplit, handleSaveFile, handleNewFile } = useFileStore();
  const { sidebarWidth, setSidebarWidth, leftSidebarWidth, isLeftSidebarOpen, showTerminalPane, setShowTerminalPane, activeTerminalTab, setActiveTerminalTab, shells, setShells, wordWrap, minimapEnabled, setToastNotification, setShowBrowser } = useUIStore();
  const { messages, setMessages, activeTool, setActiveTool, selectedModel, setSelectedModel, selectedPersona, setSelectedPersona, promptHistory, setPromptHistory, models, setModels, modelsLoaded, setModelsLoaded, traceLogs, setTraceLogs, activeTask, setActiveTask } = useAgentStore();

  // Local React state — only what App truly needs to own
  const [input, setInput] = useState(() => localStorage.getItem('astra_current_input') || '');
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [isLeftDragging, setIsLeftDragging] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempPrompt, setTempPrompt] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [authorityLevel] = useState(() => localStorage.getItem('astra_authority_level') || 'Supervised');
  const fileInputRef = useRef(null);
  const editorRefMain = useRef(null);
  const editorRefSplit = useRef(null);

  // --- Sidebar resizing ---
  const startRightResizing = useCallback(() => setIsRightDragging(true), []);
  const startLeftResizing = useCallback(() => setIsLeftDragging(true), []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isRightDragging) {
        const newWidth = document.body.clientWidth - e.clientX;
        if (newWidth > 300 && newWidth < 800) setSidebarWidth(newWidth);
      } else if (isLeftDragging) {
        const newWidth = e.clientX - 48;
        if (newWidth > 150 && newWidth < 600) useUIStore.getState().setLeftSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => { setIsRightDragging(false); setIsLeftDragging(false); };
    if (isRightDragging || isLeftDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isRightDragging, isLeftDragging]);

  // --- Editor refs ---
  const handleEditorMainMount = (editor) => { editorRefMain.current = editor; };
  const handleEditorSplitMount = (editor) => { editorRefSplit.current = editor; };

  const executeEditorAction = (actionId) => {
    if (activeFileIdSplit && editorRefSplit.current && editorRefSplit.current.hasTextFocus()) {
      editorRefSplit.current.trigger('keyboard', actionId, null);
    } else if (editorRefMain.current) {
      editorRefMain.current.trigger('keyboard', actionId, null);
    }
  };

  // --- Init effects ---
  useEffect(() => { fetchModels(); }, []);
  useEffect(() => {
    if (workspacePath) useAgentStore.getState().loadConversations(workspacePath);
  }, [workspacePath]);
  useEffect(() => { localStorage.setItem('astra_current_input', input); }, [input]);

  // --- Keyboard shortcuts ---
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

  // --- Handler functions ---
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
      reader.readAsText(file);
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
      if (!SpeechRecognition) { alert("Your browser does not support Speech Recognition."); return; }
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) { transcript += event.results[i][0].transcript; }
        setInput(prev => prev ? prev + ' ' + transcript : transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
      setIsListening(true);
    }
  };

  const regenerateLast = () => {
    if (messages.length === 0 || isGenerating) return;
    let lastUserIdx = messages.length - 1;
    while (lastUserIdx >= 0 && messages[lastUserIdx].role !== 'user') lastUserIdx--;
    if (lastUserIdx >= 0) {
      const userMessage = messages[lastUserIdx].content;
      const strippedMessage = userMessage.split('\n\n--- Attached File:')[0];
      const newMessages = messages.slice(0, lastUserIdx);
      setMessages(newMessages);
      handleSend(strippedMessage, newMessages);
    }
  };

  const handleEditMessage = (msgContent, index) => {
    if (isGenerating) return;
    const strippedMessage = msgContent.split('\n\n--- Attached File:')[0];
    setInput(strippedMessage);
    setMessages(messages.slice(0, index));
  };

  const handleRegenerateFrom = (index) => {
    if (isGenerating) return;
    const userMessage = messages[index].content;
    const strippedMessage = userMessage.split('\n\n--- Attached File:')[0];
    const newMessages = messages.slice(0, index);
    setMessages(newMessages);
    handleSend(strippedMessage, newMessages);
  };

  const handleCopy = (text) => { navigator.clipboard.writeText(text); };

  const handleRunActiveFile = async () => {
    if (!activeFileIdMain) return;
    await handleSaveFile(activeFileIdMain);
    let command = '';
    if (activeFileIdMain.endsWith('.js') || activeFileIdMain.endsWith('.jsx')) command = `node "${activeFileIdMain}"`;
    else if (activeFileIdMain.endsWith('.py')) command = `python "${activeFileIdMain}"`;
    else if (activeFileIdMain.endsWith('.ts')) command = `npx ts-node "${activeFileIdMain}"`;
    else { setToastNotification({ type: 'warning', message: 'No default runner for this file type' }); return; }
    try {
      const res = await apiFetch('/api/tools/terminal/run', {
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
      }
    } catch (err) {
      console.error(err);
      setToastNotification({ type: 'error', message: 'Failed to run file' });
    }
  };

  const handleNewTerminal = () => {
    const newId = `shell-${Date.now()}`;
    setShells([...shells, { id: newId }]);
    setActiveTerminalTab(newId);
    setShowTerminalPane(true);
  };

  const handleCloseTerminal = () => {
    if (activeTerminalTab.startsWith('shell-')) {
      const newShells = shells.filter(s => s.id !== activeTerminalTab);
      setShells(newShells);
      setActiveTerminalTab(newShells[0] ? newShells[0].id : 'problems');
    }
  };

  const handleBrowse = () => {
    const startPath = workspacePath || 'C:/';
    setShowBrowser(true);
  };

  const fetchModels = async () => {
    try {
      const res = await apiFetch('/api/models');
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

  // --- Agent session callbacks ---
  // Updates are addressed by message id, not array position: the server's
  // context includes a system turn the client's list does not, so any
  // index-based scheme is off by one the moment a session starts.
  const onMessageUpdate = useCallback((messageId, update) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;

      const msg = { ...prev[idx] };
      if (update.content !== undefined) msg.content = (msg.content || '') + update.content;
      if (update.content_replace !== undefined) msg.content = update.content_replace;
      if (update.error !== undefined) msg.error = update.error;
      if (update.tool_execution) {
        msg.tool_executions = [...(msg.tool_executions || []), update.tool_execution];
      }
      if (update.tool_execution_result) {
        msg.tool_executions = (msg.tool_executions || []).map(t =>
          t.id === update.tool_execution_result.id ? { ...t, ...update.tool_execution_result } : t
        );
      }

      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  const onTraceLog = useCallback((entry) => {
    setTraceLogs(prev => [entry, ...prev].slice(0, 100));
  }, []);

  const onToolExecuted = useCallback(async (name, argsObj, resultObj) => {
    if (name === 'read_file' && resultObj.success) {
      setOpenFilesMain(prev => {
        const exists = prev.find(f => f.name === argsObj.filePath);
        if (!exists) return [...prev, { name: argsObj.filePath, content: resultObj.content }];
        return prev.map(f => f.name === argsObj.filePath ? { ...f, content: resultObj.content } : f);
      });
      setActiveFileIdMain(argsObj.filePath);
    } else if (name === 'write_file' && resultObj.success) {
      setOpenFilesMain(prev => {
        const exists = prev.find(f => f.name === argsObj.filePath);
        if (!exists) return [...prev, { name: argsObj.filePath, content: argsObj.content }];
        return prev.map(f => f.name === argsObj.filePath ? { ...f, content: argsObj.content } : f);
      });
      setActiveFileIdMain(argsObj.filePath);
    } else if (name === 'edit_file' && resultObj.success) {
      const readRes = await apiFetch('/api/tools/fs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: argsObj.filePath, workspacePath })
      });
      const readData = await readRes.json();
      if (readData.success) {
        setOpenFilesMain(prev => {
          const exists = prev.find(f => f.name === argsObj.filePath);
          if (!exists) return [...prev, { name: argsObj.filePath, content: readData.content }];
          return prev.map(f => f.name === argsObj.filePath ? { ...f, content: readData.content } : f);
        });
        setActiveFileIdMain(argsObj.filePath);
      }
    } else if (name === 'run_command' && resultObj.taskId) {
      setActiveTask(resultObj.taskId);
      setShowTerminalPane(true);
      setActiveTerminalTab('task');
    }
  }, [workspacePath]);

  const runtime = useAgentSession({
    onMessageUpdate,
    onTraceLog,
    onToolExecuted,
    model: selectedModel,
    // Always offer the full tool set; the server probes the model's actual
    // capabilities and drops the schemas if it can't accept them.
    tools: TOOLS,
    workspacePath,
    authorityLevel,
    maxIterations: 10
  });

  const isGenerating = runtime.isStreaming || runtime.isExecutingTool;

  // --- Permission notification ---
  useEffect(() => {
    if (runtime.pendingApproval) {
      const toolName = runtime.pendingApproval.name || 'tool';
      setToastNotification({ title: 'Permission Required', message: `Astra wants to execute: ${toolName}`, timestamp: Date.now() });
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
  }, [runtime.pendingApproval]);


  const handleRewind = useCallback(async (filePath, checkpointSha) => {
    // User-initiated, so a plain confirm is the right gate — this never goes
    // through the agent's approval channel.
    if (!window.confirm(`Rewind ${filePath} to checkpoint ${checkpointSha.slice(0, 8)}?`)) return;
    try {
      const res = await apiFetch('/api/tools/fs/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, checkpointSha, workspacePath })
      });
      const data = await res.json();
      if (data.success) {
        onTraceLog(`Rewound ${filePath} to ${checkpointSha} (Recovery SHA: ${data.recoverySha})`);
      } else {
        onTraceLog(`Failed to rewind ${filePath}: ${data.error}`);
      }
    } catch (e) {
      onTraceLog(`Error during rewind: ${e.message}`);
    }
  }, [workspacePath, onTraceLog]);

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
      if (isListening) toggleListening();
    }

    if (attachments.length > 0) {
      const attachmentText = attachments.map(a => `\n--- Attached File: ${a.name} ---\n${a.content}\n--- End of ${a.name} ---\n`).join('');
      userText = `${userText}\n\n${attachmentText}`;
      setAttachments([]);
    }

    const currentMessages = overrideMessages !== null ? overrideMessages : messages;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: userText };
    const assistantMessageId = crypto.randomUUID();

    setMessages([
      ...currentMessages,
      userMessage,
      { id: assistantMessageId, role: 'assistant', content: '', tool_executions: [] }
    ]);

    try {
      let systemPrompt = PERSONAS[selectedPersona].prompt;
      if (workspacePath) systemPrompt += '\nYour active workspace is located at: ' + workspacePath;
      const currentContext = [
        { role: 'system', content: systemPrompt },
        ...currentMessages,
        userMessage
      ];
      await runtime.run(currentContext, assistantMessageId);
    } catch (err) {
      console.error('Chat error:', err);
      onMessageUpdate(assistantMessageId, { error: err.message || 'Error generating response.' });
    } finally {
      if (workspacePath) useAgentStore.getState().saveCurrentConversation(workspacePath);
    }
  };

  // --- Render ---
  return (
    <>
      <SettingsModal />
      <WorkspaceBrowser />

      <div className="app-container" onClick={(e) => { /* Menu dismissal handled inside MenuBar */ }}>
        <header style={{ display: 'flex', padding: 0, background: 'var(--surface-color)', overflow: 'visible', borderBottom: '1px solid var(--border-color)', position: 'relative', zIndex: 50 }}>
          <div style={{ flex: 1, padding: '0.25rem 1rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 16, height: 16, background: 'linear-gradient(135deg, #6366f1, #a855f7, #ec4899)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'white', fontWeight: 'bold', fontSize: '10px' }}>A</span>
              </div>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', letterSpacing: '1px' }}>Astra</span>
            </div>
            <MenuBar
              executeEditorAction={executeEditorAction}
              handleRunActiveFile={handleRunActiveFile}
              handleNewTerminal={handleNewTerminal}
              handleCloseTerminal={handleCloseTerminal}
            />
          </div>
          <div style={{ width: '5px' }}></div>
          <ChatHeader
            clearMemory={clearMemory}
            handleBrowse={handleBrowse}
            isGenerating={isGenerating}
            sidebarWidth={sidebarWidth}
          />
        </header>

        <div className="workspace-container">
          <ActivityBar />

          <LeftSidebar handleRewind={handleRewind} />

          {/* Left Resizer */}
          {isLeftSidebarOpen && (
            <div className={`resizer ${isLeftDragging ? 'active' : ''}`} onMouseDown={startLeftResizing} />
          )}

          {/* Central Area: Editor / Terminal */}
          <div className="central-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <EditorPanel
              openFilesMain={openFilesMain}
              setOpenFilesMain={setOpenFilesMain}
              activeFileIdMain={activeFileIdMain}
              setActiveFileIdMain={setActiveFileIdMain}
              openFilesSplit={openFilesSplit}
              setOpenFilesSplit={setOpenFilesSplit}
              activeFileIdSplit={activeFileIdSplit}
              setActiveFileIdSplit={setActiveFileIdSplit}
              minimapEnabled={minimapEnabled}
              wordWrap={wordWrap}
              handleEditorMainMount={handleEditorMainMount}
              handleEditorSplitMount={handleEditorSplitMount}
              activeTask={activeTask}
            />
            <TerminalPane />
          </div>

          {/* Right Resizer */}
          <div className={`resizer ${isRightDragging ? 'active' : ''}`} onMouseDown={startRightResizing} />

          <ChatSidebar
            sidebarWidth={sidebarWidth}
            messages={messages}
            handleRewind={handleRewind}
            activeTool={activeTool}
            pendingApproval={runtime.pendingApproval}
            onApprove={runtime.approve}
            onDeny={runtime.deny}
            agentError={runtime.error}
            attachments={attachments}
            removeAttachment={removeAttachment}
            PERSONAS={PERSONAS}
            selectedPersona={selectedPersona}
            input={input}
            setInput={setInput}
            promptHistory={promptHistory}
            historyIndex={historyIndex}
            setHistoryIndex={setHistoryIndex}
            tempPrompt={tempPrompt}
            setTempPrompt={setTempPrompt}
            fileInputRef={fileInputRef}
            handleFileChange={handleFileChange}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            modelsLoaded={modelsLoaded}
            models={models}
            toggleListening={toggleListening}
            isListening={isListening}
            isGenerating={isGenerating}
            stopGeneration={stopGeneration}
            handleSend={handleSend}
            handleEditMessage={handleEditMessage}
            handleRegenerateFrom={handleRegenerateFrom}
            handleCopy={handleCopy}
          />
        </div>
      </div>

      <ToastOverlay />
    </>
  );
}

export default App;
