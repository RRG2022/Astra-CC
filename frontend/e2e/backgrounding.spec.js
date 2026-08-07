import { test, expect } from 'playwright/test';
import { createSessionMock, ev, installBaseRoutes, sendPrompt } from './fixtures';

/**
 * When a command backgrounds, the server reports a taskId. The frontend's job
 * is to open the task panel and let the user watch and kill it.
 */
test('a backgrounded command opens the task panel and can be killed', async ({ page }) => {
  const taskId = 'task-background-1';
  let killed = false;
  let pollCount = 0;

  const mock = createSessionMock();
  mock.phase(
    ev.messageStart(),
    ev.toolRunning('call_bg', 'run_command', { command: 'sleep 60', reason: 'long job' }),
    ev.toolExecuted('call_bg', 'run_command',
      { command: 'sleep 60', reason: 'long job' },
      { success: true, backgrounded: true, taskId, stdout: '[Task sent to background]' }),
    ev.toolResult('call_bg', JSON.stringify({ success: true, backgrounded: true, taskId })),
    ev.content('Background task started.'),
    ev.completed('complete')
  );

  await installBaseRoutes(page, { authority: 'Autonomous' });
  await mock.install(page);

  await page.route(`http://localhost:8789/api/tools/terminal/stream/${taskId}`, route => {
    pollCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: killed ? 'partial output\n\n[Task killed by user]' : 'partial output',
        done: killed,
        killed
      })
    });
  });

  await page.route(`http://localhost:8789/api/tools/terminal/kill/${taskId}`, route => {
    killed = true;
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true })
    });
  });

  await sendPrompt(page, 'start a long job');

  await expect(page.getByText('Background task started.')).toBeVisible();

  // Completed cards collapse; the live terminal lives inside the body.
  await page.locator('.tool-execution-header').filter({ hasText: 'run_command' }).click();
  await expect(page.getByRole('button', { name: 'Kill Task' }).first()).toBeVisible({ timeout: 10000 });
  // LiveTerminal polls on an interval — give it a tick.
  await expect.poll(() => pollCount, { timeout: 10000 }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Kill Task' }).first().click();
  await expect.poll(() => killed).toBe(true);
});
