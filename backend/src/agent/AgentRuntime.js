const { resolveToolCalls, anchorToolsForNextTurn, toWireToolCalls } = require('./toolProtocol.js');
const crypto = require('crypto');

class AgentRuntime {
  constructor(options) {
    this.options = {
      model: 'llama3.1',
      tools: [],
      workspacePath: '',
      authorityLevel: 'Supervised',
      maxIterations: 10,
      executeTool: async () => 'Not implemented',
      requestApproval: async () => false, // returns boolean
      onStateChange: () => {},
      onMessageUpdate: () => {},
      onTraceLog: () => {},
      onToolExecuted: () => {},
      ...options
    };

    this.state = {
      isStreaming: false,
      isExecutingTool: false,
      pendingApproval: null,
      stopReason: null,
      currentActionId: null,
      iterationCount: 0
    };

    this.abortController = null;
    this.agentMsgIndex = -1;
    this.context = [];
  }

  updateState(updates) {
    this.state = { ...this.state, ...updates };
    this.options.onStateChange(this.state);
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.updateState({ stopReason: 'cancelled' });
  }

  async streamOllama(apiMessages) {
    this.updateState({ isStreaming: true });
    this.abortController = new AbortController();

    const payload = {
      model: this.options.model,
      messages: apiMessages,
      ...(this.options.model.toLowerCase().includes('llama') || this.options.model.toLowerCase().includes('gpt') ? { tools: this.options.tools } : {}),
      stream: true
    };

    const traceEntry = {
      timestamp: Date.now(),
      model: this.options.model,
      requestPayload: payload,
      rawBuffer: '',
      parsedToolCalls: []
    };

    let response;
    try {
      response = await fetch('http://localhost:8789/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: this.abortController.signal
      });
    } catch (err) {
      this.updateState({ isStreaming: false, stopReason: 'network_error' });
      return null;
    }

    if (!response.ok) {
      this.updateState({ isStreaming: false, stopReason: 'http_error' });
      return null;
    }

    // Node.js or browser stream
    const reader = response.body.getReader ? response.body.getReader() : null;

    // We implement a robust NDJSON carry buffer
    let buffer = '';
    let fullContent = '';
    let nativeToolCalls = []; // Accumulate fragments correctly
    let partialNativeCall = null;

    const processChunk = (chunk) => {
      buffer += chunk;
      traceEntry.rawBuffer += chunk;

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            fullContent += parsed.message.content;
            this.options.onMessageUpdate(this.agentMsgIndex, { content: parsed.message.content });
          }

