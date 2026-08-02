import { create } from 'zustand';

export const useWorkspaceStore = create((set, get) => ({
  workspacePath: localStorage.getItem('astra_workspace') || '',
  fsNodes: [],
  
  setWorkspacePath: (path) => {
    localStorage.setItem('astra_workspace', path);
    set({ workspacePath: path });
  },
  
  setFsNodes: (nodes) => set({ fsNodes: nodes }),
  
  fetchDir: async (pathStr = '') => {
    const wsPath = pathStr || get().workspacePath;
    try {
      const res = await fetch('http://localhost:8789/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: wsPath })
      });
      const data = await res.json();
      if (data.success) {
        set({ fsNodes: data.directories });
      }
    } catch (e) {
      console.error('Error fetching directory:', e);
    }
  }
}));
