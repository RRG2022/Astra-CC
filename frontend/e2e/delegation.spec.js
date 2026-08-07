import { test, expect } from 'playwright/test';
import { createSessionMock, ev, installBaseRoutes, sendPrompt } from './fixtures';

test.describe('task list', () => {
  test('renders the plan and marks progress as the server reports it', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.tasksUpdated([
        { id: '1', task: 'Read the config', status: 'completed' },
        { id: '2', task: 'Change the port', status: 'in_progress' },
        { id: '3', task: 'Run the tests', status: 'pending' }
      ]),
      ev.content('Working through it.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await mock.install(page);

    await sendPrompt(page, 'change the port and verify');

    const list = page.getByTestId('task-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('1/3');
    await expect(list.getByText('Change the port')).toBeVisible();
    await expect(list.getByText('Run the tests')).toBeVisible();
  });

  test('a later list replaces the earlier one rather than appending to it', async ({ page }) => {
    // The tool replaces the whole list every call, so the UI must not
    // accumulate — a plan that only ever grows is worse than none.
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.tasksUpdated([
        { id: '1', task: 'Draft the change', status: 'in_progress' },
        { id: '2', task: 'Review it', status: 'pending' }
      ]),
      ev.tasksUpdated([
        { id: '1', task: 'Draft the change', status: 'completed' },
        { id: '2', task: 'Review it', status: 'completed' }
      ]),
      ev.content('Done.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await mock.install(page);

    await sendPrompt(page, 'draft and review');

    const list = page.getByTestId('task-list');
    await expect(list).toContainText('2/2');
    await expect(list.getByText('Draft the change')).toHaveCount(1);
  });

  test('no plan means no panel', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(ev.messageStart(), ev.content('A one-step answer.'), ev.completed('complete'));

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'what is 2 + 2?');

    await expect(page.getByText('A one-step answer.')).toBeVisible();
    await expect(page.getByTestId('task-list')).toHaveCount(0);
  });
});

test.describe('sub-agent activity', () => {
  test('shows what a running sub-agent is doing, then clears when it ends', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.subAgent({ callId: 'call_9', phase: 'started', task: 'Survey the routes directory.' }),
      ev.subAgent({ callId: 'call_9', phase: 'tool', name: 'list_dir' }),
      ev.subAgent({ callId: 'call_9', phase: 'tool', name: 'grep_search' })
    );
    mock.phase(
      ev.subAgent({ callId: 'call_9', phase: 'finished', stopReason: 'complete', iterations: 3 }),
      ev.content('The sub-agent found four routes.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await mock.install(page);

    await sendPrompt(page, 'survey the routes');

    const panel = page.getByTestId('sub-agent-activity');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Survey the routes directory.');
    await expect(panel).toContainText('grep_search');
    await expect(panel).toContainText('2 tools');
  });
});
