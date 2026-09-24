// The Contacts tab: 383 lines and, until now, no tests — which is where two of
// this module's bugs lived (it re-searched the raw query string including
// operators, and carried a second tag filter that fought the page-level one).
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ContactsTab from '../ContactsTab';
import { contacts as contactsApi } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('../../../lib/api', () => ({
  adminApi: {},
  contacts: {
    bulkTag: jest.fn(() => Promise.resolve({ data: { requested: 0, updated: 0, skipped: 0 } })),
    bulkAssign: jest.fn(() => Promise.resolve({ data: { requested: 0, updated: 0, skipped: 0 } })),
  },
  tags: { create: jest.fn() },
  dripSequences: { getAll: jest.fn(), enrollContacts: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../ContactDetailPanel', () => ({ CallStatusBadge: () => null }));
jest.mock('../MultiFilterBar', () => () => null);
// The owner picker isn't the point of these tests — Task 4 only needs to
// prove it's offered to admins and wired up; AssignToPicker itself has its
// own tests elsewhere. Captures the latest props (var must be `mock`-prefixed
// — jest's hoist plugin only allows out-of-scope references to variables
// named that way) so a test can drive its onChange directly, since it
// otherwise renders nothing.
let mockAssignToPickerProps = null;
jest.mock('../AssignToPicker', () => (props) => { mockAssignToPickerProps = props; return null; });

// Tagging goes through BulkTagPicker: open it, tick each tag, press Add/Remove.
async function applyTags(v, tagIds, action = 'add') {
  act(() => { v.q('contacts-bulk-tags-button').click(); });
  tagIds.forEach(id => act(() => { v.q(`contacts-bulk-tags-check-${id}`).click(); }));
  await act(async () => {
    v.q(`contacts-bulk-tags-${action}`).click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const CONTACTS = [
  { contact_id: 'c1', school_id: 's1', name: 'R Sharma', phone: '9811111111',
    email: 'r@dps.in', company: 'Delhi Public School', designation: 'Principal',
    tag_ids: ['t_hot'], status: 'active' },
  { contact_id: 'c2', school_id: 's1', name: 'K Verma', phone: '9822222222',
    email: 'k@dps.in', company: 'Delhi Public School', designation: 'Director',
    tag_ids: [], status: 'active' },
  { contact_id: 'c3', school_id: 's2', name: 'A Menon', phone: '9833333333',
    email: 'a@lotus.in', company: 'Lotus Valley', designation: 'Principal',
    tag_ids: [], status: 'active' },
];
const SCHOOLS = [
  { school_id: 's1', school_name: 'Delhi Public School', city: 'Rohini', school_type: 'CBSE' },
  { school_id: 's2', school_name: 'Lotus Valley', city: 'Noida', school_type: 'ICSE' },
];

// The page owns sorting; the tab just applies it. Identity keeps these tests
// about filtering and paging rather than about sort order.
const sortData = (rows) => rows;

// CRA's default Jest config sets `resetMocks: true` (wipes mock implementations
// before every test, even ones set at jest.mock() factory time) — so the
// implementations are (re)installed here, freshly, before each test (same
// pattern as BulkDeleteSchoolsDialog.test.js / DataCleanupPanel.test.js).
beforeEach(() => {
  // crmFilter is now session-persisted (so a real "Back" button retraces the
  // user's filter, not just the URL) — clear between tests so it doesn't
  // leak from one test into the next.
  window.sessionStorage.clear();
  contactsApi.bulkTag.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 2, skipped: 0 } }));
  contactsApi.bulkAssign.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 2, skipped: 0 } }));
  const { dripSequences } = jest.requireMock('../../../lib/api');
  dripSequences.getAll.mockImplementation(() => Promise.resolve({ data: DRIP_SEQUENCES }));
  dripSequences.enrollContacts.mockImplementation(() => Promise.resolve({ data: {
    requested: 2, enrolled: 2, skipped_duplicate: 0, skipped_not_visible: 0, skipped_missing: 0, no_channel: 0 } }));
});

const DRIP_SEQUENCES = [
  { sequence_id: 'seq_gslc', name: 'GSLC follow-up', is_active: true, steps: [{ step_number: 1 }] },
  { sequence_id: 'seq_off', name: 'Switched off', is_active: false, steps: [{ step_number: 1 }] },
  { sequence_id: 'seq_empty', name: 'No steps', is_active: true, steps: [] },
];

