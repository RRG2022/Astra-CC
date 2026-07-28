const fs = require('fs');
let c = fs.readFileSync('I:/Astra/frontend/src/App.jsx', 'utf8');

const functions = `
  const runLinter = async () => {
    setIsLinting(true);
    try {
      const res = await fetch('http://localhost:8789/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspacePath })
      });
      const data = await res.json();
      setProblems(data.problems || []);
    } catch (e) {
      setProblems([]);
    } finally {
      setIsLinting(false);
    }
  };

  const startOrchestration = async () => {
    setIsOrchestrating(true);
    setOrchestrationLogs([{ role: 'system', text: 'Starting multi-agent orchestration for: ' + orchestrationTask }]);
    try {
      const res = await fetch('http://localhost:8789/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: orchestrationTask, agents: ['planner', 'coder', 'reviewer'] })
      });
      const data = await res.json();
      setOrchestrationLogs(prev => [...prev, ...data.logs]);
    } catch (e) {
      setOrchestrationLogs(prev => [...prev, { role: 'error', text: 'Failed to start orchestration.' }]);
    } finally {
      setIsOrchestrating(false);
    }
  };
`;

c = c.replace('  useEffect(() => {\n    const handleMouseMove', functions + '\n  useEffect(() => {\n    const handleMouseMove');

fs.writeFileSync('I:/Astra/frontend/src/App.jsx', c);
