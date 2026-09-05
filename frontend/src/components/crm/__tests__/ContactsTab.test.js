// The Contacts tab: 383 lines and, until now, no tests — which is where two of
// this module's bugs lived (it re-searched the raw query string including
// operators, and carried a second tag filter that fought the page-level one).
//
// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ContactsTab from '../ContactsTab';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('../../../lib/api', () => ({ adminApi: {} }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../ContactDetailPanel', () => ({ CallStatusBadge: () => null }));
jest.mock('../MultiFilterBar', () => () => null);

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

function render(overrides = {}) {
  const props = {
    contactsList: CONTACTS,
    leadsList: [],
    schoolsList: SCHOOLS,
    sourcesList: [],
    filterRole: '',
    setFilterRole: jest.fn(),
    searchTerm: '',
    tagsList: [{ tag_id: 't_hot', name: 'Hot Lead', color: '#f00' }],
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