function render(overrides = {}) {
  const props = {
    contactsList: CONTACTS,
    leadsList: [],
    schoolsList: SCHOOLS,
    sourcesList: [],
    filterRole: '',
    setFilterRole: jest.fn(),
    searchTerm: '',
    tagsList: [
      { tag_id: 't_hot', name: 'Hot Lead', color: '#f00' },
      { tag_id: 't_cbse', name: 'CBSE', color: '#0f0' },
    ],
    rolesList: [],
    sortConfig: { key: 'name', dir: 'asc' },
    toggleSort: jest.fn(),
    sortIndicator: () => '',
    sortData,
    contactPage: 1,
    setContactPage: jest.fn(),
    contactsPerPage: 2,
    getRoleName: (c) => c.designation || '',
    calcContactCompletion: () => 100,
    touchAgeCls: () => '',
    daysSince: () => 0,
    openCreateContact: jest.fn(),
    openEditContact: jest.fn(),
    deleteContact: jest.fn(),
    openConvert: jest.fn(),
    openWaForContact: jest.fn(),
    handleContactExport: jest.fn(),
    setContactImportOpen: jest.fn(),
    setActiveTab: jest.fn(),
    openDetail: jest.fn(),
    openContactPanel: jest.fn(),
    fetchData: jest.fn(),
    user: { email: 'info@smartshape.in', role: 'admin' },
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<ContactsTab {...props} />); });
  return {
    props,
    container,
    rowIds: () => Array.from(container.querySelectorAll('[data-testid^="contact-row-"]'))
      .map(el => el.getAttribute('data-testid').replace('contact-row-', '')),
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    // Re-renders the SAME mounted instance with merged prop overrides — needed
    // to test selection surviving a filter change (a fresh render() call would
    // create a brand-new component instance and lose the in-progress selection
    // state, since useBulkSelect's Set lives in ContactsTab's own useState).
    rerender: (moreOverrides) => {
      Object.assign(props, moreOverrides);
      act(() => { root.render(<ContactsTab {...props} />); });
    },
    unmount: () => act(() => root.unmount()),
  };
}

test('shows a row per contact, up to the page size', () => {
  const v = render();
  expect(v.rowIds()).toEqual(['c1', 'c2']);   // page 1 of 2 per page
  v.unmount();
});

test('the second page holds the remainder', () => {
  const v = render({ contactPage: 2 });
  expect(v.rowIds()).toEqual(['c3']);
  v.unmount();
});

test('a page number past the end falls back to the last real page', () => {
  // Filtering down while sitting on page 5 must not show an empty table.
  const v = render({ contactPage: 99 });
  expect(v.rowIds()).toEqual(['c3']);
  v.unmount();
});

// ── Search ──────────────────────────────────────────────────────────────────

test('search matches name, phone, company and email', () => {
  expect(render({ searchTerm: 'menon' }).rowIds()).toEqual(['c3']);
  expect(render({ searchTerm: '9822' }).rowIds()).toEqual(['c2']);
  expect(render({ searchTerm: 'lotus' }).rowIds()).toEqual(['c3']);
  expect(render({ searchTerm: 'r@dps' }).rowIds()).toEqual(['c1']);
});

test('search ignores case', () => {
  expect(render({ searchTerm: 'SHARMA' }).rowIds()).toEqual(['c1']);
});

// The page parses owner:/city:/... out of the box and passes only the residual
// free text down. Handing the raw string here made this tab search for the
// literal "owner:parul", so it showed nothing while its own tab badge counted N.
test('the tab is given residual text, and matches nothing for a stray operator', () => {
  expect(render({ searchTerm: 'owner:parul' }).rowIds()).toEqual([]);
  expect(render({ searchTerm: '' }).rowIds()).toEqual(['c1', 'c2']);
});

// ── Role chips ──────────────────────────────────────────────────────────────

test('a role chip narrows to that role', () => {
  expect(render({ filterRole: 'Director' }).rowIds()).toEqual(['c2']);
});

test('role and search combine rather than override', () => {
  expect(render({ filterRole: 'Principal', searchTerm: 'menon' }).rowIds()).toEqual(['c3']);
  expect(render({ filterRole: 'Director', searchTerm: 'menon' }).rowIds()).toEqual([]);
});

// ── The removed duplicate tag control ───────────────────────────────────────

test('the tab no longer carries its own tag filter', () => {
  // The page-level Tags dropdown filters contacts now. A second control here
  // could disagree with it, with neither admitting the other was on.
  const v = render();
  const tagButtons = Array.from(v.container.querySelectorAll('button'))
    .filter(b => b.textContent.trim() === 'Hot Lead');
  expect(tagButtons).toHaveLength(0);
  v.unmount();
});

