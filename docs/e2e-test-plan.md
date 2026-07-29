# Astra IDE deep audit and E2E plan

## Current assessment

The frontend production build and backend JavaScript syntax check pass. There is no backend test suite and no Playwright configuration in the repository; the added browser suite therefore mocks the backend boundary and is independent of Ollama, PowerShell side effects, and a real workspace.

## Critical findings

- **P0 — agent execution can run forever.** `handleSend` has no maximum tool-round count, deadline, or duplicate-call guard around the `while` loop (`frontend/src/App.jsx:996-1065`). A model that keeps returning a tool call can keep the browser and backend busy indefinitely. Add a hard cap and surface a recoverable error.
- **P0 — permission waits cannot be cancelled.** The loop awaits a Promise stored in `pendingTool` (`frontend/src/App.jsx:1031-1039`). `stopGeneration` aborts only the fetch and clears UI flags; it does not reject that Promise (`frontend/src/App.jsx:793-800`). Stopping while approval is open leaves the loop suspended and approval can later execute a command from an apparently stopped generation.
- **P0 — filesystem and terminal boundaries are bypassable.** `fs/read`, `fs/write`, `fs/list`, and `fs/grep` resolve paths without enforcing that the result remains beneath the workspace. Terminal containment uses a string prefix (`startsWith`), so a workspace such as `C:\work` can match `C:\work-other` (`backend/index.js:417-425`, `backend/index.js:267-305`, `backend/index.js:620-628`). Require a workspace and compare `path.relative` segments.
- **P0 — arbitrary plugin module execution is exposed.** `/api/plugins/execute` builds a path directly from `pluginName` and `require`s it (`backend/index.js:32-47`). `..` segments can escape `plugins`; an unauthenticated request can execute server-side JavaScript. Restrict names to an allow-list or a basename regex and load only registered modules.
- **P1 — concurrent sends corrupt message state.** `setMessages([...currentMessages, userMessage])` uses a render-time snapshot, while every stream updates a shared message by numeric `agentMsgIndex` (`frontend/src/App.jsx:971-979`, `frontend/src/App.jsx:912-918`). Two sends, or a send racing regenerate, can overwrite messages or append output to the wrong assistant.
- **P1 — tool-call stream parsing drops valid data.** Each network chunk is split and incomplete JSON is discarded (`frontend/src/App.jsx:899-927`). JSON lines split across chunks are never reassembled, so content and tool calls can silently disappear.
- **P1 — no response/body validation.** `streamOllama` calls `response.body.getReader()` without checking `response.ok` or a non-null body (`frontend/src/App.jsx:881-895`). A proxy 500, HTML error, or connection close can throw a secondary TypeError and leave partially rendered state.
- **P1 — `stopGeneration` does not cancel active tools.** The signal is passed only to `/api/chat`; `executeTool` uses independent fetches (`frontend/src/App.jsx:802-879`). A stopped generation can still finish a write or command and then append a tool result.
- **P1 — tool execution and background task ownership are not bounded.** `activeTasks` keeps every child and its complete output forever (`backend/index.js:414-415`, `backend/index.js:449-469`). Long output is appended without a limit, completed tasks are never deleted, and only one global `activeTask` is shown by the UI even though several agent calls can background concurrently.
- **P1 — kill reports success even when it failed.** `spawnSync('taskkill', ...)` is synchronous, its status and stderr are ignored, and fallback to `child.kill()` happens only when it throws (`backend/index.js:484-496`). A permission denial or already-exited PID still returns `{success:true}`.
- **P1 — another unhandled spawn error remains.** `/api/models/pull` starts `ollama` detached without an `error` listener (`backend/index.js:167-172`). `ENOENT` can still terminate the Node process despite the terminal route having an error handler.
- **P1 — PTY lifecycle has gaps.** The frontend closes the WebSocket on normal unmount (`InteractiveTerminal.jsx:62-67`), but the backend has no WebSocket `error` handler, no PTY exit handler, no server-shutdown cleanup, and no connection limit (`backend/index.js:721-759`). Invalid cwd or a PTY failure can leave an open socket or an unhandled event.
- **P2 — polling can overlap.** `LiveTerminal` starts a new `fetch` every second without preventing an earlier request from overlapping (`frontend/src/components/LiveTerminal.jsx:41-64`). A slow backend can produce concurrent polls and duplicated output writes. The polling loop also continues after Kill Task, and there is no explicit killed/completed status in the rendered block.
- **P2 — streaming render cost grows with every token.** Every content fragment clones the whole `messages` array and reparses all Markdown; thought blocks are converted with global replacements and code blocks use a syntax highlighter (`frontend/src/App.jsx:910-918`, `frontend/src/App.jsx:1801-1826`). Large responses cause repeated full-document work and can make input janky.
- **P2 — localStorage is an unbounded synchronous persistence sink.** The whole message history is serialized on every message/input effect (`frontend/src/App.jsx:366-370`). Large tool output can hit quota or block the main thread; the write is not protected by `try/catch`.
- **P2 — AudioContext instances are not closed.** Each permission prompt creates a new `AudioContext` and never closes it (`frontend/src/App.jsx:381-398`). Repeated approvals can consume browser audio resources.

