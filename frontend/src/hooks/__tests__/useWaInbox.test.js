// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo's node_modules — same pattern as
// useLeadsData.test.js / useMailMaterials.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useWaInbox, { applyMessageNew, applyMessageStatus, mergeMessages } from '../useWaInbox';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ok = (data) => Promise.resolve({ data });

const mockChats = jest.fn();
const mockMessages = jest.fn();
const mockSend = jest.fn();
const mockRead = jest.fn();
const mockResolve = jest.fn();
const mockReopen = jest.fn();
const mockAssign = jest.fn();
const mockAddNote = jest.fn();
const mockLink = jest.fn();

jest.mock('../../lib/api', () => ({
  waInbox: {
    chats: (...args) => mockChats(...args),
    messages: (...args) => mockMessages(...args),
    send: (...args) => mockSend(...args),
    read: (...args) => mockRead(...args),
    resolve: (...args) => mockResolve(...args),
    reopen: (...args) => mockReopen(...args),
    assign: (...args) => mockAssign(...args),
    addNote: (...args) => mockAddNote(...args),
    link: (...args) => mockLink(...args),
    streamUrl: () => 'https://api.example.test/api/wa/stream',
  },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'rep@smartshape.in', role: 'sales' } }),
}));

class FakeEventSource {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  close() { this.closed = true; }
  emit(type, data) { (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
  error() { this.onerror && this.onerror(new Event('error')); }
}
FakeEventSource.instances = [];
global.EventSource = FakeEventSource;

let hookResult = null;
function Probe() {
  hookResult = useWaInbox();
  return null;
}

let container;
let root;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root.render(<Probe />);
  });
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  mockChats.mockReset();
  mockMessages.mockReset();
  mockSend.mockReset();
  mockRead.mockReset();
  mockResolve.mockReset();
  mockReopen.mockReset();
  mockAssign.mockReset();
  mockAddNote.mockReset();
  mockLink.mockReset();
  mockChats.mockReturnValue(ok({ items: [], total: 0, page: 1, unread_total: 0 }));
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  hookResult = null;
});

test('initial load calls waInbox.chats with scope=mine, status=open, page=1', async () => {
  await mount();
  expect(mockChats).toHaveBeenCalledWith({ scope: 'mine', status: 'open', page: 1 });
  expect(hookResult.loading).toBe(false);
});

test('select loads messages ascending and marks the chat read when unread', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'c1', unread_count: 3, last_message_preview: 'hi' }],
    total: 1,
    page: 1,
    unread_total: 3,
  }));
  mockMessages.mockReturnValue(ok({
    items: [
      { message_id: 'm2', chat_id: 'c1', direction: 'in', text: 'second', created_at: '2026-01-01T00:00:02Z' },
      { message_id: 'm1', chat_id: 'c1', direction: 'in', text: 'first', created_at: '2026-01-01T00:00:01Z' },
    ],
    has_more: false,
  }));
  mockRead.mockReturnValue(ok({ ok: true }));

  await mount();
  expect(hookResult.unreadTotal).toBe(3);

  await act(async () => { await hookResult.select('c1'); });

  expect(mockMessages).toHaveBeenCalledWith('c1', { limit: 50 });
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['m1', 'm2']);
  expect(mockRead).toHaveBeenCalledWith('c1');
  expect(hookResult.selectedId).toBe('c1');
  // optimistic unread-zero + total drop
  expect(hookResult.chats.find((c) => c.chat_id === 'c1').unread_count).toBe(0);
  expect(hookResult.unreadTotal).toBe(0);
});

test('select does not call read when the chat has no unread messages', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'c1', unread_count: 0 }],
    total: 1,
    page: 1,
    unread_total: 0,
  }));
  mockMessages.mockReturnValue(ok({ items: [], has_more: false }));

  await mount();
  await act(async () => { await hookResult.select('c1'); });

  expect(mockRead).not.toHaveBeenCalled();
});

test('markRead zeroes the row and calls read only while the loaded row still shows unread', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'c1', unread_count: 3 }, { chat_id: 'c2', unread_count: 0 }],
    total: 2, page: 1, unread_total: 3,
  }));
  mockRead.mockReturnValue(ok({ ok: true }));
  await mount();
  expect(hookResult.unreadTotal).toBe(3);

  await act(async () => { await hookResult.markRead('c2'); });      // nothing unread → no call
  expect(mockRead).not.toHaveBeenCalled();
  await act(async () => { await hookResult.markRead('c9'); });      // not loaded → no call
  expect(mockRead).not.toHaveBeenCalled();

  await act(async () => { await hookResult.markRead('c1'); });
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledWith('c1');
  expect(hookResult.chats.find((c) => c.chat_id === 'c1').unread_count).toBe(0);
  expect(hookResult.unreadTotal).toBe(0);
  await act(async () => { await hookResult.markRead('c1'); });      // already zero → idempotent
  expect(mockRead).toHaveBeenCalledTimes(1);
});

