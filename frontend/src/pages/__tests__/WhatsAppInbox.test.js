// /whatsapp: list + selected conversation from the inbox hook; a row click selects; Enter in
// the composer sends; a manager sees the instance chips and the assignee select; a phone-width
// viewport shows one pane at a time; ?chat=<id> selects on load.
// Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

global.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30000);                      // first render pays the cold transform of the whole page tree

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
jest.mock('../../hooks/useWaInbox', () => jest.fn());
jest.mock('../../hooks/useWaStream', () => jest.fn(() => ({ connected: true, degraded: false })));
jest.mock('../../lib/api', () => ({
  waInbox: { templates: jest.fn(), renderTemplate: jest.fn(), uploadAttachment: jest.fn() },
  salesPersons: { getAll: jest.fn() },
  contacts: { getAll: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import WhatsAppInbox from '../WhatsAppInbox';
// eslint-disable-next-line import/first
import useWaInbox from '../../hooks/useWaInbox';
// eslint-disable-next-line import/first
import { salesPersons } from '../../lib/api';

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

const chats = [
  { chat_id: 'c1', contact_name: 'Ravi Kumar', school_name: 'DPS Noida', phone_e164: '919811111111', unread_count: 2,
    last_message_preview: 'Quote?', last_direction: 'in', instance_name: 'rep_priya', instance_label: 'Priya',
    last_message_at: new Date().toISOString(), status: 'open', assignee_email: '', notes: [] },
  { chat_id: 'c2', display_name: 'Meera', phone_e164: '919822222222', unread_count: 0,
    last_message_preview: 'Thanks', last_direction: 'out', instance_name: 'company', instance_label: 'Company',
    last_message_at: new Date().toISOString(), status: 'open' },
];
const messages = [
  { message_id: 'm1', chat_id: 'c1', direction: 'in', text: 'Quote?', status: 'delivered', created_at: '2026-09-27T08:00:00Z' },
  { message_id: 'm2', chat_id: 'c1', direction: 'out', text: 'Sending now', status: 'read', typed_by: 'rep@x.in',
    sent_via_owner_email: 'rep@x.in', created_at: '2026-09-27T08:01:00Z' },
];

function hookState(extra = {}) {
  return {
    filters: { scope: 'mine', status: 'open', instance: '', q: '' }, setFilters: jest.fn(),
    chats, total: 2, unreadTotal: 2,
    selectedId: 'c1', messages, hasMore: false,
    loading: false, sending: false, isManager: false, connected: true, degraded: false, instanceStates: {},
    select: jest.fn(), loadOlder: jest.fn(), send: jest.fn(),
    resolve: jest.fn(), reopen: jest.fn(), assign: jest.fn(), addNote: jest.fn(), link: jest.fn(), reloadChats: jest.fn(),
    ...extra,
  };
}

let mounted = [];
let matchMediaBackup;
beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  mounted = [];
  mockRouter.search = '';
  mockRouter.setSearchParams.mockReset();
  matchMediaBackup = window.matchMedia;
  salesPersons.getAll.mockResolvedValue({ data: [{ email: 'priya@x.in', name: 'Priya' }, { email: 'amit@x.in', name: 'Amit' }] });
});
afterEach(() => {
  mounted.forEach((r) => act(() => r.unmount()));
  window.matchMedia = matchMediaBackup;
});

function mobile(matches) {
  window.matchMedia = jest.fn(() => ({ matches, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
}

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(<WhatsAppInbox />); });
  await flush();
  return { el, root, q: (id) => el.querySelector(`[data-testid="${id}"]`), qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)) };
}

function type(el, value) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

test('desktop: the list, the selected conversation and the rail render side by side', async () => {
  useWaInbox.mockReturnValue(hookState());
  const v = await render();
  expect(v.q('wa-inbox').getAttribute('data-layout')).toBe('desktop');
  expect(v.qa('chat-row')).toHaveLength(2);
  expect(v.q('chat-view-title').textContent).toBe('Ravi Kumar');
  expect(v.qa('msg-row')).toHaveLength(2);
  expect(v.q('msg-tick').getAttribute('data-status')).toBe('read');
  expect(v.q('wa-pane-rail')).not.toBeNull();
  expect(v.q('rail-contact')).toBeNull();                 // c1 has no contact_id → unlinked card
  expect(v.q('rail-unlinked')).not.toBeNull();
  expect(v.q('rail-assignee')).toBeNull();                // not a manager
  expect(salesPersons.getAll).not.toHaveBeenCalled();
});

test('clicking a row selects that chat and records it in the URL', async () => {
  const s = hookState();
  useWaInbox.mockReturnValue(s);
  const v = await render();
  act(() => { v.qa('chat-row')[1].click(); });
  expect(s.select).toHaveBeenCalledWith('c2');
  expect(mockRouter.setSearchParams).toHaveBeenCalled();
  const updater = mockRouter.setSearchParams.mock.calls[0][0];
  expect(updater(new URLSearchParams('')).get('chat')).toBe('c2');
});

