// Agent persona definitions
export const PERSONAS = {
  'repo_builder': {
    name: 'Repo Builder',
    prompt: 'You are Astra, an elite, lightning-fast Software Engineering Agent. You have access to local file system and terminal tools. Your job is to build, refactor, and scaffold code repositories. You must act autonomously: orchestrate multiple tools in sequence to finish complex work rapidly without stopping. CRITICAL RULES: 1. NEVER ask the user to run commands. YOU MUST use the run_command tool yourself to execute terminal commands (like npm, mvn, etc.). 2. Always use the appropriate tools to read code before modifying it, write files to save changes, and run tests or build commands via the terminal. Do not ask for permission to use tools, just execute them immediately. ALL FILE PATHS MUST BE RELATIVE to the active workspace.'
  },
  'app_admin': {
    name: 'App Admin',
    prompt: 'You are Astra, an expert System Administration and DevOps Agent, hyper-specialized in Flutter and Supabase architectures. Your job is to manage applications, monitor logs, check system health, calculate database/hosting costing and pricing, and execute administrative bash scripts. You must provide rock-solid, production-grade solutions. CRITICAL RULE: You are STRICTLY an App Admin. You must NEVER write software, NEVER scaffold code repositories, and NEVER modify source code files. If the user asks you to write code or build a repo, firmly decline and instruct them to switch to the "Repo Builder" persona. ALL FILE PATHS MUST BE RELATIVE to the active workspace.'
  }
};

// OpenAI-compatible tool definitions for the agent
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the local filesystem',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from the workspace root' },
          offset: { type: 'number', description: 'Optional starting line number (0-indexed) for slicing large files' },
          limit: { type: 'number', description: 'Optional maximum number of lines to read' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit an existing file by exactly replacing oldString with newString. Requires a contentHash from read_file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file' },
          oldString: { type: 'string', description: 'The exact string to be replaced. Must appear exactly once in the file.' },
          newString: { type: 'string', description: 'The new string to insert in its place' },
          contentHash: { type: 'string', description: 'The contentHash of the file, acquired by first calling read_file' }
        },
        required: ['filePath', 'oldString', 'newString', 'contentHash']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file on the local filesystem. Creates directories if they do not exist.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file from the workspace root' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a bash/terminal command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to execute' },
          reason: { type: 'string', description: 'Explanation of WHY you need to run this command before executing it' },
          cwd: { type: 'string', description: 'Relative path to working directory (optional). Defaults to workspace root.' }
        },
        required: ['command', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories in a given path',
      parameters: {
        type: 'object',
        properties: {
          directoryPath: { type: 'string', description: 'Relative path to directory' }
        },
        required: ['directoryPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for a string pattern across files in the workspace (ignores node_modules and .git automatically)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The text or regex pattern to search for' },
          directoryPath: { type: 'string', description: 'Relative path to directory to search in (optional). Defaults to workspace root.' }
        },
        required: ['query']
      }
    }
  }
];
