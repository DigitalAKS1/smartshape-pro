// The derived-state contract of useLeadsCRM.
//
// This hook is 892 lines holding 69 pieces of state and handing back 167 values,
// and splitting it up is the next piece of work. These tests pin what the page
// actually depends on — one filter pipeline feeding every tab, and tab counts
// that agree with the rows each tab renders — so the split can be judged by
// whether they still pass rather than by reading the diff.
//
// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo — same pattern as FilterRail.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useLeadsCRM from '../useLeadsCRM';

global.IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixture: two schools, three contacts, three leads ───────────────────────
const SCHOOLS = [
  { school_id: 's_dps', school_name: 'Delhi Public School', city: 'Rohini',
    school_type: 'CBSE', school_strength: 1200, assigned_to: 'parul@ss.in', tags: ['t_hot'] },
  { school_id: 's_lotus', school_name: 'Lotus Valley', city: 'Noida',
    school_type: 'ICSE', school_strength: 400, assigned_to: '' },
];
const CONTACTS = [
  { contact_id: 'c1', school_id: 's_dps', name: 'R Sharma', phone: '9811111111',
    designation: 'Principal', assigned_to: 'parul@ss.in', status: 'active' },
  { contact_id: 'c2', school_id: 's_dps', name: 'K Verma', phone: '9822222222',
    designation: 'Director', assigned_to: 'parul@ss.in', status: 'active' },
  { contact_id: 'c3', school_id: 's_lotus', name: 'A Menon', phone: '9833333333',
    designation: 'Principal', assigned_to: '', status: 'active' },
];
const LEADS = [
  { lead_id: 'l1', school_id: 's_dps', company_name: 'Delhi Public School',
    contact_name: 'R Sharma', contact_phone: '9811111111', stage: 'demo',
    lead_type: 'hot', school_type: 'CBSE', assigned_to: 'parul@ss.in', tags: ['t_hot'] },
  { lead_id: 'l2', school_id: 's_dps', company_name: 'Delhi Public School',
    contact_name: 'K Verma', stage: 'won', lead_type: 'warm',
    school_type: 'CBSE', assigned_to: 'parul@ss.in', tags: [] },
  { lead_id: 'l3', school_id: 's_lotus', company_name: 'Lotus Valley',
    contact_name: 'A Menon', stage: 'new', lead_type: 'cold',
    school_type: 'ICSE', assigned_to: '', tags: [] },
];
const SALESPEOPLE = [{ email: 'parul@ss.in', name: 'Parul Kanchan' }];
const TAGS = [{ tag_id: 't_hot', name: 'Hot Lead', color: '#f00' }];

const ok = (data) => Promise.resolve({ data });

