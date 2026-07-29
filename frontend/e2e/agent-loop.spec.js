import { test, expect } from 'playwright/test';
import { finalAnswer, installBaseRoutes, ndjson, sendPrompt } from './fixtures';

test.describe('agent loop', () => {
  test('executes a tool, shows live state, and renders thought blocks', async ({ page }) => {
    let chatRequests = 0;
    let terminalStarted = false;

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await page.route('http://localhost:8789/api/chat', route => {
      chatRequests += 1;
      if (chatRequests === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{
            function: { name: 'run_command', arguments: { command: 'Write-Output agent-loop', reason: 'test' } }
          }] } })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: finalAnswer('<think>Tool result was received.</think>Final answer')
      });
    });
    await page.route('http://localhost:8789/api/tools/terminal/run', async route => {
      terminalStarted = true;
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, stdout: 'agent-loop' })
      });
    });

    await sendPrompt(page, 'run the agent loop test');

    await expect(page.getByText('Running', { exact: false }).first()).toBeVisible();
    expect(terminalStarted).toBe(true);
    await expect(page.getByText('Thought Process', { exact: true })).toBeVisible();
    await expect(page.getByText('Final answer', { exact: true })).toBeVisible();
    expect(chatRequests).toBe(2);
  });

  test('fallback parser executes a raw JSON tool call from model text', async ({ page }) => {
    let chatRequests = 0;
    let readRequest;

    await installBaseRoutes(page, { authority: 'Supervised' });
    await page.route('http://localhost:8789/api/chat', route => {
      chatRequests += 1;
      const body = chatRequests === 1
        ? ndjson({ message: { content: '{"name":"read_file","arguments":{"filePath":"README.md"}}' } })
        : finalAnswer('Fallback executed.');
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
    });
    await page.route('http://localhost:8789/api/tools/fs/read', async route => {
      readRequest = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, content: '# mocked README' })
      });
    });

    await sendPrompt(page, 'read the README using the fallback parser');

    await expect(page.getByText('Fallback executed.', { exact: false })).toBeVisible();
    expect(readRequest.filePath).toBe('README.md');
    expect(chatRequests).toBe(2);
  });

  test('stop generation aborts an in-flight chat request and unlocks the composer', async ({ page }) => {
    let chatRequestFailed = false;

    await installBaseRoutes(page);
    page.on('requestfailed', request => {
      if (request.url() === 'http://localhost:8789/api/chat') chatRequestFailed = true;
    });
    await page.route('http://localhost:8789/api/chat', async route => {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: finalAnswer('late') });
      } catch { /* the browser abort is the assertion */ }
    });

    await sendPrompt(page, 'stop this generation');
    await expect(page.getByTitle('Stop Generation')).toBeVisible();
    await page.getByTitle('Stop Generation').click();
    await expect(page.getByTitle('Send')).toBeVisible();
    await expect.poll(() => chatRequestFailed).toBe(true);
  });
});
