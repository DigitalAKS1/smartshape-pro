// /whatsapp with the REAL inbox hook: a deep link `?chat=c1` selects before the list has
// loaded; when the list lands with c1 unread, the chat is marked read on the server and the
// row shows 0. Only the network (api), the stream and the shell are mocked.
// Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

global.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30000);

const mockRouter = { search: '', setSearchParams: jest.fn() };
jest.mock('react-router-dom', () => {
  const R = require('react');
  return {
    useSearchParams: () => [new URLSearchParams(mockRouter.search), mockRouter.setSearchParams],
    useNavigate: () => jest.fn(),
    Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children),
  };
}, { virtual: true });
jest.mock('../../components/layouts/AppShell', () => ({ children }) => <div data-testid="shell">{children}</div>);
jest.mock('../../hooks/useWaStream', () => jest.fn(() => ({ connected: true, degraded: false })));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'rep@x.in', role: 'sales', name: 'Rep' } }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../lib/api', () => ({
  waInbox: {
    chats: jest.fn(), messages: jest.fn(), read: jest.fn(), send: jest.fn(),
    resolve: jest.fn(), reopen: jest.fn(), assign: jest.fn(), addNote: jest.fn(), link: jest.fn(),
    templates: jest.fn(), renderTemplate: jest.fn(), uploadAttachment: jest.fn(),
    streamUrl: () => 'https://api.example.test/api/wa/stream',
  },
  salesPersons: { getAll: jest.fn() },
  contacts: { getAll: jest.fn() },
}));

// eslint-disable-next-line import/first
import WhatsAppInbox from '../WhatsAppInbox';
// eslint-disable-next-line import/first
import { waInbox } from '../../lib/api';
// eslint-disable-next-line import/first
import useWaStream from '../../hooks/useWaStream';

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

let mounted = [];
beforeEach(() => {
  jest.clearAllMocks();
  useWaStream.mockReturnValue({ connected: true, degraded: false });   // CRA resets mock impls per test
  document.body.innerHTML = '';
  mounted = [];
  mockRouter.search = '';
});
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); });

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(<WhatsAppInbox />); });
  return { el, root, q: (id) => el.querySelector(`[data-testid="${id}"]`), qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)) };
}

test('?chat=c1 before the list loads: once c1 arrives with unread 3 the server is told and the row shows 0', async () => {
  mockRouter.search = 'chat=c1';
  let resolveChats;
  waInbox.chats.mockReturnValue(new Promise((resolve) => { resolveChats = resolve; }));
  waInbox.messages.mockResolvedValue({ data: { items: [
    { message_id: 'm1', chat_id: 'c1', direction: 'in', text: 'Quote?', status: 'delivered', created_at: '2026-09-27T08:00:00Z' },
  ], has_more: false } });
  waInbox.read.mockResolvedValue({ data: { ok: true } });

  const v = await render();
  await flush();
  expect(waInbox.messages).toHaveBeenCalledWith('c1', { limit: 50 });   // selected straight away
  expect(v.q('chat-view').getAttribute('data-chat-id')).toBe('c1');
  expect(waInbox.read).not.toHaveBeenCalled();                          // the row is not loaded yet

  await act(async () => {
    resolveChats({ data: { items: [
      { chat_id: 'c1', display_name: 'Ravi', phone_e164: '919811111111', unread_count: 3, status: 'open',
        last_message_preview: 'Quote?', last_direction: 'in', last_message_at: '2026-09-27T08:00:00Z' },
      { chat_id: 'c2', display_name: 'Meera', unread_count: 1, status: 'open', last_message_at: '2026-09-27T07:00:00Z' },
    ], total: 2, page: 1, unread_total: 4 } });
  });
  await flush();

  expect(waInbox.read).toHaveBeenCalledTimes(1);
  expect(waInbox.read).toHaveBeenCalledWith('c1');
  const rows = v.qa('chat-row');
  expect(rows[0].getAttribute('data-chat-id')).toBe('c1');
  expect(rows[0].querySelector('[data-testid="chat-unread"]')).toBeNull();          // shows 0 → no badge
  expect(rows[1].querySelector('[data-testid="chat-unread"]').textContent).toBe('1'); // the other row is untouched
  expect(v.q('chat-view-title').textContent).toBe('Ravi');
});
