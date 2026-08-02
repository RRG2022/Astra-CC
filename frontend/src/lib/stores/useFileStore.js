import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore';

export const useFileStore = create((set, get) => ({
  openFilesMain: [],
  activeFileIdMain: null,
  openFilesSplit: [],
  activeFileIdSplit: null,

  setOpenFilesMain: (files) => set({ openFilesMain: typeof files === 'function' ? files(get().openFilesMain) : files }),
  setActiveFileIdMain: (id) => set({ activeFileIdMain: id }),
  setOpenFilesSplit: (files) => set({ openFilesSplit: typeof files === 'function' ? files(get().openFilesSplit) : files }),
  setActiveFileIdSplit: (id) => set({ activeFileIdSplit: id }),

  handleSaveFile: async (filePath) => {
    const { openFilesMain, openFilesSplit } = get();
    const workspacePath = useWorkspaceStore.getState().workspacePath;
    
    const fileObj = openFilesMain.find(f => f.name === filePath) || openFilesSplit.find(f => f.name === filePath);
    if (!fileObj || !fileObj.unsaved) return;
    
    try {
      const res = await fetch('http://localhost:8789/api/tools/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, content: fileObj.content, workspacePath })
      });
      const data = await res.json();
      if (data.success) {
        set({
          openFilesMain: openFilesMain.map(f => f.name === filePath ? { ...f, unsaved: false } : f),
          openFilesSplit: openFilesSplit.map(f => f.name === filePath ? { ...f, unsaved: false } : f)
        });
        return true;
      }
    } catch(e) {
      console.error('Save failed', e);
    }
    return false;
  },

  handleNewFile: () => {
    const { openFilesMain } = get();
    let i = 1;
    while (openFilesMain.some(f => f.name === `Untitled-${i}`)) i++;
    const newName = `Untitled-${i}`;
    set({
      openFilesMain: [...openFilesMain, { name: newName, content: '', unsaved: true }],
      activeFileIdMain: newName
    });
  }
}));
