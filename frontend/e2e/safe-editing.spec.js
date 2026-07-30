import { test, expect } from 'playwright/test';
import { installBaseRoutes, sendPrompt, ndjson } from './fixtures.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

test.describe('Safe Editing (Live Backend)', () => {

  let testWorkspace;

  test.beforeEach(() => {
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-e2e-'));
  });

  test.afterEach(() => {
    try {
      fs.rmSync(testWorkspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch(e) { console.error('Cleanup failed:', e); }
  });

  test('rejects edit_file without prior read_file', async ({ page }) => {
    await installBaseRoutes(page, { authority: 'Autonomous', workspace: testWorkspace });
    
    fs.writeFileSync(path.join(testWorkspace, 'app.js'), 'var x = 1;');

    await page.route('http://localhost:8789/api/chat', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjson(
          { message: { tool_calls: [{ function: { name: 'edit_file', arguments: JSON.stringify({ filePath: 'app.js', oldString: 'var', newString: 'const', contentHash: 'fakehash' }) } }] } },
          { message: { content: 'Done.' }, done: true }
        )
      });
    });

    await sendPrompt(page, 'edit app.js directly');
    const log = page.locator('.tool-execution-log').filter({ hasText: 'edit_file' }).last();
    await expect(log).toBeVisible();
    await log.click(); // Expand to see result
    
    // Rejected client-side in AgentRuntime due to sessionReadFiles invariant
    await expect(page.locator('.tool-execution-body').filter({ hasText: /Error: You must read the file/ })).toBeVisible({ timeout: 10000 });
  });

  test('normalizes paths for read-before-edit invariant and edits successfully', async ({ page }) => {
    await installBaseRoutes(page, { authority: 'Autonomous', workspace: testWorkspace });
    
    fs.writeFileSync(path.join(testWorkspace, 'app.js'), 'var x = 1;');
    
    page.on('response', async res => {
      if (res.url().includes('/api/tools/fs/edit')) {
        console.log('EDIT RESPONSE (Test 11):', await res.json());
      }
    });
    const appJsHash = crypto.createHash('sha256').update('var x = 1;').digest('hex');

    await page.route('http://localhost:8789/api/chat', async route => {
      const payload = JSON.parse(route.request().postData() || '{}');
      const messages = payload.messages || [];
      const hasSuccessfulEdit = messages.some(m => m.role === 'tool' && m.name === 'edit_file' && m.content && m.content.includes('"success":true'));
      
      if (messages.length <= 2) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'app.js' }) } }] } })
        });
      } else if (hasSuccessfulEdit) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { content: 'Done.' }, done: true })
        });
      } else {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'edit_file', arguments: JSON.stringify({ filePath: './app.js', oldString: 'var', newString: 'const', contentHash: appJsHash }) } }] } })
        });
      }
    });

    await sendPrompt(page, 'Read and then edit');
    const log = page.locator('.tool-execution-log').filter({ hasText: 'edit_file' }).last();
    await expect(log).toBeVisible();
    
    // Wait for the tool execution to complete
    await expect(log.getByRole('button', { name: 'Rewind' })).toBeVisible({ timeout: 10000 });
    
    // Ensure the invariant error is not anywhere
    await expect(page.getByText('Error: You must read the file')).not.toBeVisible();
    
    // Check if it was really edited
    const newContent = fs.readFileSync(path.join(testWorkspace, 'app.js'), 'utf8');
    expect(newContent).toBe('const x = 1;');
  });

  test('shows permission preview with diff for edit_file', async ({ page }) => {
    await installBaseRoutes(page, { authority: 'Supervised', workspace: testWorkspace });
    
    fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'hello');
    
    await page.evaluate(() => {
      window.electronAPI = {
        invoke: async (channel, ...args) => {
          if (channel === 'get-workspace-path') return window._mockWorkspace;
        },
        normalizePath: async (workspace, fp) => {
          const w = workspace.replace(/\\/g, '/');
          let p = fp.replace(/\\/g, '/');
          if (p.startsWith('./')) p = p.slice(2);
          if (p.startsWith(w)) p = p.slice(w.length + 1);
          return p;
        }
      };
    });
    page.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('AGENT_RUNTIME')) console.log('BROWSER LOG (Test 12):', txt);
    });
    
    page.on('response', async res => {
      if (res.url().includes('/api/tools/fs/edit')) {
        console.log('EDIT RESPONSE (Test 12):', await res.json());
      }
      if (res.url().includes('/api/tools/fs/read')) {
        console.log('READ RESPONSE (Test 12):', await res.json());
      }
    });
    const testJsHash = crypto.createHash('sha256').update('hello').digest('hex');

    await page.route('http://localhost:8789/api/chat', async route => {
      const payload = JSON.parse(route.request().postData() || '{}');
      const messages = payload.messages || [];
      const hasSuccessfulEdit = messages.some(m => m.role === 'tool' && m.name === 'edit_file' && m.content && m.content.includes('"success":true'));

      if (messages.length <= 2) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'test.js' }) } }] } })
        });
      } else if (hasSuccessfulEdit) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { content: 'Done.' }, done: true })
        });
      } else {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'edit_file', arguments: JSON.stringify({ filePath: 'test.js', oldString: 'hello', newString: 'world', contentHash: testJsHash }) } }] } })
        });
      }
    });

    await sendPrompt(page, 'edit something');
    
    // Wait for edit_file approval
    await expect(page.getByText('Astra wants to execute: edit_file')).toBeVisible();
    await expect(page.getByText('test.js', { exact: true })).toBeVisible();
    await expect(page.getByText('- hello')).toBeVisible();
    await expect(page.getByText('+ world')).toBeVisible();
    
    // File should NOT be modified yet (proves no edit before approval)
    expect(fs.readFileSync(path.join(testWorkspace, 'test.js'), 'utf8')).toBe('hello');
    
    // Clicking reject
    await page.getByRole('button', { name: 'Reject' }).click();
    
    const log = page.locator('.tool-execution-log').filter({ hasText: 'edit_file' }).last();
    await expect(log).toBeVisible();
    await log.click();
    await expect(page.getByText('Error: User explicitly denied')).toBeVisible();
    
    // File should STILL not be modified
    expect(fs.readFileSync(path.join(testWorkspace, 'test.js'), 'utf8')).toBe('hello');
  });

  test('displays Rewind button, requests approval, and restores file', async ({ page }) => {
    await installBaseRoutes(page, { authority: 'Autonomous', workspace: testWorkspace });
    
    fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'hello');
    
    await page.evaluate(() => {
      window.electronAPI = {
        invoke: async (channel, ...args) => {
          if (channel === 'get-workspace-path') return window._mockWorkspace;
        },
        normalizePath: async (workspace, fp) => {
          const w = workspace.replace(/\\/g, '/');
          let p = fp.replace(/\\/g, '/');
          if (p.startsWith('./')) p = p.slice(2);
          if (p.startsWith(w)) p = p.slice(w.length + 1);
          return p;
        }
      };
    });
    page.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('AGENT_RUNTIME')) console.log('BROWSER LOG (Test 13):', txt);
    });
    
    page.on('response', async res => {
      if (res.url().includes('/api/tools/fs/edit')) {
        console.log('EDIT RESPONSE (Test 13):', await res.json());
      }
      if (res.url().includes('/api/tools/fs/read')) {
        console.log('READ RESPONSE (Test 13):', await res.json());
      }
    });
    const testJsHash2 = crypto.createHash('sha256').update('hello').digest('hex');

    await page.route('http://localhost:8789/api/chat', async route => {
      const payload = JSON.parse(route.request().postData() || '{}');
      const messages = payload.messages || [];
      console.log('CHAT MESSAGES (Test 13):', JSON.stringify(messages, null, 2));
      const hasSuccessfulEdit = messages.some(m => m.role === 'tool' && m.name === 'edit_file' && m.content && m.content.includes('"success":true'));
      const hasSuccessfulRewind = messages.some(m => m.role === 'tool' && m.name === 'rewind_file' && m.content && m.content.includes('successfully'));

      if (messages.length <= 2) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'read_file', arguments: JSON.stringify({ filePath: 'test.js' }) } }] } })
        });
      } else if (hasSuccessfulRewind) {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { content: 'Rewound successfully.' }, done: true })
        });
      } else if (hasSuccessfulEdit) {
        // After successful edit, we just wait for the user to click rewind.
        // If the agent is asked something before rewind, just say done.
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { content: 'Edit complete. Waiting for user.' }, done: true })
        });
      } else {
        return route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson',
          body: ndjson({ message: { tool_calls: [{ function: { name: 'edit_file', arguments: JSON.stringify({ filePath: 'test.js', oldString: 'hello', newString: 'world', contentHash: testJsHash2 }) } }] } })
        });
      }
    });

    await sendPrompt(page, 'do the edit');
    
    const log = page.locator('.tool-execution-log').filter({ hasText: 'edit_file' }).last();
    await expect(log).toBeVisible();
    
    const rewindBtn = log.getByRole('button', { name: 'Rewind' });
    await expect(rewindBtn).toBeVisible();
    
    // Verify file actually edited
    expect(fs.readFileSync(path.join(testWorkspace, 'test.js'), 'utf8')).toBe('world');

    // Trigger rewind
    await rewindBtn.click();
    
    // Approval required for Rewind
    await expect(page.getByText('Astra wants to execute: rewind_file')).toBeVisible();
    
    // File should NOT be rewound yet
    expect(fs.readFileSync(path.join(testWorkspace, 'test.js'), 'utf8')).toBe('world');
    
    // Approve it
    await page.getByRole('button', { name: 'Approve' }).click();
    
    // Wait for rewind to complete
    await expect.poll(() => fs.readFileSync(path.join(testWorkspace, 'test.js'), 'utf8'), { timeout: 10000 }).toBe('hello');
  });

});
