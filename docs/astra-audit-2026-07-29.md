# Astra — Full Repository Audit

**Date:** 2026-07-29 · **Commit:** `46ba447` (+ uncommitted work in `backend/index.js`, `frontend/src/App.jsx`)
**Scope:** agent correctness, architecture, security, reliability, repo hygiene, product roadmap.

This supersedes and extends `docs/e2e-test-plan.md`, which covered loop/lifecycle bugs but did not
diagnose the hallucination behaviour itself.

---

## 0. Executive summary

Astra is a working local-first agentic IDE — Ollama chat, native FS/terminal tools, PTY terminals,
Monaco, inline tool logs, a permission gate. The skeleton is sound. Four things are wrong at a level
that caps how good it can get:

1. **The agent executes the model's prose, not its tool calls.** A regex scrapes any JSON-shaped text
   out of the assistant's *visible message* and runs it. This is the direct cause of the "I said hi
   and it ran `echo 'Hello, World!'` twice" behaviour in the screenshots. It is not the model
   hallucinating a tool call — it's Astra executing the model's *description* of one.
2. **No context-window management.** Ollama is called without `options`, so it silently runs at the
   default `num_ctx` (4096) regardless of what the model supports, at `temperature 0.8`. One
   `read_file` on a medium file evicts the system prompt and the user's task from the window. From
   that point every response is confabulation.
3. **The backend is an unauthenticated remote-code-execution service on `0.0.0.0` with
   `Access-Control-Allow-Origin: *`.** Verified live. Any web page the user visits can run PowerShell
   on this machine and read the stored API keys. The permission dialog is client-side only.
4. **The agent loop lives in the browser.** No server-side agent means no resumability, no headless
   runs, no audit log, no concurrency, and a closed tab kills an agent mid-`write_file`.

Two bugs were confirmed by probing the running backend, not just by reading code:

- `POST /api/problems` → **HTTP 500**, `TypeError: Cannot destructure property 'workspace' of 'req.body'`.
  `express.json()` is registered at `backend/index.js:123`, *after* the routes at lines 35 and 89.
  The Problems panel and `/api/plugins/execute` are dead.
- `GET /api/settings` with `Origin: https://evil.example.com` → **200** with
  `Access-Control-Allow-Origin: *` and the API-key payload.

---

## 1. Why the agent hallucinates

Ranked by contribution to the observed behaviour.

### 1.1 P0 — The fallback parser executes prose (`frontend/src/App.jsx:930-942`)

```js
if (toolCalls.length === 0 && fullContent.includes('"name"') && fullContent.includes('"arguments"')) {
  const toolCallRegex = /\{[\s]*"name"[\s]*:[\s]*"[^"]+"[\s]*,[\s]*"arguments"[\s]*:[\s]*\{[\s\S]*?\}[\s]*\}/g;
  ...
  toolCalls.push({ function: parsedTool });
}
```

`fullContent` is the assistant's rendered message text. Every JSON object in it that happens to have
`name` and `arguments` keys becomes an executed tool call. Consequences:

- **Duplicate execution.** In screenshot 1 the model printed the call once pretty-printed and once
  inside a ``` fence. Two regex matches → two `run_command` executions → the two "Executed
  run_command" rows. Nothing dedupes on `(name, arguments)`.
- **Explanations become actions.** When the user asked *"i simply said hi, why are you running
  commands"*, the model answered by quoting the call it had made. The quote was scraped and
  re-executed. **The app converts self-explanation into side effects** — an unrecoverable feedback
  loop from the user's point of view.
- **Fenced code blocks are live.** Ask the model "show me what a `run_command` call looks like" and
  it runs it. Documentation, examples, and denial explanations are all executable.
- **The regex is wrong even when the intent is right.** `\{[\s\S]*?\}` is non-greedy, so it stops at
  the *first* `}`. Any nested object or a `}` inside a string value (extremely common in
  `write_file` content) truncates the match and either fails to parse or silently executes a
  half-argument call.
- **Prompt-injection surface.** A `README.md` read into context that contains
  `{"name":"run_command","arguments":{"command":"..."}}` gets executed on the next turn. Untrusted
  file content is currently executable.

**This path is also the *only* tool path for models Ollama reports as not supporting tools.**
`backend/index.js:257-281` catches `does not support tools`, strips tool messages, and retries
without them — but the frontend keeps looping and the regex scraper becomes the sole mechanism. For
those models Astra is *permanently* in prose-execution mode.

**Fix:** delete the scraper, or gate it hard:
- only run it when the model is on a known no-native-tools allowlist;
- require the JSON to be the *entire* trimmed message, or inside a fence explicitly tagged
  ` ```tool_call `;