// ── Actions reach the right contact ─────────────────────────────────────────

test('edit and delete act on the row they sit in', () => {
  const v = render();
  act(() => { v.q('edit-contact-c2').click(); });
  expect(v.props.openEditContact).toHaveBeenCalledWith(CONTACTS[1]);
  act(() => { v.q('delete-contact-c1').click(); });
  expect(v.props.deleteContact).toHaveBeenCalledWith('c1');
  v.unmount();
});

test('a converted contact offers no Convert action', () => {
  const converted = [{ ...CONTACTS[0], converted_to_lead: true }];
  const v = render({ contactsList: converted });
  expect(v.q('convert-contact-c1')).toBeNull();
  v.unmount();
});

test('an unconverted contact does offer Convert', () => {
  const v = render({ contactsList: [CONTACTS[0]] });
  expect(v.q('convert-contact-c1')).toBeTruthy();
  v.unmount();
});

test('an empty list still renders the tab rather than blowing up', () => {
  const v = render({ contactsList: [] });
  expect(v.rowIds()).toEqual([]);
  expect(v.q('contacts-list')).toBeTruthy();
  v.unmount();
});

// ── Row selection + bulk bar (Task 4) ───────────────────────────────────────

// 25 contacts, well past a single 10-per-page window (3 pages: 10/10/5).
const MANY = Array.from({ length: 25 }, (_, i) => ({
  contact_id: `m${i + 1}`, name: `Contact ${i + 1}`, phone: `98${String(i).padStart(9, '0')}`,
  company: i < 8 ? 'Keep Co' : 'Other Co', tag_ids: [],
}));

test('ticking the header checkbox selects every filtered contact, not just the page on screen, and a bulk action reaches all of them', async () => {
  const v = render({ contactsList: MANY, contactsPerPage: 10 });
  // Only 10 rows are on screen…
  expect(v.rowIds()).toHaveLength(10);
  act(() => { v.q('contacts-select-all').click(); });
  // …but selecting-all must act on all 25 matching contacts, not the 10 shown.
  expect(v.q('contacts-bulk-bar').textContent).toContain('25 selected');
  expect(v.q('contacts-bulk-bar').textContent).not.toContain('hidden by filter');

  // And a bulk action fired from here must reach all 25, not just the page.
  await applyTags(v, ['t_hot']);
  const sentIds = contactsApi.bulkTag.mock.calls[0][0].contact_ids;
  expect(sentIds).toHaveLength(25);
  expect(new Set(sentIds)).toEqual(new Set(MANY.map(c => c.contact_id)));
  v.unmount();
});

test('ticking a row checkbox does NOT open the contact panel (desktop table)', () => {
  const v = render();
  const table = v.q('contacts-table');
  const cb = table.querySelector('[data-testid="select-contact-c1"]');
  act(() => { cb.click(); });
  expect(v.props.openContactPanel).not.toHaveBeenCalled();
  expect(cb.checked).toBe(true);
  v.unmount();
});

test('the bulk bar appears only when something is selected and shows the count', () => {
  const v = render();
  expect(v.q('contacts-bulk-bar')).toBeNull();
  act(() => { v.q('select-contact-c1').click(); });
  expect(v.q('contacts-bulk-bar')).toBeTruthy();
  expect(v.q('contacts-bulk-bar').textContent).toContain('1 selected');
  v.unmount();
});

test('a filter change that hides some selected rows reports the hidden count with a clear control, and does not lose the rest of the selection', () => {
  const v = render({ contactsList: MANY, contactsPerPage: 10 });
  act(() => { v.q('contacts-select-all').click(); }); // selects all 25
  expect(v.q('contacts-bulk-bar').textContent).toContain('25 selected');

  // Filter down to just the 8 "Keep Co" contacts — 17 of the 25 selections
  // are no longer visible under the new filter.
  v.rerender({ searchTerm: 'keep co' });
  expect(v.q('contacts-bulk-bar').textContent).toContain('25 selected (17 hidden by filter)');

  act(() => { v.q('contacts-bulk-clear').click(); });
  expect(v.q('contacts-bulk-bar')).toBeNull();
  v.unmount();
});

