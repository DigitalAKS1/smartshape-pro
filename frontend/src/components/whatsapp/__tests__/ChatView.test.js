// ChatView: ticks by status, attribution when typed on another rep's number, inline media by
// kind (and the "not yet" stub), yellow internal notes in the timeline, quoted context,
// the opt-out / history banners, Load older, and the preview stub hidden behind a pending send.
// Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ChatView, { buildTimeline, dayLabel } from '../ChatView';

global.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30000);                      // cold transform on a busy machine

jest.mock('react-router-dom', () => {
  const R = require('react');
  return { Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('../../../lib/api', () => ({ waInbox: {} }));

const flush = () => act(async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); });

let mounted = [];
beforeEach(() => { document.body.innerHTML = ''; mounted = []; });
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); });

async function render(ui) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(ui); });
  await flush();
  return {
    el, root,
    q: (id) => el.querySelector(`[data-testid="${id}"]`),
    qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)),
  };
}

const T0 = '2026-09-27T09:00:00Z';
const at = (m) => new Date(new Date(T0).getTime() + m * 60000).toISOString();
const chat = { chat_id: 'c1', display_name: 'Ravi', phone_e164: '919811111111', instance_label: 'Priya', status: 'open' };
const out = (id, status, extra = {}) => ({
  message_id: id, chat_id: 'c1', direction: 'out', text: `msg ${id}`, status,
  typed_by: 'rep@x.in', sent_via_owner_email: 'rep@x.in', created_at: at(Number(id.replace(/\D/g, '')) || 0), ...extra,
});

test('outbound ticks follow the status; failed and skipped carry the reason', async () => {
  const messages = [
    out('m1', 'queued'), out('m2', 'sent'), out('m3', 'delivered'), out('m4', 'read'),
    out('m5', 'failed', { fail_reason: 'Number not on WhatsApp' }),
    out('m6', 'skipped', { fail_reason: 'Daily cap reached' }),
    { message_id: 'm7', chat_id: 'c1', direction: 'in', text: 'hello', status: 'delivered', created_at: at(7) },
  ];
  const v = await render(<ChatView chat={chat} messages={messages} />);
  const ticks = v.qa('msg-tick').map((t) => t.getAttribute('data-status'));
  expect(ticks).toEqual(['queued', 'sent', 'delivered', 'read', 'failed', 'skipped']);
  const reasons = v.qa('msg-fail-reason').map((r) => r.textContent);
  expect(reasons).toEqual(['Number not on WhatsApp', 'Daily cap reached']);
  expect(v.qa('msg-tick')[3].className).toMatch(/sky/);            // read = blue ticks
  expect(v.qa('msg-tick')[4].className).toMatch(/red/);
  // inbound rows carry no tick and sit on the left
  const rows = v.qa('msg-row');
  expect(rows[6].getAttribute('data-direction')).toBe('in');
  expect(rows[6].className).toMatch(/justify-start/);
  expect(rows[0].className).toMatch(/justify-end/);
});

test('a message typed by someone else on this number is attributed', async () => {
  const messages = [
    out('m1', 'sent', { typed_by: 'manager@x.in', sent_via_owner_email: 'rep@x.in' }),
    out('m2', 'sent'),
  ];
  const v = await render(<ChatView chat={chat} messages={messages} />);
  const tags = v.qa('msg-attribution');
  expect(tags).toHaveLength(1);
  expect(tags[0].textContent).toBe('sent by manager@x.in via rep@x.in');
});

