// Rendered into jsdom via react-dom/client (no @testing-library/react here —
// same pattern as FilterRail.test.js / ActiveFilterBar.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import RecentlyDeleted from '../RecentlyDeleted';
import { adminApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  adminApi: { listAuditBackups: jest.fn(), restoreAuditBackup: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const BACKUPS = [
  {
    backup_id: 'bk_1', root_type: 'school', root_label: 'Delhi Public School',
    deleted_by: 'info@smartshape.in', deleted_at: '2026-09-04T10:00:00+00:00',
    reason: 'duplicate', total: 14, restored: false,
    counts: { schools: 1, contacts: 4, leads: 9 },
  },
  {
    backup_id: 'bk_2', root_type: 'order', root_label: 'SO-2026-0042',
    deleted_by: 'info@smartshape.in', deleted_at: '2026-09-03T09:00:00+00:00',
    total: 3, restored: true, restored_at: '2026-09-03T11:00:00+00:00',
    restored_by: 'info@smartshape.in', counts: { orders: 1, order_items: 2 },
  },
  {
    backup_id: 'bk_3', root_type: 'migration', root_label: 'phone repair',
    deleted_by: 'info@smartshape.in', deleted_at: '2026-09-02T09:00:00+00:00',
    total: 120, restored: false, migration: true, counts: { schools: 120 },
  },
];

async function mount(rows = BACKUPS) {
  adminApi.listAuditBackups.mockResolvedValue({ data: rows });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RecentlyDeleted />); });
  return {
    container,
    text: () => container.textContent,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    click: async (id) => { await act(async () => { container.querySelector(`[data-testid="${id}"]`).click(); }); },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
});

test('lists what was deleted, by whom, and how much of it', async () => {
  const v = await mount();
  expect(v.text()).toContain('Delhi Public School');
  expect(v.text()).toContain('info@smartshape.in');
  // The blast radius is spelled out per entity rather than as a bare "14",
  // because a total doesn't tell you whether putting it back is safe.
  expect(v.text()).toContain('4 contacts');
  expect(v.text()).toContain('9 leads');
  expect(v.text()).toContain('1 school');
  v.unmount();
});

test('an empty history is reassuring, not alarming', async () => {
  const v = await mount([]);
  expect(v.text()).toMatch(/[Nn]othing/);
  expect(v.q('restore-bk_1')).toBeNull();
  v.unmount();
});

test('restoring asks first, then calls the endpoint', async () => {
  adminApi.restoreAuditBackup.mockResolvedValue({ data: { total: 14 } });
  const v = await mount();
  await v.click('restore-bk_1');
  expect(window.confirm).toHaveBeenCalled();
  expect(adminApi.restoreAuditBackup).toHaveBeenCalledWith('bk_1');
  v.unmount();
});

test('declining the confirmation restores nothing', async () => {
  window.confirm = jest.fn(() => false);
  const v = await mount();
  await v.click('restore-bk_1');
  expect(adminApi.restoreAuditBackup).not.toHaveBeenCalled();
  v.unmount();
});

test('an already-restored entry says so and cannot be restored twice', async () => {
  const v = await mount();
  expect(v.q('restore-bk_2')).toBeNull();
  expect(v.text()).toContain('Restored');
  v.unmount();
});

test('a migration pre-image is labelled, since nothing was deleted', async () => {
  const v = await mount();
  expect(v.text()).toMatch(/[Cc]hanged in place|migration|Before a bulk edit/);
  v.unmount();
});

test('a failed restore surfaces the reason', async () => {
  const { toast } = require('sonner');
  adminApi.restoreAuditBackup.mockRejectedValue(
    { response: { data: { detail: 'This backup has already been restored' } } });
  const v = await mount();
  await v.click('restore-bk_1');
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('already been restored'));
  v.unmount();
});

test('a restored row reloads the list so its state is current', async () => {
  adminApi.restoreAuditBackup.mockResolvedValue({ data: { total: 14 } });
  const v = await mount();
  expect(adminApi.listAuditBackups).toHaveBeenCalledTimes(1);
  await v.click('restore-bk_1');
  expect(adminApi.listAuditBackups).toHaveBeenCalledTimes(2);
  v.unmount();
});
