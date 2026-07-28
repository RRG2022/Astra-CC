const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');

const problemsBlock = `
const { exec } = require('child_process');
app.post('/api/problems', (req, res) => {
  const { workspace } = req.body;
  if (!workspace) return res.json({ problems: [] });
  
  exec('npx eslint . -f json', { cwd: workspace }, (error, stdout, stderr) => {
    try {
      const results = JSON.parse(stdout);
      const problems = [];
      results.forEach(fileRes => {
        fileRes.messages.forEach(msg => {
          problems.push({
            file: fileRes.filePath.replace(workspace, ''),
            line: msg.line,
            message: msg.message,
            severity: msg.severity
          });
        });
      });
      res.json({ problems });
    } catch (e) {
      console.error('Linting parsing error', e.message);
      // Fallback if no eslint
      res.json({ problems: [] });
    }
  });
});\n`;

c = c.replace('// Start Express Server', problemsBlock + '\n// Start Express Server');
fs.writeFileSync('I:/Astra/backend/index.js', c);
console.log('Backend updated with problems endpoint');
