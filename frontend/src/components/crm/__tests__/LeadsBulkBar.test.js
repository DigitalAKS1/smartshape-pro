// LeadsBulkBar: the one bulk-action bar the Leads list tab and the Pipeline
// tab both render (previously an inline block that only the Pipeline tab
// showed, so the list tab's checkboxes led nowhere).
//
// Behaviour pinned here matches the Contacts bar (ContactsTab.test.js):
// "N selected (M hidden by filter)", actions send only VISIBLE selected ids,
// gone ids are ignored rather than counted as hidden, a 2,000 cap, and
// toast→refetch→clear on success vs toast-and-keep on error.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { toast } from 'sonner';
import LeadsBulkBar from '../LeadsBulkBar';
import { leads as leadsApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('../../../lib/api', () => ({
  leads: {
    bulkTag: jest.fn(),
    bulkStage: jest.fn(),
  },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const TAGS = [{ tag_id: 't_hot', name: 'Hot Lead', color: '#f00' }];

// CRA's Jest config sets `resetMocks: true`, which wipes jest.mock() factory
// implementations before every test, so they're reinstalled here.
beforeEach(() => {
  leadsApi.bulkTag.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 2, skipped: 0, modified: 2 } }));
  leadsApi.bulkStage.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 2, skipped: 0, modified: 2 } }));
});

function render(overrides = {}) {
  const props = {
    selectedIds: new Set(),
    visibleIds: ['l1', 'l2', 'l3'],
    allIds: ['l1', 'l2', 'l3', 'l4', 'l5'],
    tagsList: TAGS,
    isAdmin: true,
    onReassign: jest.fn(),
    onClear: jest.fn(),
    onDone: jest.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<LeadsBulkBar {...props} />); });
  return {
    props,
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    rerender: (more) => {
      Object.assign(props, more);
      act(() => { root.render(<LeadsBulkBar {...props} />); });
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function choose(select, value) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

// ── Visibility + counts ─────────────────────────────────────────────────────

test('renders nothing when nothing is selected', () => {
  const v = render();
  expect(v.q('bulk-actions-bar')).toBeNull();
  v.unmount();
});

test('shows the count when rows are selected', () => {
  const v = render({ selectedIds: new Set(['l1', 'l2']) });
  expect(v.q('leads-bulk-count').textContent).toBe('2 selected');
  v.unmount();
});

test('selections the filter hides are counted as hidden, with a Clear control', () => {
  // l4 and l5 still exist (in allIds) but the current filter doesn't show them.
  const v = render({ selectedIds: new Set(['l1', 'l4', 'l5']) });
  expect(v.q('leads-bulk-count').textContent).toBe('3 selected (2 hidden by filter)');
  act(() => { v.q('leads-bulk-clear').click(); });
  expect(v.props.onClear).toHaveBeenCalledTimes(1);
  v.unmount();
});

test('ids that no longer exist at all are ignored, not reported as hidden', () => {
  const v = render({ selectedIds: new Set(['l1', 'deleted_lead']) });
  expect(v.q('leads-bulk-count').textContent).toBe('1 selected');
  v.unmount();
});

test('stays visible when the filter hides every selected row, so it can still be cleared', () => {
  const v = render({ selectedIds: new Set(['l4']) });
  expect(v.q('leads-bulk-count').textContent).toBe('1 selected (1 hidden by filter)');
  expect(v.q('leads-bulk-clear')).toBeTruthy();
  v.unmount();
});

// ── Tag actions ─────────────────────────────────────────────────────────────

test('"Add tag" sends only the visible selected ids, in list order', async () => {
  const v = render({ selectedIds: new Set(['l3', 'l4', 'l1']) }); // l4 hidden
  await choose(v.q('leads-bulk-tag-add'), 't_hot');
  expect(leadsApi.bulkTag).toHaveBeenCalledWith({ lead_ids: ['l1', 'l3'], tag_id: 't_hot', action: 'add' });
  v.unmount();
});

test('"Remove tag" calls bulkTag with action "remove"', async () => {
  const v = render({ selectedIds: new Set(['l1', 'l2']) });
  await choose(v.q('leads-bulk-tag-remove'), 't_hot');
  expect(leadsApi.bulkTag).toHaveBeenCalledWith({ lead_ids: ['l1', 'l2'], tag_id: 't_hot', action: 'remove' });
  v.unmount();
});

test('a successful bulk tag toasts the updated count, then refetches and clears', async () => {
  const v = render({ selectedIds: new Set(['l1', 'l2']) });
  await choose(v.q('leads-bulk-tag-add'), 't_hot');
  expect(toast.success).toHaveBeenCalledWith('Tagged 2 lead(s) — “Hot Lead”');
  expect(v.props.onDone).toHaveBeenCalledTimes(1);
  expect(v.props.onClear).toHaveBeenCalledTimes(1);
  v.unmount();
});

test('skipped leads are reported in the toast when non-zero', async () => {
  leadsApi.bulkTag.mockImplementation(() => Promise.resolve({ data: { requested: 3, updated: 1, skipped: 2, modified: 1 } }));
  const v = render({ selectedIds: new Set(['l1', 'l2', 'l3']) });
  await choose(v.q('leads-bulk-tag-add'), 't_hot');
  expect(toast.success).toHaveBeenCalledWith('Tagged 1 lead(s) — “Hot Lead” (2 skipped)');
  v.unmount();
});

test('a failed bulk tag toasts the error and keeps the selection for a retry', async () => {
  leadsApi.bulkTag.mockImplementation(() => Promise.reject({ response: { data: { detail: 'nope' } } }));
  const v = render({ selectedIds: new Set(['l1']) });
  await choose(v.q('leads-bulk-tag-add'), 't_hot');
  expect(toast.error).toHaveBeenCalledWith('nope');
  expect(v.props.onClear).not.toHaveBeenCalled();
  expect(v.props.onDone).not.toHaveBeenCalled();
  v.unmount();
});

// ── Move to Stage ───────────────────────────────────────────────────────────

test('Move to Stage keeps its confirm prompt, and cancelling sends nothing', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const v = render({ selectedIds: new Set(['l1', 'l2', 'l5']) }); // l5 hidden
  await choose(v.q('leads-bulk-stage'), 'demo');
  // The count in the prompt is the VISIBLE count, which is what will be moved.
  expect(confirmSpy).toHaveBeenCalledWith('Move 2 lead(s) to stage "demo"?');
  expect(leadsApi.bulkStage).not.toHaveBeenCalled();
  expect(v.props.onClear).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
  v.unmount();
});

test('Move to Stage sends the visible ids once confirmed, then refetches and clears', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  leadsApi.bulkStage.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 1, skipped: 1, modified: 1 } }));
  const v = render({ selectedIds: new Set(['l1', 'l2', 'l5']) });
  await choose(v.q('leads-bulk-stage'), 'demo');
  expect(leadsApi.bulkStage).toHaveBeenCalledWith({ lead_ids: ['l1', 'l2'], stage: 'demo' });
  expect(toast.success).toHaveBeenCalledWith('1 lead(s) moved to demo (1 skipped)');
  expect(v.props.onDone).toHaveBeenCalledTimes(1);
  expect(v.props.onClear).toHaveBeenCalledTimes(1);
  confirmSpy.mockRestore();
  v.unmount();
});

