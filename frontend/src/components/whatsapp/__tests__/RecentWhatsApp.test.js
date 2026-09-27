// RecentWhatsApp: read-only last-N messages for a record — asks /wa/messages for only the
// id it was given, draws newest at the bottom with outbound ticks, attributes messages typed
// by someone other than the number's owner, and links into the inbox for the newest chat.
// Rendered via react-dom/client (no @testing-library/react here).
//
// react-router-dom v7 is ESM-only and this project's Jest resolver can't load it (see
// useGoBack.test.js), so it is stubbed with a virtual mock: Link renders a plain <a href>
// and MemoryRouter is a pass-through — enough to assert the Open chat href.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import RecentWhatsApp, { relativeTime, statusTick } from '../RecentWhatsApp';
import { waInbox } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => {
  const R = require('react');
  return {
    MemoryRouter: ({ children }) => R.createElement(R.Fragment, null, children),
    Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children),
  };
}, { virtual: true });
jest.mock('../../../lib/api', () => ({ waInbox: { byRecord: jest.fn() } }));

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

let mounted = [];
beforeEach(() => { jest.clearAllMocks(); document.body.innerHTML = ''; mounted = []; });
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); });

async function render(ui) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); });
  await flush();
  return {
    el, root,
    q: (id) => el.querySelector(`[data-testid="${id}"]`),
    qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)),
    rerender: async (next) => { await act(async () => { root.render(<MemoryRouter>{next}</MemoryRouter>); }); await flush(); },
  };
}

const NOW = new Date('2026-09-27T10:00:00Z').getTime();
const ago = (mins) => new Date(NOW - mins * 60000).toISOString();

// Newest first, as the API returns them.
const ROWS = [
  { message_id: 'm4', chat_id: 'chat_9', direction: 'out', text: 'Sending the PDF', status: 'failed', fail_reason: 'number not on WhatsApp',
    typed_by: 'rep2@smartshape.in', sent_via_owner_email: 'rep1@smartshape.in', created_at: ago(1) },
  { message_id: 'm3', chat_id: 'chat_9', direction: 'out', text: 'Read this one', status: 'read',
    typed_by: 'rep1@smartshape.in', sent_via_owner_email: 'rep1@smartshape.in', created_at: ago(5) },
  { message_id: 'm2', chat_id: 'chat_9', direction: 'in', text: 'Hello, price list?',
    media: { type: 'image', url: 'https://cdn/x.jpg', filename: 'photo.jpg' }, status: 'received', created_at: ago(60) },
  { message_id: 'm1', chat_id: 'chat_9', direction: 'out', text: 'Hi from SmartShape', status: 'delivered',
    typed_by: 'rep1@smartshape.in', sent_via_owner_email: 'rep1@smartshape.in', created_at: ago(60 * 24 * 2) },
];

test('asks for only the id it was given, plus the limit', async () => {
  waInbox.byRecord.mockResolvedValue({ data: [] });
  await render(<RecentWhatsApp contactId="c1" />);
  expect(waInbox.byRecord).toHaveBeenCalledTimes(1);
  expect(waInbox.byRecord).toHaveBeenCalledWith({ contact_id: 'c1', limit: 20 });

  await render(<RecentWhatsApp schoolId="s1" limit={5} />);
  expect(waInbox.byRecord).toHaveBeenLastCalledWith({ school_id: 's1', limit: 5 });

  await render(<RecentWhatsApp leadId="l1" />);
  expect(waInbox.byRecord).toHaveBeenLastCalledWith({ lead_id: 'l1', limit: 20 });
});

test('rows render newest last, with the outbound ticks and the failure reason', async () => {
  waInbox.byRecord.mockResolvedValue({ data: ROWS });
  const v = await render(<RecentWhatsApp contactId="c1" />);
  const texts = v.qa('rw-text').map((n) => n.textContent);
  expect(texts).toEqual(['Hi from SmartShape', 'Hello, price list?', 'Read this one', 'Sending the PDF']);
  const rows = v.qa('rw-row');
  expect(rows.map((r) => r.getAttribute('data-direction'))).toEqual(['out', 'in', 'out', 'out']);
  const ticks = v.qa('rw-tick').map((n) => n.textContent);
  expect(ticks).toEqual(['✓✓', '✓✓ read', '!']);          // the inbound row has no tick
  const failed = v.qa('rw-tick')[2];
  expect(failed.getAttribute('title')).toBe('number not on WhatsApp');
  expect(v.q('rw-empty')).toBeNull();
  expect(v.q('rw-loading')).toBeNull();
});