## Refactor snippets

### App.jsx: reducer, request ref, cancellation, and loop guard

Use stable message IDs instead of array indexes and keep the controller and pending permission resolver in refs. This is illustrative code to adapt to the existing UI actions.

```jsx
const MAX_TOOL_ROUNDS = 32;
const generationRef = useRef(null);
const pendingPermissionRef = useRef(null);

const [messages, dispatch] = useReducer(messagesReducer, [], loadMessages);

function messagesReducer(state, action) {
  switch (action.type) {
    case 'append': return [...state, action.message];
    case 'appendContent':
      return state.map(message => message.id === action.id
        ? { ...message, content: message.content + action.content }
        : message);
    case 'toolStatus':
      return state.map(message => message.id === action.messageId
        ? { ...message, tool_executions: message.tool_executions.map(tool =>
            tool.id === action.toolId ? { ...tool, ...action.patch } : tool) }
        : message);
    default: return state;
  }
}

async function handleSend(text) {
  if (generationRef.current) return;
  const controller = new AbortController();
  const assistantId = crypto.randomUUID();
  generationRef.current = { controller, assistantId, rounds: 0 };
  dispatch({ type: 'append', message: { id: assistantId, role: 'assistant', content: '', tool_executions: [] } });

  try {
    let toolCalls = await streamOllama(context, assistantId, controller.signal);
    while (toolCalls.length) {
      if (++generationRef.current.rounds > MAX_TOOL_ROUNDS) {
        throw new Error(`Agent stopped after ${MAX_TOOL_ROUNDS} tool rounds`);
      }
      for (const call of toolCalls) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const approved = await requestPermission(call, controller.signal);
        if (!approved) throw new Error('Tool permission denied');
        const result = await executeTool(call, controller.signal);
        context.push({ role: 'tool', content: result, name: call.function.name });
      }
      toolCalls = await streamOllama(context, assistantId, controller.signal);
    }
  } finally {
    if (generationRef.current?.controller === controller) generationRef.current = null;
  }
}

function requestPermission(call, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { pendingPermissionRef.current = null; reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    pendingPermissionRef.current = { call, resolve: value => { signal.removeEventListener('abort', abort); resolve(value); } };
    setPendingTool(pendingPermissionRef.current);
  });
}

function stopGeneration() {
  pendingPermissionRef.current?.resolve(false);
  pendingPermissionRef.current = null;
  generationRef.current?.controller.abort();
}
```

`streamOllama` should also maintain a carry buffer between reads, check `response.ok`, and reject when `response.body` is absent. Persist messages with a debounced effect and a size cap.

### index.js: safe workspace resolution and owned child lifecycle