test('send inserts an optimistic bubble then replaces it with the server row', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  mockMessages.mockReturnValue(ok({ items: [], has_more: false }));
  await mount();
  await act(async () => { await hookResult.select('c1'); });

  let resolveSend;
  mockSend.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));

  let sendPromise;
  act(() => { sendPromise = hookResult.send({ text: 'hello there' }); });
  await flush();

  expect(hookResult.messages).toHaveLength(1);
  const tmp = hookResult.messages[0];
  expect(tmp.message_id).toMatch(/^tmp_/);
  expect(tmp.status).toBe('queued');
  expect(tmp.text).toBe('hello there');
  expect(hookResult.sending).toBe(true);

  await act(async () => {
    resolveSend({ data: { status: 'sent', message_id: 'srv-1', message: { message_id: 'srv-1', chat_id: 'c1', direction: 'out', text: 'hello there', status: 'sent', created_at: '2026-01-01T00:00:05Z' } } });
    await sendPromise;
  });

  expect(hookResult.messages).toHaveLength(1);
  expect(hookResult.messages[0].message_id).toBe('srv-1');
  expect(hookResult.messages[0].status).toBe('sent');
  expect(hookResult.sending).toBe(false);
});

test('send with a skipped answer keeps the bubble with fail_reason', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  mockMessages.mockReturnValue(ok({ items: [], has_more: false }));
  await mount();
  await act(async () => { await hookResult.select('c1'); });

  mockSend.mockReturnValue(ok({ status: 'skipped', reason: 'opted_out', message_id: 'srv-2' }));

  await act(async () => { await hookResult.send({ text: 'hi again' }); });

  expect(hookResult.messages).toHaveLength(1);
  const bubble = hookResult.messages[0];
  expect(bubble.message_id).toMatch(/^tmp_/);
  expect(bubble.status).toBe('skipped');
  expect(bubble.fail_reason).toBe('opted_out');
});

test('a message_new stream event for another chat moves it to the top with unread_count from the event', async () => {
  mockChats.mockReturnValue(ok({
    items: [
      { chat_id: 'c1', unread_count: 0, last_message_preview: 'old' },
      { chat_id: 'c2', unread_count: 0, last_message_preview: 'older' },
    ],
    total: 2,
    page: 1,
    unread_total: 0,
  }));
  await mount();

  const es = FakeEventSource.instances[0];
  await act(async () => {
    es.emit('message_new', { chat_id: 'c2', message_id: 'mX', direction: 'in', preview: 'new msg', unread_count: 5 });
  });

  expect(hookResult.chats[0].chat_id).toBe('c2');
  expect(hookResult.chats[0].unread_count).toBe(5);
  expect(hookResult.chats[0].last_message_preview).toBe('new msg');
  expect(hookResult.unreadTotal).toBe(5);
});

test('a message_status stream event updates the matching bubble', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  mockMessages.mockReturnValue(ok({
    items: [{ message_id: 'm1', chat_id: 'c1', direction: 'out', text: 'hi', status: 'sent', created_at: '2026-01-01T00:00:01Z' }],
    has_more: false,
  }));
  await mount();
  await act(async () => { await hookResult.select('c1'); });

  const es = FakeEventSource.instances[0];
  await act(async () => {
    es.emit('message_status', { chat_id: 'c1', message_id: 'm1', status: 'delivered' });
  });

  expect(hookResult.messages.find((m) => m.message_id === 'm1').status).toBe('delivered');
});

test('pure helper: applyMessageNew updates and reorders an existing chat', () => {
  const chats = [
    { chat_id: 'a', unread_count: 0 },
    { chat_id: 'b', unread_count: 1 },
  ];
  const next = applyMessageNew(chats, { chat_id: 'b', unread_count: 4, preview: 'ping' }, { scope: 'mine', status: 'open' });
  expect(next.map((c) => c.chat_id)).toEqual(['b', 'a']);
  expect(next[0].unread_count).toBe(4);
  expect(next[0].last_message_preview).toBe('ping');
});

test('pure helper: applyMessageNew does not insert an unknown chat outside scope=all', () => {
  const chats = [{ chat_id: 'a', unread_count: 0 }];
  const next = applyMessageNew(chats, { chat_id: 'z', unread_count: 1 }, { scope: 'mine', status: 'open' });
  expect(next).toEqual(chats);
});

