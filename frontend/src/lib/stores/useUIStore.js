import { create } from 'zustand';

export const useUIStore = create((set) => ({
  sidebarWidth: 400,
  leftSidebarWidth: 250,
  isLeftSidebarOpen: true,
  activeActivity: 'explorer',
  showTerminalPane: false,
  activeTerminalTab: 'shell-1',
  shells: [{ id: 'shell-1' }],
  wordWrap: true,
  minimapEnabled: false,
  toastNotification: null,
  showSettings: false,
  showBrowser: false,
  showAddTool: false,
  showPluginInstaller: false,
  showWebSearchConfig: false,

  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setLeftSidebarWidth: (w) => set({ leftSidebarWidth: w }),
  setIsLeftSidebarOpen: (open) => set({ isLeftSidebarOpen: open }),
  setActiveActivity: (act) => set({ activeActivity: act }),
  setShowTerminalPane: (show) => set({ showTerminalPane: show }),
  setActiveTerminalTab: (tab) => set({ activeTerminalTab: tab }),
  setShells: (s) => set({ shells: s }),
  setWordWrap: (w) => set({ wordWrap: w }),
  setMinimapEnabled: (m) => set({ minimapEnabled: m }),
  
  showToast: (title, message) => {
    set({ toastNotification: { title, message, timestamp: Date.now() } });
    setTimeout(() => set({ toastNotification: null }), 5000);
  },
  setToastNotification: (toast) => set({ toastNotification: toast }),
  
  setShowSettings: (show) => set({ showSettings: show }),
  setShowBrowser: (show) => set({ showBrowser: show }),
  setShowAddTool: (show) => set({ showAddTool: show }),
  setShowPluginInstaller: (show) => set({ showPluginInstaller: show }),
  setShowWebSearchConfig: (show) => set({ showWebSearchConfig: show })
}));
