import React from 'react';
import Editor from '@monaco-editor/react';
import { X } from 'lucide-react';

const WelcomeScreen = () => (
  <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: 100, height: 100, margin: '0 auto', opacity: 0.1, background: 'var(--text-primary)', borderRadius: '50%' }}></div>
      <h2 style={{ marginTop: '1rem', fontWeight: 400 }}>Astra Editor</h2>
      <p>Select a file to view</p>
    </div>
  </div>
);

const EditorPanel = ({
  openFilesMain,
  setOpenFilesMain,
  activeFileIdMain,
  setActiveFileIdMain,
  openFilesSplit,
  setOpenFilesSplit,
  activeFileIdSplit,
  setActiveFileIdSplit,
  minimapEnabled,
  wordWrap,
  handleEditorMainMount,
  handleEditorSplitMount,
  activeTask
}) => {
  return (
    <div className="editor-pane" style={{ flex: activeTask ? '1 1 60%' : '1 1 100%', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {/* Main Viewport */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: openFilesSplit.length > 0 ? '1px solid var(--border-color)' : 'none' }}>
        {openFilesMain.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="code-viewer-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="code-viewer-header" style={{ display: 'flex', padding: '0', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
              {openFilesMain.map(f => (
                <div 
                  key={f.name} 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: activeFileIdMain === f.name ? 'var(--bg-color)' : 'transparent', borderTop: activeFileIdMain === f.name ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer', borderRight: '1px solid var(--border-color)' }} 
                  onClick={() => setActiveFileIdMain(f.name)}
                >
                  <span style={{ fontSize: '0.85rem', color: activeFileIdMain === f.name ? 'var(--text-primary)' : 'var(--text-secondary)' }}>📄 {f.name.split('/').pop()}{f.unsaved ? ' *' : ''}</span>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      const filtered = openFilesMain.filter(x => x.name !== f.name);
                      setOpenFilesMain(filtered); 
                      if(activeFileIdMain === f.name) {
                        setActiveFileIdMain(filtered[0]?.name || null);
                      }
                    }} 
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="code-viewer-content" style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                height="100%"
                theme="vs-dark"
                path={activeFileIdMain || 'temp'}
                defaultLanguage={activeFileIdMain?.split('.').pop() || 'javascript'}
                value={openFilesMain.find(f => f.name === activeFileIdMain)?.content || ''}
                onMount={handleEditorMainMount}
                onChange={(value) => {
                  setOpenFilesMain(prev => prev.map(f => f.name === activeFileIdMain ? { ...f, content: value, unsaved: true } : f));
                }}
                options={{ readOnly: false, minimap: { enabled: minimapEnabled }, wordWrap: wordWrap ? 'on' : 'off' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Split Viewport */}
      {openFilesSplit.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="code-viewer-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="code-viewer-header" style={{ display: 'flex', padding: '0', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
              {openFilesSplit.map(f => (
                <div 
                  key={f.name} 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: activeFileIdSplit === f.name ? 'var(--bg-color)' : 'transparent', borderTop: activeFileIdSplit === f.name ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer', borderRight: '1px solid var(--border-color)' }} 
                  onClick={() => setActiveFileIdSplit(f.name)}
                >
                  <span style={{ fontSize: '0.85rem', color: activeFileIdSplit === f.name ? 'var(--text-primary)' : 'var(--text-secondary)' }}>📄 {f.name.split('/').pop()}{f.unsaved ? ' *' : ''}</span>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      const filtered = openFilesSplit.filter(x => x.name !== f.name);
                      setOpenFilesSplit(filtered); 
                      if(activeFileIdSplit === f.name) {
                        setActiveFileIdSplit(filtered[0]?.name || null);
                      }
                    }} 
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="code-viewer-content" style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                height="100%"
                theme="vs-dark"
                path={activeFileIdSplit || 'temp'}
                defaultLanguage={activeFileIdSplit?.split('.').pop() || 'javascript'}
                value={openFilesSplit.find(f => f.name === activeFileIdSplit)?.content || ''}
                onMount={handleEditorSplitMount}
                onChange={(value) => {
                  setOpenFilesSplit(prev => prev.map(f => f.name === activeFileIdSplit ? { ...f, content: value, unsaved: true } : f));
                }}
                options={{ readOnly: false, minimap: { enabled: minimapEnabled }, wordWrap: wordWrap ? 'on' : 'off' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorPanel;
export { WelcomeScreen };
