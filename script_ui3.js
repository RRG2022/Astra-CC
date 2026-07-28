const fs = require('fs');
let c = fs.readFileSync('I:/Astra/frontend/src/App.jsx', 'utf8');

// Sidebar icon
const sidebarIconRegex = /<div onClick=\{\(\) => setActiveActivity\('search'\)\} className=\{`sidebar-icon-wrapper \$\{activeActivity === 'search' \? 'active' : ''\}`\}>[\s\S]*?<\/div>/;

const orchestrationIcon = `<div onClick={() => setActiveActivity('search')} className={\`sidebar-icon-wrapper \${activeActivity === 'search' ? 'active' : ''}\`}>
            <Search size={24} />
          </div>
          <div onClick={() => setActiveActivity('orchestrate')} className={\`sidebar-icon-wrapper \${activeActivity === 'orchestrate' ? 'active' : ''}\`} style={{ marginTop: '0.5rem', color: activeActivity === 'orchestrate' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>
            <Users size={24} />
          </div>`;
c = c.replace(sidebarIconRegex, orchestrationIcon);

// Orchestration panel state
const stateInsert = `  const [orchestrationTask, setOrchestrationTask] = useState('');
  const [orchestrationLogs, setOrchestrationLogs] = useState([]);
  const [isOrchestrating, setIsOrchestrating] = useState(false);\n`;
c = c.replace('  const [searchHistory, setSearchHistory] = useState(() => {', stateInsert + '  const [searchHistory, setSearchHistory] = useState(() => {');

// Orchestration run function
const runOrchestration = `
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
  };\n`;
c = c.replace('  const toggleTerminalPane = () => {', runOrchestration + '  const toggleTerminalPane = () => {');

// Orchestration Panel render
const searchPanelRegex = /\{activeActivity === 'search' && \([\s\S]*?<\/>\n            \)\}/;

const searchPanelMatch = c.match(searchPanelRegex)[0];
const orchestrationPanel = `
            {activeActivity === 'orchestrate' && (
              <>
                <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Orchestration</div>
                <div style={{ padding: '0 1rem 1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                  <textarea 
                    value={orchestrationTask} 
                    onChange={e => setOrchestrationTask(e.target.value)} 
                    placeholder="Describe a complex task for multiple agents..."
                    style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', resize: 'vertical', minHeight: '80px' }}
                  />
                  <button onClick={startOrchestration} disabled={isOrchestrating} style={{ background: 'var(--text-primary)', color: 'var(--bg-color)', border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {isOrchestrating ? 'Orchestrating...' : 'Start Orchestration'}
                  </button>
                  <div style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {orchestrationLogs.map((log, i) => (
                      <div key={i} style={{ padding: '0.5rem', background: 'var(--bg-color)', borderRadius: '4px', borderLeft: log.role === 'error' ? '3px solid #f87171' : '3px solid #a855f7' }}>
                        <strong style={{ display: 'block', marginBottom: '0.25rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{log.role}</strong>
                        {log.text}
                      </div>
                    ))}
                    {orchestrationLogs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No logs yet.</div>}
                  </div>
                </div>
              </>
            )}
`;
c = c.replace(searchPanelRegex, searchPanelMatch + orchestrationPanel);

fs.writeFileSync('I:/Astra/frontend/src/App.jsx', c);
console.log('App.jsx modified for orchestration.');
