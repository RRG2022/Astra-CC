const path = require('path');
const fs = require('fs');

/**
 * Validates a plugin name and ensures it does not contain path traversal characters.
 * 
 * @param {string} pluginName - The requested plugin name
 * @returns {string} The validated plugin name
 * @throws {Error} If plugin name contains illegal characters
 */
function validatePluginName(pluginName) {
  if (!pluginName || typeof pluginName !== 'string') {
    throw new Error('Invalid plugin name');
  }
  
  // Only allow alphanumeric characters, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
    throw new Error('Invalid plugin name: Contains illegal characters. Path traversal blocked.');
  }

  return pluginName;
}

module.exports = { validatePluginName };
