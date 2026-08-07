const { badRequest } = require('./errors');

/**
 * The agent's own task list.
 *
 * Every call carries the *whole* list, not a delta. That is the point: the most
 * recent result in context is always the complete state, so there is no merge
 * to get wrong and no way for the model's idea of its plan to drift from the
 * one the user is looking at.
 *
 * The constraints below are what separate a task list from decoration. A model
 * that marks six things in progress at once has not planned anything, and a
 * list that grows without bound is a place for work to hide.
 */

const STATUSES = ['pending', 'in_progress', 'completed'];

const MAX_TASKS = parseInt(process.env.ASTRA_MAX_TASKS || '30', 10);
const MAX_TASK_CHARS = 200;

async function updateTasks(args) {
  if (!Array.isArray(args.tasks)) {
    throw badRequest(
      'tasks must be an array.',
      'Send the whole list every time, including the items that have not changed.'
    );
  }

  if (args.tasks.length > MAX_TASKS) {
    throw badRequest(
      `Too many tasks (${args.tasks.length}); the limit is ${MAX_TASKS}.`,
      'Group the small steps together — a list nobody can hold in their head is not a plan.'
    );
  }

  const tasks = args.tasks.map((entry, index) => {
    const text = typeof entry?.task === 'string' ? entry.task.trim() : '';
    if (!text) {
      throw badRequest(
        `Task at position ${index} has no text.`,
        'Every entry needs a "task" describing what will be done.'
      );
    }

    const status = entry.status || 'pending';
    if (!STATUSES.includes(status)) {
      throw badRequest(
        `Task at position ${index} has an unknown status "${status}".`,
        `Use one of: ${STATUSES.join(', ')}.`
      );
    }

    return {
      id: String(entry.id || index + 1),
      task: text.length > MAX_TASK_CHARS ? `${text.slice(0, MAX_TASK_CHARS)}…` : text,
      status
    };
  });

  const active = tasks.filter(t => t.status === 'in_progress');
  if (active.length > 1) {
    throw badRequest(
      `${active.length} tasks are marked in_progress at once.`,
      'Exactly one task may be in progress. Finish or re-queue the others.'
    );
  }

  const completed = tasks.filter(t => t.status === 'completed').length;

  return {
    success: true,
    tasks,
    summary: `${completed}/${tasks.length} complete`,
    ...(active.length ? { current: active[0].task } : {})
  };
}

module.exports = { updateTasks, STATUSES, MAX_TASKS };