```js
function resolveInsideWorkspace(workspacePath, requested = '.') {
  if (!workspacePath) throw new Error('workspacePath is required');
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, requested);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error('Path is outside workspace');
    error.statusCode = 403;
    throw error;
  }
  return target;
}

function runTerminal({ command, workspacePath, cwd }, res) {
  const executionDir = resolveInsideWorkspace(workspacePath, cwd || '.');
  const taskId = crypto.randomUUID();
  const child = spawn(POWERSHELL_PATH, ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: executionDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const task = { child, output: '', done: false, timer: null };
  activeTasks.set(taskId, task);
  const append = chunk => {
    task.output = (task.output + chunk.toString()).slice(-1_000_000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', error => {
    append(`\nProcess error: ${error.message}\n`);
    finish(1);
  });
  child.once('close', code => finish(code));

  function finish(code) {
    if (task.done) return;
    task.done = true;
    clearTimeout(task.timer);
    if (!res.headersSent) res.json({ success: code === 0, stdout: task.output.trim(), taskId: null });
    setTimeout(() => activeTasks.delete(taskId), 60_000);
  }

  task.timer = setTimeout(() => {
    if (!task.done && !res.headersSent) res.json({ success: true, taskId, stdout: task.output.trim() });
  }, 5_000);
}

function killTerminal(taskId) {
  const task = activeTasks.get(taskId);
  if (!task) return { status: 404, body: { success: false, error: 'Task not found' } };
  const result = process.platform === 'win32'
    ? spawnSync('taskkill', ['/PID', String(task.child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
    : task.child.kill('SIGTERM');
  if (result && result.status !== 0) {
    return { status: 409, body: { success: false, error: result.stderr || 'Unable to kill task' } };
  }
  task.output += '\n[Task killed by user]';
  return { status: 200, body: { success: true } };
}
```

Use a `Map`, validate every filesystem endpoint with the same resolver, attach `error` listeners to every spawned process, and close/kill all tracked children and PTYs during server shutdown.

## Complete Playwright E2E matrix

All tests should start from a clean browser context and a disposable workspace fixture. Every test must assert both user-visible state and the relevant network contract, including method, request body, status, and error behavior. The high-risk executable subset is in `frontend/e2e`.

### Core editor and workspace

- [ ] Set a valid workspace; reload; verify the path persists in `localStorage` and the explorer requests `/api/fs/list`.
- [ ] Set an invalid, inaccessible, empty, and path-with-spaces workspace; verify a non-crashing error state.
- [ ] Expand a directory; verify directories sort before files and nested navigation works.
- [ ] Open a text file; verify `/api/tools/fs/read`, Monaco content, language mode, active tab, and active-tab styling.
- [ ] Open the same file twice; verify only one tab is created.
- [ ] Open a file in split view; verify the main and split tab sets remain independent and both active-file selections are correct.
- [ ] Edit content; verify the unsaved marker appears, editor changes are retained across tab switches, and Monaco is not accidentally read-only.
- [ ] File > New File creates unique `Untitled-N` tabs; edit and save it; verify directory creation and `/api/tools/fs/write` payload.
- [ ] File > Save with no active file is a no-op; with a dirty file it shows the success toast and clears the marker.
- [ ] Press Ctrl+S on Windows and Meta+S on macOS; verify the same write request and preventDefault behavior.
- [ ] Close the active and inactive tabs; verify the next active tab is selected correctly, including last-tab and split-pane cases.
- [ ] Toggle View > Word Wrap, View > Minimap, and View > Terminal Panel; verify the corresponding editor/panel state.
- [ ] Exercise Edit > Undo/Redo/Cut/Copy/Paste/Find/Replace and Go > line/symbol/definition/reference actions with Monaco focused.
- [ ] Run > Run Active File for JS/JSX, Python, and TypeScript; verify auto-save, command selection, task behavior, and unsupported-extension warning.
- [ ] Run linter from Problems; verify loading, empty results, parsed diagnostics, and malformed backend response behavior.

### Header, navigation, and persistence

- [ ] Verify model fetch occurs on mount, loading/empty/error states render, a preferred Qwen model is selected when present, and switching models changes `/api/chat` payload.
- [ ] Switch Repo Builder/App Admin personas; verify prompt placeholder and system behavior change.
- [ ] Use Clear; verify confirmation, disabled state while generating, message removal, and `astra_memory` deletion.
- [ ] Verify prompt history saves, deduplicates, caps at 50 entries, and ArrowUp/ArrowDown restores the temporary draft.
- [ ] Verify input draft, workspace, tool settings, authority level, and search/orchestration histories survive reload.
- [ ] Open Settings > Preferences; verify GET/POST `/api/settings`, save toast, cancel, and malformed settings handling.
- [ ] Exercise Settings theme/shortcuts informational toasts and Help Welcome/Documentation/About toasts.
- [ ] Resize both sidebars; verify bounds, mouseup cleanup, and no resize listener remains after unmount.

### Chat and agent loop

