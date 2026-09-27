// ChatList: the filter bar emits scope / status / rep / search (search debounced 300 ms),
// rows carry the unread badge and, for managers, the number the chat is on; empty, loading
// and degraded states. Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ChatList, { initials, chatTitle, chatSubtitle, instanceOptions, prettyPhone } from '../ChatList';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => {
  const R = require('react');
  return { Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('../../../lib/api', () => ({ waInbox: {} }));

const flush = () => act(async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); });

let mounted = [];
beforeEach(() => { document.body.innerHTML = ''; mounted = []; });
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); jest.useRealTimers(); });

async function render(ui) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(ui); });
  await flush();
  return { el, root, q: (id) => el.querySelector(`[data-testid="${id}"]`), qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)) };
}

function type(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const chats = [
  { chat_id: 'c1', contact_name: 'Ravi Kumar', school_name: 'DPS Noida', phone_e164: '919811111111', unread_count: 3,
    last_message_preview: 'Can you send the quote?', last_direction: 'in', instance_name: 'rep_priya', instance_label: 'Priya',
    last_message_at: new Date().toISOString(), status: 'open' },
  { chat_id: 'c2', display_name: 'Unknown', phone_e164: '919822222222', unread_count: 0,
    last_message_preview: 'Thanks', last_direction: 'out', instance_name: 'company', instance_label: 'Company number',
    last_message_at: new Date(Date.now() - 3600000).toISOString(), status: 'open' },
];
const filters = { scope: 'mine', status: 'open', instance: '', q: '' };

test('rows show name, school line, preview, unread badge; only unread rows get a badge', async () => {
  const v = await render(<ChatList chats={chats} filters={filters} onFiltersChange={jest.fn()} onSelect={jest.fn()} />);
  const rows = v.qa('chat-row');
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector('[data-testid="chat-title"]').textContent).toBe('Ravi Kumar');
  expect(rows[0].querySelector('[data-testid="chat-subtitle"]').textContent).toBe('DPS Noida');
  expect(rows[0].querySelector('[data-testid="chat-preview"]').textContent).toBe('Can you send the quote?');
  expect(rows[0].querySelector('[data-testid="chat-unread"]').textContent).toBe('3');
  expect(rows[1].querySelector('[data-testid="chat-unread"]')).toBeNull();
  expect(rows[1].querySelector('[data-testid="chat-preview"]').textContent).toBe('You: Thanks');
  expect(rows[1].querySelector('[data-testid="chat-subtitle"]').textContent).toBe('+91 98222 22222');
  // no instance chip or rep filter for a plain rep
  expect(v.q('chat-instance')).toBeNull();
  expect(v.q('filter-instance')).toBeNull();
});

test('clicking a row selects it; the selected row is marked', async () => {
  const onSelect = jest.fn();
  const v = await render(<ChatList chats={chats} selectedId="c2" filters={filters} onFiltersChange={jest.fn()} onSelect={onSelect} />);
  act(() => { v.qa('chat-row')[0].click(); });
  expect(onSelect).toHaveBeenCalledWith('c1');
  expect(v.qa('chat-row')[1].getAttribute('aria-current')).toBe('true');
  expect(v.qa('chat-row')[0].getAttribute('aria-current')).toBeNull();
});

test('scope and status tabs emit a filter patch', async () => {
  const onFiltersChange = jest.fn();
  const v = await render(<ChatList chats={chats} filters={filters} onFiltersChange={onFiltersChange} onSelect={jest.fn()} />);
  expect(v.q('scope-mine').getAttribute('aria-selected')).toBe('true');
  act(() => { v.q('scope-all').click(); });
  expect(onFiltersChange).toHaveBeenCalledWith({ scope: 'all' });
  act(() => { v.q('scope-unassigned').click(); });
  expect(onFiltersChange).toHaveBeenCalledWith({ scope: 'unassigned' });
  act(() => { v.q('status-resolved').click(); });
  expect(onFiltersChange).toHaveBeenCalledWith({ status: 'resolved' });
  act(() => { v.q('status-all').click(); });
  expect(onFiltersChange).toHaveBeenCalledWith({ status: 'all' });
});

