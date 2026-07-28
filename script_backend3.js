const fs = require('fs');
let c = fs.readFileSync('I:/Astra/backend/index.js', 'utf8');

const oldOrchestrateRegex = /\/\/ Multi-Agent Orchestration scaffold\napp\.post\('\/api\/orchestrate', \(req, res\) => \{\n[\s\S]*?\}\);/;
const newOrchestrate = `// Multi-Agent Orchestration scaffold
app.post('/api/orchestrate', (req, res) => {
  const { task, agents } = req.body;
  // Scaffold: Simulate multiple agents debating/working.
  const logs = [
    { role: 'planner', text: 'Analyzing task: ' + task },
    { role: 'planner', text: 'Breaking down into sub-tasks and delegating to ' + agents.join(', ') },
    { role: 'coder', text: 'Writing initial implementation...' },
    { role: 'reviewer', text: 'Reviewing code. Found 2 issues. Suggesting fixes.' },
    { role: 'coder', text: 'Applying fixes.' },
    { role: 'planner', text: 'Task completed successfully.' }
  ];
  
  // Simulate delay
  setTimeout(() => {
    res.json({ success: true, message: 'Orchestration finished', logs });
  }, 1500);
});`;

c = c.replace(oldOrchestrateRegex, newOrchestrate);
fs.writeFileSync('I:/Astra/backend/index.js', c);
console.log('Backend orchestrate updated.');
