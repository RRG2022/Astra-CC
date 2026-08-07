const fs = require('fs');
const os = require('os');
const path = require('path');

/** A temp workspace whose path is fully resolved (macOS /var -> /private/var). */
function createWorkspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astra-test-')));
}

function parseSseBlock(raw) {
  let event = 'message';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * Opens an SSE connection and accumulates events into an array as they arrive.
 * Returns helpers for waiting on a specific event without polling sleeps.
 */
async function openSse(url) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);

  const events = [];
  const waiters = [];

  const notify = () => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      const hit = events.find(w.predicate);
      if (hit) {
        clearTimeout(w.timer);
        waiters.splice(i, 1);
        w.resolve(hit);
      }
    }
  };

  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const parsed = parseSseBlock(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          if (parsed) events.push(parsed);
        }
        notify();
      }
    } catch {
      // aborted on close()
    }
  })();

  return {
    events,
    of(name) { return events.filter(e => e.event === name); },
    waitFor(predicate, { timeout = 5000, label = 'event' } = {}) {
      const fn = typeof predicate === 'string' ? (e) => e.event === predicate : predicate;
      const existing = events.find(fn);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex(w => w.timer === timer);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(
            `Timed out after ${timeout}ms waiting for ${label}. Saw: ` +
            JSON.stringify(events.map(e => e.event))
          ));
        }, timeout);
        waiters.push({ predicate: fn, resolve, timer });
      });
    },
    close() { controller.abort(); }
  };
}

module.exports = { createWorkspace, openSse, parseSseBlock };