test('a manager sees the instance chip and a rep select built from the list', async () => {
  const onFiltersChange = jest.fn();
  const v = await render(<ChatList chats={chats} isManager filters={filters} onFiltersChange={onFiltersChange} onSelect={jest.fn()} />);
  const chips = v.qa('chat-instance').map((c) => c.textContent);
  expect(chips).toEqual(['via Priya', 'via Company number']);
  const sel = v.q('filter-instance');
  const opts = Array.from(sel.querySelectorAll('option')).map((o) => [o.value, o.textContent]);
  expect(opts).toEqual([['', 'All numbers'], ['rep_priya', 'Priya'], ['company', 'Company number']]);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'rep_priya');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onFiltersChange).toHaveBeenCalledWith({ instance: 'rep_priya' });
});

test('search waits 300 ms after the last keystroke, then emits once with the trimmed text', async () => {
  jest.useFakeTimers();
  const onFiltersChange = jest.fn();
  const v = await render(<ChatList chats={chats} filters={filters} onFiltersChange={onFiltersChange} onSelect={jest.fn()} />);
  const box = v.q('chat-search');
  act(() => { type(box, 'ra'); });
  act(() => { jest.advanceTimersByTime(200); });
  act(() => { type(box, 'rav '); });
  act(() => { jest.advanceTimersByTime(299); });
  expect(onFiltersChange).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1); });
  expect(onFiltersChange).toHaveBeenCalledTimes(1);
  expect(onFiltersChange).toHaveBeenCalledWith({ q: 'rav' });
  expect(box.value).toBe('rav ');
  // same text again → nothing new
  act(() => { type(box, 'rav'); });
  act(() => { jest.advanceTimersByTime(300); });
  expect(onFiltersChange).toHaveBeenCalledTimes(1);
});

test('loading, empty and degraded states', async () => {
  const a = await render(<ChatList chats={[]} loading filters={filters} onFiltersChange={jest.fn()} onSelect={jest.fn()} />);
  expect(a.q('chat-loading')).not.toBeNull();
  expect(a.q('chat-empty')).toBeNull();
  const b = await render(<ChatList chats={[]} loading={false} degraded filters={filters} onFiltersChange={jest.fn()} onSelect={jest.fn()} />);
  expect(b.q('chat-empty')).not.toBeNull();
  expect(b.q('chat-degraded').textContent).toBe('Live updates paused — refreshing every 30 s');
  const c = await render(<ChatList chats={chats} filters={filters} onFiltersChange={jest.fn()} onSelect={jest.fn()} />);
  expect(c.q('chat-degraded')).toBeNull();
});

test('helpers: initials, title fallbacks, subtitle, phone, instance options', () => {
  expect(initials('Ravi Kumar')).toBe('RK');
  expect(initials('ravi')).toBe('R');
  expect(initials('+91 98111 11111')).toBe('#');
  expect(chatTitle({ contact_name: 'A', display_name: 'B' })).toBe('A');
  expect(chatTitle({ display_name: 'B', push_name: 'C' })).toBe('B');
  expect(chatTitle({ push_name: 'C' })).toBe('C');
  expect(chatTitle({ phone_e164: '919811111111' })).toBe('+91 98111 11111');
  expect(chatSubtitle({ contact_name: 'A', school_name: 'S' })).toBe('S');
  expect(chatSubtitle({ contact_name: 'A', phone_e164: '919811111111' })).toBe('+91 98111 11111');
  expect(chatSubtitle({ phone_e164: '919811111111' })).toBe('');
  expect(prettyPhone('447700900123')).toBe('+447700900123');
  expect(instanceOptions([{ instance_name: 'a', instance_label: 'A' }, { instance_name: 'a' }, { instance_name: 'b' }]))
    .toEqual([{ value: 'a', label: 'A' }, { value: 'b', label: 'b' }]);
});
