import { test, expect } from 'playwright/test';
import { approvalCard, createSessionMock, ev, installBaseRoutes, sendPrompt } from './fixtures';

/**
 * The read-before-write invariant, hash checking, and checkpointing all run
 * server-side and are covered by the backend suite. This spec covers the part
 * the user actually sees: the diff preview in the approval card, and the
 * invariant's refusal message rendered in the tool card.
 */
test.describe('safe editing', () => {
  test('shows a diff preview for edit_file before approval', async ({ page }) => {
    const mock = createSessionMock();
    const args = {
      filePath: 'src/test.js',
      oldString: 'hello',
      newString: 'world',
      contentHash: 'abc123'
    };
    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_edit', 'edit_file', args),
      ev.approvalRequested('call_edit', 'edit_file', args)
    );
    mock.phase(
      ev.toolResult('call_edit', JSON.stringify({ success: true, checkpointSha: 'deadbeef' })),
      ev.content('Edited.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'change hello to world');

    await expect(approvalCard(page).getByText('Astra wants to execute:')).toBeVisible();
    await expect(approvalCard(page).getByText('src/test.js', { exact: true })).toBeVisible();
    await expect(approvalCard(page).getByText('- hello')).toBeVisible();
    await expect(approvalCard(page).getByText('+ world')).toBeVisible();

    await page.getByRole('button', { name: /Approve/ }).click();
    await expect(page.getByText('Edited.')).toBeVisible();
  });

  test('renders the read-before-edit refusal in the tool card', async ({ page }) => {
    const mock = createSessionMock();
    const refusal = 'Error: You must read the file with read_file before editing it. '
      + 'This is a strict safety invariant.';

    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_bad', 'edit_file', { filePath: 'unread.js', oldString: 'a', newString: 'b' }),
      ev.toolResult('call_bad', refusal),
      ev.content('I need to read the file first.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await mock.install(page);

    await sendPrompt(page, 'edit a file I never read');

    // Completed cards collapse; expand to inspect the result.
    await page.locator('.tool-execution-header').filter({ hasText: 'edit_file' }).click();
    await expect(
      page.locator('.tool-execution-body').filter({ hasText: /You must read the file/ })
    ).toBeVisible({ timeout: 10000 });
  });
});
