// Smoke tests: the CRM Data Health panel must be invisible to anyone but the
// superadmin, and its destructive actions (merge, phone repair) must keep
// their confirm button disabled until a dry-run has loaded AND the confirm
// word is typed. Rendered directly into jsdom via react-dom/client (no
// @testing-library/react in this repo's node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DataHealthPanel from '../DataHealthPanel';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('../../../lib/api', () => ({
  crmMaintenance: {
    integrityDetect: jest.fn(),
    duplicateSchools: jest.fn(),
    mergeSchools: jest.fn(),
    repairPhones: jest.fn(),
    unifyLinks: jest.fn(),
    repairDanglingContactLinks: jest.fn(),
  },
}));
const { crmMaintenance } = require('../../../lib/api');

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const duplicateGroup = {
  normalized_name: 'abc public school',
  total_children: 5,
  schools: [
    { school_id: 's1', school_name: 'ABC Public School', city: 'Delhi', created_at: '2026-01-01T00:00:00+00:00', children: { leads: 3, contacts: 2, quotations: 0, orders: 0 } },
    { school_id: 's2', school_name: 'ABC Public Schl', city: 'Delhi', created_at: '2026-02-01T00:00:00+00:00', children: { leads: 0, contacts: 0, quotations: 0, orders: 0 } },
  ],
};

const mergePreview = {
  dry_run: true, survivor_id: 's1', merge_ids: ['s2'],
  per_merge_moves: { s2: { leads: 0 } },
  moved: { leads: 0 },
  survivor_children_before: { leads: 3, contacts: 2, quotations: 0, orders: 0 },
  survivor_children_after: { leads: 3, contacts: 2, quotations: 0, orders: 0 },
  ambiguous_name_fallback_rows: { count: 0, samples: [], rival_schools: {} },
};

const phonePreview = {
  dry_run: true,
  per_collection: { schools: { recoverable: 2, lossy: 1, needs_review: 0 }, contacts: { recoverable: 0, lossy: 0, needs_review: 0 }, leads: { recoverable: 0, lossy: 0, needs_review: 0 } },
  totals: { recoverable: 2, lossy: 1, needs_review: 0 },
  skipped_samples: { schools: ['9.17709E+11'] },
};

beforeEach(() => {
  crmMaintenance.duplicateSchools.mockImplementation(() => Promise.resolve({ data: { groups: [duplicateGroup], group_count: 1 } }));
  crmMaintenance.mergeSchools.mockImplementation((body) => Promise.resolve({
    data: body.dry_run === false
      ? { survivor_id: 's1', merged: ['s2'], moved: { leads: 0 }, backups: ['bk1', 'bk2', 'bk3'], undo_note: 'replay child_preimage to undo' }
      : mergePreview,
  }));
  crmMaintenance.repairPhones.mockImplementation((body) => Promise.resolve({
    data: body.dry_run === false
      ? { totals: { recoverable: 2 }, backup_id: 'bk-phones' }
      : phonePreview,
  }));
  crmMaintenance.integrityDetect.mockImplementation(() => Promise.resolve({ data: {
    links: {}, duplicates: { school_id: [], lead_id: [] }, schools_soft_deleted_with_children: 0,
    phones: {}, counts: { leads: 0, contacts: 0, schools: 0 },
  } }));
});

afterEach(() => { mockUser = null; document.body.innerHTML = ''; });

test('renders nothing for a non-superadmin account', () => {
  mockUser = { email: 'admin@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataHealthPanel />);
  expect(container.querySelector('[data-testid="data-health-trigger"]')).toBeFalsy();
  expect(container.innerHTML).toBe('');
  unmount();
});

test('renders the trigger for the superadmin account, and opening shows the backup banner + 4 ordered sections', () => {
  mockUser = { email: 'info@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataHealthPanel />);
  expect(container.querySelector('[data-testid="data-health-trigger"]')).toBeTruthy();
  act(() => { container.querySelector('[data-testid="data-health-trigger"]').click(); });
  const panel = document.querySelector('[data-testid="data-health-panel"]');
  expect(panel).toBeTruthy();
  expect(document.querySelector('[data-testid="data-health-backup-banner"]').textContent).toContain('Atlas backup');
  expect(document.querySelector('[data-testid="data-health-section-toggle-1"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="data-health-section-toggle-2"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="data-health-section-toggle-3"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="data-health-section-toggle-4"]')).toBeTruthy();
  unmount();
});

test('merge: confirm button stays disabled until the dry-run preview loads AND "MERGE" is typed', async () => {
  mockUser = { email: 'info@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataHealthPanel />);
  act(() => { container.querySelector('[data-testid="data-health-trigger"]').click(); });
  // Section 2 (Duplicate Schools / Merge) is collapsed by default — open it.
  act(() => { document.querySelector('[data-testid="data-health-section-toggle-2"]').click(); });
  act(() => { document.querySelector('[data-testid="find-duplicates-btn"]').click(); });
  await flush();
  act(() => { document.querySelector('[data-testid="dup-group-toggle-abc public school"]').click(); });
  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]')).toBeFalsy(); // no preview yet

  act(() => { document.querySelector('[data-testid="preview-confirm-preview-btn"]').click(); });
  await flush();
  expect(crmMaintenance.mergeSchools).toHaveBeenCalledWith({ survivor_id: 's1', merge_ids: ['s2'], dry_run: true, reason: '' });
  const runBtn = document.querySelector('[data-testid="preview-confirm-run-btn"]');
  expect(runBtn.disabled).toBe(true);

  const input = document.querySelector('[data-testid="preview-confirm-word-input"]');
  act(() => setInputValue(input, 'merge')); // wrong case
  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(true);

  act(() => setInputValue(input, 'MERGE'));
  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(false);
  unmount();
});

test('phone repair: confirm button stays disabled until the dry-run preview loads AND "CONFIRM" is typed', async () => {
  mockUser = { email: 'info@smartshape.in', role: 'admin' };
  const { container, unmount } = mount(<DataHealthPanel />);
  act(() => { container.querySelector('[data-testid="data-health-trigger"]').click(); });
  act(() => { document.querySelector('[data-testid="data-health-section-toggle-3"]').click(); });

  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]')).toBeFalsy();
  act(() => { document.querySelector('[data-testid="preview-confirm-preview-btn"]').click(); });
  await flush();
  expect(crmMaintenance.repairPhones).toHaveBeenCalledWith({ dry_run: true, reason: '' });
  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(true);

  act(() => setInputValue(document.querySelector('[data-testid="preview-confirm-word-input"]'), 'CONFIRM'));
  expect(document.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(false);

  await act(async () => {
    document.querySelector('[data-testid="preview-confirm-run-btn"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(crmMaintenance.repairPhones).toHaveBeenLastCalledWith({ dry_run: false, reason: '' });
  unmount();
});