test('pure helper: applyMessageNew inserts an unknown chat when scope=all and status=open', () => {
  const chats = [{ chat_id: 'a', unread_count: 0 }];
  const next = applyMessageNew(chats, { chat_id: 'z', unread_count: 2, preview: 'hey' }, { scope: 'all', status: 'open' });
  expect(next[0].chat_id).toBe('z');
  expect(next[0].unread_count).toBe(2);
});

test('pure helper: applyMessageStatus patches only the matching message', () => {
  const messages = [
    { message_id: 'm1', status: 'sent' },
    { message_id: 'm2', status: 'sent' },
  ];
  const next = applyMessageStatus(messages, { message_id: 'm2', status: 'read' });
  expect(next[0].status).toBe('sent');
  expect(next[1].status).toBe('read');
});

// ── Fix round 1 ─────────────────────────────────────────────────────────────

test('select merges rows the stream appended while the page was loading (no duplicates)', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  let resolveMessages;
  mockMessages.mockReturnValue(new Promise((resolve) => { resolveMessages = resolve; }));
  await mount();

  let selectPromise;
  act(() => { selectPromise = hookResult.select('c1'); });
  await flush();
  expect(hookResult.selectedId).toBe('c1');

  const es = FakeEventSource.instances[0];
  await act(async () => {
    es.emit('message_new', { chat_id: 'c1', message_id: 'm3', direction: 'in', preview: 'live one', status: 'delivered' });
  });
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['m3']);

  await act(async () => {
    resolveMessages({ data: {
      items: [
        { message_id: 'm1', chat_id: 'c1', direction: 'in', text: 'first', created_at: '2026-01-01T00:00:01Z' },
        { message_id: 'm2', chat_id: 'c1', direction: 'in', text: 'second', created_at: '2026-01-01T00:00:02Z' },
      ],
      has_more: false,
    } });
    await selectPromise;
  });

  const ids = hookResult.messages.map((m) => m.message_id);
  expect(ids).toEqual(['m1', 'm2', 'm3']);
  expect(ids.filter((id) => id === 'm3')).toHaveLength(1);
  expect(hookResult.messages.find((m) => m.message_id === 'm3').preview_only).toBe(true);
});

test('select ignores a page that resolves after the selection moved on', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'c1', unread_count: 0 }, { chat_id: 'c2', unread_count: 0 }],
    total: 2, page: 1, unread_total: 0,
  }));
  let resolveC1;
  mockMessages.mockImplementation((chatId) => (
    chatId === 'c1'
      ? new Promise((resolve) => { resolveC1 = resolve; })
      : ok({ items: [{ message_id: 'x1', chat_id: 'c2', direction: 'in', text: 'c2 row', created_at: '2026-01-01T00:00:01Z' }], has_more: false })
  ));
  await mount();

  let p1;
  act(() => { p1 = hookResult.select('c1'); });
  await flush();
  await act(async () => { await hookResult.select('c2'); });
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['x1']);

  await act(async () => {
    resolveC1({ data: { items: [{ message_id: 'old1', chat_id: 'c1', direction: 'in', text: 'stale', created_at: '2026-01-01T00:00:00Z' }], has_more: false } });
    await p1;
  });
  expect(hookResult.selectedId).toBe('c2');
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['x1']);
});

test('loadOlder ignores an older page that resolves after the selection moved on', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'A', unread_count: 0 }, { chat_id: 'B', unread_count: 0 }],
    total: 2, page: 1, unread_total: 0,
  }));
  let resolveOlderA;
  mockMessages.mockImplementation((chatId, params) => {
    if (chatId === 'A' && params.before) return new Promise((resolve) => { resolveOlderA = resolve; });
    if (chatId === 'A') {
      return ok({
        items: [{ message_id: 'a2', chat_id: 'A', direction: 'in', text: 'a2', created_at: '2026-01-01T00:00:02Z' }],
        has_more: true, next_before: '2026-01-01T00:00:02Z', next_before_id: 'a2',
      });
    }
    return ok({
      items: [{ message_id: 'b1', chat_id: 'B', direction: 'in', text: 'b1', created_at: '2026-01-01T00:00:01Z' }],
      has_more: false, next_before: null, next_before_id: null,
    });
  });
  await mount();

  await act(async () => { await hookResult.select('A'); });
  expect(hookResult.hasMore).toBe(true);

  let olderPromise;
  act(() => { olderPromise = hookResult.loadOlder(); });
  await flush();
  expect(mockMessages).toHaveBeenCalledWith('A', { before: '2026-01-01T00:00:02Z', before_id: 'a2', limit: 50 });

  await act(async () => { await hookResult.select('B'); });
  expect(hookResult.selectedId).toBe('B');
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['b1']);
  expect(hookResult.hasMore).toBe(false);

  await act(async () => {
    resolveOlderA({ data: {
      items: [{ message_id: 'a1', chat_id: 'A', direction: 'in', text: 'a1', created_at: '2026-01-01T00:00:01Z' }],
      has_more: true, next_before: '2026-01-01T00:00:01Z', next_before_id: 'a1',
    } });
    await olderPromise;
  });

  // B's thread and cursor are untouched by A's late page
  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['b1']);
  expect(hookResult.hasMore).toBe(false);
  // loadOlder on B is a no-op (has_more false) — A's cursor did not leak into a new request
  const callsBefore = mockMessages.mock.calls.length;
  await act(async () => { await hookResult.loadOlder(); });
  expect(mockMessages.mock.calls.length).toBe(callsBefore);
});