test('Enter in the composer sends through the hook', async () => {
  const s = hookState();
  useWaInbox.mockReturnValue(s);
  const v = await render();
  const ta = v.q('composer-text');
  act(() => { type(ta, 'On its way'); });
  act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(s.send).toHaveBeenCalledWith({ text: 'On its way' });
});

test('a manager sees which number each chat is on and can assign it', async () => {
  const s = hookState({ isManager: true });
  useWaInbox.mockReturnValue(s);
  const v = await render();
  expect(v.qa('chat-instance').map((c) => c.textContent)).toEqual(['via Priya', 'via Company']);
  expect(v.q('filter-instance')).not.toBeNull();
  expect(salesPersons.getAll).toHaveBeenCalledTimes(1);
  const sel = v.q('rail-assignee');
  expect(sel).not.toBeNull();
  expect(Array.from(sel.querySelectorAll('option')).map((o) => o.value)).toEqual(['', 'priya@x.in', 'amit@x.in']);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'amit@x.in');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(s.assign).toHaveBeenCalledWith('c1', 'amit@x.in');
});

test('the rail collapses and reopens from the header toggle; Resolve reaches the hook', async () => {
  const s = hookState();
  useWaInbox.mockReturnValue(s);
  const v = await render();
  act(() => { v.q('chat-rail-toggle').click(); });
  expect(v.q('wa-pane-rail')).toBeNull();
  act(() => { v.q('chat-rail-toggle').click(); });
  expect(v.q('wa-pane-rail')).not.toBeNull();
  act(() => { v.q('chat-resolve').click(); });
  expect(s.resolve).toHaveBeenCalledWith('c1');
});

test('phone width: the list alone, then the conversation alone with a back button, the rail as a sheet', async () => {
  mobile(true);
  const s = hookState({ selectedId: null, messages: [] });
  useWaInbox.mockReturnValue(s);
  const v = await render();
  expect(v.q('wa-inbox').getAttribute('data-layout')).toBe('mobile');
  expect(v.q('wa-pane-list')).not.toBeNull();
  expect(v.q('wa-pane-chat')).toBeNull();
  // select → the hook would set selectedId; simulate by re-rendering with it set
  act(() => { v.qa('chat-row')[0].click(); });
  expect(s.select).toHaveBeenCalledWith('c1');
  useWaInbox.mockReturnValue(hookState({ selectedId: 'c1' }));
  await act(async () => { v.root.render(<WhatsAppInbox />); });
  await flush();
  expect(v.q('wa-pane-list')).toBeNull();
  expect(v.q('wa-pane-chat')).not.toBeNull();
  expect(v.q('wa-pane-rail')).toBeNull();
  expect(v.q('wa-rail-sheet')).toBeNull();
  act(() => { v.q('chat-rail-toggle').click(); });
  expect(v.q('wa-rail-sheet')).not.toBeNull();
  act(() => { v.q('rail-close').click(); });
  expect(v.q('wa-rail-sheet')).toBeNull();
  act(() => { v.q('chat-back').click(); });
  expect(v.q('wa-pane-list')).not.toBeNull();
  expect(v.q('wa-pane-chat')).toBeNull();
});

test('?chat=<id> selects that chat once on load', async () => {
  mockRouter.search = 'chat=c2';
  const s = hookState({ selectedId: null, messages: [] });
  useWaInbox.mockReturnValue(s);
  const v = await render();
  expect(s.select).toHaveBeenCalledTimes(1);
  expect(s.select).toHaveBeenCalledWith('c2');
  expect(s.setFilters).not.toHaveBeenCalled();           // c2 is on the page → filters stay
  await act(async () => { v.root.render(<WhatsAppInbox />); });
  expect(s.select).toHaveBeenCalledTimes(1);
});

test('?chat=<id> for a chat outside the default filters widens them once', async () => {
  mockRouter.search = 'chat=c_hidden';
  const s = hookState({ selectedId: 'c_hidden', messages: [] });
  useWaInbox.mockReturnValue(s);
  const v = await render();
  expect(s.select).toHaveBeenCalledWith('c_hidden');
  expect(s.setFilters).toHaveBeenCalledTimes(1);
  expect(s.setFilters).toHaveBeenCalledWith({ scope: 'all', status: 'all' });
  expect(v.q('chat-view').getAttribute('data-chat-id')).toBe('c_hidden');   // the thread still renders
  await act(async () => { v.root.render(<WhatsAppInbox />); });
  expect(s.setFilters).toHaveBeenCalledTimes(1);
});