          // Handle streaming native tool calls
          if (parsed.message?.tool_calls) {
            // Some models stream fragments of arguments
            for (const call of parsed.message.tool_calls) {
              if (call.function.name) {
                // new call
                partialNativeCall = { function: { name: call.function.name, arguments: call.function.arguments || '' } };
                if (call.id) partialNativeCall.id = call.id;
                nativeToolCalls.push(partialNativeCall);
              } else if (call.function.arguments && partialNativeCall) {
                // append arguments
                partialNativeCall.function.arguments += call.function.arguments;
              }
            }
          }
        } catch (e) {
          // ignore invalid json from split lines
        }
      }
    };

    try {
      if (reader) {
        const decoder = new TextDecoder('utf-8');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          processChunk(decoder.decode(value, { stream: true }));
        }
      } else {
        // Node 18 native fetch iteration
        const decoder = new TextDecoder('utf-8');
        for await (const chunk of response.body) {
          processChunk(decoder.decode(chunk, { stream: true }));
        }
      }
      if (buffer.trim()) {
        try {
          processChunk('\n'); // Force newline to flush remaining buffer
        } catch(e) {}
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        this.updateState({ isStreaming: false, stopReason: 'cancelled' });
        return null;
      }
    }

    this.updateState({ isStreaming: false });

    // We do NOT use the old regex scraper. We use toolProtocol.js resolveToolCalls
    const allowFallback = (this.options.model || '').toLowerCase().includes('qwen');
    const { toolCalls: resolvedCalls, cleanedContent } = resolveToolCalls(nativeToolCalls, fullContent, allowFallback);

    traceEntry.parsedToolCalls = resolvedCalls;
    this.options.onTraceLog(traceEntry);

    // Only update content cleanly if we stripped protocol noise
    if (fullContent !== cleanedContent) {
      this.options.onMessageUpdate(this.agentMsgIndex, { content_replace: cleanedContent });
    }

    return resolvedCalls;
  }

  async run(initialContext, agentMsgIndex) {
    this.agentMsgIndex = agentMsgIndex;
    this.context = [...initialContext];
    this.updateState({ stopReason: null, iterationCount: 0 });
    
    // Clear sessionReadFiles per new tool loop run
    if (!this.sessionReadFiles) this.sessionReadFiles = new Map();
    this.sessionReadFiles.clear();

    while (this.state.iterationCount < this.options.maxIterations) {
      this.updateState({ iterationCount: this.state.iterationCount + 1 });

      if (this.state.stopReason === 'cancelled') break;

      const calls = await this.streamOllama(this.context);

      if (!calls || calls.length === 0) {
        this.updateState({ stopReason: 'complete' });
        break; // No more tools to call
      }

      if (this.state.stopReason === 'cancelled') break;

      // Append the assistant's tool call intent to context
      this.context.push({
        role: 'assistant',
        content: '',
        tool_calls: toWireToolCalls(calls)
      });

      this.updateState({ isExecutingTool: true });
      let actionIds = new Set();

      for (const call of calls) {
        if (this.state.stopReason === 'cancelled') break;

        const callId = call.id || crypto.randomUUID();
        // Deduplication guard
        if (actionIds.has(callId)) continue;
        actionIds.add(callId);

        this.updateState({ currentActionId: callId });
        this.options.onMessageUpdate(agentMsgIndex, {
          tool_execution: {
            id: callId,
            name: (call.function ? call.function.name : call.name),
            arguments: (call.function ? call.function.arguments : call.arguments),
            status: 'running',
            result: null
          }
        });

        // Permissions check
        const needsApproval = this.options.authorityLevel === 'Strict' ||
          (this.options.authorityLevel === 'Supervised' && ['write_file', 'run_command', 'edit_file', 'create_file', 'delete_file'].includes((call.function ? call.function.name : call.name)));

        const workspaceDependentTools = ['run_command', 'read_file', 'write_file', 'edit_file', 'create_file', 'delete_file', 'list_dir', 'grep_search'];

        let resultString = '';
        const toolName = (call.function ? call.function.name : call.name);
        const args = (call.function ? JSON.parse(call.function.arguments || '{}') : (typeof call.arguments === 'string' ? JSON.parse(call.arguments || '{}') : call.arguments));
        
        // Simple frontend path normalization (remove leading ./)
        const normalizedPath = args.filePath ? args.filePath.replace(/\\/g, '/').replace(/^\.\//, '') : '';
        
        if (workspaceDependentTools.includes(toolName) && !this.options.workspacePath) {
          resultString = 'Error: Active workspace is required for this action.';
        } else if (toolName === 'edit_file' && (!normalizedPath || !this.sessionReadFiles.has(normalizedPath))) {
          resultString = 'Error: You must read the file (or the relevant portion of it) using read_file before attempting to edit it. This is a strict safety invariant.';
        } else if (needsApproval) {
          this.updateState({ pendingApproval: call });
          const approvalResult = await this.options.requestApproval(call);
          this.updateState({ pendingApproval: null });

          let approved = false;
          let finalCall = call;
          if (typeof approvalResult === 'boolean') {
            approved = approvalResult;
          } else if (approvalResult && typeof approvalResult === 'object') {
            approved = approvalResult.approved;
            if (approvalResult.editedCall) {
              finalCall = approvalResult.editedCall;
            }
          }

          if (!approved) {
            resultString = 'Error: User explicitly denied permission to execute this tool.';
            this.updateState({ stopReason: 'denied' });
          } else {
            resultString = await this.options.executeTool(finalCall);
          }
        } else {
          resultString = await this.options.executeTool(call);
        }

        // Track successfully read files
        if (toolName === 'read_file' && resultString) {
          try {
            const parsed = JSON.parse(resultString);
            if (parsed.success && parsed.contentHash && normalizedPath) {
              this.sessionReadFiles.set(normalizedPath, parsed.contentHash);
            }
          } catch(e) {}
        }
        
        try {
          const parsedResult = JSON.parse(resultString);
          this.options.onToolExecuted(toolName, args, parsedResult);
        } catch(e) {}

        this.options.onMessageUpdate(agentMsgIndex, {
          tool_execution_result: {
            id: callId,
            status: 'completed',
            result: resultString
          }
        });

        this.context.push({
          role: 'tool',
          content: resultString,
          name: (call.function ? call.function.name : call.name)
        });

        if (this.state.stopReason === 'denied') break; // stop processing further tools in batch
      }

      this.updateState({ isExecutingTool: false, currentActionId: null });

      if (this.state.stopReason === 'denied') {
        break; // break the outer loop
      }

      this.context = anchorToolsForNextTurn(this.context);
    }

    if (this.state.iterationCount >= this.options.maxIterations) {
      this.updateState({ stopReason: 'max_iterations' });
    }
  }
}

module.exports = { AgentRuntime };
