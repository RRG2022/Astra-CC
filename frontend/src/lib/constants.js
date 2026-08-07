// Display metadata only. The actual persona prompts and their tool allowlists
// live server-side (backend/src/agent/personas.js) so a client cannot widen a
// persona's capabilities or drop the project's AGENTS.md rules.
//
// Tool schemas are not here either: backend/src/tools/schemas.js owns them,
// alongside the registry that executes them. The client sends none, so there
// is nothing for the two to disagree about.
export const PERSONAS = {
  'repo_builder': { name: 'Repo Builder' },
  'app_admin': { name: 'App Admin' }
};
