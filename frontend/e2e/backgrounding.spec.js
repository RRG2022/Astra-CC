import { test, expect } from 'playwright/test';
import { finalAnswer, installBaseRoutes, ndjson, sendPrompt } from './fixtures';

test('slow terminal work backgrounds after five seconds, streams output, and can be killed', async ({ page }) => {
  let chatRequests = 0;
  let streamRequests = 0;
  let killRequests = 0;

  await installBaseRoutes(page, { authority: 'Autonomous' });
  await page.route('http://localhost:8789/api/chat', route => {
    chatRequests += 1;
    const body = chatRequests === 1
      ? ndjson({ message: { tool_calls: [{
        function: { name: 'run_command', arguments: { command: 'Start-Sleep 6', reason: 'test' } }
      }] } })
      : finalAnswer('Background task complete.');
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
  });
  await page.route('http://localhost:8789/api/tools/terminal/run', async route => {
    await new Promise(resolve => setTimeout(resolve, 5200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        taskId: 'task-background-1',
        stdout: '[Task sent to background] Task ID: task-background-1'
      })
    });
  });
  await page.route('http://localhost:8789/api/tools/terminal/stream/task-background-1', route => {
    streamRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'background output\n' })
    });
  });
  await page.route('http://localhost:8789/api/tools/terminal/kill/task-background-1', route => {
    killRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  await sendPrompt(page, 'run a slow background task');
  await expect(page.getByRole('button', { name: 'Kill Task' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Background task complete.', { exact: true })).toBeVisible();
  await expect.poll(() => streamRequests).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Kill Task' }).click();
  await expect.poll(() => killRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'Kill Task' })).toHaveCount(0);
});
