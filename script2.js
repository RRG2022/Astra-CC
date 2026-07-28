const fs = require('fs');
let c = fs.readFileSync('I:/Astra/frontend/src/App.jsx', 'utf8');

// 1. Insert states
const stateInsert = `  const [outputLogs, setOutputLogs] = useState([]);
  const [problems, setProblems] = useState(null);
  const [isLinting, setIsLinting] = useState(false);\n`;
c = c.replace('  const [activeTerminalTab, setActiveTerminalTab] = useState(\'shell-1\');', '  const [activeTerminalTab, setActiveTerminalTab] = useState(\'shell-1\');\n' + stateInsert);

// 2. Fetch SSE for output
const useEffectInsert = `  useEffect(() => {
    const sse = new EventSource('http://localhost:8789/api/output/stream');
    sse.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setOutputLogs(prev => [...prev, log]);
      } catch (err) {}
    };
    return () => sse.close();
  }, []);\n`;
c = c.replace('  useEffect(() => {\n    fetch(\'http://localhost:8789/api/settings\')', useEffectInsert + '  useEffect(() => {\n    fetch(\'http://localhost:8789/api/settings\')');

// 3. Lint function
const fetchProblems = `
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
`;
c = c.replace('  const toggleTerminalPane = () => {', fetchProblems + '  const toggleTerminalPane = () => {');

// 4. Output Tab replace
const oldOutputRegex = /\{activeTerminalTab === 'output' && \([\s\S]*?<\/div>[\s\S]*?\)\}/;
const newOutput = `{activeTerminalTab === 'output' && (
                  <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {outputLogs.map((log, i) => (
                      <div key={i} style={{ color: log.type === 'error' ? '#f87171' : 'var(--text-primary)', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--text-secondary)', marginRight: '0.5rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        {log.msg}
                      </div>
                    ))}
                    {outputLogs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No output from backend...</div>}
                  </div>
                )}`;
c = c.replace(oldOutputRegex, newOutput);

// 5. Problems Tab replace
const oldProblemsRegex = /\{activeTerminalTab === 'problems' && \([\s\S]*?<\/div>[\s\S]*?\)\}/;
const newProblems = `{activeTerminalTab === 'problems' && (
                  <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 1rem' }}>
                      <h3 style={{ margin: 0 }}>Problems</h3>
                      <button onClick={runLinter} disabled={isLinting} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.25rem 0.5rem', cursor: 'pointer', borderRadius: '4px' }}>
                        {isLinting ? 'Linting...' : 'Run Linter'}
                      </button>
                    </div>
                    {problems === null ? (
                      <div style={{ color: 'var(--text-secondary)', padding: '0 1rem' }}>Click "Run Linter" to scan workspace.</div>
                    ) : problems.length === 0 ? (
                      <div style={{ color: '#4ade80', padding: '0 1rem' }}>No problems detected in the workspace!</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {problems.map((p, i) => (
                          <div key={i} style={{ padding: '0.25rem 1rem', display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                            <span style={{ color: p.severity === 2 ? '#f87171' : '#facc15', width: '20px' }}>{p.severity === 2 ? '✖' : '⚠'}</span>
                            <span style={{ flex: 1 }}>{p.message}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{p.file}:{p.line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}`;
c = c.replace(oldProblemsRegex, newProblems);

fs.writeFileSync('I:/Astra/frontend/src/App.jsx', c);
console.log('App.jsx modified with output and problems.');
