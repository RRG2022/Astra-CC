const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const workspaceLocks = new Map();

async function withWorkspaceLock(workspacePath, fn) {
  if (!workspaceLocks.has(workspacePath)) {
    workspaceLocks.set(workspacePath, Promise.resolve());
  }
  
  let release;
  const lockPromise = new Promise(resolve => { release = resolve; });
  
  const previous = workspaceLocks.get(workspacePath);
  workspaceLocks.set(workspacePath, previous.then(() => lockPromise));
  
  try {
    await previous;
    return await fn();
  } finally {
    release();
    // Clean up if we are the last one in the queue
    if (workspaceLocks.get(workspacePath) === previous.then(() => lockPromise)) {
      workspaceLocks.delete(workspacePath);
    }
  }
}

/**
 * Ensures the shadow git repository is initialized.
 * Also adds .astra to the workspace's .git/info/exclude if a user repo exists.
 */
function ensureInit(workspacePath) {
  const astraDir = path.join(workspacePath, '.astra');
  const gitDir = path.join(astraDir, 'shadow.git');
  
  if (!fs.existsSync(gitDir)) {
    if (!fs.existsSync(astraDir)) {
      fs.mkdirSync(astraDir, { recursive: true });
    }
    
    // Initialize the shadow repo
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'init'], { stdio: 'ignore' });
    
    // Set internal identity
    execFileSync('git', ['--git-dir', gitDir, 'config', 'user.name', 'Astra Shadow'], { stdio: 'ignore' });
    execFileSync('git', ['--git-dir', gitDir, 'config', 'user.email', 'shadow@astra.local'], { stdio: 'ignore' });
    
    // Disable line ending conversion
    execFileSync('git', ['--git-dir', gitDir, 'config', 'core.autocrlf', 'false'], { stdio: 'ignore' });
    
    // Create an initial empty commit to establish HEAD
    execFileSync('git', ['--git-dir', gitDir, 'commit', '--allow-empty', '-m', 'Initial Shadow Git Commit'], { stdio: 'ignore' });
  }

  // Prevent user's repo from tracking .astra
  const userGitExclude = path.join(workspacePath, '.git', 'info', 'exclude');
  if (fs.existsSync(userGitExclude)) {
    const excludeContent = fs.readFileSync(userGitExclude, 'utf8');
    if (!excludeContent.includes('.astra/')) {
      fs.writeFileSync(userGitExclude, excludeContent.trim() + '\n.astra/\n');
    }
  }
}

async function commitFile(workspacePath, absolutePath) {
  ensureInit(workspacePath);
  
  const gitDir = path.join(workspacePath, '.astra', 'shadow.git');
  const relativeTarget = path.relative(workspacePath, absolutePath).replace(/\\/g, '/');
  
  const exists = fs.existsSync(absolutePath);
  
  // Stage the file path explicitly (never the whole workspace)
  if (exists) {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'add', '--', relativeTarget], { stdio: 'ignore' });
  } else {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'rm', '--cached', '--ignore-unmatch', '--', relativeTarget], { stdio: 'ignore' });
  }
  
  // Check if there are changes to commit
  try {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'diff', '--cached', '--quiet']);
    // Exit code 0 means NO changes. Just return HEAD.
    const headSha = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD']).toString().trim();
    return headSha;
  } catch (err) {
    // Exit code 1 means there ARE changes staged. We can commit.
    const action = exists ? 'Checkpoint' : 'Absent Checkpoint';
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'commit', '-m', `${action}: ${relativeTarget}`], { stdio: 'ignore' });
    
    return execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD']).toString().trim();
  }
}

function _validateSha(gitDir, sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('Invalid SHA format. Expected 40-character hex string.');
  }
  try {
    const result = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (result.toString().trim() !== sha) {
      throw new Error('SHA does not map directly to the parsed commit object.');
    }
  } catch (err) {
    throw new Error('Invalid or missing commit SHA.');
  }
}

/**
 * Rewinds a specific file to the given shadow-git commit SHA.
 * Creates a recovery checkpoint before rewinding.
 */
async function rewindFile(workspacePath, absolutePath, commitSha) {
  ensureInit(workspacePath);
  
  const gitDir = path.join(workspacePath, '.astra', 'shadow.git');
  const relativeTarget = path.relative(workspacePath, absolutePath).replace(/\\/g, '/');
  
  _validateSha(gitDir, commitSha);
  
  // 1. Checkpoint current version so we can undo the undo
  // Using a manual internal logic to avoid deadlock since we hold the lock
  const exists = fs.existsSync(absolutePath);
  if (exists) {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'add', '--', relativeTarget], { stdio: 'ignore' });
  } else {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'rm', '--cached', '--ignore-unmatch', '--', relativeTarget], { stdio: 'ignore' });
  }
  
  let recoverySha;
  try {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'diff', '--cached', '--quiet']);
    recoverySha = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD']).toString().trim();
  } catch (err) {
    const action = exists ? 'Checkpoint' : 'Absent Checkpoint';
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'commit', '-m', `${action}: ${relativeTarget}`], { stdio: 'ignore' });
    recoverySha = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD']).toString().trim();
  }
  
  // 2. Check if the file existed in the target commit
  const treeInfo = execFileSync('git', ['--git-dir', gitDir, 'ls-tree', commitSha, '--', relativeTarget]).toString().trim();
  
  if (!treeInfo) {
    // File did not exist in the target commit (it was absent)
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { force: true });
    }
  } else {
    // File existed, checkout its state
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'checkout', commitSha, '--', relativeTarget], { stdio: 'ignore' });
  }
  
  // We commit this rewind operation itself to keep the git index synced with the worktree
  const rewindExists = fs.existsSync(absolutePath);
  if (rewindExists) {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'add', '--', relativeTarget], { stdio: 'ignore' });
  } else {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'rm', '--cached', '--ignore-unmatch', '--', relativeTarget], { stdio: 'ignore' });
  }
  try {
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'diff', '--cached', '--quiet']);
  } catch (err) {
    const action = rewindExists ? 'Checkpoint' : 'Absent Checkpoint';
    execFileSync('git', ['--git-dir', gitDir, '--work-tree', workspacePath, 'commit', '-m', `${action} (Rewind): ${relativeTarget}`], { stdio: 'ignore' });
  }
  
  return recoverySha;
}

module.exports = {
  ensureInit,
  commitFile,
  rewindFile,
  withWorkspaceLock
};
