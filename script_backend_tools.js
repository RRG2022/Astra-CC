const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');

const toolsBlock = `
// Tools Integration Endpoint
let customTools = [];
app.get('/api/tools', (req, res) => {
  res.json({
    builtIn: [
      { id: 'web_search', name: 'Web Search', description: 'Search the web for real-time information.' },
      { id: 'file_system', name: 'File System', description: 'Read and write local files.' },
      { id: 'code_execution', name: 'Code Execution', description: 'Execute code in a sandboxed environment.' }
    ],
    custom: customTools
  });
});

app.post('/api/tools/custom', (req, res) => {
  const { tool } = req.body;
  if (tool) {
    customTools.push(tool);
    res.json({ success: true, tools: customTools });
  } else {
    res.status(400).json({ error: 'No tool provided' });
  }
});
`;

if (!c.includes('/api/tools')) {
  c = c.replace(/app\.listen\(PORT/, toolsBlock + '\napp.listen(PORT');
  fs.writeFileSync('I:/Astra/backend/index.js', c);
  console.log('Backend tools scaffold added');
} else {
  console.log('Backend tools scaffold already exists');
}
