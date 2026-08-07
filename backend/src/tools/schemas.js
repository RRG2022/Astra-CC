/**
 * Canonical tool schemas, owned by the backend.
 *
 * The registry that executes these lives here, so their descriptions live here
 * too — a headless run has no browser to supply them, and a schema that
 * disagrees with the implementation is how `read_file` came to advertise
 * slicing it did not do.
 */
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a file from the workspace. Use offset and limit on large files rather '
        + 'than reading the whole thing; the returned contentHash always covers the '
        + 'entire file and is what edit_file requires.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path relative to the workspace root' },
          offset: { type: 'number', description: 'First line to return (0-indexed)' },
          limit: { type: 'number', description: 'Maximum number of lines to return' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact string in a file. oldString must appear exactly once, so '
        + 'include enough surrounding context to be unique. Requires the contentHash '
        + 'from a prior read_file of the same file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path relative to the workspace root' },
          oldString: { type: 'string', description: 'Exact text to replace, including indentation' },
          newString: { type: 'string', description: 'Text to put in its place' },
          contentHash: { type: 'string', description: 'contentHash returned by read_file' }
        },
        required: ['filePath', 'oldString', 'newString', 'contentHash']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write a whole file, creating parent directories as needed. This replaces the '
        + 'entire contents — prefer edit_file when the file already exists.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path relative to the workspace root' },
          content: { type: 'string', description: 'Full contents to write' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the workspace. Commands that take longer than a few '
        + 'seconds are backgrounded and return a taskId instead of full output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run' },
          reason: { type: 'string', description: 'Why this command is needed' },
          cwd: { type: 'string', description: 'Working directory relative to the workspace root' }
        },
        required: ['command', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the files and directories at a path in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          directoryPath: { type: 'string', description: 'Path relative to the workspace root' }
        },
        required: ['directoryPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description:
        'Search file contents across the workspace for a literal string. '
        + 'node_modules, .git, dist and build are skipped.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for' },
          directoryPath: { type: 'string', description: 'Directory to search in, relative to the workspace root' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_tasks',
      description:
        'Record your plan for a multi-step job and keep it current: mark a task '
        + 'in_progress before starting it and completed the moment it is done. '
        + 'Send the entire list every time — it replaces the previous one, so the '
        + 'list you send is the list the user sees. At most one task may be '
        + 'in_progress. Skip this for work that is a single step.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'The complete task list, in order',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable identifier, kept across updates' },
                task: { type: 'string', description: 'What will be done, in a few words' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Where this task stands'
                }
              },
              required: ['task', 'status']
            }
          }
        },
        required: ['tasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_agent',
      description:
        'Delegate a self-contained piece of work to a sub-agent that has its own '
        + 'context. Use it when answering something would take many tool calls whose '
        + 'details you do not need — surveying a large codebase, tracking down where '
        + 'a behaviour lives — so your own context holds the answer rather than the '
        + 'search. The sub-agent cannot see this conversation and cannot ask you '
        + 'anything: put everything it needs in the task, and expect only its final '
        + 'report back. It has your tools or fewer, never more, and cannot spawn '
        + 'agents of its own.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'The complete instruction, including any context and what the report '
              + 'must contain to be useful to you'
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: restrict the sub-agent to these tools. Defaults to yours '
              + 'apart from spawn_agent.'
          }
        },
        required: ['task']
      }
    }
  }
];

module.exports = { TOOL_SCHEMAS };
