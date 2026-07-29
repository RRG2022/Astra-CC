import { test, expect } from 'playwright/test';
import { finalAnswer, installBaseRoutes, ndjson, sendPrompt } from './fixtures';

async function mockWriteTool(page) {
  let terminalRequests = 0;
  let chatRequests = 0;
  await page.route('http://localhost:8789/api/chat', route => {
    chatRequests += 1;
    const body = chatRequests === 1
      ? ndjson({ message: { tool_calls: [{
        function: { name: 'run_command', arguments: { command: 'Write-Output approved', reason: 'permission test' } }
      }] } })
      : finalAnswer('Permission flow complete.');
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
  });
  await page.route('http://localhost:8789/api/tools/terminal/run', route => {
    terminalRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, stdout: 'approved' })
    });
  });
  return () => terminalRequests;
}

test('Strict mode blocks a modifying tool until Approve is clicked', async ({ page }) => {
  await installBaseRoutes(page, { authority: 'Strict' });
  const terminalRequests = await mockWriteTool(page);

  await sendPrompt(page, 'approve a command');
  await expect(page.getByText('Permission Required', { exact: true }).first()).toBeVisible();
  expect(terminalRequests()).toBe(0);

  await page.getByRole('button', { name: /Approve/ }).click();
  await expect(page.getByText('Permission flow complete.', { exact: true })).toBeVisible();
  expect(terminalRequests()).toBe(1);
});

test('Supervised mode bypasses read-only tools but asks for modifying tools', async ({ page }) => {
  await installBaseRoutes(page, { authority: 'Supervised' });
  let chatRequests = 0;
  let readRequests = 0;
  await page.route('http://localhost:8789/api/chat', route => {
    chatRequests += 1;
    const body = chatRequests === 1
      ? ndjson({ message: { tool_calls: [{
        function: { name: 'read_file', arguments: { filePath: 'README.md' } }
      }] } })
      : finalAnswer('Read-only tool bypassed.');
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
  });
  await page.route('http://localhost:8789/api/tools/fs/read', route => {
    readRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, content: 'ok' }) });
  });

  await sendPrompt(page, 'read a file');
  await expect(page.getByText('Read-only tool bypassed.', { exact: true })).toBeVisible();
  await expect(page.getByText('Permission Required', { exact: true })).toHaveCount(0);
  expect(readRequests).toBe(1);
});

test('Autonomous mode executes a modifying tool without an approval overlay', async ({ page }) => {
  await installBaseRoutes(page, { authority: 'Autonomous' });
  const terminalRequests = await mockWriteTool(page);

  await sendPrompt(page, 'run without asking');
  await expect(page.getByText('Permission flow complete.', { exact: true })).toBeVisible();
  await expect(page.getByText('Permission Required', { exact: true })).toHaveCount(0);
  expect(terminalRequests()).toBe(1);
});
