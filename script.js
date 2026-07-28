const fs = require('fs');
let c = fs.readFileSync('I:/Astra/frontend/src/App.jsx', 'utf8');

const stateInsert = `  const [activeMenu, setActiveMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ openai: '', anthropic: '', gemini: '' });\n`;
c = c.replace('  const [searchHistory, setSearchHistory] = useState(() => {', stateInsert + '  const [searchHistory, setSearchHistory] = useState(() => {');

const useEffectInsert = `  useEffect(() => {
    fetch('http://localhost:8789/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data && data.apiKeys) {
          setSettingsForm(data.apiKeys);
        }
      })
      .catch(err => console.error('Error fetching settings:', err));
  }, []);\n`;
c = c.replace('  useEffect(() => {', useEffectInsert + '  useEffect(() => {');

c = c.replace('<div className="app-container">', '<div className="app-container" onClick={(e) => { if (activeMenu && !e.target.closest(".menu-bar")) setActiveMenu(null); }}>');

const oldHeaderRegex = /<div className="menu-bar" style={{ display: 'flex', gap: '1rem', fontSize: '0\.85rem', color: 'var\(--text-secondary\)' }}>[\s\S]*?<\/div>/;

const newHeader = `<div className="menu-bar" style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>File</span>
              {activeMenu === 'file' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '150px', zIndex: 100 }}>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); console.log('New File'); }}>New File</span>
                  <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setShowBrowser(true); }}>Open Folder</span>
                </div>
              )}
            </div>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>Edit</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>Selection</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>View</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>Go</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>Run</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setActiveMenu(null); setShowTerminalPane(true); }}>Terminal</span>
            <span style={{ cursor: 'pointer' }} onClick={() => { setActiveMenu(null); setShowSettings(true); }}>Settings</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(null)}>Help</span>
          </div>`;
c = c.replace(oldHeaderRegex, newHeader);

const settingsModal = `{showSettings && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Settings</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>OpenAI API Key</label>
              <input type="password" value={settingsForm.openai || ''} onChange={e => setSettingsForm({...settingsForm, openai: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Anthropic API Key</label>
              <input type="password" value={settingsForm.anthropic || ''} onChange={e => setSettingsForm({...settingsForm, anthropic: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gemini API Key</label>
              <input type="password" value={settingsForm.gemini || ''} onChange={e => setSettingsForm({...settingsForm, gemini: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                fetch('http://localhost:8789/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ apiKeys: settingsForm })
                })
                .then(res => res.json())
                .then(data => {
                  if (data.success) {
                    showToast('Settings saved successfully');
                    setShowSettings(false);
                  }
                });
              }} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
            </div>
          </div>
        </div>
      )}\n      `;

c = c.replace('{showBrowser && (', settingsModal + '{showBrowser && (');

c = c.replace('</style>', '.menu-item:hover { background: #2a2a2a; }\n</style>');

fs.writeFileSync('I:/Astra/frontend/src/App.jsx', c);
console.log('App.jsx modified successfully!');