test('send: a message_new with the real id arriving before the POST resolves yields one row, no tmp left', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  mockMessages.mockReturnValue(ok({ items: [], has_more: false }));
  await mount();
  await act(async () => { await hookResult.select('c1'); });

  let resolveSend;
  mockSend.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
  let sendPromise;
  act(() => { sendPromise = hookResult.send({ text: 'hello there' }); });
  await flush();
  expect(hookResult.messages).toHaveLength(1);
  expect(hookResult.messages[0].message_id).toMatch(/^tmp_/);

  // Our own send is echoed on the stream, and it beats the HTTP response.
  const es = FakeEventSource.instances[0];
  await act(async () => {
    es.emit('message_new', { chat_id: 'c1', message_id: 'srv-1', direction: 'out', preview: 'hello there', status: 'sent', typed_by: 'rep@smartshape.in' });
  });

  await act(async () => {
    resolveSend({ data: { status: 'sent', message_id: 'srv-1', message: { message_id: 'srv-1', chat_id: 'c1', direction: 'out', text: 'hello there', status: 'sent', created_at: '2026-01-01T00:00:05Z' } } });
    await sendPromise;
  });

  expect(hookResult.messages.map((m) => m.message_id)).toEqual(['srv-1']);
  expect(hookResult.messages.some((m) => String(m.message_id).startsWith('tmp_'))).toBe(false);
  expect(hookResult.messages[0].preview_only).toBeUndefined();
  expect(hookResult.messages[0].created_at).toBe('2026-01-01T00:00:05Z');
});

