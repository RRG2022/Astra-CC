const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

function getConversationsDir(workspacePath) {
  const dir = path.join(workspacePath, '.astra', 'conversations');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// GET /api/conversations?workspacePath=...
router.get('/', (req, res) => {
  const { workspacePath } = req.query;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
  
  try {
    const dir = getConversationsDir(workspacePath);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    
    const conversations = files.map(file => {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        return {
          id: file.replace('.json', ''),
          title: content.title || 'Untitled Conversation',
          timestamp: content.timestamp || Date.now(),
          messageCount: content.messages ? content.messages.length : 0
        };
      } catch (e) {
        return null;
      }
    }).filter(c => c !== null);

    // Sort by timestamp desc
    conversations.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/conversations/:id?workspacePath=...
router.get('/:id', (req, res) => {
  const { workspacePath } = req.query;
  const { id } = req.params;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
  
  try {
    const dir = getConversationsDir(workspacePath);
    const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ success: true, conversation: content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/conversations?workspacePath=...
router.post('/', (req, res) => {
  const { workspacePath } = req.query;
  const { id, title, messages } = req.body;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });

  try {
    const dir = getConversationsDir(workspacePath);
    const file = path.join(dir, `${id}.json`);
    const payload = {
      id,
      title: title || 'Untitled Conversation',
      timestamp: Date.now(),
      messages: messages || []
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    res.json({ success: true, conversation: payload });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/conversations/:id?workspacePath=...
router.delete('/:id', (req, res) => {
  const { workspacePath } = req.query;
  const { id } = req.params;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });

  try {
    const dir = getConversationsDir(workspacePath);
    const file = path.join(dir, `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Conversation not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
