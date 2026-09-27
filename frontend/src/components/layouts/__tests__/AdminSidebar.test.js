// AdminSidebar: the WhatsApp Inbox item carries the unread badge when waUnread > 0, in the
// same style as the notification badge; no badge at 0. Rendered via react-dom/client.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MessageCircle, Target } from 'lucide-react';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => {
  const R = require('react');
  return {
    useLocation: () => ({ pathname: '/today' }),
    Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children),
  };
}, { virtual: true });
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: false, toggleTheme: jest.fn() }) }));
jest.mock('../NotificationBell', () => () => null);

// eslint-disable-next-line import/first
import AdminSidebar from '../AdminSidebar';

let mounted = [];
beforeEach(() => { document.body.innerHTML = ''; mounted = []; });
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); });

const groups = [{ label: 'Sales & CRM', items: [
  { path: '/leads', icon: Target, label: 'Leads & CRM' },
  { path: '/whatsapp', icon: MessageCircle, label: 'WhatsApp Inbox' },
] }];

async function render(props) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => {
    root.render(<AdminSidebar sidebarGroups={groups} user={{ name: 'Admin', role: 'admin' }} initials="AD"
      onClose={jest.fn()} onLogout={jest.fn()} {...props} />);
  });
  return { el, q: (id) => el.querySelector(`[data-testid="${id}"]`) };
}

test('the WhatsApp Inbox item shows the unread count as a badge', async () => {
  const v = await render({ waUnread: 4 });
  const link = v.q('admin-sidebar-whatsapp-inbox-link');
  expect(link.getAttribute('href')).toBe('/whatsapp');
  const badge = v.q('admin-sidebar-whatsapp-badge');
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe('4');
  expect(link.contains(badge)).toBe(true);
  expect(badge.className).toMatch(/bg-\[#e94560\]/);
  // no badge on the other items
  expect(v.q('admin-sidebar-leads-&-crm-link').querySelector('[data-testid="admin-sidebar-whatsapp-badge"]')).toBeNull();
});

test('no badge at zero; 99+ caps the count', async () => {
  const a = await render({ waUnread: 0 });
  expect(a.q('admin-sidebar-whatsapp-badge')).toBeNull();
  const b = await render({});
  expect(b.q('admin-sidebar-whatsapp-badge')).toBeNull();
  const c = await render({ waUnread: 250 });
  expect(c.q('admin-sidebar-whatsapp-badge').textContent).toBe('99+');
});
