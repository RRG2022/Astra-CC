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

  // Ensure the target is strictly inside the workspace boundary
  if (!absoluteTarget.startsWith(absoluteWorkspace + path.sep) && absoluteTarget !== absoluteWorkspace) {
    throw new Error('Path traversal detected: Target path escapes workspace boundary');
  }

  return absoluteTarget;
}

module.exports = { resolveSafePath };
