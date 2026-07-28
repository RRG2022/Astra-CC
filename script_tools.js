const fs = require('fs');
let c = fs.readFileSync('I:/Astra/frontend/src/App.jsx', 'utf8');

if (!c.includes('Puzzle')) {
  c = c.replace(/Users } from 'lucide-react'/, "Users, Puzzle } from 'lucide-react'");
}

const stateInsert = `  const [tools, setTools] = useState(() => {
    const saved = localStorage.getItem('astra_tools');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [
        { id: 'web_search', name: 'Web Search', enabled: true, builtIn: true },
        { id: 'file_system', name: 'File System', enabled: true, builtIn: true },
        { id: 'code_execution', name: 'Code Execution', enabled: true, builtIn: true }
      ];
    } catch(e) {
      return [];
    }
  });
  const [showAddTool, setShowAddTool] = useState(false);
  const [newToolForm, setNewToolForm] = useState({ name: '', endpoint: '', description: '' });

  useEffect(() => {
    localStorage.setItem('astra_tools', JSON.stringify(tools));
  }, [tools]);

  const handleToggleTool = (id) => {
    setTools(tools.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };
`;

if (!c.includes('const [tools, setTools] = useState')) {
  c = c.replace(/  const \[showBrowser, setShowBrowser\] = useState\(false\);/, stateInsert + '  const [showBrowser, setShowBrowser] = useState(false);');
}

const sidebarIconRegex = /<div onClick=\{\(\) => setActiveActivity\('orchestrate'\)\} className=\{`sidebar-icon-wrapper \$\{activeActivity === 'orchestrate' \? 'active' : ''\}`\} style=\{\{ marginTop: '0\.5rem', color: activeActivity === 'orchestrate' \? 'var\(--text-primary\)' : 'var\(--text-secondary\)', cursor: 'pointer' \}\}>\s*<Users size=\{24\} \/>\s*<\/div>/;

const toolsIcon = `<div onClick={() => setActiveActivity('orchestrate')} className={\`sidebar-icon-wrapper \${activeActivity === 'orchestrate' ? 'active' : ''}\`} style={{ marginTop: '0.5rem', color: activeActivity === 'orchestrate' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>
            <Users size={24} />
          </div>
          <div onClick={() => setActiveActivity('tools')} className={\`sidebar-icon-wrapper \${activeActivity === 'tools' ? 'active' : ''}\`} style={{ marginTop: '0.5rem', color: activeActivity === 'tools' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>
            <Puzzle size={24} />
          </div>`;

if (!c.includes('<Puzzle size={24} />')) {
  c = c.replace(sidebarIconRegex, toolsIcon);
}

const toolsPanelRegex = /<div className="fs-browser-inline" style=\{\{ flex: 1, overflowY: 'auto', padding: '0\.5rem', background: '#1e1e1e' \}\}>\s*<div style=\{\{ padding: '1rem', color: 'var\(--text-secondary\)', fontSize: '0\.9rem', textAlign: 'center' \}\}>\s*No workspace selected\.\s*<\/div>\s*<\/div>/;

const toolsPanel = `{activeActivity === 'explorer' && (
            <div className="fs-browser-inline" style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', background: '#1e1e1e' }}>
              <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
                No workspace selected.
              </div>
            </div>
          )}
          {activeActivity === 'search' && (
            <div style={{ flex: 1, padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Search functionality coming soon...
            </div>
          )}
          {activeActivity === 'tools' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>Integrations</span>
                <button onClick={() => setShowAddTool(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', padding: 0 }} title="Add Custom Tool"><Plus size={16} /></button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                {tools.map(tool => (
                  <div key={tool.id} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '6px', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{tool.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{tool.builtIn ? 'Built-in Tool' : 'Custom API Tool'}</span>
                    </div>
                    <div 
                      onClick={() => handleToggleTool(tool.id)}
                      style={{ 
                        width: '36px', height: '20px', borderRadius: '10px', 
                        background: tool.enabled ? '#22c55e' : 'var(--border-color)',
                        position: 'relative', cursor: 'pointer', transition: 'background 0.2s'
                      }}>
                      <div style={{ 
                        position: 'absolute', top: '2px', left: tool.enabled ? '18px' : '2px', 
                        width: '16px', height: '16px', borderRadius: '50%', background: '#fff', 
                        transition: 'left 0.2s' 
                      }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}`;

if (!c.includes('activeActivity === \'tools\'')) {
  // need to replace the static fs-browser-inline with conditional blocks
  c = c.replace(/<div className="sidebar-panel" style=\{\{ width: leftSidebarWidth, borderRight: '1px solid var\(--border-color\)', background: '#18181b', display: 'flex', flexDirection: 'column' \}\}>\s*<div style=\{\{ padding: '0\.75rem 1rem', fontSize: '0\.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0\.5px', color: 'var\(--text-secondary\)' \}\}>\s*Explorer\s*<\/div>\s*<div className="fs-browser-inline" style=\{\{ flex: 1, overflowY: 'auto', padding: '0\.5rem', background: '#1e1e1e' \}\}>\s*<div style=\{\{ padding: '1rem', color: 'var\(--text-secondary\)', fontSize: '0\.9rem', textAlign: 'center' \}\}>\s*No workspace selected\.\s*<\/div>\s*<\/div>\s*<\/div>/,
    `<div className="sidebar-panel" style={{ width: leftSidebarWidth, borderRight: '1px solid var(--border-color)', background: '#18181b', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
            {activeActivity === 'explorer' ? 'Explorer' : activeActivity === 'search' ? 'Search' : activeActivity === 'tools' ? 'Tools & Plugins' : 'Panel'}
          </div>
          ${toolsPanel}
        </div>`);
}

const addToolModal = `{showAddTool && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Add Custom Tool</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tool Name</label>
              <input type="text" placeholder="e.g. Jira Ticket Fetcher" value={newToolForm.name} onChange={e => setNewToolForm({...newToolForm, name: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>API Endpoint URL</label>
              <input type="text" placeholder="https://api.example.com/v1/..." value={newToolForm.endpoint} onChange={e => setNewToolForm({...newToolForm, endpoint: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Description (for the agent)</label>
              <textarea placeholder="Tell the agent when to use this tool..." value={newToolForm.description} onChange={e => setNewToolForm({...newToolForm, description: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px', resize: 'vertical', minHeight: '60px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={() => setShowAddTool(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                if (newToolForm.name && newToolForm.endpoint) {
                  const newTool = { id: 'custom_' + Date.now(), name: newToolForm.name, endpoint: newToolForm.endpoint, description: newToolForm.description, enabled: true, builtIn: false };
                  setTools([...tools, newTool]);
                  setNewToolForm({ name: '', endpoint: '', description: '' });
                  setShowAddTool(false);
                  showToast('Custom tool added successfully');
                }
              }} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Add Tool</button>
            </div>
          </div>
        </div>
      )}`;

if (!c.includes('Add Custom Tool')) {
  c = c.replace('{showSettings && (', addToolModal + '\n      {showSettings && (');
}

fs.writeFileSync('I:/Astra/frontend/src/App.jsx', c);
console.log('Done replacing');