test('media renders by kind: image, video, audio, document link, and a pending stub', async () => {
  const messages = [
    { message_id: 'a1', direction: 'in', created_at: at(1), media: { type: 'image', url: 'https://x/a.jpg', filename: 'a.jpg' } },
    { message_id: 'a2', direction: 'in', created_at: at(2), media: { type: 'video', url: 'https://x/b.mp4' } },
    { message_id: 'a3', direction: 'in', created_at: at(3), media: { type: 'audio', url: 'https://x/c.ogg' } },
    { message_id: 'a4', direction: 'in', created_at: at(4), media: { type: 'document', url: 'https://x/d.pdf', filename: 'Quote.pdf' } },
    { message_id: 'a5', direction: 'in', created_at: at(5), media: { type: 'image', url: '', pending: true } },
  ];
  const v = await render(<ChatView chat={chat} messages={messages} />);
  const media = v.qa('msg-media');
  expect(media.map((m) => m.getAttribute('data-kind'))).toEqual(['image', 'video', 'audio', 'document', 'pending']);
  expect(media[0].tagName).toBe('IMG');
  expect(media[0].getAttribute('src')).toBe('https://x/a.jpg');
  expect(media[1].tagName).toBe('VIDEO');
  expect(media[1].hasAttribute('controls')).toBe(true);
  expect(media[2].tagName).toBe('AUDIO');
  expect(media[2].hasAttribute('controls')).toBe(true);
  expect(media[3].tagName).toBe('A');
  expect(media[3].getAttribute('href')).toBe('https://x/d.pdf');
  expect(media[3].textContent).toMatch(/Quote\.pdf/);
  expect(media[4].textContent).toMatch(/Media not available yet/);
});

test('internal notes show as yellow bubbles in time order with the messages', async () => {
  const withNotes = { ...chat, notes: [{ by: 'manager@x.in', text: 'Call after 4 pm', at: at(2) }] };
  const messages = [out('m1', 'sent'), out('m3', 'sent')];
  const v = await render(<ChatView chat={withNotes} messages={messages} />);
  const note = v.q('note-row');
  expect(note).not.toBeNull();
  expect(note.textContent).toMatch(/Call after 4 pm/);
  expect(note.textContent).toMatch(/manager@x.in/);
  expect(note.querySelector('div').className).toMatch(/amber/);
  // order: m1 (t+1), note (t+2), m3 (t+3)
  const rows = Array.from(v.el.querySelectorAll('[data-testid="msg-row"], [data-testid="note-row"]'));
  expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['msg-row', 'note-row', 'msg-row']);
});

test('date separators, quoted context, opt-out and history banners, Load older', async () => {
  const onLoadOlder = jest.fn();
  const c = { ...chat, opted_out: true, history_synced_at: '2026-09-20T00:00:00Z' };
  const messages = [
    { message_id: 'p1', provider_msg_id: 'PROV1', direction: 'in', text: 'Original question', created_at: '2026-09-26T08:00:00Z' },
    out('m2', 'sent', { quoted_provider_msg_id: 'PROV1', created_at: '2026-09-27T08:00:00Z' }),
    out('m3', 'sent', { quoted_provider_msg_id: 'UNKNOWN', created_at: '2026-09-27T08:05:00Z' }),
  ];
  const v = await render(<ChatView chat={c} messages={messages} hasMore onLoadOlder={onLoadOlder} />);
  expect(v.qa('day-separator')).toHaveLength(2);
  const quoted = v.qa('msg-quoted');
  expect(quoted[0].textContent).toBe('Original question');
  expect(quoted[1].textContent).toBe('Replying to an earlier message');
  expect(v.q('chat-opted-out')).not.toBeNull();
  expect(v.q('chat-history-banner').textContent).toMatch(/^History before .* may be incomplete$/);
  act(() => { v.q('chat-load-older').click(); });
  expect(onLoadOlder).toHaveBeenCalledTimes(1);
});

