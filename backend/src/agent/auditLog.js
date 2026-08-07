const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Append-only record of everything the agent did to the filesystem.
 *
 * Without this there is no way to answer "what did it actually do?" after an
 * unattended run — which is exactly the question that has to be answerable
 * before anyone leaves it running unattended.
 */

const AUDIT_FILE = 'audit.jsonl';

// Arguments can carry whole file bodies; the log records what was done, not a
// second copy of the content.
const MAX_FIELD_CHARS = 500;

function auditPath(workspacePath) {
  const dir = workspacePath
    ? path.join(workspacePath, '.astra')
    : path.join(os.homedir(), '.astra');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, AUDIT_FILE);
}

function truncate(value) {
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…[${value.length} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(truncate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  }
  return value;
}

/**
 * Appends one entry. Never throws: an unwritable log must not take down the
 * run it is recording.
 */
function record(workspacePath, entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...truncate(entry) });
    fs.appendFileSync(auditPath(workspacePath), line + '\n');
    return true;
  } catch (err) {
    console.error('Audit log write failed:', err.message);
    return false;
  }
}

/** Reads back the most recent entries, newest last. */
function read(workspacePath, { limit = 200, sessionId } = {}) {
  try {
    const file = auditPath(workspacePath);
    if (!fs.existsSync(file)) return [];

    const entries = fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(e => !sessionId || e.sessionId === sessionId);

    return entries.slice(-limit);
  } catch (err) {
    console.error('Audit log read failed:', err.message);
    return [];
  }
}

module.exports = { record, read, auditPath, AUDIT_FILE, MAX_FIELD_CHARS };
