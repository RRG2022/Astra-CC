const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const os = require('os');

const ASTRA_DIR = path.join(os.homedir(), '.astra');
if (!fs.existsSync(ASTRA_DIR)) {
  fs.mkdirSync(ASTRA_DIR, { recursive: true });
}
const SETTINGS_FILE = path.join(ASTRA_DIR, 'settings.json');

function getSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading settings.json:', e);
    }
  }
  return { apiKeys: { openai: '', anthropic: '', gemini: '' } };
}

router.get('/', (req, res) => {
  const settings = getSettings();
  const maskedSettings = { ...settings };
  if (maskedSettings.apiKeys) {
    maskedSettings.apiKeys = {
      openai: !!maskedSettings.apiKeys.openai,
      anthropic: !!maskedSettings.apiKeys.anthropic,
      gemini: !!maskedSettings.apiKeys.gemini,
    };
  }
  res.json(maskedSettings);
});

router.post('/', (req, res) => {
  try {
    const existingSettings = getSettings();
    const newSettings = req.body;
    
    // Do not overwrite existing keys with the masked boolean values
    if (newSettings.apiKeys && existingSettings.apiKeys) {
      ['openai', 'anthropic', 'gemini'].forEach(provider => {
        if (newSettings.apiKeys[provider] === true || newSettings.apiKeys[provider] === 'true') {
          newSettings.apiKeys[provider] = existingSettings.apiKeys[provider];
        } else if (newSettings.apiKeys[provider] === false || newSettings.apiKeys[provider] === 'false') {
          newSettings.apiKeys[provider] = existingSettings.apiKeys[provider] || '';
        }
      });
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { router, getSettings };
