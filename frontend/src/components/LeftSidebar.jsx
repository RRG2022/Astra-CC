import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { useAgentStore } from '../lib/stores/useAgentStore';
import { useFileStore } from '../lib/stores/useFileStore';
import { apiFetch } from '../lib/api';
import FileExplorer from './FileExplorer';
import CheckpointPanel from './CheckpointPanel';
import JSONPreview from './JSONPreview';

export default function LeftSidebar({ handleRewind }) {
  const { activeActivity, leftSidebarWidth, isLeftSidebarOpen, setIsLeftSidebarOpen } = useUIStore();
  const { workspacePath } = useWorkspaceStore();
  const { traceLogs } = useAgentStore();
  const { setOpenFilesMain, setActiveFileIdMain, setOpenFilesSplit, setActiveFileIdSplit } = useFileStore();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('astra_search_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [searchHistoryIndex, setSearchHistoryIndex] = useState(-1);

  useEffect(() => {
    localStorage.setItem('astra_search_history', JSON.stringify(searchHistory));
  }, [searchHistory]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchHistory(prev => {
      const filtered = prev.filter(q => q !== searchQuery.trim());
      return [searchQuery.trim(), ...filtered].slice(0, 50);
    });
    setSearchHistoryIndex(-1);
    try {
      const res = await apiFetch('/api/fs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, query: searchQuery })
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.results);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  if (!isLeftSidebarOpen) return null;

  return (
    <div className="sidebar-panel" style={{ width: leftSidebarWidth, borderRight: '1px solid var(--border-color)', background: '#18181b', display: 'flex', flexDirection: 'column' }}>
      {/* Trace Logs */}
      {activeActivity === 'trace' && (
        <>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
            Trace Logs
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem 1rem' }}>
            {traceLogs.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No trace logs recorded yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {traceLogs.map((log, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      <span style={{ fontWeight: 600 }}>Turn {traceLogs.length - idx}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ color: '#aaa' }}>Model: </span> <span style={{ color: '#fff' }}>{log.model}</span>
                    </div>
                    <JSONPreview title="Request Payload (apiMessages & tools)" data={log.requestPayload} />
                    <JSONPreview title="Raw Response Buffer (NDJSON chunks)" data={log.rawBuffer} isString={true} />
                    <JSONPreview title="Parsed Tool Calls" data={log.parsedToolCalls} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Checkpoints */}
      {activeActivity === 'checkpoints' && (
        <CheckpointPanel onClose={() => setIsLeftSidebarOpen(false)} handleRewind={handleRewind} />
      )}

      {/* Explorer */}
      {activeActivity === 'explorer' && (
        <>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Explorer</div>
          <div className="fs-browser-inline" style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', background: '#1e1e1e' }}>
            <FileExplorer
              workspacePath={workspacePath}
              onFileSelect={(fileData) => {
                setOpenFilesMain(prev => prev.find(f => f.name === fileData.name) ? prev : [...prev, fileData]);
                setActiveFileIdMain(fileData.name);
              }}
              onFileSelectSplit={(fileData) => {
                setOpenFilesSplit(prev => prev.find(f => f.name === fileData.name) ? prev : [...prev, fileData]);
                setActiveFileIdSplit(fileData.name);
              }}
            />
          </div>
        </>
      )}

      {/* Search */}
      {activeActivity === 'search' && (
        <>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Search</div>
          <div style={{ padding: '0 1rem 1rem', flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input
                type="text"
                list="search-history-list"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                  else if (e.key === 'ArrowUp') {
                    if (searchHistory.length > 0 && searchHistoryIndex < searchHistory.length - 1) {
                      e.preventDefault();
                      const nextIndex = searchHistoryIndex + 1;
                      setSearchHistoryIndex(nextIndex);
                      setSearchQuery(searchHistory[nextIndex]);
                    }
                  } else if (e.key === 'ArrowDown') {
                    if (searchHistoryIndex >= 0) {
                      e.preventDefault();
                      const prevIndex = searchHistoryIndex - 1;
                      setSearchHistoryIndex(prevIndex);
                      setSearchQuery(prevIndex >= 0 ? searchHistory[prevIndex] : '');
                    }
                  }
                }}
                placeholder="Search files..."
                style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', borderRadius: '4px', outline: 'none' }}
              />
              <datalist id="search-history-list">
                {searchHistory.map((h, i) => <option key={i} value={h} />)}
              </datalist>
              <button
                onClick={handleSearch}
                disabled={isSearching}
                style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
              >
                <Search size={16} />
              </button>
            </div>

            {isSearching ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching...</div>
            ) : searchResults ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {searchResults.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No results found.</div>
                ) : (
                  searchResults.map((res, i) => (
                    <div
                      key={i}
                      onClick={async () => {
                        try {
                          const fileRes = await apiFetch('/api/tools/fs/read', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filePath: res.file, workspacePath })
                          });
                          const fileData = await fileRes.json();
                          if (fileData.success) {
                            const fData = { name: res.file, content: fileData.content };
                            setOpenFilesMain(prev => prev.find(f => f.name === fData.name) ? prev : [...prev, fData]);
                            setActiveFileIdMain(fData.name);
                          }
                        } catch(e) {}
                      }}
                      style={{ background: 'var(--surface-color)', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border-color)' }}
                    >
                      <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.25rem', wordBreak: 'break-all' }}>{res.file.split('/').pop()} <span style={{ color: 'var(--text-secondary)' }}>:{res.line}</span></div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.text}</div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Type to search your workspace.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