test('a PAGE-level filter (search box / FilterRail, which narrows contactsList itself) counts selections as hidden, not deleted', () => {
  const v = render({ contactsList: CONTACTS, allContactsList: CONTACTS });
  act(() => { v.q('contacts-select-all').click(); });
  expect(v.q('contacts-bulk-bar').textContent).toContain('3 selected');

  // The page's master filter hands the tab only c1 — c2/c3 still exist.
  v.rerender({ contactsList: [CONTACTS[0]] });
  expect(v.q('contacts-bulk-bar').textContent).toContain('3 selected (2 hidden by filter)');

  // Clearing the page filter brings the selection back intact.
  v.rerender({ contactsList: CONTACTS });
  expect(v.q('contacts-bulk-bar').textContent).toContain('3 selected');
  expect(v.q('contacts-bulk-bar').textContent).not.toContain('hidden by filter');

  // A contact deleted from the full list IS pruned.
  v.rerender({ contactsList: [CONTACTS[0], CONTACTS[1]], allContactsList: [CONTACTS[0], CONTACTS[1]] });
  expect(v.q('contacts-bulk-bar').textContent).toContain('2 selected');
  expect(v.q('contacts-bulk-bar').textContent).not.toContain('hidden by filter');
  v.unmount();
});

test('adding a tag calls contacts.bulkTag with every selected (visible) id', async () => {
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  act(() => { v.q('select-contact-c2').click(); });

  await applyTags(v, ['t_hot']);

  expect(contactsApi.bulkTag).toHaveBeenCalledWith({ contact_ids: ['c1', 'c2'], tag_ids: ['t_hot'], action: 'add' });
  v.unmount();
});

test('several ticked tags are added in ONE request, and the toast counts them', async () => {
  const { toast } = jest.requireMock('sonner');
  contactsApi.bulkTag.mockImplementation(() => Promise.resolve({ data: { requested: 2, updated: 2, skipped: 1 } }));
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  act(() => { v.q('select-contact-c2').click(); });

  await applyTags(v, ['t_cbse', 't_hot']);

  expect(contactsApi.bulkTag).toHaveBeenCalledTimes(1);
  expect(contactsApi.bulkTag).toHaveBeenCalledWith({ contact_ids: ['c1', 'c2'], tag_ids: ['t_cbse', 't_hot'], action: 'add' });
  expect(toast.success).toHaveBeenCalledWith('Added 2 tags to 2 contacts (1 skipped)');
  v.unmount();
});

test('removing tags sends action "remove" with every ticked tag', async () => {
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await applyTags(v, ['t_hot', 't_cbse'], 'remove');
  expect(contactsApi.bulkTag).toHaveBeenCalledWith({ contact_ids: ['c1'], tag_ids: ['t_hot', 't_cbse'], action: 'remove' });
  v.unmount();
});

