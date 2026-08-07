import { create } from 'zustand';
import { apiFetch } from '../api.js';


export const useAgentStore = create((set, get) => ({
  models: [],
  traceLogs: [],
  selectedModel: localStorage.getItem('astra_model') || '',
  selectedPersona: 'repo_builder',
  messages: (() => {
    const saved = localStorage.getItem('astra_memory');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  })(),
  promptHistory: (() => {
    const saved = localStorage.getItem('astra_prompt_history');
    try {
      return saved && saved !== 'undefined' ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  })(),
  activeTool: null,
  modelsLoaded: false,
  activeTask: null,
  
  // Persistence state
  conversationId: localStorage.getItem('astra_conversation_id') || null,
  conversationTitle: 'New Chat',
  conversations: [],

  setModels: (m) => set({ models: m }),
  setTraceLogs: (logs) => set({ traceLogs: typeof logs === 'function' ? logs(get().traceLogs) : logs }),
  
  setSelectedModel: (model) => {
    localStorage.setItem('astra_model', model);
    set({ selectedModel: model });
  },
  
  setSelectedPersona: (pers) => set({ selectedPersona: pers }),
  
  setMessages: (messages) => {
    const next = typeof messages === 'function' ? messages(get().messages) : messages;
    localStorage.setItem('astra_memory', JSON.stringify(next));
    set({ messages: next });
  },
  
  setPromptHistory: (history) => {
    const next = typeof history === 'function' ? history(get().promptHistory) : history;
    localStorage.setItem('astra_prompt_history', JSON.stringify(next));
    set({ promptHistory: next });
  },
  
  setActiveTool: (tool) => set({ activeTool: tool }),
  setModelsLoaded: (loaded) => set({ modelsLoaded: loaded }),
  setActiveTask: (task) => set({ activeTask: task }),

  // Persistence Actions
  loadConversations: async (workspacePath) => {
    if (!workspacePath) return;
    try {
      const res = await apiFetch(`/api/conversations?workspacePath=${encodeURIComponent(workspacePath)}`);
      const data = await res.json();
      if (data.success) {
        set({ conversations: data.conversations });
      }
    } catch (e) {
      console.error('Error fetching conversations list:', e);
    }
  },

  loadConversationDetail: async (id, workspacePath) => {
    if (!workspacePath) return;
    try {
      const res = await apiFetch(`/api/conversations/${id}?workspacePath=${encodeURIComponent(workspacePath)}`);
      const data = await res.json();
      if (data.success && data.conversation) {
        localStorage.setItem('astra_conversation_id', id);
        localStorage.setItem('astra_memory', JSON.stringify(data.conversation.messages || []));
        set({
          conversationId: id,
          messages: data.conversation.messages || [],
          conversationTitle: data.conversation.title || 'Untitled Conversation'
        });
      }
    } catch (e) {
      console.error('Error fetching conversation detail:', e);
    }
  },

  saveCurrentConversation: async (workspacePath) => {
    const { conversationId, messages, conversationTitle } = get();
    if (!workspacePath) return;
    
    // Ensure we have a valid conversation ID
    let currentId = conversationId;
    if (!currentId) {
      currentId = crypto.randomUUID();
      localStorage.setItem('astra_conversation_id', currentId);
      set({ conversationId: currentId });
    }

    // Generate a default title if none exists
    let title = conversationTitle;
    if (title === 'New Chat' && messages.length > 0) {
      // Use the first user message content as title
      const firstUserMsg = messages.find(m => m.role === 'user');
      title = firstUserMsg ? firstUserMsg.content.substring(0, 30) + '...' : 'Untitled Conversation';
      set({ conversationTitle: title });
    }

    try {
      await apiFetch(`/api/conversations?workspacePath=${encodeURIComponent(workspacePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentId,
          title,
          messages
        })
      });
      get().loadConversations(workspacePath);
    } catch (e) {
      console.error('Error saving conversation:', e);
    }
  },

  startNewConversation: () => {
    const newId = crypto.randomUUID();
    localStorage.setItem('astra_conversation_id', newId);
    localStorage.removeItem('astra_memory');
    set({
      conversationId: newId,
      messages: [],
      conversationTitle: 'New Chat'
    });
  }
}));
