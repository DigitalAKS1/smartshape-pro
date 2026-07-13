// Smoke tests: the Data Cleanup panel must be completely invisible to anyone
// but the superadmin (info@smartshape.in) — same gate as OwnerDeleteButton.
// Rendered directly into jsdom via react-dom/client (no @testing-library/react
// in this repo's node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DataCleanupPanel from '../DataCleanupPanel';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../../../lib/api', () => ({
  crmMaintenance: { blankSchoolsAudit: jest.fn(), bulkDeleteSchools: jest.fn(), deleteBlankChildlessSchools: jest.fn() },
}));
const { crmMaintenance } = require('../../../lib/api');

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

// CRA's default Jest config sets `resetMocks: true` (wipes mock implementations
// before every test, even ones set at jest.mock() factory time) — so the
// implementations are (re)installed here, freshly, before each test.
beforeEach(() => {
  crmMaintenance.blankSchoolsAudit.mockImplementation(() => Promise.resolve({ data: {
    total_schools: 600, blank_schools: 516, blank_childless: 500, blank_with_children: 16,
    children_breakdown: { leads: 3, contacts: 1, quotations: 0, orders: 0 },
    by_creator: { 'import@smartshape.in': 516 },
    created_at_earliest: '2026-01-01T00:00:00+00:00', created_at_latest: '2026-02-01T00:00:00+00:00',
    sample_childless_ids: [], sample_with_children_ids: [],
  } }));
  crmMaintenance.deleteBlankChildlessSchools.mockImplementation(() => Promise.resolve({
    data: { dry_run: true, schools: [], totals: { schools: 0, leads: 0, contacts: 0, quotations: 0, orders: 0, docs: 0 } },
  }));
});

afterEach(() => { mockUser = null; document.body.innerHTML = ''; });

test('renders nothing for a non-superadmin account (a regular admin)', () => {
  mockUser = { email: 'admin@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataCleanupPanel />);
  expect(container.querySelector('[data-testid="data-cleanup-trigger"]')).toBeFalsy();
  expect(container.innerHTML).toBe('');
  unmount();
});

test('renders nothing when there is no logged-in user', () => {
  mockUser = null;
  const { container, unmount } = mount(<DataCleanupPanel />);
  expect(container.innerHTML).toBe('');
  unmount();
});

test('renders the Data Cleanup trigger for the superadmin account', () => {
  mockUser = { email: 'info@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataCleanupPanel />);
  expect(container.querySelector('[data-testid="data-cleanup-trigger"]')).toBeTruthy();
  unmount();
});

test('superadmin: opening the panel loads and shows the audit numbers', async () => {
  mockUser = { email: 'info@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataCleanupPanel />);
  act(() => { container.querySelector('[data-testid="data-cleanup-trigger"]').click(); });
  await flush();
  const audit = document.querySelector('[data-testid="data-cleanup-audit"]');
  expect(audit).toBeTruthy();
  expect(audit.textContent).toContain('500'); // blank_childless
  expect(audit.textContent).toContain('16');  // blank_with_children
  unmount();
});
