import { expect } from 'playwright/test';

export const WORKSPACE = 'C:/Astra-test-workspace';

export function ndjson(...records) {
  return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}

export async function installBaseRoutes(page, { authority = 'Supervised' } = {}) {
  await page.addInitScript(({ workspace, authorityLevel }) => {
    localStorage.clear();
    localStorage.setItem('astra_workspace', workspace);
    localStorage.setItem('astra_authority_level', authorityLevel);
  }, { workspace: WORKSPACE, authorityLevel: authority });

  await page.route('http://localhost:8789/api/output/stream', route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: ': connected\n\n'
  }));

  await page.route('http://localhost:8789/api/settings', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ apiKeys: { openai: '', anthropic: '', gemini: '' } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  await page.route('http://localhost:8789/api/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: [{ name: 'test-model' }, { name: 'alternate-model' }, { name: 'qwen2.5-coder:latest' }] })
  }));

  await page.route('http://localhost:8789/api/fs/list', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, directories: [] })
  }));

  await page.goto('/');
  await expect(page.getByText('Astra', { exact: true })).toBeVisible();
  await expect(page.locator('select').last()).toHaveValue('test-model');
}

export async function sendPrompt(page, prompt) {
  const input = page.getByPlaceholder(/Ask Repo Builder/);
  await input.fill(prompt);
  await input.press('Enter');
}

export function finalAnswer(text = 'Completed.') {
  return ndjson({ message: { content: text }, done: true });
}
