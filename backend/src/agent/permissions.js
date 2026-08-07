const fs = require('fs');
const path = require('path');
const { isMutating } = require('../tools');

/**
 * Pattern-based permission rules, enforced server-side.
 *
 * The three-level authority switch forces a choice between nagging and
 * recklessness: Supervised asks about every write forever, Autonomous asks
 * about nothing. Rules let the answer accumulate — "always allow `npm test`",
 * "never allow `git push`" — while everything unmatched still falls back to the
 * authority level.
 *
 * A rule is `{ effect, tool, pattern }`:
 *   effect  'allow' | 'ask' | 'deny'
 *   tool    a tool name, or '*' for any
 *   pattern a glob over that tool's subject (see subjectOf), or '*'
 */

const RULES_FILE = 'permissions.json';
const EFFECTS = new Set(['allow', 'ask', 'deny']);

/**
 * The string a rule's pattern is matched against. Each tool has one field that
 * actually determines what it will touch.
 */
function subjectOf(tool, args = {}) {
  switch (tool) {
    case 'run_command': return String(args.command || '');
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'rewind_file': return String(args.filePath || '');
    case 'list_dir': return String(args.directoryPath || '');
    case 'grep_search': return String(args.query || '');
    default: return '';
  }
}

// Tools whose subject is a path, where `/` is a meaningful boundary. For
// everything else (commands, search queries) `/` is just a character.
const PATH_LIKE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'rewind_file', 'list_dir'
]);

/**
 * Glob to RegExp.
 *
 * For path subjects `*` stops at `/` and `**` crosses it, so `src/*` matches
 * `src/a.js` but not `src/deep/a.js`. For command subjects `/` carries no
 * structure — a rule of `rm *` has to match `rm -rf /`, which is the whole
 * point of writing it — so `*` matches everything there.
 */
function globToRegExp(glob, { pathLike = true } = {}) {
  if (!glob || glob === '*') return /^.*$/;

  const star = pathLike ? '[^/]*' : '.*';
  const single = pathLike ? '[^/]' : '.';

  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        out += star;
      }
      continue;
    }
    if (ch === '?') { out += single; continue; }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function ruleMatches(rule, tool, subject) {
  if (rule.tool && rule.tool !== '*' && rule.tool !== tool) return false;
  return globToRegExp(rule.pattern || '*', { pathLike: PATH_LIKE_TOOLS.has(tool) }).test(subject);
}

function normalizeRule(raw) {
  if (!raw || !EFFECTS.has(raw.effect)) return null;
  return {
    effect: raw.effect,
    tool: raw.tool || '*',
    pattern: raw.pattern || '*',
    ...(raw.note ? { note: raw.note } : {})
  };
}

const AUTHORITY_DEFAULT = {
  Strict: () => 'ask',
  Supervised: (tool) => (isMutating(tool) ? 'ask' : 'allow'),
  Autonomous: () => 'allow'
};

/**
 * Decides what to do with a call.
 *
 * `deny` always wins, so a deny rule cannot be shadowed by a broader allow
 * added later. Among the rest the last matching rule wins, which makes a
 * freshly appended "allow always" override an earlier general `ask`.
 */
function evaluate({ tool, args, rules = [], authorityLevel = 'Supervised' }) {
  const subject = subjectOf(tool, args);
  const matching = rules.filter(r => ruleMatches(r, tool, subject));

  const denied = matching.find(r => r.effect === 'deny');
  if (denied) return { decision: 'deny', rule: denied, subject };

  for (let i = matching.length - 1; i >= 0; i--) {
    if (matching[i].effect === 'allow' || matching[i].effect === 'ask') {
      return { decision: matching[i].effect, rule: matching[i], subject };
    }
  }

  const fallback = AUTHORITY_DEFAULT[authorityLevel] || AUTHORITY_DEFAULT.Strict;
  return { decision: fallback(tool), rule: null, subject };
}

// --- persistence ----------------------------------------------------------

function rulesPath(workspacePath) {
  return path.join(workspacePath, '.astra', RULES_FILE);
}

function loadRules(workspacePath) {
  if (!workspacePath) return [];
  try {
    const file = rulesPath(workspacePath);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (parsed.rules || []).map(normalizeRule).filter(Boolean);
  } catch (err) {
    console.error('Failed to read permission rules:', err.message);
    return [];
  }
}

function saveRules(workspacePath, rules) {
  if (!workspacePath) return false;
  try {
    const file = rulesPath(workspacePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ rules }, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error('Failed to save permission rules:', err.message);
    return false;
  }
}

function addRule(workspacePath, raw) {
  const rule = normalizeRule(raw);
  if (!rule) return null;

  const rules = loadRules(workspacePath);
  // Replace an identical tool+pattern rather than stacking duplicates.
  const existing = rules.findIndex(r => r.tool === rule.tool && r.pattern === rule.pattern);
  if (existing !== -1) rules[existing] = rule;
  else rules.push(rule);

  saveRules(workspacePath, rules);
  return rule;
}

/**
 * The pattern offered by "always allow this". Commands are generalized to
 * their first token so approving `npm test` does not silently approve every
 * future `npm` invocation's arguments; paths are offered verbatim.
 */
function suggestPattern(tool, args = {}) {
  const subject = subjectOf(tool, args);
  if (!subject) return '*';
  if (tool === 'run_command') {
    const head = subject.trim().split(/\s+/)[0] || subject;
    return `${head}*`;
  }
  return subject;
}

module.exports = {
  evaluate, subjectOf, globToRegExp, ruleMatches, normalizeRule, PATH_LIKE_TOOLS,
  loadRules, saveRules, addRule, suggestPattern, rulesPath, RULES_FILE
};