jest.mock('../../lib/api', () => ({
  leads:        { getAll: () => ok(LEADS) },
  schools:      { getAll: () => ok(SCHOOLS) },
  tasks:        { getAll: () => ok([]) },
  salesPersons: { getAll: () => ok(SALESPEOPLE) },
  contacts:     { getAll: () => ok(CONTACTS) },
  groups:       { getAll: () => ok([]) },
  sources:      { getAll: () => ok([]) },
  contactRoles: { getAll: () => ok([]) },
  tags:         { getAll: () => ok(TAGS) },
  dripSequences:{ getAll: () => ok([]) },
  quotations:   { getAll: () => ok([]) },
  designations: { getAll: () => ok([]) },
  dealTypes:    { getAll: () => ok([]) },
  followups:    { getAll: () => ok([]) },
  exportData:   {},
}));
jest.mock('../../lib/dataSync', () => ({ useDataSync: () => {}, useAutoRefresh: () => {} }));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'info@smartshape.in', role: 'admin' } }),
}));
// virtual: react-router-dom v7 is ESM-only and this Jest resolver can't walk its
// exports map. The hook only uses useSearchParams, so a stub is the whole need.
jest.mock('react-router-dom',
  () => ({ useSearchParams: () => [new URLSearchParams(), () => {}] }),
  { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// ── Probe ───────────────────────────────────────────────────────────────────
let api = null;
function Probe() {
  api = useLeadsCRM();
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  return { unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { fn(); }); };

let view;
beforeEach(async () => { api = null; view = await mount(); });
afterEach(() => { view.unmount(); });

// ── Loading ─────────────────────────────────────────────────────────────────

test('loads every list the CRM page renders from', () => {
  expect(api.leadsList).toHaveLength(3);
  expect(api.schoolsList).toHaveLength(2);
  expect(api.contactsList).toHaveLength(3);
  expect(api.tagsList).toHaveLength(1);
  expect(api.loading).toBe(false);
});

test('with nothing filtering, every tab shows everything', () => {
  expect(api.masterFiltered.schools).toHaveLength(2);
  expect(api.masterFiltered.contacts).toHaveLength(3);
  expect(api.masterFiltered.leads).toHaveLength(3);
  expect(api.filteredLeads).toHaveLength(3);
});

// ── One filter pipeline, every tab ──────────────────────────────────────────

test('a rail filter narrows schools, contacts and leads together', async () => {
  await set(() => api.setMasterFilter({ cities: ['Rohini'] }));
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_dps']);
  expect(api.masterFiltered.contacts.map(c => c.contact_id)).toEqual(['c1', 'c2']);
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l1', 'l2']);
});

test('the Type dropdown narrows every tab, not only Leads', async () => {
  await set(() => api.setFilterType('ICSE'));
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_lotus']);
  expect(api.masterFiltered.contacts.map(c => c.contact_id)).toEqual(['c3']);
  expect(api.filteredLeads.map(l => l.lead_id)).toEqual(['l3']);
});

test('Hot/Warm/Cold rolls up from leads to their school', async () => {
  await set(() => api.setFilterType('hot'));
  expect(api.filteredLeads.map(l => l.lead_id)).toEqual(['l1']);
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_dps']);
});

test('the Tags dropdown narrows every tab', async () => {
  await set(() => api.setFilterTag('t_hot'));
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_dps']);
  expect(api.filteredLeads.map(l => l.lead_id)).toEqual(['l1']);
});

// ── Search box ──────────────────────────────────────────────────────────────

test('plain text searches every tab', async () => {
  await set(() => api.setSearchTerm('lotus'));
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_lotus']);
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l3']);
});

test('a partial owner: operator resolves against the real owner list', async () => {
  await set(() => api.setSearchTerm('owner:parul'));
  expect(api.parsedQuery.filter.owners).toEqual(['parul@ss.in']);
  expect(api.parsedQuery.text).toBe('');
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l1', 'l2']);
});

test('is:unassigned finds the rows with no owner', async () => {
  await set(() => api.setSearchTerm('is:unassigned'));
  expect(api.masterFiltered.schools.map(s => s.school_id)).toEqual(['s_lotus']);
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l3']);
});

test('operators and free text combine', async () => {
  await set(() => api.setSearchTerm('owner:parul sharma'));
  expect(api.parsedQuery.text).toBe('sharma');
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l1']);
});

test('a typo narrows to nothing rather than being silently ignored', async () => {
  await set(() => api.setSearchTerm('owner:nobody'));
  expect(api.parsedQuery.filter).toEqual({});
  expect(api.parsedQuery.text).toBe('owner:nobody');
  expect(api.masterFiltered.leads).toHaveLength(0);
});

// ── The rail and the search box must not fight ──────────────────────────────

test('typing an operator never mutates the rail\'s own selections', async () => {
  await set(() => api.setMasterFilter({ cities: ['Rohini'] }));
  await set(() => api.setSearchTerm('owner:parul'));
  expect(api.masterFilter).toEqual({ cities: ['Rohini'] });
  expect(api.effectiveFilter.cities).toEqual(['Rohini']);
  expect(api.effectiveFilter.owners).toEqual(['parul@ss.in']);
});

test('clearing the search box leaves the rail selection standing', async () => {
  await set(() => api.setMasterFilter({ cities: ['Rohini'] }));
  await set(() => api.setSearchTerm('owner:parul'));
  await set(() => api.setSearchTerm(''));
  expect(api.effectiveFilter).toEqual({ cities: ['Rohini'] });
  expect(api.masterFiltered.leads).toHaveLength(2);
});

test('the dropdowns reach effectiveFilter as ordinary facets', async () => {
  await set(() => api.setFilterType('hot'));
  await set(() => api.setFilterTag('t_hot'));
  expect(api.effectiveFilter.lead_types).toEqual(['hot']);
  expect(api.effectiveFilter.tags).toEqual(['t_hot']);
});

// ── Honest counts: what the tab badge says is what the tab shows ────────────

test('filteredLeads is exactly the leads the master pipeline kept', async () => {
  await set(() => api.setMasterFilter({ lead_stages: ['demo'] }));
  expect(api.filteredLeads).toEqual(api.masterFiltered.leads);
  expect(api.filteredLeads.map(l => l.lead_id)).toEqual(['l1']);
});

test('countFor answers what would remain if a value were added', async () => {
  await set(() => api.setActiveTab('schools'));
  expect(api.masterCountFor('cities', 'Rohini')).toBe(1);
  expect(api.masterCountFor('cities', 'Noida')).toBe(1);
});

test('countFor follows the tab, because each tab counts its own entity', async () => {
  await set(() => api.setActiveTab('contacts'));
  expect(api.activeTabKind).toBe('contact');
  expect(api.masterCountFor('cities', 'Rohini')).toBe(2);   // two contacts at that school
  await set(() => api.setActiveTab('schools'));
  expect(api.activeTabKind).toBe('school');
  expect(api.masterCountFor('cities', 'Rohini')).toBe(1);
});

// ── Options offered to the user come from the real data ─────────────────────

test('filter options are derived from the loaded rows, not hard-coded', () => {
  expect(api.filterOptions.cities).toEqual(['Noida', 'Rohini']);
  expect(api.filterOptions.owners.map(o => o.id)).toContain('parul@ss.in');
  expect(api.filterOptions.tags.map(t => t.id)).toEqual(['t_hot']);
});

// ── Combining filters narrows, never widens ─────────────────────────────────

test('two different facets are ANDed', async () => {
  await set(() => api.setMasterFilter({ cities: ['Rohini'], lead_stages: ['won'] }));
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l2']);
});

test('two values in one facet are ORed', async () => {
  await set(() => api.setMasterFilter({ lead_stages: ['demo', 'new'] }));
  expect(api.masterFiltered.leads.map(l => l.lead_id)).toEqual(['l1', 'l3']);
});

test('a filter matching nothing yields nothing, and says so honestly', async () => {
  await set(() => api.setMasterFilter({ cities: ['Chennai'] }));
  expect(api.masterFiltered.schools).toHaveLength(0);
  expect(api.masterFiltered.contacts).toHaveLength(0);
  expect(api.filteredLeads).toHaveLength(0);
});