- [ ] Send with the button and Enter; verify the user message is rendered once, persisted, and included in the chat request.
- [ ] Send whitespace-only input with and without attachments; verify button disabled/no request and attachment-only send behavior.
- [ ] Attach multiple text files; verify contents are included once, chips render, individual removal works, and file input resets.
- [ ] Use ArrowUp/ArrowDown prompt history while a draft exists; verify ordering and draft restoration.
- [ ] Mock incremental NDJSON content; verify all chunks render in order, including JSON split across network chunks.
- [ ] Return HTTP 4xx/5xx, an empty body, malformed JSON, and a dropped connection; verify the composer unlocks and a useful error appears.
- [ ] Click Stop Generation during content streaming; verify the fetch is aborted, no tool executes afterward, state unlocks, and no unhandled page error occurs.
- [ ] Return a raw fenced/raw JSON tool call; verify fallback parsing executes exactly once and does not expose malformed JSON as a tool.
- [ ] Return repeated tool calls beyond the safety cap; verify the loop terminates with a visible error.
- [ ] Start two rapid sends and regenerate/edit while generating; verify requests are serialized or explicitly rejected and message IDs keep output isolated.
- [ ] Verify `<think>...</think>` and split think tags render as a Thought Process block, are not executed as Markdown HTML, and preserve final content.
- [ ] Verify large Markdown/code responses remain responsive and do not duplicate syntax-highlighted output.
- [ ] Verify Copy, Edit Prompt, Regenerate from here, Clear, and attachment interactions.

### Tool visibility, backgrounding, and terminal lifecycle

- [ ] For every tool, verify a Running block appears before the tool request resolves, arguments are visible, completion result is shown, and unknown tools produce an error.
- [ ] Verify `read_file`, `write_file`, `list_dir`, `grep_search`, and `run_command` request schemas and workspace propagation.
- [ ] Run a command completing below 5 seconds; verify inline result and no task ID.
- [ ] Run at 4.99s, exactly 5s, and above 5s; verify one response only and deterministic foreground/background classification.
- [ ] Run `Start-Sleep 6`; verify task ID, LiveTerminal mount, periodic stream polling, incremental output, and background completion.
- [ ] Click Kill Task; verify `/kill/:taskId`, process termination, error/permission-denial reporting, stopped polling, and an explicit killed state.
- [ ] Unmount a LiveTerminal while a poll is pending; verify no state update, duplicate output, or console error.
- [ ] Open New Terminal and Split Terminal; verify each shell has a unique tab, PTY connection, input/output, resize, and close cleanup.
- [ ] Force WebSocket error, PTY exit, invalid cwd, and server disconnect; verify the UI reports failure and reconnect/close behavior is bounded.
- [ ] Verify Output SSE appends logs, removes disconnected clients, and handles slow/closed clients.

### Permission modes

- [ ] Strict: `read_file`, `list_dir`, `grep_search`, `write_file`, and `run_command` all block; Reject appends a denial result and resumes to a final model response; Approve executes once.
- [ ] Supervised: read-only tools bypass; write/command tools block; changing the selector during a generation has a defined policy for an already pending request.
- [ ] Autonomous: all supported tools execute without overlay.
- [ ] Stop while approval is open; verify the pending resolver is rejected, the command is not executed, the overlay disappears, and later model output is ignored.
- [ ] Reload or navigate away while approval is open; verify no orphaned promise or command is executed.

### Plugins, search, orchestration, and resilience

- [ ] Search workspace, filename/content match, no results, 150-result cap, search history navigation, and clicking a result to open a file.
- [ ] Toggle File System enabled/disabled; verify explorer messaging and persistence.
- [ ] Configure Web Search; verify modal cancel/save and field validation.
- [ ] Open plugin installer; verify marketplace fetch, plugin list, normal install delay, Ollama pull progress, failure, and missing executable behavior.
- [ ] Attempt plugin names containing `..`, path separators, invalid characters, and unknown IDs; verify rejection and no module escape.
- [ ] Start orchestration, empty task, slow response, malformed response, logs, history, and disabled duplicate submissions.
- [ ] Verify backend health, settings, models fallback when Ollama is unavailable, CORS policy, oversized request handling, and graceful server shutdown.

## How to run

```powershell
cd frontend
npm run test:e2e
npx playwright test e2e/agent-loop.spec.js e2e/backgrounding.spec.js e2e/permissions.spec.js
```

The suite uses browser-side route mocks for `localhost:8789`; add a separate backend integration job with a disposable workspace and a fake Ollama HTTP server before enabling real process/PTY coverage in CI.
