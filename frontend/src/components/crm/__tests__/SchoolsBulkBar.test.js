// SchoolsBulkBar: the Schools tab's bulk bar, pulled out of LeadsCRM.js so it
// can be tested. It now behaves like the Contacts and Leads bars ("N selected
// (M hidden by filter)", visible ids only, 2,000 cap) and tags through
// BulkTagPicker — several tags at once — with the owner's "Also tag their
// contacts (N) and leads (M)" box, OFF by default.
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { toast } from 'sonner';
import SchoolsBulkBar from '../SchoolsBulkBar';
import { schools as schoolsApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('../../../lib/api', () => ({
  schools: { bulkTag: jest.fn() },
  tags: { create: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// AssignToPicker has its own tests; capture its props so a test can drive it.
let mockAssignProps = null;
jest.mock('../AssignToPicker', () => (props) => { mockAssignProps = props; return null; });

const TAGS = [
  { tag_id: 't_cbse', name: 'CBSE', color: '#0f0' },
  { tag_id: 't_expo', name: 'Delhi Expo', color: '#00f' },
];
const CONTACTS = [
  { contact_id: 'c1', school_id: 's1' },
  { contact_id: 'c2', school_id: 's1' },
  { contact_id: 'c3', school_id: 's2' },
  { contact_id: 'c_del', school_id: 's1', is_deleted: true },   // deleted: not counted
  { contact_id: 'c_hidden', school_id: 's9' },                   // at a hidden selected school
  { contact_id: 'c_none', school_id: '' },
];
const LEADS = [
  { lead_id: 'l1', school_id: 's1' },
  { lead_id: 'l2', school_id: 's3' },                            // not selected
  { lead_id: 'l_del', school_id: 's2', is_deleted: true },
];

beforeEach(() => {
  mockAssignProps = null;
  schoolsApi.bulkTag.mockImplementation(() => Promise.resolve({
    data: { ok: true, requested: 2, updated: 2, skipped: 0, tag_id: 't_cbse', action: 'add',
            contacts_updated: 0, leads_updated: 0 },
  }));
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function render(overrides = {}) {
  const props = {
    count: 3,
    hiddenCount: 1,
    visibleIds: ['s1', 's2'],
    tagsList: TAGS,
    contactsList: CONTACTS,
    leadsList: LEADS,
    isAdmin: true,
    isOwner: false,
    spList: [],
    onAssign: jest.fn(),
    onPlanActivity: jest.fn(),
    onStartSequence: jest.fn(),
    onMailRun: jest.fn(),
    mailRunBusy: false,
    onDelete: jest.fn(),
    onClear: jest.fn(),
    onDone: jest.fn(),
    onTagCreated: jest.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<SchoolsBulkBar {...props} />); });
  const q = (id) => container.querySelector(`[data-testid="${id}"]`);
  return {
    props,
    container,
    q,
    openPicker: () => act(() => { q('school-bulk-tags-button').click(); }),
    tick: (id) => act(() => { q(`school-bulk-tags-check-${id}`).click(); }),
    press: async (action) => { await act(async () => { q(`school-bulk-tags-${action}`).click(); await flush(); }); },
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}

// ── Visibility + counts ─────────────────────────────────────────────────────

test('renders nothing when nothing is selected', () => {
  const v = render({ count: 0, hiddenCount: 0, visibleIds: [] });
  expect(v.q('school-bulk-bar')).toBeNull();
  v.unmount();
});

test('shows "N selected (M hidden by filter)" like the other tabs', () => {
  const v = render();
  expect(v.q('school-bulk-count').textContent).toBe('3 selected (1 hidden by filter)');
  v.unmount();
  const w = render({ count: 2, hiddenCount: 0 });
  expect(w.q('school-bulk-count').textContent).toBe('2 selected');
  w.unmount();
});

test('the "also tag their people" box counts non-deleted contacts and leads at the VISIBLE selected schools', () => {
  const v = render();
  v.openPicker();
  const label = v.q('school-bulk-include-people-label');
  // contacts c1, c2 (s1) + c3 (s2) = 3; leads l1 (s1) = 1. Deleted rows, the
  // hidden school's people and unselected schools don't count.
  expect(label.textContent).toContain('Also tag their contacts (3) and leads (1)');
  expect(v.q('school-bulk-include-people').checked).toBe(false); // OFF by default
  v.unmount();
});

// ── Tagging ─────────────────────────────────────────────────────────────────

test('by default the tags go on the visible selected schools only (include_people false)', async () => {
  const v = render();
  v.openPicker();
  v.tick('t_cbse');
  await v.press('add');
  expect(schoolsApi.bulkTag).toHaveBeenCalledWith({
    school_ids: ['s1', 's2'], tag_ids: ['t_cbse'], action: 'add', include_people: false,
  });
  expect(toast.success).toHaveBeenCalledWith('Added “CBSE” to 2 schools');
  expect(v.props.onDone).toHaveBeenCalledTimes(1);
  expect(v.props.onClear).toHaveBeenCalledTimes(1);
  v.unmount();
});

test('with the box ticked, several tags go to the schools AND their people in one request', async () => {
  schoolsApi.bulkTag.mockImplementation(() => Promise.resolve({
    data: { ok: true, requested: 13, updated: 12, skipped: 1, tag_id: 't_cbse', action: 'add',
            contacts_updated: 48, leads_updated: 9 },
  }));
  const v = render();
  v.openPicker();
  v.tick('t_cbse');
  v.tick('t_expo');
  act(() => { v.q('school-bulk-include-people').click(); });
  await v.press('add');
  expect(schoolsApi.bulkTag).toHaveBeenCalledTimes(1);
  expect(schoolsApi.bulkTag).toHaveBeenCalledWith({
    school_ids: ['s1', 's2'], tag_ids: ['t_cbse', 't_expo'], action: 'add', include_people: true,
  });
  expect(toast.success).toHaveBeenCalledWith('Added 2 tags to 12 schools, 48 contacts, 9 leads (1 skipped)');
  v.unmount();
});

test('Remove is offered too, and honours the box', async () => {
  schoolsApi.bulkTag.mockImplementation(() => Promise.resolve({
    data: { ok: true, requested: 2, updated: 2, skipped: 0, contacts_updated: 3, leads_updated: 1 },
  }));
  const v = render();
  v.openPicker();
  v.tick('t_expo');
  act(() => { v.q('school-bulk-include-people').click(); });
  await v.press('remove');
  expect(schoolsApi.bulkTag).toHaveBeenCalledWith({
    school_ids: ['s1', 's2'], tag_ids: ['t_expo'], action: 'remove', include_people: true,
  });
  expect(toast.success).toHaveBeenCalledWith('Removed “Delhi Expo” from 2 schools, 3 contacts, 1 lead');
  v.unmount();
});

test('the box turns itself off again after a successful apply', async () => {
  const v = render();
  v.openPicker();
  v.tick('t_cbse');
  act(() => { v.q('school-bulk-include-people').click(); });
  await v.press('add');
  v.openPicker();
  expect(v.q('school-bulk-include-people').checked).toBe(false);
  v.unmount();
});

test('a failed tag toasts the error and keeps the selection and the ticks', async () => {
  schoolsApi.bulkTag.mockImplementation(() => Promise.reject({ response: { data: { detail: 'Unknown tag_ids: t_x' } } }));
  const v = render();
  v.openPicker();
  v.tick('t_cbse');
  await v.press('add');
  expect(toast.error).toHaveBeenCalledWith('Unknown tag_ids: t_x');
  expect(v.props.onClear).not.toHaveBeenCalled();
  expect(v.props.onDone).not.toHaveBeenCalled();
  expect(v.q('school-bulk-tags-check-t_cbse').checked).toBe(true);
  v.unmount();
});

test('with every selected school hidden by the filter there is nothing to act on', () => {
  const v = render({ count: 2, hiddenCount: 2, visibleIds: [] });
  expect(v.q('school-bulk-count').textContent).toBe('2 selected (2 hidden by filter)');
  expect(v.q('school-bulk-tags-button').disabled).toBe(true);
  expect(v.q('school-bulk-clear').disabled).toBe(false);
  v.unmount();
});

// ── 2,000 cap ───────────────────────────────────────────────────────────────

test('more than 2,000 visible selected schools disables the actions and shows the cap note', () => {
  const ids = Array.from({ length: 2001 }, (_, i) => `s${i}`);
  const v = render({ count: 2001, hiddenCount: 0, visibleIds: ids, isOwner: true });
  expect(v.q('school-bulk-cap-note').textContent).toContain('Max 2,000 at a time');
  expect(v.q('school-bulk-tags-button').disabled).toBe(true);
  expect(v.q('plan-activity-btn').disabled).toBe(true);
  expect(v.q('start-sequence-btn').disabled).toBe(true);
  expect(v.q('mail-run-btn').disabled).toBe(true);
  expect(v.q('school-bulk-delete-btn').disabled).toBe(true);
  expect(mockAssignProps.disabled).toBe(true);
  expect(v.q('school-bulk-clear').disabled).toBe(false); // can always get out
  v.unmount();
});

test('at 2,000 the actions stay enabled', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `s${i}`);
  const v = render({ count: 2000, hiddenCount: 0, visibleIds: ids });
  expect(v.q('school-bulk-cap-note')).toBeNull();
  expect(v.q('school-bulk-tags-button').disabled).toBe(false);
  v.unmount();
});

// ── Other actions are the parent's ──────────────────────────────────────────

test('admin actions call back to the parent; Clear clears', () => {
  const v = render();
  act(() => { v.q('plan-activity-btn').click(); });
  act(() => { v.q('start-sequence-btn').click(); });
  act(() => { v.q('mail-run-btn').click(); });
  act(() => { v.q('school-bulk-clear').click(); });
  expect(v.props.onPlanActivity).toHaveBeenCalledTimes(1);
  expect(v.props.onStartSequence).toHaveBeenCalledTimes(1);
  expect(v.props.onMailRun).toHaveBeenCalledTimes(1);
  expect(v.props.onClear).toHaveBeenCalledTimes(1);
  act(() => { mockAssignProps.onChange('rep@smartshape.in', 'Rep'); });
  expect(v.props.onAssign).toHaveBeenCalledWith('rep@smartshape.in', 'Rep');
  v.unmount();
});

test('a rep gets tagging but not the admin actions; only the owner gets Delete', () => {
  const v = render({ isAdmin: false });
  expect(v.q('school-bulk-tags-button')).toBeTruthy();
  expect(v.q('plan-activity-btn')).toBeNull();
  expect(v.q('start-sequence-btn')).toBeNull();
  expect(v.q('mail-run-btn')).toBeNull();
  expect(v.q('school-bulk-delete-btn')).toBeNull();
  expect(mockAssignProps).toBeNull();
  v.unmount();
  const w = render({ isOwner: true });
  act(() => { w.q('school-bulk-delete-btn').click(); });
  expect(w.props.onDelete).toHaveBeenCalledTimes(1);
  w.unmount();
});
