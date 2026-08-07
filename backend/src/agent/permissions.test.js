const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  evaluate, subjectOf, globToRegExp, loadRules, saveRules, addRule, suggestPattern
} = require('./permissions');
const { createWorkspace } = require('../../test/helpers');

const rule = (effect, tool, pattern) => ({ effect, tool, pattern });

test('path globs match within a segment; ** crosses separators', () => {
  assert.ok(globToRegExp('src/*').test('src/a.js'));
  assert.ok(!globToRegExp('src/*').test('src/deep/a.js'));
  assert.ok(globToRegExp('src/**').test('src/deep/a.js'));
});

test('command globs treat / as an ordinary character', () => {
  // `rm *` must match `rm -rf /` — that is the case the rule exists for.
  assert.ok(globToRegExp('rm *', { pathLike: false }).test('rm -rf /'));
  assert.ok(globToRegExp('npm test*', { pathLike: false }).test('npm test:unit'));
  assert.ok(!globToRegExp('npm test*', { pathLike: false }).test('npx test'));
});

test('glob special characters are escaped, not interpreted', () => {
  assert.ok(globToRegExp('a.b.js').test('a.b.js'));
  assert.ok(!globToRegExp('a.b.js').test('axbxjs'));
});

test('each tool exposes the field that determines what it touches', () => {
  assert.equal(subjectOf('run_command', { command: 'npm test' }), 'npm test');
  assert.equal(subjectOf('write_file', { filePath: 'src/a.js' }), 'src/a.js');
  assert.equal(subjectOf('list_dir', { directoryPath: 'src' }), 'src');
  assert.equal(subjectOf('grep_search', { query: 'TODO' }), 'TODO');
});

test('with no rules it falls back to the authority level', () => {
  const args = { filePath: 'a.js', content: 'x' };

  assert.equal(evaluate({ tool: 'write_file', args, authorityLevel: 'Autonomous' }).decision, 'allow');
  assert.equal(evaluate({ tool: 'write_file', args, authorityLevel: 'Supervised' }).decision, 'ask');
  assert.equal(evaluate({ tool: 'read_file', args, authorityLevel: 'Supervised' }).decision, 'allow');
  assert.equal(evaluate({ tool: 'read_file', args, authorityLevel: 'Strict' }).decision, 'ask');
});

test('an allow rule spares the user from being asked again', () => {
  const result = evaluate({
    tool: 'run_command',
    args: { command: 'npm test:unit' },
    rules: [rule('allow', 'run_command', 'npm test*')],
    authorityLevel: 'Supervised'
  });

  assert.equal(result.decision, 'allow');
  assert.equal(result.rule.pattern, 'npm test*');
});

test('deny wins over any allow, whatever the order', () => {
  const rules = [
    rule('allow', 'run_command', '*'),
    rule('deny', 'run_command', 'git push*')
  ];

  assert.equal(evaluate({
    tool: 'run_command', args: { command: 'git push origin main' },
    rules, authorityLevel: 'Autonomous'
  }).decision, 'deny');

  // Order reversed — deny still wins, so it cannot be shadowed later.
  assert.equal(evaluate({
    tool: 'run_command', args: { command: 'git push origin main' },
    rules: [...rules].reverse(), authorityLevel: 'Autonomous'
  }).decision, 'deny');
});

test('deny overrides even Autonomous', () => {
  const result = evaluate({
    tool: 'run_command',
    args: { command: 'rm -rf /' },
    rules: [rule('deny', 'run_command', 'rm *')],
    authorityLevel: 'Autonomous'
  });
  assert.equal(result.decision, 'deny');
});

test('a later allow overrides an earlier ask for the same subject', () => {
  const result = evaluate({
    tool: 'write_file',
    args: { filePath: 'src/a.js' },
    rules: [rule('ask', 'write_file', 'src/**'), rule('allow', 'write_file', 'src/a.js')],
    authorityLevel: 'Autonomous'
  });
  assert.equal(result.decision, 'allow');
});

test('a wildcard tool rule applies across tools', () => {
  const result = evaluate({
    tool: 'edit_file',
    args: { filePath: 'vendor/lib.js' },
    rules: [rule('deny', '*', 'vendor/**')],
    authorityLevel: 'Autonomous'
  });
  assert.equal(result.decision, 'deny');
});

test('rules round-trip through the workspace', () => {
  const ws = createWorkspace();
  assert.deepEqual(loadRules(ws), []);

  saveRules(ws, [rule('deny', 'run_command', 'git push*')]);
  const loaded = loadRules(ws);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].effect, 'deny');
  assert.ok(fs.existsSync(path.join(ws, '.astra', 'permissions.json')));
});

test('malformed rules are dropped rather than crashing the run', () => {
  const ws = createWorkspace();
  fs.mkdirSync(path.join(ws, '.astra'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.astra', 'permissions.json'),
    JSON.stringify({ rules: [{ effect: 'nonsense' }, rule('allow', 'read_file', '*')] })
  );

  const loaded = loadRules(ws);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].effect, 'allow');
});

test('an unreadable rules file yields no rules instead of throwing', () => {
  const ws = createWorkspace();
  fs.mkdirSync(path.join(ws, '.astra'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.astra', 'permissions.json'), 'not json at all');

  assert.deepEqual(loadRules(ws), []);
});

test('adding the same tool+pattern replaces rather than stacking', () => {
  const ws = createWorkspace();
  addRule(ws, rule('ask', 'run_command', 'npm *'));
  addRule(ws, rule('allow', 'run_command', 'npm *'));

  const loaded = loadRules(ws);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].effect, 'allow');
});

test('the suggested pattern generalizes a command to its verb', () => {
  // Approving `npm test` should not silently approve `npm publish`, so the
  // offered pattern keys on the executable, and the user can edit it.
  assert.equal(suggestPattern('run_command', { command: 'npm test -- --watch' }), 'npm*');
  assert.equal(suggestPattern('write_file', { filePath: 'src/a.js' }), 'src/a.js');
});

test('Windows-style paths match rules written with forward slashes', () => {
  // A model on Windows emits backslashes; a rule that silently stops matching
  // is worse than no rule, so subjects are normalized before comparison.
  const result = evaluate({
    tool: 'write_file',
    args: { filePath: 'src\\utils\\helper.js' },
    rules: [rule('deny', 'write_file', 'src/**')],
    authorityLevel: 'Autonomous'
  });
  assert.equal(result.decision, 'deny');
  assert.equal(result.subject, 'src/utils/helper.js');
});

test('a leading ./ does not defeat a rule', () => {
  const result = evaluate({
    tool: 'read_file',
    args: { filePath: './src/a.js' },
    rules: [rule('deny', 'read_file', 'src/**')],
    authorityLevel: 'Autonomous'
  });
  assert.equal(result.decision, 'deny');
});
