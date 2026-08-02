const express = require('express');
const router = express.Router();
const shadowGit = require('../../shadowGit');
const path = require('path');
const { resolveSafePath } = require('../../security/safe-path');

// POST /api/shadow/init
router.post('/init', (req, res) => {
  const { workspacePath } = req.body;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
  try {
    shadowGit.ensureInit(workspacePath);
    res.json({ success: true, message: 'Shadow Git initialized.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/shadow/commit
router.post('/commit', async (req, res) => {
  const { workspacePath, filePath } = req.body;
  if (!workspacePath || !filePath) return res.status(400).json({ error: 'workspacePath and filePath are required' });
  try {
    const absolutePath = resolveSafePath(workspacePath, filePath);
    const sha = await shadowGit.commitFile(workspacePath, absolutePath);
    res.json({ success: true, sha });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/shadow/rewind
router.post('/rewind', async (req, res) => {
  const { workspacePath, filePath, commitSha } = req.body;
  if (!workspacePath || !filePath || !commitSha) {
    return res.status(400).json({ error: 'workspacePath, filePath, and commitSha are required' });
  }
  try {
    const absolutePath = resolveSafePath(workspacePath, filePath);
    const recoverySha = await shadowGit.rewindFile(workspacePath, absolutePath, commitSha);
    res.json({ success: true, recoverySha });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/shadow/history
router.post('/history', async (req, res) => {
  const { workspacePath, filePath } = req.body;
  if (!workspacePath || !filePath) return res.status(400).json({ error: 'workspacePath and filePath are required' });
  try {
    const absolutePath = resolveSafePath(workspacePath, filePath);
    const history = shadowGit.getFileHistory(workspacePath, absolutePath);
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/shadow/show
router.post('/show', async (req, res) => {
  const { workspacePath, filePath, commitSha } = req.body;
  if (!workspacePath || !filePath || !commitSha) {
    return res.status(400).json({ error: 'workspacePath, filePath, and commitSha are required' });
  }
  try {
    const absolutePath = resolveSafePath(workspacePath, filePath);
    const content = shadowGit.getFileContentAtCommit(workspacePath, absolutePath, commitSha);
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
