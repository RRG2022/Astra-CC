const crypto = require('crypto');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { resolveSafePath } = require('../../security/safe-path');
const { badRequest } = require('./errors');

const activeTasks = new Map();

const OUTPUT_CAP = 1000000;      // 1MB of retained output per task
const BACKGROUND_AFTER_MS = 5000; // hand back control, keep the process running
const PRUNE_AFTER_MS = 60000;

/**
 * Forget a finished task's retained output after a grace period. Unref'd: this
 * is bookkeeping, and a pending prune must never be the reason a process that
 * has nothing left to do stays alive.
 */
function schedulePrune(taskId) {
  setTimeout(() => activeTasks.delete(taskId), PRUNE_AFTER_MS).unref();
}

function requireWorkspace(ctx) {
  if (!ctx || !ctx.workspacePath) {
    throw badRequest('An active workspace is required for this action.');
  }
  return ctx.workspacePath;
}

/**
 * Runs a shell command in the workspace. Resolves either when the process
 * exits, or after BACKGROUND_AFTER_MS with a taskId the caller can poll —
 * whichever happens first. The process keeps running either way.
 */
async function runCommand(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { command, cwd } = args;
  if (!command) throw badRequest('command is required');

  const executionDir = resolveSafePath(workspacePath, cwd || '.');
  const taskId = crypto.randomUUID();

  const isWindows = os.platform() === 'win32';
  const shellPath = isWindows ? 'powershell.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['-Command', command] : ['-c', command];

  const child = spawn(shellPath, shellArgs, {
    cwd: executionDir,
    detached: !isWindows // so we can kill the whole process group
  });

  const task = { child, output: '', done: false, timer: null, killed: false };
  activeTasks.set(taskId, task);

  const append = (data) => {
    task.output = (task.output + data.toString()).slice(-OUTPUT_CAP);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  return new Promise((resolve) => {
    let settled = false;
    const settleWith = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(task.timer);
      resolve(value);
    };

    child.on('error', (err) => {
      append(`\nError: Failed to start process: ${err.message}\n`);
      task.done = true;
      settleWith({ success: false, error: `Failed to start process: ${err.message}`, code: 'ESPAWN' });
      schedulePrune(taskId);
    });

    child.on('close', (code) => {
      task.done = true;
      task.exitCode = code;
      settleWith({
        success: code === 0,
        exitCode: code,
        stdout: task.output.trim(),
        stderr: ''
      });
      schedulePrune(taskId);
    });

    task.timer = setTimeout(() => {
      settleWith({
        success: true,
        backgrounded: true,
        taskId,
        stdout: `[Task sent to background] Task ID: ${taskId}\nPartial output:\n${task.output.trim()}`
      });
    }, BACKGROUND_AFTER_MS);
  });
}

function getTask(taskId) {
  return activeTasks.get(taskId);
}

function killTask(taskId) {
  const task = activeTasks.get(taskId);
  if (!task) return false;

  try {
    if (os.platform() === 'win32') {
      spawnSync('taskkill', ['/pid', String(task.child.pid), '/f', '/t']);
    } else {
      process.kill(-task.child.pid, 'SIGKILL');
    }
  } catch {
    try { task.child.kill(); } catch { /* already gone */ }
  }

  task.killed = true;
  task.output += '\n\n[Task killed by user]';
  return true;
}

function cleanAllTasks() {
  for (const taskId of activeTasks.keys()) {
    killTask(taskId);
  }
  activeTasks.clear();
}

module.exports = { runCommand, getTask, killTask, cleanAllTasks, activeTasks };
