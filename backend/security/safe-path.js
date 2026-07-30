const path = require('path');
const fs = require('fs');

/**
 * Safely resolves a path and ensures it remains within the workspace boundary.
 * 
 * @param {string} workspacePath - The absolute root path of the workspace
 * @param {string} targetPath - The requested file/directory path
 * @returns {string} The safe absolute path
 * @throws {Error} If path escapes workspace or is invalid
 */
function resolveSafePath(workspacePath, targetPath) {
  if (!workspacePath) throw new Error('workspacePath is required');
  if (!targetPath) throw new Error('targetPath is required');

  const absoluteWorkspace = path.resolve(workspacePath);
  const absoluteTarget = path.resolve(workspacePath, targetPath);

  // Reject explicit references to hidden framework/repo folders
  const normalizedTarget = absoluteTarget.replace(/\\/g, '/');
  if (normalizedTarget.includes('/.git/') || normalizedTarget.endsWith('/.git') ||
      normalizedTarget.includes('/.astra/') || normalizedTarget.endsWith('/.astra')) {
    throw new Error('Access denied: Paths inside .git or .astra are restricted');
  }

  // Ensure the target is strictly inside the workspace boundary (traversal block)
  if (!absoluteTarget.startsWith(absoluteWorkspace + path.sep) && absoluteTarget !== absoluteWorkspace) {
    throw new Error('Path traversal detected: Target path escapes workspace boundary');
  }

  // Symlink escape check
  // Since the target might not exist yet, we check the realpath of the nearest existing parent
  let currentPath = absoluteTarget;
  while (!fs.existsSync(currentPath) && currentPath !== path.dirname(currentPath)) {
    currentPath = path.dirname(currentPath);
  }
  if (fs.existsSync(currentPath)) {
    const realCurrentPath = fs.realpathSync(currentPath);
    if (!realCurrentPath.startsWith(absoluteWorkspace + path.sep) && realCurrentPath !== absoluteWorkspace) {
      throw new Error('Symlink escape detected: Target resolves outside workspace');
    }
  }

  return absoluteTarget;
}

module.exports = { resolveSafePath };
