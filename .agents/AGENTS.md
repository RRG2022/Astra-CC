# Project Architecture & Protection Rules

## Protected Core Components
Do NOT modify these systems without extreme care and cross-verifying dependencies:

1. **Interactive Terminal (`LiveTerminal.jsx`, `InteractiveTerminal.jsx`)**
   - **Status**: Implemented, Tested, Working perfectly.
   - **Dependencies**: 
     - Backend: `node-pty`, WebSockets (`/api/pty` route in `index.js`).
     - Frontend: `xterm.js`, `@xterm/addon-fit`.
   - **Notes**: Modifying `index.js` routes or `server.listen()` can break the WebSocket connection. Ensure the WebSocket server is attached to the main `http.createServer()` and NOT a separate `app.listen()`.

2. **State Management (`App.jsx`)**
   - **Status**: Fragile due to monolithic structure.
   - **Notes**: When extracting components, be extremely careful about passing down state correctly (e.g., `workspacePath`, `activeFile`). Do not redeclare `useState` variables during refactoring.

## Refactoring Guidelines
- **Always document dependencies**: When refactoring a core module, update this file with its dependencies.
- **Verify after modification**: Any change to a backend route or WebSocket must be tested end-to-end (E2E). 
- **Preserve inline features**: We recently moved tool execution logs (like background terminal tasks) to render inline inside the chat sidebar. Do not regress this behavior to a global modal or bottom pane.