test('a tag created in the picker is passed up through onTagCreated and can be applied at once', async () => {
  const { tags: tagsApi } = jest.requireMock('../../../lib/api');
  tagsApi.create.mockImplementation(({ name, color }) => Promise.resolve({ data: { tag_id: 't_new', name, color } }));
  const onTagCreated = jest.fn();
  const v = render({ onTagCreated });
  act(() => { v.q('select-contact-c1').click(); });
  act(() => { v.q('contacts-bulk-tags-button').click(); });
  act(() => {
    const input = v.q('contacts-bulk-tags-search');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Expo lead');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { v.q('contacts-bulk-tags-create').click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
  expect(onTagCreated).toHaveBeenCalledWith({ tag_id: 't_new', name: 'Expo lead', color: '#6366f1' });
  await act(async () => { v.q('contacts-bulk-tags-add').click(); for (let i = 0; i < 5; i++) await Promise.resolve(); });
  expect(contactsApi.bulkTag).toHaveBeenCalledWith({ contact_ids: ['c1'], tag_ids: ['t_new'], action: 'add' });
  v.unmount();
});

test('after a successful bulk tag, it refetches and clears the selection', async () => {
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await applyTags(v, ['t_hot']);
  expect(v.props.fetchData).toHaveBeenCalled();
  expect(v.q('contacts-bulk-bar')).toBeNull(); // selection cleared
  v.unmount();
});

test('a failed bulk tag leaves the selection intact for a retry', async () => {
  contactsApi.bulkTag.mockImplementation(() => Promise.reject({ response: { data: { detail: 'nope' } } }));
  const { toast } = jest.requireMock('sonner');
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await applyTags(v, ['t_hot']);
  expect(toast.error).toHaveBeenCalledWith('nope');
  expect(v.q('contacts-bulk-bar')).toBeTruthy();
  expect(v.q('contacts-bulk-bar').textContent).toContain('1 selected');
  expect(v.props.fetchData).not.toHaveBeenCalled();
  v.unmount();
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────

// item 1: bulk reassign confirms before sending — AssignToPicker commits on
// Enter/blur, so without a confirm an admin who selects everything and hits
// Enter would reassign the whole batch instantly.
test('bulk reassign asks for confirmation, and sends nothing if the user cancels', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  act(() => { v.q('select-contact-c2').click(); });

  expect(mockAssignToPickerProps).toBeTruthy(); // rendered — user is admin
  await act(async () => {
    mockAssignToPickerProps.onChange('newowner@smartshape.in', 'New Owner');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  expect(confirmSpy).toHaveBeenCalledWith('Assign 2 contact(s) to New Owner?');
  expect(contactsApi.bulkAssign).not.toHaveBeenCalled();
  // Cancelling must not touch the selection either.
  expect(v.q('contacts-bulk-bar').textContent).toContain('2 selected');
  confirmSpy.mockRestore();
  v.unmount();
});

test('bulk reassign sends the request once the user confirms', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  act(() => { v.q('select-contact-c2').click(); });

  await act(async () => {
    mockAssignToPickerProps.onChange('newowner@smartshape.in', 'New Owner');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  expect(confirmSpy).toHaveBeenCalledWith('Assign 2 contact(s) to New Owner?');
  expect(contactsApi.bulkAssign).toHaveBeenCalledWith({ contact_ids: ['c1', 'c2'], assigned_to: 'newowner@smartshape.in' });
  confirmSpy.mockRestore();
  v.unmount();
});

// item 5: the backend caps a single bulk request at 2,000 ids.
test('selecting more than 2,000 contacts disables the bulk controls and shows a cap note', () => {
  const huge = Array.from({ length: 2001 }, (_, i) => ({ contact_id: `h${i + 1}`, name: `H ${i + 1}`, tag_ids: [] }));
  const v = render({ contactsList: huge, contactsPerPage: 50 });
  act(() => { v.q('contacts-select-all').click(); });

  expect(v.q('contacts-bulk-bar').textContent).toContain('2001 selected');
  expect(v.q('contacts-bulk-cap-note')).toBeTruthy();
  expect(v.q('contacts-bulk-cap-note').textContent).toContain('Max 2,000 at a time');
  expect(v.q('contacts-bulk-tags-button').disabled).toBe(true);
  expect(mockAssignToPickerProps.disabled).toBe(true);
  v.unmount();
});

test('at or under the 2,000 cap, the bulk controls stay enabled and no cap note is shown', () => {
  const v = render({ contactsList: MANY, contactsPerPage: 10 });
  act(() => { v.q('contacts-select-all').click(); }); // 25, well under the cap
  expect(v.q('contacts-bulk-cap-note')).toBeNull();
  expect(v.q('contacts-bulk-tags-button').disabled).toBe(false);
  v.unmount();
});

// item 6: shift-click range selection, spanning pages (selection is computed
// against cFiltered, not the page on screen).
test('shift-clicking a row checkbox selects every row between it and the last-clicked row, in list order', () => {
  const v = render({ contactsList: MANY, contactsPerPage: 25 }); // all 25 on one page
  const table = v.q('contacts-table');
  const cb = (id) => table.querySelector(`[data-testid="select-contact-${id}"]`);

  act(() => { cb('m3').click(); }); // anchor, plain click
  act(() => {
    cb('m7').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
  });

  expect(v.q('contacts-bulk-bar').textContent).toContain('5 selected'); // m3..m7 inclusive
  ['m3', 'm4', 'm5', 'm6', 'm7'].forEach(id => expect(cb(id).checked).toBe(true));
  ['m1', 'm2', 'm8'].forEach(id => expect(cb(id).checked).toBe(false));
  v.unmount();
});

test('shift-click still does not open the contact panel', () => {
  const v = render({ contactsList: MANY, contactsPerPage: 25 });
  const table = v.q('contacts-table');
  const cb = (id) => table.querySelector(`[data-testid="select-contact-${id}"]`);
  act(() => { cb('m3').click(); });
  act(() => { cb('m7').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })); });
  expect(v.props.openContactPanel).not.toHaveBeenCalled();
  v.unmount();
});

// ── Enrol in drip (contact drip, D5) ────────────────────────────────────────

function setSelect(el, value) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

async function openDripAndPick(v, seqId = 'seq_gslc') {
  await act(async () => { v.q('contacts-bulk-drip-button').click(); await flush(); });
  act(() => { setSelect(v.q('contacts-bulk-drip-select'), seqId); });
}

test('the drip picker offers only active sequences that have steps', async () => {
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await act(async () => { v.q('contacts-bulk-drip-button').click(); await flush(); });
  const opts = Array.from(v.q('contacts-bulk-drip-select').querySelectorAll('option')).map(o => o.value);
  expect(opts).toEqual(['', 'seq_gslc']);
  v.unmount();
});

test('enrol in drip asks first, then sends exactly the visible selected ids', async () => {
  const { dripSequences } = jest.requireMock('../../../lib/api');
  const { toast } = jest.requireMock('sonner');
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const v = render({ contactsList: CONTACTS, allContactsList: CONTACTS });
  act(() => { v.q('contacts-select-all').click(); });            // c1, c2, c3
  v.rerender({ searchTerm: 'dps' });                              // c3 now hidden by filter
  expect(v.q('contacts-bulk-bar').textContent).toContain('(1 hidden by filter)');

  await openDripAndPick(v);
  await act(async () => { v.q('contacts-bulk-drip-enrol').click(); await flush(); });

  expect(confirmSpy).toHaveBeenCalledWith('Enrol 2 contacts in GSLC follow-up?');
  expect(dripSequences.enrollContacts).toHaveBeenCalledTimes(1);
  expect(dripSequences.enrollContacts).toHaveBeenCalledWith({ sequence_id: 'seq_gslc', contact_ids: ['c1', 'c2'] });
  expect(toast.success).toHaveBeenCalledWith('Enrolled 2 contacts in “GSLC follow-up”');
  expect(v.q('contacts-bulk-bar')).toBeNull();                    // selection cleared
  confirmSpy.mockRestore();
  v.unmount();
});

test('cancelling the drip confirm sends nothing and keeps the selection', async () => {
  const { dripSequences } = jest.requireMock('../../../lib/api');
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await openDripAndPick(v);
  await act(async () => { v.q('contacts-bulk-drip-enrol').click(); await flush(); });
  expect(confirmSpy).toHaveBeenCalledWith('Enrol 1 contact in GSLC follow-up?');
  expect(dripSequences.enrollContacts).not.toHaveBeenCalled();
  expect(v.q('contacts-bulk-bar').textContent).toContain('1 selected');
  confirmSpy.mockRestore();
  v.unmount();
});

test('the drip toast reports every skipped and no-channel count', () => {
  const { formatDripEnrolResult } = jest.requireActual('../BulkDripPicker');
  expect(formatDripEnrolResult({ enrolled: 40, skipped_duplicate: 3, skipped_not_visible: 2,
    skipped_missing: 1, no_channel: 5 }, 'GSLC follow-up'))
    .toBe('Enrolled 40 contacts in “GSLC follow-up” (3 already in it, 2 not yours, 1 deleted) · 5 have no phone or email');
  expect(formatDripEnrolResult({ enrolled: 1, no_channel: 1, starting_now: true }, 'S'))
    .toBe('Enrolled 1 contact in “S” · 1 has no phone or email · the first step goes out now');
});

test('a failed drip enrolment keeps the selection and shows the reason', async () => {
  const { dripSequences } = jest.requireMock('../../../lib/api');
  const { toast } = jest.requireMock('sonner');
  dripSequences.enrollContacts.mockImplementation(() => Promise.reject({ response: { data: { detail: 'Sequence not found or has no steps' } } }));
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const v = render();
  act(() => { v.q('select-contact-c1').click(); });
  await openDripAndPick(v);
  await act(async () => { v.q('contacts-bulk-drip-enrol').click(); await flush(); });
  expect(toast.error).toHaveBeenCalledWith('Sequence not found or has no steps');
  expect(v.q('contacts-bulk-bar').textContent).toContain('1 selected');
  confirmSpy.mockRestore();
  v.unmount();
});

test('over the 2,000 cap the drip button is disabled too', () => {
  const huge = Array.from({ length: 2001 }, (_, i) => ({ contact_id: `h${i + 1}`, name: `H ${i + 1}`, tag_ids: [] }));
  const v = render({ contactsList: huge, contactsPerPage: 50 });
  act(() => { v.q('contacts-select-all').click(); });
  expect(v.q('contacts-bulk-drip-button').disabled).toBe(true);
  v.unmount();
});
