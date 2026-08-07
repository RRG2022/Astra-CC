import { expect } from 'playwright/test';

export const WORKSPACE = '/tmp/astra-test-workspace';
export const SESSION_ID = 'test-session-0001';

const BASE = 'http://localhost:8789';

/**
 * The client mints the assistant message id, so scripted events can't know it
 * up front. They carry this sentinel instead and it's substituted with the real
 * id at delivery time.
 */
export const MSG = '@assistantMessageId';

function sse(events, messageId) {
  return events.map(e => {
    const json = JSON.stringify(e.data).split(JSON.stringify(MSG)).join(JSON.stringify(messageId));
    return `event: ${e.event}\ndata: ${json}\n\n`;
  }).join('');
}

/**
 * Mocks the server-side session protocol.
 *
 * The agent loop now lives on the backend, so these specs cover what is
 * genuinely the frontend's job: rendering the event stream, and posting the
 * right approval decisions back. Loop semantics (authority levels, the
 * read-before-write invariant, denial handling) are covered by the backend
 * integration suite instead, where they actually run.
 *
 * Each scripted phase is delivered as one SSE response. EventSource reconnects
 * after a response ends, so phases chain naturally: a phase is released when
 * the client posts a message or an approval decision.
 */
export function createSessionMock() {
  const phases = [];
  const posted = { messages: [], approvals: [] };
  let phaseIndex = 0;
  let released = false;

  const waitForRelease = async () => {
    for (let i = 0; i < 200; i++) {
      if (released && phaseIndex < phases.length) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  };

  return {
    /** Queue one phase: the events the server would emit next. */
    phase(...events) {
      phases.push(events);
      return this;
    },
    posted,

    async install(page) {
      await page.route(`${BASE}/api/sessions`, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: SESSION_ID })
      }));

      await page.route(`${BASE}/api/sessions/${SESSION_ID}/stream*`, async route => {
        const ready = await waitForRelease();
        if (!ready) {
          // Nothing more scripted — hold the connection instead of looping.
          await new Promise(r => setTimeout(r, 30000));
          return route.abort();
        }
        released = false;
        const events = phases[phaseIndex++];
        const last = posted.messages[posted.messages.length - 1];
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          body: sse(events, last?.assistantMessageId)
        });
      });

      await page.route(`${BASE}/api/sessions/${SESSION_ID}/message`, async route => {
        posted.messages.push(JSON.parse(route.request().postData() || '{}'));
        released = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      });

      await page.route(`${BASE}/api/sessions/${SESSION_ID}/approve/*`, async route => {
        const url = route.request().url();
        posted.approvals.push({
          callId: url.split('/').pop(),
          body: JSON.parse(route.request().postData() || '{}')
        });
        released = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      });

      await page.route(`${BASE}/api/sessions/${SESSION_ID}/cancel`, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      }));
    }
  };
}

// --- event builders (mirror the server's emit() payloads) ------------------

export const ev = {
  messageStart: () => ({ event: 'message_start', data: { messageId: MSG } }),
  content: (text) => ({
    event: 'message_update', data: { messageId: MSG, update: { content: text } }
  }),
  error: (message) => ({
    event: 'message_update', data: { messageId: MSG, update: { error: message } }
  }),
  toolRunning: (id, name, args) => ({
    event: 'message_update',
    data: { messageId: MSG, update: { tool_execution: { id, name, arguments: args, status: 'running', result: null } } }
  }),
  toolResult: (id, result) => ({
    event: 'message_update',
    data: { messageId: MSG, update: { tool_execution_result: { id, status: 'completed', result } } }
  }),
  toolExecuted: (callId, name, args, result) => ({
    event: 'tool_executed', data: { callId, name, args, result }
  }),
  approvalRequested: (callId, name, args) => ({
    event: 'approval_requested', data: { callId, name, arguments: args }
  }),
  state: (patch) => ({ event: 'state_change', data: patch }),
  completed: (stopReason = 'complete', error = null) => ({
    event: 'loop_completed', data: { stopReason, error }
  })
};

export async function installBaseRoutes(page, { authority = 'Supervised', workspace = WORKSPACE } = {}) {
  await page.addInitScript(({ workspace, authorityLevel }) => {
    localStorage.clear();
    localStorage.setItem('astra_workspace', workspace);
    localStorage.setItem('astra_authority_level', authorityLevel);
  }, { workspace, authorityLevel: authority });

  await page.route(`${BASE}/api/output/stream*`, route => route.fulfill({
    status: 200, contentType: 'text/event-stream', body: ': connected\n\n'
  }));

  await page.route(`${BASE}/api/settings`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      route.request().method() === 'GET'
        ? { apiKeys: { openai: false, anthropic: false, gemini: false } }
        : { success: true }
    )
  }));

  await page.route(`${BASE}/api/models`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: [{ name: 'test-model' }, { name: 'alternate-model' }] })
  }));

  await page.route(`${BASE}/api/fs/list`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, directories: [] })
  }));

  await page.route(`${BASE}/api/conversations*`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, conversations: [] })
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

/**
 * The approval card, scoped to the chat sidebar. The toast overlay repeats the
 * same wording at the page root, so unscoped text queries match twice.
 */
export function approvalCard(page) {
  return page.locator('.chat-sidebar');
}

/** The assistant message id the client minted for the most recent turn. */
export function lastMessageId(mock) {
  const last = mock.posted.messages[mock.posted.messages.length - 1];
  return last?.assistantMessageId;
}