- use a brace-matching parser, not a regex;
- dedupe by `(name, JSON.stringify(args))` within a turn;
- **strip the scraped JSON out of the rendered content** so it can never be re-scraped or re-quoted;
- never scrape content that originated from a `tool` role message.

### 1.2 P0 — The model never sees what it said (`frontend/src/App.jsx:1019-1023`)

```js
currentContext.push({ role: 'assistant', content: '', tool_calls: toolCalls });
```

`content` is hardcoded empty even though `fullContent` holds real text. The model's own reasoning is
erased from history every round. So next round it has no memory of having emitted the call, re-emits
it verbatim, the scraper fires again, and it re-executes — up to the 15-iteration cap. This is the
engine behind repeated identical `echo` calls.

**Fix:** `content: fullContent` (with tool-call JSON stripped). Return `fullContent` from
`streamOllama` alongside the calls.

### 1.3 P0 — No context-window or sampling control (`backend/index.js:231`)

```js
const payload = { model, messages, stream, tools: useTools ? tools : undefined };
```

No `options`. Ollama therefore uses `num_ctx: 4096` and `temperature: 0.8` — regardless of the fact
that `qwen2.5-coder:14b` supports 32k. The budget before the user types a word:

| Item | ≈ tokens |
|---|---|
| Persona system prompt | 180 |
| 5 tool JSON schemas | 450 |
| **Remaining for the entire session** | **~3400** |

One `read_file` on a 400-line source file (~5k tokens) exceeds the window on its own. Ollama silently
drops the oldest messages — **the system prompt and the original task go first**. The model retains a
vague sense of "I am an agent with tools" but not what it was asked to do, so it invents plausible
next actions: files that don't exist, commands nobody asked for, work it claims to have finished.
This is the classic signature of "the agent was fine for 5 turns then went off the rails," and it
will keep happening until `num_ctx` is set and history is budgeted.

**Fix:**

```js
options: {
  num_ctx: 16384,        // per-model, from /api/show model_info
  temperature: 0.1,      // 0.8 is far too high for tool arguments
  top_p: 0.9,
  repeat_penalty: 1.05
},
keep_alive: '30m'
```

Plus client-side budgeting: count tokens, truncate/summarise oldest turns, cap any single tool result
(`read_file` on a 1MB file currently goes into context whole).

### 1.4 P0 — The persona prompt orders the model to act on everything (`frontend/src/App.jsx:28`)

> "You must act autonomously… **NEVER** ask the user to run commands. **YOU MUST** use the
> `run_command` tool yourself… **Do not ask for permission to use tools, just execute them
> immediately.**"

There is no conversational escape hatch. A 14B model reads this as an unconditional instruction: for
*any* input, emit a tool call. Given "hi", `echo 'Hello, World!'` is the model correctly following
its instructions. Astra told it to.

**Fix:** add an explicit gate, e.g.

> If the user is greeting you, asking a question, or chatting, reply in plain prose and call **no**
> tools. Only use tools when the request requires reading, changing, or running something in the
> workspace. Never print a tool call as text — either call the tool or don't.

Also: consider not sending `tools` at all when no workspace is set (`workspacePath` is empty in both
screenshots — the agent had no workspace and still tried to run commands).

### 1.5 P1 — Streaming JSON is dropped at chunk boundaries (`frontend/src/App.jsx:899-928`)

```js
const chunk = decoder.decode(value, { stream: true });
const lines = chunk.split('\n').filter(l => l.trim() !== '');
for (const line of lines) { try { JSON.parse(line) } catch (e) { /* Ignore */ } }
```

NDJSON lines routinely straddle TCP chunks. There is no carry buffer, so a split line is silently
discarded. A dropped content line = mangled text; a dropped `tool_calls` line = **a real tool call
vanishes**, and then the prose scraper is what fires instead. Non-deterministic and maddening to
debug.