test('media shows as a paperclip link to the file', async () => {
  waInbox.byRecord.mockResolvedValue({ data: ROWS });
  const v = await render(<RecentWhatsApp contactId="c1" />);
  const media = v.q('rw-media');
  expect(media.tagName).toBe('A');
  expect(media.getAttribute('href')).toBe('https://cdn/x.jpg');
  expect(media.getAttribute('target')).toBe('_blank');
  expect(media.getAttribute('rel')).toBe('noreferrer');
  expect(media.textContent).toBe('📎 photo.jpg');
});

test('a message typed by someone else than the number owner is attributed; own messages are not', async () => {
  waInbox.byRecord.mockResolvedValue({ data: ROWS });
  const v = await render(<RecentWhatsApp contactId="c1" />);
  const tags = v.qa('rw-attribution');
  expect(tags).toHaveLength(1);
  expect(tags[0].textContent).toBe('sent by rep2@smartshape.in via rep1@smartshape.in');
});

test('Open chat links to the inbox for the newest row\'s chat', async () => {
  waInbox.byRecord.mockResolvedValue({ data: [{ ...ROWS[0], chat_id: 'chat a/b' }, ROWS[1]] });
  const v = await render(<RecentWhatsApp contactId="c1" />);
  expect(v.q('rw-open-chat').getAttribute('href')).toBe('/whatsapp?chat=chat%20a%2Fb');
});

test('no rows: the empty state and no Open chat link', async () => {
  waInbox.byRecord.mockResolvedValue({ data: [] });
  const v = await render(<RecentWhatsApp contactId="c1" />);
  expect(v.q('rw-empty').textContent).toBe('No WhatsApp messages yet');
  expect(v.q('rw-open-chat')).toBeNull();
  expect(v.q('rw-list')).toBeNull();
});

test('a failed load shows the error state', async () => {
  waInbox.byRecord.mockRejectedValue(new Error('boom'));
  const v = await render(<RecentWhatsApp contactId="c1" />);
  expect(v.q('rw-error').textContent).toBe('Could not load WhatsApp messages');
  expect(v.q('rw-empty')).toBeNull();
  expect(v.q('rw-open-chat')).toBeNull();
});

test('refetches when the contact changes and shows the new contact\'s rows', async () => {
  waInbox.byRecord.mockImplementation(({ contact_id }) => Promise.resolve({
    data: contact_id === 'c1' ? [ROWS[3]] : [{ ...ROWS[2], message_id: 'z1', chat_id: 'chat_other', text: 'Other contact' }],
  }));
  const v = await render(<RecentWhatsApp contactId="c1" />);
  expect(v.qa('rw-text').map((n) => n.textContent)).toEqual(['Hi from SmartShape']);
  await v.rerender(<RecentWhatsApp contactId="c2" />);
  expect(waInbox.byRecord).toHaveBeenCalledTimes(2);
  expect(waInbox.byRecord).toHaveBeenLastCalledWith({ contact_id: 'c2', limit: 20 });
  expect(v.qa('rw-text').map((n) => n.textContent)).toEqual(['Other contact']);
  expect(v.q('rw-open-chat').getAttribute('href')).toBe('/whatsapp?chat=chat_other');
});

test('a slow earlier load cannot overwrite a newer one', async () => {
  let resolveFirst;
  waInbox.byRecord
    .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
    .mockImplementationOnce(() => Promise.resolve({ data: [{ ...ROWS[1], text: 'second' }] }));
  const v = await render(<RecentWhatsApp contactId="c1" />);
  await v.rerender(<RecentWhatsApp contactId="c2" />);
  expect(v.qa('rw-text').map((n) => n.textContent)).toEqual(['second']);
  await act(async () => { resolveFirst({ data: [{ ...ROWS[1], text: 'first (stale)' }] }); });
  await flush();
  expect(v.qa('rw-text').map((n) => n.textContent)).toEqual(['second']);
});

test('the tick and relative-time helpers', () => {
  expect(statusTick('queued')).toBe('⏱');
  expect(statusTick('sent')).toBe('✓');
  expect(statusTick('delivered')).toBe('✓✓');
  expect(statusTick('read')).toBe('✓✓ read');
  expect(statusTick('failed')).toBe('!');
  expect(statusTick('skipped')).toBe('!');
  expect(statusTick('received')).toBe('');
  expect(relativeTime(ago(0.5), NOW)).toBe('just now');
  expect(relativeTime(ago(5), NOW)).toBe('5m ago');
  expect(relativeTime(ago(180), NOW)).toBe('3h ago');
  expect(relativeTime(ago(60 * 24 * 2), NOW)).toBe('2d ago');
  expect(relativeTime(ago(60 * 24 * 30), NOW)).toBe(new Date(NOW - 30 * 86400000).toLocaleDateString());
  expect(relativeTime('', NOW)).toBe('');
  expect(relativeTime('not a date', NOW)).toBe('');
});
