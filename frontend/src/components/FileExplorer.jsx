import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, File, FileText, FileCode, FileImage } from 'lucide-react';
import { apiFetch } from '../lib/api.js';


const FileIcon = ({ filename }) => {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'jsx':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'json':
    case 'html':
    case 'css':
      return <FileCode size={16} color="#58a6ff" />;
    case 'md':
    case 'txt':
      return <FileText size={16} color="#8b949e" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <FileImage size={16} color="#a371f7" />;
    default:
      return <File size={16} color="#8b949e" />;
  }
};

const FileNode = ({ node, level, onFileSelect, onContextMenu, workspacePath }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleToggle = async (e) => {
    e.stopPropagation();
    if (!node.isDirectory) {
      try {
        const res = await apiFetch('/api/tools/fs/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: node.path, workspacePath })
        });
        const data = await res.json();
        if (data.success) {
          onFileSelect({ name: node.name, content: data.content, path: node.path });
        } else {
          console.error(data.error);
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    if (expanded) {
      setExpanded(false);
    } else {
      setExpanded(true);
      if (children.length === 0) {
        setLoading(true);
        try {
          const res = await apiFetch('/api/fs/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dirPath: node.path, workspacePath })
          });
          const data = await res.json();
          if (data.success) {
            setChildren(data.directories);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }
    }
  };

  return (
    <div style={{ userSelect: 'none' }}>
      <div 
        onClick={handleToggle}
        onContextMenu={(e) => onContextMenu && onContextMenu(e, node)}
        className="fs-node"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '4px 8px', 
          paddingLeft: `${level * 12 + 8}px`,
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '0.85rem'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', width: '16px', marginRight: '4px' }}>
          {node.isDirectory ? (
            expanded ? <ChevronDown size={14} color="#8b949e" /> : <ChevronRight size={14} color="#8b949e" />
          ) : (
            <span style={{ width: '14px' }}></span> // Spacer for files without chevrons
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}>
          {node.isDirectory ? (
            <Folder size={16} color="#dcb67a" />
          ) : (
            <FileIcon filename={node.name} />
          )}
        </span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>
      </div>
      
      {expanded && node.isDirectory && (
        <div>
          {loading ? (
            <div style={{ paddingLeft: `${(level + 1) * 12 + 28}px`, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Loading...
            </div>
          ) : (
            children.map((child, idx) => (
              <FileNode 
                key={child.path || idx} 
                node={child} 
                level={level + 1} 
                onFileSelect={onFileSelect} 
                onContextMenu={onContextMenu}
                workspacePath={workspacePath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

const FileExplorer = ({ workspacePath, onFileSelect, onFileSelectSplit }) => {
  const [rootNodes, setRootNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, node: null });

  useEffect(() => {
    const handleClick = () => setContextMenu({ visible: false, x: 0, y: 0, node: null });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.pageX,
      y: e.pageY,
      node
    });
  };

  useEffect(() => {
    if (!workspacePath) return;

    const fetchRoot = async () => {
      setLoading(true);
      try {
        const res = await apiFetch('/api/fs/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dirPath: workspacePath, workspacePath })
        });
        const data = await res.json();
        if (data.success) {
          setRootNodes(data.directories);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRoot();
  }, [workspacePath]);

  if (!workspacePath) {
    return (
      <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
        No workspace selected.
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', background: '#1e1e1e' }}>
      <div style={{ padding: '8px 16px', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '0.05em', color: '#8b949e', textTransform: 'uppercase' }}>
        {workspacePath.split(/[\/\\]/).pop()}
      </div>
      {loading ? (
        <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading workspace...</div>
      ) : (
        rootNodes.map((node, idx) => (
          <FileNode 
            key={node.path || idx} 
            node={node} 
            level={0} 
            onFileSelect={onFileSelect} 
            onContextMenu={handleContextMenu}
            workspacePath={workspacePath}
          />
        ))
      )}

      {contextMenu.visible && contextMenu.node && !contextMenu.node.isDirectory && (
        <div 
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#252526',
            border: '1px solid #454545',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            zIndex: 1000,
            padding: '4px 0',
            minWidth: '160px',
            borderRadius: '4px',
            color: '#cccccc',
            fontSize: '0.85rem'
          }}
        >
          <div 
            className="context-menu-item"
            style={{ padding: '6px 16px', cursor: 'pointer' }}
            onClick={async (e) => {
              e.stopPropagation();
              setContextMenu({ visible: false, x: 0, y: 0, node: null });
              try {
                const res = await apiFetch('/api/tools/fs/read', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: contextMenu.node.path, workspacePath })
                });
                const data = await res.json();
                if (data.success) {
                  onFileSelect({ name: contextMenu.node.name, content: data.content, path: contextMenu.node.path });
                }
              } catch (err) {
                console.error(err);
              }
            }}
            onMouseEnter={(e) => e.target.style.background = '#094771'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
          >
            Open
          </div>
          <div 
            className="context-menu-item"
            style={{ padding: '6px 16px', cursor: 'pointer' }}
            onClick={async (e) => {
              e.stopPropagation();
              setContextMenu({ visible: false, x: 0, y: 0, node: null });
              try {
                const res = await apiFetch('/api/tools/fs/read', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: contextMenu.node.path, workspacePath })
                });
                const data = await res.json();
                if (data.success) {
                  if (onFileSelectSplit) {
                    onFileSelectSplit({ name: contextMenu.node.name, content: data.content, path: contextMenu.node.path });
                  } else {
                    onFileSelect({ name: contextMenu.node.name, content: data.content, path: contextMenu.node.path });
                  }
                }
              } catch (err) {
                console.error(err);
              }
            }}
            onMouseEnter={(e) => e.target.style.background = '#094771'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
          >
            Open to the Side
          </div>
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