test('Move to Stage offers only live stages, not retired ones', () => {
  const v = render({ selectedIds: new Set(['l1']) });
  const opts = Array.from(v.q('leads-bulk-stage').querySelectorAll('option')).map(o => o.value);
  expect(opts).toContain('demo');
  expect(opts).not.toContain('retention');
  expect(opts).not.toContain('resell');
  v.unmount();
});

test('a failed stage move toasts the error and keeps the selection', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  leadsApi.bulkStage.mockImplementation(() => Promise.reject({ response: { data: { detail: 'denied' } } }));
  const v = render({ selectedIds: new Set(['l1']) });
  await choose(v.q('leads-bulk-stage'), 'demo');
  expect(toast.error).toHaveBeenCalledWith('denied');
  expect(v.props.onClear).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
  v.unmount();
});

// ── Reassign ────────────────────────────────────────────────────────────────

test('Reassign (admin) hands only the visible selected ids to the reassign dialog', () => {
  const v = render({ selectedIds: new Set(['l2', 'l4', 'l1']) }); // l4 hidden
  act(() => { v.q('bulk-reassign-btn').click(); });
  expect(v.props.onReassign).toHaveBeenCalledWith(['l1', 'l2']);
  v.unmount();
});

test('Reassign is not offered to non-admins', () => {
  const v = render({ selectedIds: new Set(['l1']), isAdmin: false });
  expect(v.q('bulk-reassign-btn')).toBeNull();
  expect(v.q('leads-bulk-tag-add')).toBeTruthy(); // tagging still is
  v.unmount();
});

// ── 2,000 cap ───────────────────────────────────────────────────────────────

test('more than 2,000 visible selected ids disables the controls and shows the cap note', () => {
  const ids = Array.from({ length: 2001 }, (_, i) => `h${i}`);
  const v = render({ selectedIds: new Set(ids), visibleIds: ids, allIds: ids });
  expect(v.q('leads-bulk-count').textContent).toBe('2001 selected');
  expect(v.q('leads-bulk-cap-note').textContent).toContain('Max 2,000 at a time');
  expect(v.q('leads-bulk-tag-add').disabled).toBe(true);
  expect(v.q('leads-bulk-tag-remove').disabled).toBe(true);
  expect(v.q('leads-bulk-stage').disabled).toBe(true);
  expect(v.q('bulk-reassign-btn').disabled).toBe(true);
  expect(v.q('leads-bulk-clear').disabled).toBe(false); // can always get out
  v.unmount();
});

test('the cap counts visible ids only: 2,001 selected with 1 hidden stays enabled', () => {
  const ids = Array.from({ length: 2001 }, (_, i) => `h${i}`);
  const v = render({ selectedIds: new Set(ids), visibleIds: ids.slice(0, 2000), allIds: ids });
  expect(v.q('leads-bulk-count').textContent).toBe('2001 selected (1 hidden by filter)');
  expect(v.q('leads-bulk-cap-note')).toBeNull();
  expect(v.q('leads-bulk-tag-add').disabled).toBe(false);
  v.unmount();
});
