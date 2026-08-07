#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { createApp } = require('../src/app');
const permissions = require('../src/agent/permissions');
const auditLog = require('../src/agent/auditLog');
const { TOOL_SCHEMAS } = require('../src/tools/schemas');

/**
 * Headless Astra: one agent run, no browser.
 *
 * Starts the server in-process on an ephemeral port, drives the session API,
 * and streams events to stdout. The same permission rules and audit log apply
 * as in the UI — an unattended run is exactly where they matter most, so
 * anything that would prompt is refused rather than silently allowed.
 */

const USAGE = `
astra run --workspace <path> --prompt <text> [options]

Required:
  --workspace <path>     Directory the agent may act in
  --prompt <text>        What to do  (or --prompt-file <path>)

Options:
  --model <name>         Model to use            (default: qwen2.5-coder:14b)
  --persona <key>        repo_builder|app_admin  (default: repo_builder)
  --mode <key>           plan|build              (default: build)
  --authority <level>    Strict|Supervised|Autonomous  (default: Supervised)
  --max-iterations <n>   Loop cap                (default: 15)
  --yes                  Auto-approve calls that would prompt (implies risk)
  --json                 Emit raw events as JSONL instead of prose
  --quiet                Only print the final answer
  -h, --help             This message

Exit codes:
  0 completed   1 error   2 blocked on approval   3 hit the iteration cap
`.trim();

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (arg === '-h') out.help = true;
      else out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'yes' || key === 'json' || key === 'quiet' || key === 'help') out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const EXIT = { OK: 0, ERROR: 1, NEEDS_APPROVAL: 2, MAX_ITERATIONS: 3 };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (args.help || !command) {
    console.log(USAGE);
    process.exit(args.help ? EXIT.OK : EXIT.ERROR);
  }
  if (command !== 'run') {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(EXIT.ERROR);
  }

  const workspace = args.workspace && path.resolve(args.workspace);
  if (!workspace || !fs.existsSync(workspace)) {
    console.error(`--workspace must be an existing directory (got: ${args.workspace || 'nothing'})`);
    process.exit(EXIT.ERROR);
  }

  const prompt = args['prompt-file']
    ? fs.readFileSync(args['prompt-file'], 'utf8')
    : args.prompt;
  if (!prompt) {
    console.error('--prompt or --prompt-file is required');
    process.exit(EXIT.ERROR);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const { app } = createApp({ token, requestLogging: false, patchConsole: false });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (pathname, { method = 'POST', body } = {}) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const log = (...parts) => { if (!args.quiet && !args.json) console.error(...parts); };
  const emitJson = (obj) => { if (args.json) console.log(JSON.stringify(obj)); };

  const created = await api('/api/sessions', {
    body: {
      workspacePath: workspace,
      model: args.model || 'qwen2.5-coder:14b',
      persona: args.persona || 'repo_builder',
      mode: args.mode || 'build',
      authorityLevel: args.authority || 'Supervised',
      maxIterations: parseInt(args['max-iterations'] || '15', 10),
      tools: TOOL_SCHEMAS
    }
  });
  if (created.status !== 200) {
    console.error('Failed to create session:', created.body?.error || created.status);
    process.exit(EXIT.ERROR);
  }

  const { sessionId, projectFile } = created.body;
  log(`session ${sessionId}`);
  log(`workspace ${workspace}${projectFile ? ` (loaded ${projectFile})` : ''}`);
  log(`rules: ${permissions.loadRules(workspace).length} loaded\n`);

  let exitCode = EXIT.OK;
  let finalText = '';

  const stream = await fetch(`${base}/api/sessions/${sessionId}/stream?token=${token}`);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const posted = api(`/api/sessions/${sessionId}/message`, {
    body: { message: { role: 'user', content: prompt }, assistantMessageId: crypto.randomUUID() }
  });

  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;

    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let event = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      let data;
      try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }
      emitJson({ event, data });

      if (event === 'message_update' && data.update?.content) {
        finalText += data.update.content;
        if (!args.json && !args.quiet) process.stderr.write(data.update.content);
      }

      if (event === 'message_update' && data.update?.tool_execution) {
        const t = data.update.tool_execution;
        log(`\n  → ${t.name} ${JSON.stringify(t.arguments).slice(0, 120)}`);
      }

      if (event === 'approval_requested') {
        if (args.yes) {
          log(`\n  ✓ auto-approving ${data.name} (--yes)`);
          await api(`/api/sessions/${sessionId}/approve/${data.callId}`, { body: { approved: true } });
        } else {
          // Refuse rather than hang: nobody is watching to answer.
          log(`\n  ✗ ${data.name} needs approval and no one is here to give it.`);
          log(`    Add a rule, or re-run with --yes:`);
          log(`      { "effect": "allow", "tool": "${data.name}", "pattern": "${data.suggestedPattern}" }`);
          exitCode = EXIT.NEEDS_APPROVAL;
          await api(`/api/sessions/${sessionId}/approve/${data.callId}`, { body: { approved: false } });
        }
      }

      if (event === 'context_usage' && data.compacted) {
        log(`\n  [context compacted: ${data.used}/${data.budget} tokens]`);
      }

      if (event === 'loop_completed') {
        done = true;
        if (data.stopReason === 'error') {
          console.error(`\nError: ${data.error}`);
          exitCode = EXIT.ERROR;
        } else if (data.stopReason === 'max_iterations') {
          log('\nStopped at the iteration cap.');
          exitCode = EXIT.MAX_ITERATIONS;
        } else if (data.stopReason === 'denied' && exitCode === EXIT.OK) {
          exitCode = EXIT.NEEDS_APPROVAL;
        }
        break;
      }
    }
  }

  await posted;
  reader.cancel().catch(() => {});

  if (args.quiet) console.log(finalText.trim());
  else if (!args.json) console.error('');

  const entries = auditLog.read(workspace, { sessionId });
  log(`${entries.length} tool call(s) recorded in .astra/audit.jsonl`);

  server.closeAllConnections?.();
  server.close();
  process.exit(exitCode);
}

main().catch(err => {
  console.error('astra:', err.message);
  process.exit(EXIT.ERROR);
});
