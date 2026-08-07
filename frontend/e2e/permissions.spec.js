import { test, expect } from 'playwright/test';
import { approvalCard, createSessionMock, ev, installBaseRoutes, sendPrompt } from './fixtures';

/**
 * Authority levels are enforced server-side and covered by the backend
 * integration suite. What matters here is that the approval card renders the
 * pending call and posts the right decision against the right callId — the
 * wiring that was entirely disconnected before.
 */
test.describe('approval card', () => {
  test('shows the pending call and approves it against its callId', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_abc', 'write_file', { filePath: 'out.txt', content: 'hi' }),
      ev.approvalRequested('call_abc', 'write_file', { filePath: 'out.txt', content: 'hi' })
    );
    mock.phase(
      ev.toolResult('call_abc', JSON.stringify({ success: true })),
      ev.content('Done.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'create out.txt');

    await expect(approvalCard(page).getByText('Permission Required')).toBeVisible();
    // The tool card also names the tool, so assert on the approval prompt itself.
    await expect(
      approvalCard(page).getByRole('paragraph').filter({ hasText: 'Astra wants to execute:' })
    ).toContainText('write_file');

    await page.getByRole('button', { name: /Approve/ }).click();

    await expect(page.getByText('Done.')).toBeVisible();
    await expect.poll(() => mock.posted.approvals.length).toBe(1);
    expect(mock.posted.approvals[0].callId).toBe('call_abc');
    expect(mock.posted.approvals[0].body.approved).toBe(true);
  });

  test('rejects a call and reports the denial', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_deny', 'run_command', { command: 'rm -rf /', reason: 'no' }),
      ev.approvalRequested('call_deny', 'run_command', { command: 'rm -rf /', reason: 'no' })
    );
    mock.phase(
      ev.toolResult('call_deny', 'Error: User explicitly denied permission to execute this tool.'),
      ev.completed('denied')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'delete everything');

    await expect(approvalCard(page).getByText('Permission Required')).toBeVisible();
    await page.getByRole('button', { name: /Reject/ }).click();

    await expect.poll(() => mock.posted.approvals.length).toBe(1);
    expect(mock.posted.approvals[0].callId).toBe('call_deny');
    expect(mock.posted.approvals[0].body.approved).toBe(false);
    await expect(approvalCard(page).getByText('Permission Required')).toBeHidden();
  });

  test('sends an edited command when the user changes it before approving', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_edit', 'run_command', { command: 'npm test', reason: 'verify' }),
      ev.approvalRequested('call_edit', 'run_command', { command: 'npm test', reason: 'verify' })
    );
    mock.phase(
      ev.toolResult('call_edit', JSON.stringify({ success: true, stdout: 'ok' })),
      ev.completed('complete')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'run the tests');

    const commandInput = page.locator('input[type="text"]').filter({ hasNot: page.locator('[placeholder]') }).last();
    await expect(commandInput).toHaveValue('npm test');
    await commandInput.fill('npm test -- --watch=false');

    await page.getByRole('button', { name: /Approve/ }).click();

    await expect.poll(() => mock.posted.approvals.length).toBe(1);
    expect(mock.posted.approvals[0].body.editedCall).toEqual({
      name: 'run_command',
      arguments: { command: 'npm test -- --watch=false', reason: 'verify' }
    });
  });
});
