const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Durable session records.
 *
 * Sessions used to live only in a Map that was never pruned: a restart lost
 * every conversation, and a long-running server grew until it was restarted.
 * Records are written under the workspace so they travel with the project;
 * workspace-less sessions fall back to the user's Astra directory.
 */
function sessionsDir(workspacePath) {
  const base = workspacePath
    ? path.join(workspacePath, '.astra', 'sessions')
    : path.join(os.homedir(), '.astra', 'sessions');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function recordPath(session) {
  return path.join(sessionsDir(session.workspacePath), `${session.id}.json`);
}

/** The persistable projection: transient fields (clients, timers) are dropped. */
function toRecord(session) {
  return {
    id: session.id,
    workspacePath: session.workspacePath || '',
    persona: session.persona,
    model: session.model,
    authorityLevel: session.authorityLevel,
    maxIterations: session.maxIterations,
    tools: session.tools,
    context: session.context,
    createdAt: session.createdAt,
    updatedAt: Date.now()
  };
}

function save(session) {
  try {
    const file = recordPath(session);
    // Write-then-rename so a crash mid-write can't leave a truncated record.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(toRecord(session), null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error(`Failed to persist session ${session.id}:`, err.message);
    return false;
  }
}

function load(sessionId, workspacePath) {
  const candidates = [sessionsDir(workspacePath), sessionsDir('')];
  for (const dir of candidates) {
    const file = path.join(dir, `${sessionId}.json`);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`Failed to read session ${sessionId}:`, err.message);
    }
  }
  return null;
}

function list(workspacePath) {
  try {
    const dir = sessionsDir(workspacePath);
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return {
            id: record.id,
            model: record.model,
            persona: record.persona,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            messageCount: (record.context || []).filter(m => m.role !== 'system').length
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

function remove(sessionId, workspacePath) {
  let removed = false;
  for (const dir of [sessionsDir(workspacePath), sessionsDir('')]) {
    const file = path.join(dir, `${sessionId}.json`);
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed = true;
      }
    } catch (err) {
      console.error(`Failed to delete session ${sessionId}:`, err.message);
    }
  }
  return removed;
}

module.exports = { save, load, list, remove, sessionsDir, toRecord };
