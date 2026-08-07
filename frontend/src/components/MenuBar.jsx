import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { useFileStore } from '../lib/stores/useFileStore';

export default function MenuBar({ executeEditorAction, handleRunActiveFile, handleNewTerminal, handleCloseTerminal }) {
  const [activeMenu, setActiveMenu] = useState(null);

  const { wordWrap, setWordWrap, minimapEnabled, setMinimapEnabled, showTerminalPane, setShowTerminalPane, setShowSettings, setToastNotification } = useUIStore();
  const { activeFileIdMain, setOpenFilesMain, setActiveFileIdMain, openFilesMain, handleSaveFile, handleNewFile } = useFileStore();

  return (
    <div className="menu-bar" style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', position: 'relative' }}>
      {/* File Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>File</span>
        {activeMenu === 'file' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '150px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); handleNewFile(); }}>New File</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); useUIStore.getState().setShowBrowser(true); }}>Open Folder</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={() => { setActiveMenu(null); if (activeFileIdMain) handleSaveFile(activeFileIdMain); }}>Save</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={() => {
              setActiveMenu(null);
              if (activeFileIdMain) {
                setOpenFilesMain(prev => prev.filter(x => x.name !== activeFileIdMain));
                setActiveFileIdMain(openFilesMain[0]?.name !== activeFileIdMain ? openFilesMain[0]?.name : openFilesMain[1]?.name || null);
              }
            }}>Close File</span>
          </div>
        )}
      </div>

      {/* Edit Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}>Edit</span>
        {activeMenu === 'edit' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('undo'); setActiveMenu(null); }}>Undo</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('redo'); setActiveMenu(null); }}>Redo</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.clipboardCutAction'); setActiveMenu(null); }}>Cut</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.clipboardCopyAction'); setActiveMenu(null); }}>Copy</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.clipboardPasteAction'); setActiveMenu(null); }}>Paste</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('actions.find'); setActiveMenu(null); }}>Find</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.startFindReplaceAction'); setActiveMenu(null); }}>Replace</span>
          </div>
        )}
      </div>

      {/* Selection Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'selection' ? null : 'selection')}>Selection</span>
        {activeMenu === 'selection' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.selectAll'); setActiveMenu(null); }}>Select All</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.smartSelect.expand'); setActiveMenu(null); }}>Expand Selection</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.smartSelect.shrink'); setActiveMenu(null); }}>Shrink Selection</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.copyLinesUpAction'); setActiveMenu(null); }}>Copy Line Up</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.copyLinesDownAction'); setActiveMenu(null); }}>Copy Line Down</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.moveLinesUpAction'); setActiveMenu(null); }}>Move Line Up</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.moveLinesDownAction'); setActiveMenu(null); }}>Move Line Down</span>
          </div>
        )}
      </div>

      {/* View Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}>View</span>
        {activeMenu === 'view' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setWordWrap(!wordWrap); setActiveMenu(null); }}>
              Word Wrap <span>{wordWrap && '✓'}</span>
            </span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setMinimapEnabled(!minimapEnabled); setActiveMenu(null); }}>
              Minimap <span>{minimapEnabled && '✓'}</span>
            </span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setShowTerminalPane(!showTerminalPane); setActiveMenu(null); }}>
              Terminal Panel <span>{showTerminalPane && '✓'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Go Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'go' ? null : 'go')}>Go</span>
        {activeMenu === 'go' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.gotoLine'); setActiveMenu(null); }}>Go to Line/Column...</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.quickOutline'); setActiveMenu(null); }}>Go to Symbol in File...</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.revealDefinition'); setActiveMenu(null); }}>Go to Definition</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.referenceSearch.trigger'); setActiveMenu(null); }}>Go to References</span>
          </div>
        )}
      </div>

      {/* Run Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'run' ? null : 'run')}>Run</span>
        {activeMenu === 'run' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', color: activeFileIdMain ? 'var(--text-primary)' : 'var(--text-secondary)' }} className="menu-item" onClick={() => { handleRunActiveFile(); setActiveMenu(null); }}>
              <Play size={14} style={{ display: 'inline', marginRight: '8px' }} />
              Run Active File
            </span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { executeEditorAction('editor.action.showHover'); setActiveMenu(null); }}>Show Hover</span>
          </div>
        )}
      </div>

      {/* Terminal Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'terminal' ? null : 'terminal')}>Terminal</span>
        {activeMenu === 'terminal' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { handleNewTerminal(); setActiveMenu(null); }}>New Terminal</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { handleNewTerminal(); setActiveMenu(null); }}>Split Terminal</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { handleCloseTerminal(); setActiveMenu(null); }}>Close Terminal</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="menu-item" onClick={() => { setShowTerminalPane(!showTerminalPane); setActiveMenu(null); }}>
              Toggle Panel <span>{showTerminalPane && '✓'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Settings Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'settings' ? null : 'settings')}>Settings</span>
        {activeMenu === 'settings' && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setShowSettings(true); }}>Preferences...</span>
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}>Help</span>
        {activeMenu === 'help' && (
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px', zIndex: 100 }}>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Welcome to Astra IDE! Try creating a file to get started.' }); setTimeout(() => setToastNotification(null), 4000); }}>Welcome</span>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Documentation opens in a new tab...' }); setTimeout(() => setToastNotification(null), 3000); }}>Documentation</span>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }}></div>
            <span style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px' }} className="menu-item" onClick={() => { setActiveMenu(null); setToastNotification({ type: 'info', message: 'Astra IDE v1.0.0' }); setTimeout(() => setToastNotification(null), 3000); }}>About</span>
          </div>
        )}
      </div>
    </div>
  );
}