Also `toolCalls = parsed.message.tool_calls` **overwrites** rather than accumulates — with multiple
tool calls streamed across lines, only the last survives.

**Fix:** keep a `buffer` across reads, split on `\n`, retain the trailing partial; accumulate tool
calls into an array; flush the buffer on `done`.

### 1.6 P1 — Tool arguments are not validated or coerced (`frontend/src/App.jsx:802-879`)

`{ ...argsObj, workspacePath }` assumes `argsObj` is an object. Ollama frequently returns
`arguments` as a **JSON string**; spreading a string yields `{0:'{', 1:'"', …}` and the backend gets
a nonsense body — no error, just a wrong result the model then reasons from.

No schema validation either: a `write_file` with a missing `content` 400s, and the raw error goes
back to the model with no repair hint. There's no "your arguments were invalid, here is the schema,
try again" turn — the model just guesses again.

**Fix:** `typeof argsObj === 'string' ? JSON.parse(argsObj) : argsObj`, then validate against the
declared JSON Schema (ajv or hand-rolled), and on failure return a structured repair message.

### 1.7 P1 — Tool results have no call correlation

`currentContext.push({ role: 'tool', content: resultString, name: call.function.name })` — no
`tool_call_id`. With two parallel calls to the same tool the model cannot tell which result is which.
Also `{ function: parsedTool }` from the scraper has no `id` at all.

### 1.8 P2 — Denial doesn't stop the loop (`frontend/src/App.jsx:1063-1067`)

Rejecting a tool feeds back *"You must explain why you wanted to run this"* and the loop continues.
The model explains — in JSON — and 1.1 executes it. **Rejecting a command can cause it to run.** This
is the most user-hostile bug in the file.

**Fix:** on denial, break the loop, mark the turn ended, and let the user reply.

### 1.9 P2 — Raw tool JSON is rendered into the chat

Because `fullContent` is streamed straight into the message body, the user sees the raw
`{"name": "run_command", ...}` blob (visible in both screenshots). Tool calls should render as the
`ToolExecution` card only, never as message text.

---

## 2. Architecture gaps

### 2.1 The agent loop runs in the browser

`handleSend` (`App.jsx:947-1111`) *is* the agent. Consequences:

- Closing the tab or an HMR reload kills a running agent, potentially mid-`write_file`.
- No headless/CI/scheduled runs.
- No shared state — two tabs are two agents fighting over the same workspace.
- **The permission gate is decorative.** The backend executes whatever it's asked; approval never
  reaches it. Anything that can talk to port 8789 bypasses it entirely (§3).
- No server-side transcript, so no audit trail of what the agent did to the filesystem.
- No resumability, no queueing, no backpressure.

**Target:** move the loop to the backend as a session service (`POST /api/sessions`,
`POST /api/sessions/:id/messages`, SSE for events, `POST /api/sessions/:id/approvals/:toolCallId`).
The browser becomes a viewer. This one change unlocks resumability, headless mode, audit logging,
multi-client, and a *real* permission gate.

### 2.2 There is no edit tool — only whole-file overwrite

`write_file` is the only mutation. To change one line of a 2000-line file the model must regenerate
all 2000 lines. It won't; it will drop code, collapse functions to `// ... rest unchanged`, and
silently destroy work. **This is a top-3 driver of perceived hallucination** and there is no undo.

Missing, in priority order:

- `edit_file(filePath, oldString, newString)` — exact-match replace, error if not unique.
- `read_file(filePath, offset, limit)` — line ranges, so big files don't need to enter context whole.
- A **read-before-write invariant**: refuse `edit_file` on a file the agent hasn't read this session.
- Checkpointing: shadow-git commit before every mutation, with a "rewind" button.
- A diff preview in the approval card instead of a raw JSON dump.

### 2.3 `/api/orchestrate` is a fake (`backend/index.js:179-195`)

It returns six hardcoded log lines pretending a planner/coder/reviewer collaborated, after a 1.5s
`setTimeout`. The plugin marketplace installer is the same (`backend/index.js:718-722`: `setTimeout`
→ `"Successfully installed"`). Shipping simulated success as real output is hallucination baked into
the product, and it will destroy trust the first time a user checks. Either implement it or label it
"Preview — not yet functional".

