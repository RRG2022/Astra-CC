# Project Architecture & Protection Rules

## Protected Core Components
Do NOT modify these systems without extreme care and cross-verifying dependencies:

1. **Interactive Terminal (`LiveTerminal.jsx`, `InteractiveTerminal.jsx`)**
   - **Status**: Implemented, Tested, Working perfectly.
   - **Dependencies**: 
     - Backend: `node-pty`, WebSockets (`/api/pty` route in `index.js`).
     - Frontend: `xterm.js`, `@xterm/addon-fit`.
   - **Notes**: Modifying `index.js` routes or `server.listen()` can break the WebSocket connection. Ensure the WebSocket server is attached to the main `http.createServer()` and NOT a separate `app.listen()`.

2. **State Management & Modular UI (`App.jsx`)**
   - **Status**: Refactored & Modularized. `App.jsx` serves as the slim top-level shell (~530 lines).
   - **Extracted Modules**:
     - `frontend/src/lib/constants.js`: System personas (`PERSONAS`) and OpenAI tool definitions (`TOOLS`).
     - `frontend/src/lib/api.js`: Centralized `apiFetch`, auth header injection, WebSocket/SSE URL builders.
     - `frontend/src/components/MenuBar.jsx`: Top menu bar (File, Edit, Selection, View, Go, Run, Terminal, Settings, Help).
     - `frontend/src/components/ChatHeader.jsx`: Right header workspace input, persona selector, memory clear.
     - `frontend/src/components/ActivityBar.jsx`: Left vertical activity bar icons.
     - `frontend/src/components/LeftSidebar.jsx`: Explorer, search panel, trace logs, checkpoint history.
     - `frontend/src/components/TerminalPane.jsx`: Bottom terminal container (Interactive, Task, Problems/Linting, Output SSE logs).
     - `frontend/src/components/SettingsModal.jsx`: Preferences & API keys modal.
     - `frontend/src/components/WorkspaceBrowser.jsx`: Folder selector modal.
     - `frontend/src/components/ToastOverlay.jsx`: Active model download notifications & app toasts.
   - **Notes**: When refactoring or adding state, do not re-monolith `App.jsx`. Keep UI component state local to extracted components or in Zustand stores (`useUIStore`, `useFileStore`, `useWorkspaceStore`, `useAgentStore`).

## Refactoring Guidelines
- **Always document dependencies**: When refactoring a core module, update this file with its dependencies.
- **Verify after modification**: Any change to a backend route or WebSocket must be tested end-to-end (E2E). 
- **Preserve inline features**: Tool execution logs render inline inside `ChatSidebar.jsx`. Do not regress this behavior.