test('no Load older without more history; Resolve/Reopen follow the chat status; back only when asked', async () => {
  const onResolve = jest.fn(); const onReopen = jest.fn(); const onBack = jest.fn();
  const v = await render(<ChatView chat={chat} messages={[]} onResolve={onResolve} onReopen={onReopen} />);
  expect(v.q('chat-load-older')).toBeNull();
  expect(v.q('chat-back')).toBeNull();
  expect(v.q('chat-view-title').textContent).toBe('Ravi');
  expect(v.q('chat-view-meta').textContent).toBe('+91 98111 11111 · via Priya');
  act(() => { v.q('chat-resolve').click(); });
  expect(onResolve).toHaveBeenCalledWith('c1');
  const w = await render(<ChatView chat={{ ...chat, status: 'resolved' }} messages={[]} onReopen={onReopen} onBack={onBack} />);
  expect(w.q('chat-resolve')).toBeNull();
  act(() => { w.q('chat-reopen').click(); });
  expect(onReopen).toHaveBeenCalledWith('c1');
  act(() => { w.q('chat-back').click(); });
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('an outbound preview stub is hidden only while our optimistic bubble is still pending; inbound stubs always show', () => {
  const ids = (list) => buildTimeline(list).filter((r) => r.kind === 'message').map((r) => r.data.message_id);
  const pending = [
    { message_id: 'tmp_1', direction: 'out', text: 'hi', status: 'queued', created_at: at(1) },
    { message_id: 'real_1', direction: 'out', text: 'hi', status: 'sent', created_at: at(1), preview_only: true },
  ];
  expect(ids(pending)).toEqual(['tmp_1']);
  // pending tmp + INBOUND stub → the stub (their reply) must render
  const inboundStub = [
    { message_id: 'tmp_1', direction: 'out', text: 'hi', status: 'queued', created_at: at(1) },
    { message_id: 'in_1', direction: 'in', text: 'yes?', status: 'delivered', created_at: at(2), preview_only: true },
  ];
  expect(ids(inboundStub)).toEqual(['tmp_1', 'in_1']);
  // a FAILED tmp bubble suppresses nothing — an inbound stub and an outbound stub both render
  const failedTmp = [
    { message_id: 'tmp_1', direction: 'out', text: 'hi', status: 'failed', fail_reason: 'cap', created_at: at(1) },
    { message_id: 'in_1', direction: 'in', text: 'yes?', status: 'delivered', created_at: at(2), preview_only: true },
    { message_id: 'out_2', direction: 'out', text: 'again', status: 'sent', created_at: at(3), preview_only: true },
  ];
  expect(ids(failedTmp)).toEqual(['tmp_1', 'in_1', 'out_2']);
  const settled = [{ message_id: 'real_1', direction: 'out', text: 'hi', status: 'sent', created_at: at(1), preview_only: true }];
  expect(buildTimeline(settled).filter((r) => r.kind === 'message').map((r) => r.data.message_id)).toEqual(['real_1']);
});

test('media with a non-http URL is never a link or a src — the filename shows as plain text', async () => {
  const messages = [
    { message_id: 'x1', direction: 'in', created_at: at(1), media: { type: 'document', url: 'javascript:alert(1)', filename: 'evil.pdf' } },
    { message_id: 'x2', direction: 'in', created_at: at(2), media: { type: 'image', url: 'data:text/html,hi', filename: 'pic.jpg' } },
    { message_id: 'x3', direction: 'in', created_at: at(3), media: { type: 'document', url: '/uploads/ok.pdf', filename: 'ok.pdf' } },
    { message_id: 'x4', direction: 'in', created_at: at(4), media: { type: 'document', url: '//cdn.x/ok2.pdf', filename: 'ok2.pdf' } },
  ];
  const v = await render(<ChatView chat={chat} messages={messages} />);
  const media = v.qa('msg-media');
  expect(media[0].tagName).toBe('SPAN');
  expect(media[0].getAttribute('data-kind')).toBe('unsafe');
  expect(media[0].textContent).toMatch(/evil\.pdf/);
  expect(media[1].tagName).toBe('SPAN');
  expect(v.el.querySelectorAll('a[href^="javascript"], img[src^="data"]')).toHaveLength(0);
  expect(media[2].tagName).toBe('A');
  expect(media[2].getAttribute('href')).toBe('/uploads/ok.pdf');
  expect(media[3].tagName).toBe('A');
});

test('dayLabel says Today / Yesterday, else the date', () => {
  const now = new Date('2026-09-27T12:00:00');
  expect(dayLabel('2026-09-27T01:00:00', now)).toBe('Today');
  expect(dayLabel('2026-09-26T23:00:00', now)).toBe('Yesterday');
  expect(dayLabel('2026-09-01T10:00:00', now)).not.toMatch(/Today|Yesterday/);
});

test('without a chat the pane invites a selection', async () => {
  const v = await render(<ChatView chat={null} messages={[]} />);
  expect(v.q('chat-view-empty')).not.toBeNull();
});
