import React, { useRef, useEffect, useState } from 'react';
import { Send, Paperclip, Mic, MicOff, Copy, Edit2, RefreshCw, AlertTriangle, Check, X, Brain } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ToolExecution from './ToolExecution';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { useAgentStore } from '../lib/stores/useAgentStore';

const ChatSidebar = ({
  sidebarWidth,
  messages,
  handleRewind,
  activeTool,
  pendingApproval,
  onApprove,
  onDeny,
  agentError,
  attachments,
  removeAttachment,
  PERSONAS,
  selectedPersona,
  input,
  setInput,
  promptHistory,
  historyIndex,
  setHistoryIndex,
  tempPrompt,
  setTempPrompt,
  fileInputRef,
  handleFileChange,
  selectedModel,
  setSelectedModel,
  modelsLoaded,
  models,
  toggleListening,
  isListening,
  isGenerating,
  stopGeneration,
  handleSend,
  handleEditMessage,
  handleRegenerateFrom,
  handleCopy
}) => {
  const messagesEndRef = useRef(null);

  const { workspacePath } = useWorkspaceStore();
  const { conversations, conversationId, startNewConversation, loadConversationDetail } = useAgentStore();

  const [editedCommand, setEditedCommand] = useState('');

  useEffect(() => {
    if (pendingApproval && pendingApproval.name === 'run_command') {
      setEditedCommand(pendingApproval.arguments?.command || '');
    } else {
      setEditedCommand('');
    }
  }, [pendingApproval]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool, pendingApproval]);

  return (
    <div className="chat-sidebar" style={{ width: sidebarWidth }}>
      {/* Top Header for Conversation History & New Chat */}
      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <Brain size={18} style={{ color: 'var(--text-primary)' }} />
          <select
            value={conversationId || 'new'}
            onChange={(e) => {
              if (e.target.value === 'new') {
                startNewConversation();
              } else {
                loadConversationDetail(e.target.value, workspacePath);
              }
            }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer', outline: 'none', maxWidth: '180px', textOverflow: 'ellipsis' }}
          >
            <option value="new">+ New Chat</option>
            {conversations.map(c => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={startNewConversation}
          title="New Conversation"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
        >
          <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>+</span>
        </button>
      </div>

      <div className="messages" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
            How can I help you today?
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role === 'user' ? 'user' : 'agent'}`}>
            <MarkdownRenderer content={msg.content} />
            {msg.tool_executions && msg.tool_executions.map((t, i) => (
              <ToolExecution key={i} tool={t} onRewind={handleRewind} />
            ))}
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
        {pendingApproval && (
          <div style={{ background: '#2c2c2c', border: '1px solid #d35400', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e67e22', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              <AlertTriangle size={18} /> Permission Required
            </div>
            <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Astra wants to execute: <strong>{pendingApproval.name}</strong>
            </p>
            {(() => {
              const args = pendingApproval.arguments || {};

              if (pendingApproval.name === 'edit_file') {
                return (
                  <div style={{ margin: '0 0 1rem 0', border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ background: '#333', color: '#ccc', padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>{args.filePath}</div>
                    <pre style={{ background: '#3a1d1d', color: '#f8c2c2', padding: '0.5rem', margin: 0, overflowX: 'auto', fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ opacity: 0.5 }}>- </span>{args.oldString}
                    </pre>
                    <pre style={{ background: '#1d3a23', color: '#c2f8cb', padding: '0.5rem', margin: 0, overflowX: 'auto', fontSize: '0.8rem' }}>
                      <span style={{ opacity: 0.5 }}>+ </span>{args.newString}
                    </pre>
                  </div>
                );
              }

              if (pendingApproval.name === 'run_command') {
                return (
                  <div style={{ margin: '0 0 1rem 0' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Command to execute:</label>
                    <input
                      type="text"
                      value={editedCommand}
                      onChange={(e) => setEditedCommand(e.target.value)}
                      style={{
                        width: '100%',
                        background: '#1e1e1e',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        padding: '0.5rem',
                        color: '#d4d4d4',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                );
              }

              return (
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '0.5rem', borderRadius: '4px', overflowX: 'auto', fontSize: '0.8rem', margin: '0 0 1rem 0', border: '1px solid var(--border-color)' }}>
                  {JSON.stringify(args, null, 2)}
                </pre>
              );
            })()}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onDeny(pendingApproval.id)}
                style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <X size={14} /> Reject
              </button>
              <button
                onClick={() => {
                  // Only run_command is editable; everything else is approved as-is.
                  const editedCall = pendingApproval.name === 'run_command'
                    ? { name: 'run_command', arguments: { ...pendingApproval.arguments, command: editedCommand } }
                    : null;
                  onApprove(pendingApproval.id, editedCall);
                }}
                style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <Check size={14} /> Approve
              </button>
            </div>
          </div>
        )}

        {agentError && !pendingApproval && (
          <div style={{ background: '#3a1d1d', border: '1px solid #a33', borderRadius: '8px', padding: '0.75rem 1rem', marginTop: '1rem', color: '#f8c2c2', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={16} /> {agentError}
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
  );
};

export default ChatSidebar;
