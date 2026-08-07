import { test, expect } from 'playwright/test';
import { createSessionMock, ev, installBaseRoutes, sendPrompt } from './fixtures';

test.describe('agent session', () => {
  test('starts a session, streams content, and renders the final answer', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.state({ isStreaming: true }),
      ev.content('Hello '),
      ev.content('from the agent.'),
      ev.state({ isStreaming: false }),
      ev.completed('complete')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'say hello');

    await expect(page.getByText('Hello from the agent.')).toBeVisible();

    // The client must supply the id the server keys every event to.
    expect(mock.posted.messages).toHaveLength(1);
    expect(mock.posted.messages[0].assistantMessageId).toBeTruthy();
    expect(mock.posted.messages[0].message.content).toContain('say hello');
  });

  test('renders a tool execution card through running and completed', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.toolRunning('call_1', 'list_dir', { directoryPath: '.' }),
      ev.toolResult('call_1', JSON.stringify({ success: true, items: [{ name: 'a.txt' }] })),
      ev.toolExecuted('call_1', 'list_dir', { directoryPath: '.' }, { success: true, items: [] }),
      ev.content('There is one file.'),
      ev.completed('complete')
    );

    await installBaseRoutes(page, { authority: 'Autonomous' });
    await mock.install(page);

    await sendPrompt(page, 'what is here?');

    await expect(page.getByText('list_dir').first()).toBeVisible();
    await expect(page.getByText('There is one file.')).toBeVisible();
  });

  test('surfaces a failed turn instead of showing an empty reply', async ({ page }) => {
    const mock = createSessionMock();
    mock.phase(
      ev.messageStart(),
      ev.state({ isStreaming: true }),
      ev.state({ isStreaming: false, stopReason: 'error', error: 'Ollama returned HTTP 500' }),
      ev.completed('error', 'Ollama returned HTTP 500')
    );

    await installBaseRoutes(page);
    await mock.install(page);

    await sendPrompt(page, 'this will fail');

    // The regression this guards: a dead backend used to render as a silent,
    // successful, empty assistant turn.
    await expect(page.getByText(/Ollama returned HTTP 500/)).toBeVisible();
  });
});
