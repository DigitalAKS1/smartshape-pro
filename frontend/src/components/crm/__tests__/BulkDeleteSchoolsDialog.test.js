// Smoke tests: the shared guarded bulk-delete dialog must dry-run first and
// keep the real delete disabled until the user explicitly types DELETE.
// Rendered directly into jsdom via react-dom/client (no @testing-library/react
// in this repo's node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import BulkDeleteSchoolsDialog from '../BulkDeleteSchoolsDialog';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  crmMaintenance: { deleteBlankChildlessSchools: jest.fn(), bulkDeleteSchools: jest.fn() },
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
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

// CRA's default Jest config sets `resetMocks: true` (wipes mock implementations
// before every test, even ones set at jest.mock() factory time) — so the
// implementations are (re)installed here, freshly, before each test.
beforeEach(() => {
  crmMaintenance.deleteBlankChildlessSchools.mockImplementation((body) => Promise.resolve({
    data: body.dry_run === false
      ? { dry_run: false, deleted: 3, backups: ['bk1'], total_docs: 0, recomputed: false }
      : { dry_run: true, schools: [{ school_id: 's1', label: 'Blank 1', blank: true, children: { leads: 0, contacts: 0, quotations: 0, orders: 0 }, plan_total: 0 }], totals: { schools: 3, leads: 0, contacts: 0, quotations: 0, orders: 0, docs: 0 } },
  }));
  crmMaintenance.bulkDeleteSchools.mockImplementation((body) => Promise.resolve({
    data: body.dry_run === false
      ? { dry_run: false, deleted: 2, backups: ['bk2'], total_docs: 0, recomputed: false }
      : { dry_run: true, schools: [], totals: { schools: 2, leads: 1, contacts: 0, quotations: 0, orders: 0, docs: 1 } },
  }));
});

afterEach(() => { document.body.innerHTML = ''; });

test('always dry-runs first: opening the dialog calls with dry_run:true and writes nothing', () => {
  const { unmount } = mount(<BulkDeleteSchoolsDialog open onOpenChange={jest.fn()} mode="childless" onDeleted={jest.fn()} />);
  expect(crmMaintenance.deleteBlankChildlessSchools).toHaveBeenCalledWith({ dry_run: true, reason: '' });
  unmount();
});

test('confirm button is disabled until the preview has loaded AND "DELETE" is typed exactly', async () => {
  const { unmount } = mount(<BulkDeleteSchoolsDialog open onOpenChange={jest.fn()} mode="childless" onDeleted={jest.fn()} />);

  // Preview still loading -> disabled regardless of confirm text.
  expect(document.querySelector('[data-testid="bulk-delete-confirm-btn"]').disabled).toBe(true);

  await flush(); // preview resolves

  // Preview loaded, but nothing typed yet -> still disabled.
  expect(document.querySelector('[data-testid="bulk-delete-confirm-btn"]').disabled).toBe(true);

  const input = document.querySelector('[data-testid="bulk-delete-confirm-input"]');
  act(() => setInputValue(input, 'delete')); // wrong case
  expect(document.querySelector('[data-testid="bulk-delete-confirm-btn"]').disabled).toBe(true);

  act(() => setInputValue(input, 'DELETE'));
  expect(document.querySelector('[data-testid="bulk-delete-confirm-btn"]').disabled).toBe(false);

  unmount();
});

test('childless mode: confirming calls dry_run:false with confirm_count from the dry-run totals', async () => {
  const onDeleted = jest.fn();
  const { unmount } = mount(<BulkDeleteSchoolsDialog open onOpenChange={jest.fn()} mode="childless" onDeleted={onDeleted} />);
  await flush();
  act(() => setInputValue(document.querySelector('[data-testid="bulk-delete-confirm-input"]'), 'DELETE'));
  await act(async () => {
    document.querySelector('[data-testid="bulk-delete-confirm-btn"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(crmMaintenance.deleteBlankChildlessSchools).toHaveBeenLastCalledWith({ dry_run: false, confirm_count: 3, reason: '' });
  expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ deleted: 3 }));
  unmount();
});

test('selected mode: sends the exact school_ids array + confirm_count = ids.length (not the preview total)', async () => {
  const { unmount } = mount(
    <BulkDeleteSchoolsDialog open onOpenChange={jest.fn()} mode="selected" schoolIds={['s1', 's2']} onDeleted={jest.fn()} />
  );
  expect(crmMaintenance.bulkDeleteSchools).toHaveBeenCalledWith({ school_ids: ['s1', 's2'], dry_run: true, reason: '' });
  await flush();
  act(() => setInputValue(document.querySelector('[data-testid="bulk-delete-confirm-input"]'), 'DELETE'));
  await act(async () => {
    document.querySelector('[data-testid="bulk-delete-confirm-btn"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(crmMaintenance.bulkDeleteSchools).toHaveBeenLastCalledWith({ school_ids: ['s1', 's2'], dry_run: false, confirm_count: 2, reason: '' });
  unmount();
});

test('never calls the real delete (dry_run:false) unless the button is clicked', async () => {
  const { unmount } = mount(<BulkDeleteSchoolsDialog open onOpenChange={jest.fn()} mode="childless" onDeleted={jest.fn()} />);
  await flush();
  const calls = crmMaintenance.deleteBlankChildlessSchools.mock.calls;
  expect(calls.every((c) => c[0].dry_run === true)).toBe(true);
  unmount();
});