### 2.4 UI toggles wired to nothing

- The `tools` state (`App.jsx:187-198`: Web Search / File System / Code Execution) is persisted to
  localStorage and rendered — and never consulted. `TOOLS` (line 36) is always sent in full.
- `fsEnabled` (`App.jsx:560-570`) likewise gates nothing.
- Custom tools added via the "Add Custom Tool" modal (`App.jsx:1133-1141`) are stored and never
  registered with the model or executed. Dead feature.
- "Web Search" is offered in the UI with no implementation anywhere.
- The two personas share one `TOOLS` array — `app_admin` is told never to write code but still holds
  `write_file`. Prompt-level restrictions without capability-level enforcement are not restrictions.

### 2.5 `.agents/AGENTS.md` is never loaded

The repo contains project rules the agent should honour. `systemPrompt` (`App.jsx:984-987`) only ever
gets the persona plus the workspace path. Auto-loading `AGENTS.md` / `CLAUDE.md` from the workspace
root is ~10 lines and immediately makes the agent project-aware.

### 2.6 Other structural issues

- `App.jsx` is 2213 lines with ~80 `useState` hooks and fully inline styles. Untestable, and every
  token of a streaming response re-renders and re-highlights the whole transcript (O(n²)).
- ~20 hardcoded `http://localhost:8789` literals. No API client, no `VITE_API_URL`.
- Windows-only: hardcoded PowerShell path (`backend/index.js:434`), `taskkill`, `C:\`/`D:\`/`E:\`
  buttons, `browse.ps1`.
- Messages are keyed by array index (`App.jsx:1826`, and `agentMsgIndex` throughout). Concurrent
  sends, edit, and regenerate all corrupt state.
- No token/cost/latency telemetry anywhere.
- Model default hardcodes a search for `qwen2.5-coder:14b` (`App.jsx:780`).

---

## 3. Security — the backend is an unauthenticated RCE service

**Severity: critical. Do not run this on an untrusted network, and close it while browsing.**

`server.listen(PORT)` binds `0.0.0.0`; `app.use(cors())` sets `Access-Control-Allow-Origin: *`; there
is no auth, no CSRF token, no origin check.

| # | Issue | Location | Impact |
|---|---|---|---|
| S1 | `POST /api/tools/terminal/run` — no auth, permissive CORS, `Content-Type: application/json` preflight is allowed | `index.js:420` | **Any website the user visits executes PowerShell on this machine.** Anyone on the LAN too. |
| S2 | `GET /api/settings` returns API keys in plaintext to any origin (**verified 200 + `ACAO: *`**) | `index.js:142` | OpenAI/Anthropic/Gemini key exfiltration by any open tab. |
| S3 | `workspacePath` is entirely client-supplied | all tool routes | `resolveSafePath` is correct *within* a workspace, but the caller picks the workspace. The sandbox is advisory. |
| S4 | `fs/write` with no `workspacePath` → `path.resolve(filePath)` | `index.js:619` | Write anywhere: Startup folder, `.bashrc`, ssh keys, `backend/plugins/*.js`. |
| S5 | `POST /api/plugins/execute` → `require(pluginPath)` | `index.js:35-51` | Chain with S4: write `backend/plugins/x.js`, then execute it. Full RCE with a clean name. |
| S6 | `POST /api/problems` runs `npx eslint` with request-controlled `cwd` | `index.js:93` | `npx` resolves the workspace's local `eslint`; a malicious repo executes code on lint. |
| S7 | Terminal containment is a string prefix: `executionDir.startsWith(workspacePath)` | `index.js:426` | `C:\work` matches `C:\work-evil`. Use `path.relative` segment checks. |
| S8 | `POST /api/fs/list` browses any directory, defaults to `C:\` | `index.js:569` | Arbitrary filesystem enumeration. |
| S9 | Console SSE (`/api/output/stream`) broadcasts all backend logs incl. morgan lines, unauthenticated | `index.js:55-85` | Path/secret leakage. |
| S10 | `backend/settings.json` is git-tracked and is the file keys are written into | tracked | Keys will be committed on first save. |
| S11 | File content read into context can contain tool-call JSON that §1.1 executes | `App.jsx:931` | Prompt injection → code execution. |
| S12 | No request size limits on tool routes beyond `50mb`, no rate limiting, no timeouts on `run_command` | — | Trivial local DoS. |

**Minimum viable hardening (do this before anything else):**

1. `server.listen(PORT, '127.0.0.1')`.
2. `app.use(cors({ origin: 'http://localhost:5173', credentials: true }))` and reject requests whose
   `Origin`/`Sec-Fetch-Site` isn't the app. A wildcard CORS on an RCE endpoint is the whole problem.
3. Generate a per-launch token, inject it into the Vite dev server, require it on every route and on
   the PTY WebSocket.
4. Move `app.use(express.json())` and `app.use(cors())` **above all route definitions** (also fixes
   the confirmed 500s).
5. Make `workspacePath` server-side session state, not a request field. Pin it once; validate every
   path against it with `path.relative`.
6. Replace `require(pluginPath)` with an explicit registry; or delete the plugin execute route until
   there's a manifest + sandbox.
7. Never return secrets from `GET /api/settings` — return `{ openai: true, anthropic: false }`
   presence flags. Store keys outside the repo (`%APPDATA%/astra/`), 0600.
8. Enforce the permission decision **server-side**, keyed to the session.

---

## 4. Reliability bugs (confirmed or code-evident)

| # | Issue | Location |
|---|---|---|
| R1 | **Confirmed 500** — `express.json()` at line 123 registered after routes at 35 and 89. `/api/problems` and `/api/plugins/execute` throw `TypeError: Cannot destructure ... req.body`. Problems panel is dead. | `index.js:89`, `index.js:36` |
| R2 | `activeTasks` is never pruned and `output` grows unbounded. Every command leaks a child handle and its full output for the process lifetime. | `index.js:418-436` |
| R3 | Kill reports success unconditionally — `spawnSync('taskkill')` status and stderr ignored; fallback only on throw. | `index.js:487-500` |
| R4 | `/api/models/pull` spawns detached `ollama` with **no `error` listener** — `ENOENT` crashes the Node process. (The `/plugins/install` path has one; this one doesn't.) | `index.js:170-176` |
| R5 | The 5s background timer isn't cleared on close; both branches are guarded only by `headersSent`. | `index.js:464-472` |
| R6 | PTY: no `ws.on('error')`, no `ptyProcess.onExit`, no shutdown cleanup, no connection cap. `ws.on('resize')` is not a real ws event — resize is dead code. | `index.js:727-777` |
| R7 | `streamOllama` never checks `response.ok` or a null body before `getReader()` — a 500 or HTML error page throws a secondary TypeError and strands the UI. | `App.jsx:881-895` |
| R8 | `stopGeneration` aborts only `/api/chat`. `executeTool`'s fetches have no signal, so a stopped generation still completes a write or command. | `App.jsx:793-800`, `802-879` |
| R9 | Concurrent sends / regenerate-while-generating corrupt state via numeric `agentMsgIndex`. | `App.jsx:971-979` |
| R10 | localStorage persistence is synchronous, unbounded, and untry/catch'd. Full transcripts incl. tool output hit the 5MB quota → `QuotaExceededError` on every keystroke → **the app breaks and stays broken across reloads**. | `App.jsx:365-371` |
| R11 | `LiveTerminal` polls every 1s with no overlap guard, keeps polling after Kill, and has no killed/completed state. | `LiveTerminal.jsx:41-64` |
| R12 | A new `AudioContext` per permission prompt, never closed. Browsers cap these (~6); the beep silently dies and warnings accumulate. | `App.jsx:385-398` |
| R13 | `console.log` is monkey-patched to broadcast; any log inside a client `write` risks recursion, and slow SSE clients aren't backpressured. | `index.js:69-85` |
| R14 | `handleSend` returns early inside `catch` on `AbortError` — the `finally` still runs, but the assistant message is left as an empty bubble with no "stopped" marker. | `App.jsx:1095-1098` |

---

## 5. Repo hygiene

- **No `.gitignore` anywhere.** 3,413 of 3,462 tracked files are `node_modules`. Every `npm install`
  produces an enormous diff; clones are huge; dependency changes are unreviewable. Highest
  effort-to-value fix in the repo.
- 15 tracked debug artefacts at the root: `script*.js`, `script_backend*.js`, `script_ui3.js`,
  `fix.js`, `fix2.js`, `check_errors*.js`, `temp.html`, `temp_render.html`, `body.html`.
- Root `package.json` contains only `puppeteer` — an orphan from a scripting session.
- `backend/settings.json` is tracked (see S10).
- No backend tests; `backend` `npm test` is the default error stub. Frontend has three Playwright
  specs that mock the backend boundary — good, but nothing covers the backend contract.
- `backend/package.json` lists `body-parser` unused, and does **not** list `express` (it's a
  transitive/ambient dependency) — check `npm ls express`.
- No CI, no lint gate, no `.editorconfig`. Mixed LF/CRLF (git warns on every diff).
- `frontend/playwright-report/` and `frontend/test-results/` are untracked but will be committed
  eventually without a `.gitignore`.

---

## 6. Problems this will hit at scale

1. **localStorage cliff.** ~20 tool-heavy turns fills 5MB. Unhandled `QuotaExceededError` → the app
   dies on load with a corrupt `astra_memory`. Move to IndexedDB or server-side sessions; cap tool
   results at ~10KB in the transcript.
2. **Render cost.** Every streamed token clones `messages` and re-runs ReactMarkdown + Prism over the
   entire transcript. Long responses will make typing janky, then unusable. Memoise per-message,
   virtualise the list, buffer tokens on `requestAnimationFrame`.
3. **Memory.** `activeTasks` + unbounded `output` strings + never-closed PTYs → the backend grows
   until restarted.
4. **Context cost.** With no compaction, every turn resends the whole history. On a local model this
   is latency; on the OpenAI/Anthropic keys the settings modal collects, it's money.
5. **Multi-workspace.** Everything is keyed to a single global `workspacePath` in localStorage.
   Adding a second project means rearchitecting state.
6. **Cross-platform.** Every shell path is Windows-hardcoded. Porting is a rewrite of the terminal
   layer, not a config change.

---

## 7. Fix plan

### Phase 0 — Stop the bleeding (hours)

1. Move `cors()` + `express.json()` above all routes; bind to `127.0.0.1`; lock CORS to the Vite
   origin. *(Fixes R1 + S1 + S2.)*
2. Delete the prose-scraping fallback parser, or gate it as in §1.1.
3. Set `content: fullContent` on the assistant context push.
4. Send `options: { num_ctx: 16384, temperature: 0.1 }` on `/api/chat`.
5. Rewrite the persona prompt with a no-tool-for-chat clause.
6. Add a carry buffer to the NDJSON reader; accumulate rather than overwrite tool calls.
7. On tool denial, break the loop.
8. Add a `.gitignore`; `git rm -r --cached node_modules backend/settings.json`; delete the root
   debug scripts.

After 1–7, the "said hi → ran a command" class of failure should be gone. These are ~150 lines total.

### Phase 1 — Make the agent trustworthy (days)

9. `edit_file` (exact-string replace) + `read_file(offset, limit)` + read-before-write invariant.
10. Argument coercion + JSON-Schema validation + a structured repair turn on invalid args.
11. `tool_call_id` correlation; dedupe identical calls within a turn.
12. Token budgeting: cap tool results, count tokens, compact oldest turns at 70% of `num_ctx`, show a
    context meter.
13. Auto-load `AGENTS.md` / `CLAUDE.md` from the workspace root into the system prompt.
14. Wire the tool toggles and personas to the actual `TOOLS` array sent to the model.
15. Diff preview in the approval card; checkpoint (shadow git commit) before every mutation + rewind.
16. Fix R2–R14.

### Phase 2 — Move the agent server-side (weeks)

17. Session service + SSE event stream; browser becomes a viewer.
18. Server-enforced permissions with a persistent rule engine (see §8.2).
19. Structured audit log of every tool call, args, result, approval decision.
20. Multi-session, resume, transcript search.
21. Split `App.jsx` into feature modules; message IDs instead of indices; virtualised transcript.
22. Backend integration tests against a fake Ollama + disposable workspace; wire the existing
    Playwright suite into CI.

---

## 8. What I'd add if I were designing this

Roughly in order of value-per-effort. Several of these are things my own harness relies on daily.

### 8.1 Plan mode
A read-only mode where the agent can search and read but cannot write or execute, ending in a written
plan the user approves before anything runs. Eliminates most "it did something I didn't want"
incidents, and is *cheap* — it's a capability filter over the existing tool list.

### 8.2 A real permission engine
Replace Strict/Supervised/Autonomous with pattern rules the user accumulates:

```
allow  run_command(npm run test:*)
allow  read_file(**)
ask    write_file(src/**)
deny   run_command(rm *), run_command(git push *)
```

Each prompt offers "Allow once / Allow always for this pattern / Deny". Enforced server-side. This is
the single biggest quality-of-life change for an autonomous agent — the current global 3-level switch
forces users to pick between nagging and recklessness.

### 8.3 Sub-agents with isolated context
"Search the repo for where auth is handled" burns thousands of tokens of file dumps in the main
context. Spawn a sub-agent with its own window that returns only the conclusion. Directly attacks
§1.3, the deepest hallucination cause. Your fake `/api/orchestrate` is a sketch of the right idea —
make it real.

### 8.4 A visible task list
The agent maintains a checklist (`pending / in_progress / completed`) rendered in the sidebar. Keeps
the model on-task across long runs, makes progress legible, and makes "it claimed it was done" a
visible lie rather than a plausible one.

### 8.5 Checkpoints and rewind
Shadow-git commit before each mutation; a "rewind to here" control on every message. Turns a
destructive `write_file` from a catastrophe into an undo. Prerequisite for trusting Autonomous mode.

### 8.6 Hooks
User-configured commands that run before/after tool use: format on write, run tests after edits,
block writes to `*.env`. Lets users encode project policy without touching Astra's source.

### 8.7 MCP client support
Instead of a bespoke `require()`-based plugin system with no manifest or sandbox, speak Model Context
Protocol. You get GitHub, Postgres, Sentry, Slack, Puppeteer and hundreds more integrations for free,
plus a real capability/permission model. This deletes §2.4 and S5 simultaneously.

### 8.8 Context compaction with a visible meter
At ~70% of `num_ctx`, summarise the oldest turns into a compact digest and continue. Show
"12.4k / 16k" in the header. Users currently have zero visibility into the thing that is actually
breaking their agent.

### 8.9 Slash commands / reusable prompts
`/review`, `/test`, `/commit` backed by markdown files in `.agents/commands/`. Cheap to build,
enormous for repeat workflows.

### 8.10 Model routing
Route cheap work (search, summarisation, classification) to a small fast model and reserve the 14B
for edits and reasoning. On local hardware this is the difference between usable and sluggish.

### 8.11 Git as a first-class surface
`git_status` / `git_diff` / `git_log` tools, a diff view in the editor, and commit generation — with
`git push` and history rewrites permanently behind explicit approval.

### 8.12 Session telemetry
Tokens in/out, wall-clock, tool-call count, and cost per turn when external models are used. Right
now nothing is measured, so nothing can be optimised.

### 8.13 Structured errors back to the model
When a tool fails, return a typed error with a hint (`ENOENT: file not found. Did you mean
src/App.jsx? Use list_dir to check.`) rather than a raw stack trace. Models recover from structured
errors and spiral on opaque ones.

### 8.14 A trace/debug panel
Show the exact `messages` array sent to Ollama each turn, token counts, and raw NDJSON. When the
agent misbehaves, this turns a 3-hour mystery into a 30-second read. Given §1, you'd have found the
prose-scraper bug on day one with this panel.

---

## 9. The one-paragraph answer to "why is it hallucinating"

It mostly isn't. Astra told the model — in the system prompt — to always use tools and never ask
permission, then attached five tool schemas to a "hi", then took the model's *written description* of
a tool call, pulled it out of the visible message with a regex, and executed it twice because it
appeared twice in the text. It then erased the model's own words from history, so on the next turn
the model repeated itself and Astra executed it again. Separately, because `num_ctx` is never set,
Ollama runs at a 4096-token window that the system prompt and tool schemas already consume 15% of, so
once real file contents enter the conversation the original task falls out of the window and the
model genuinely does start confabulating. Fix the scraper, feed the assistant's text back, set
`num_ctx` and `temperature`, and add a "just chat when they're chatting" clause — that is roughly 150
lines and covers the behaviour in both screenshots.