test('a message_new for an unknown chat under scope=mine schedules one debounced chats refetch', async () => {
  jest.useFakeTimers();
  try {
    mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
    await mount();
    expect(mockChats).toHaveBeenCalledTimes(1);

    const es = FakeEventSource.instances[0];
    await act(async () => {
      es.emit('message_new', { chat_id: 'zz', message_id: 'mz1', direction: 'in', preview: 'who dis', unread_count: 1 });
      es.emit('message_new', { chat_id: 'zz', message_id: 'mz2', direction: 'in', preview: 'hello?', unread_count: 2 });
    });
    // not inserted client-side, and not refetched synchronously
    expect(hookResult.chats.map((c) => c.chat_id)).toEqual(['c1']);
    expect(mockChats).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(299); });
    expect(mockChats).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(1); });
    await flush();
    // two events inside the window → exactly one extra load
    expect(mockChats).toHaveBeenCalledTimes(2);
    expect(mockChats).toHaveBeenLastCalledWith({ scope: 'mine', status: 'open', page: 1 });

    // a known chat does not schedule a refetch
    await act(async () => {
      es.emit('message_new', { chat_id: 'c1', message_id: 'mc1', direction: 'in', preview: 'known', unread_count: 1 });
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockChats).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('the pending unknown-chat refetch timer is cleared on unmount', async () => {
  jest.useFakeTimers();
  try {
    mockChats.mockReturnValue(ok({ items: [], total: 0, page: 1, unread_total: 0 }));
    await mount();
    const es = FakeEventSource.instances[0];
    await act(async () => {
      es.emit('message_new', { chat_id: 'zz', message_id: 'mz1', direction: 'in', preview: 'x', unread_count: 1 });
    });
    expect(mockChats).toHaveBeenCalledTimes(1);

    act(() => { root.unmount(); });
    root = createRoot(document.createElement('div'));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockChats).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('pure helper: mergeMessages never lets a preview_only stub overwrite a full row', () => {
  const full = { message_id: 'm1', text: 'full text', media: { url: 'x' }, status: 'sent', created_at: '2026-01-01T00:00:01Z' };
  const stub = { message_id: 'm1', text: 'full…', status: 'delivered', preview_only: true, created_at: '2026-01-02T00:00:00Z' };

  // full first, stub later → full kept untouched
  const a = mergeMessages([full], [stub]);
  expect(a).toHaveLength(1);
  expect(a[0]).toEqual(full);

  // stub first, full later → full replaces and the flag is cleared
  const b = mergeMessages([stub], [full]);
  expect(b).toHaveLength(1);
  expect(b[0].text).toBe('full text');
  expect(b[0].media).toEqual({ url: 'x' });
  expect(b[0].preview_only).toBeUndefined();

  // stub over stub still merges (later wins)
  const c = mergeMessages([stub], [{ ...stub, status: 'read' }]);
  expect(c[0].status).toBe('read');
  expect(c[0].preview_only).toBe(true);
});

test('stream: a message_new stub does not overwrite the full row already in the thread', async () => {
  mockChats.mockReturnValue(ok({ items: [{ chat_id: 'c1', unread_count: 0 }], total: 1, page: 1, unread_total: 0 }));
  mockMessages.mockReturnValue(ok({
    items: [{ message_id: 'm1', chat_id: 'c1', direction: 'in', text: 'the whole message body', media: { url: 'u' }, status: 'delivered', created_at: '2026-01-01T00:00:01Z' }],
    has_more: false,
  }));
  await mount();
  await act(async () => { await hookResult.select('c1'); });

  const es = FakeEventSource.instances[0];
  await act(async () => {
    es.emit('message_new', { chat_id: 'c1', message_id: 'm1', direction: 'in', preview: 'the whole…', status: 'delivered' });
  });

  expect(hookResult.messages).toHaveLength(1);
  expect(hookResult.messages[0].text).toBe('the whole message body');
  expect(hookResult.messages[0].media).toEqual({ url: 'u' });
  expect(hookResult.messages[0].preview_only).toBeUndefined();
});

test('unreadTotal is derived from the chat list (no side effects in updaters)', async () => {
  mockChats.mockReturnValue(ok({
    items: [{ chat_id: 'c1', unread_count: 2 }, { chat_id: 'c2', unread_count: 1 }],
    total: 2, page: 1, unread_total: 10, // 7 unread live on other pages
  }));
  await mount();
  expect(hookResult.unreadTotal).toBe(10);

  const es = FakeEventSource.instances[0];
  await act(async () => { es.emit('message_new', { chat_id: 'c2', message_id: 'n1', direction: 'in', preview: 'p', unread_count: 4 }); });
  expect(hookResult.unreadTotal).toBe(13);

  await act(async () => { es.emit('chat_updated', { chat_id: 'c1', unread_count: 0 }); });
  expect(hookResult.unreadTotal).toBe(11);
});

test('degraded stream: refetches the list every 30 s and stops on unmount', async () => {
  jest.useFakeTimers();
  try {
    mockChats.mockReturnValue(ok({ items: [], total: 0, page: 1, unread_total: 0 }));
    await mount();
    expect(mockChats).toHaveBeenCalledTimes(1);

    const es = FakeEventSource.instances[0];
    await act(async () => { es.error(); });
    await act(async () => { es.error(); });
    await act(async () => { es.error(); });
    expect(hookResult.degraded).toBe(true);

    await act(async () => { jest.advanceTimersByTime(29999); });
    expect(mockChats).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    await flush();
    expect(mockChats).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(30000); });
    await flush();
    expect(mockChats).toHaveBeenCalledTimes(3);

    act(() => { root.unmount(); });
    root = createRoot(document.createElement('div'));
    await act(async () => { jest.advanceTimersByTime(90000); });
    expect(mockChats).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});

test('pure helper: mergeMessages dedupes by message_id and sorts ascending', () => {
  const existing = [
    { message_id: 'm1', created_at: '2026-01-01T00:00:01Z' },
    { message_id: 'm2', created_at: '2026-01-01T00:00:02Z' },
  ];
  const incoming = [
    { message_id: 'm2', created_at: '2026-01-01T00:00:02Z', status: 'read' },
    { message_id: 'm3', created_at: '2026-01-01T00:00:03Z' },
  ];
  const merged = mergeMessages(existing, incoming);
  expect(merged.map((m) => m.message_id)).toEqual(['m1', 'm2', 'm3']);
  expect(merged[1].status).toBe('read');
});
