import {
  matchesGlobalSearch, buildMasterContexts, computeMasterFiltered, makeCountFor, tabKind,
} from '../crmMasterFilter';

const schools = [
  { school_id: 's_roh', school_name: 'Rohini Public School', city: 'Rohini', school_type: 'CBSE' },
  { school_id: 's_dwk', school_name: 'Dwarka Model School', city: 'Dwarka', school_type: 'ICSE' },
];
const leads = [
  { lead_id: 'l1', school_id: 's_roh', company_name: 'Rohini Public School', contact_name: 'Ravi', stage: 'demo', assigned_to: 'a@ss.in' },
  { lead_id: 'l2', school_id: 's_dwk', company_name: 'Dwarka Model School', contact_name: 'Priya', stage: 'new', assigned_to: '' },
];
const contacts = [
  { contact_id: 'c1', name: 'Ravi Kumar', company: 'Rohini Public School', school_id: 's_roh', assigned_to: 'a@ss.in' },
  { contact_id: 'c2', name: 'Priya Singh', company: 'Dwarka Model School', school_id: 's_dwk', assigned_to: '' },
];

const contexts = buildMasterContexts({ schoolsList: schools, leadsList: leads, contactsList: contacts, rolesList: [] });

describe('matchesGlobalSearch', () => {
  test('blank term matches everything', () => {
    expect(matchesGlobalSearch(schools[0], 'school', '')).toBe(true);
  });
  test('school matches by city', () => {
    expect(matchesGlobalSearch(schools[0], 'school', 'rohini')).toBe(true);
    expect(matchesGlobalSearch(schools[1], 'school', 'rohini')).toBe(false);
  });
  test('contact matches by name', () => {
    expect(matchesGlobalSearch(contacts[0], 'contact', 'ravi')).toBe(true);
    expect(matchesGlobalSearch(contacts[1], 'contact', 'ravi')).toBe(false);
  });
  test('lead matches by company_name', () => {
    expect(matchesGlobalSearch(leads[1], 'lead', 'dwarka')).toBe(true);
  });
});

describe('computeMasterFiltered — this is what drives the tab badges', () => {
  test('no search/filter returns everything', () => {
    const out = computeMasterFiltered({ schoolsList: schools, contactsList: contacts, leadsList: leads, contexts });
    expect(out.schools).toHaveLength(2);
    expect(out.contacts).toHaveLength(2);
    expect(out.leads).toHaveLength(2);
  });

  test('search term narrows all three entity types together (O16)', () => {
    const out = computeMasterFiltered({ schoolsList: schools, contactsList: contacts, leadsList: leads, contexts, searchTerm: 'Rohini' });
    // Schools(N) / Contacts(N) / Leads(N) badges would now read 1/1/1, not 2/2/2 —
    // this is the "City=Rohini with 1 school shows 1, not 143" acceptance bar (O5).
    expect(out.schools.map((s) => s.school_id)).toEqual(['s_roh']);
    expect(out.contacts.map((c) => c.contact_id)).toEqual(['c1']);
    expect(out.leads.map((l) => l.lead_id)).toEqual(['l1']);
  });

  test('owner facet (master filter) narrows all three entity types (O1, O17)', () => {
    const out = computeMasterFiltered({ schoolsList: schools, contactsList: contacts, leadsList: leads, contexts, masterFilter: { owners: ['a@ss.in'] } });
    expect(out.contacts.map((c) => c.contact_id)).toEqual(['c1']);
    expect(out.leads.map((l) => l.lead_id)).toEqual(['l1']);
  });

  test('UNASSIGNED owner sentinel matches blank assigned_to', () => {
    const out = computeMasterFiltered({ schoolsList: schools, contactsList: contacts, leadsList: leads, contexts, masterFilter: { owners: ['__unassigned__'] } });
    expect(out.leads.map((l) => l.lead_id)).toEqual(['l2']);
  });
});

describe('makeCountFor — live per-option counts for FilterRail', () => {
  test('counts rows that would remain if this facet value were added', () => {
    const countFor = makeCountFor({ kind: 'lead', list: leads, ctx: contexts.lead });
    expect(countFor('lead_stages', 'demo')).toBe(1);
    expect(countFor('lead_stages', 'new')).toBe(1);
  });

  test('counts compose with an already-active master filter (AND across facets)', () => {
    const countFor = makeCountFor({ kind: 'lead', list: leads, ctx: contexts.lead, masterFilter: { owners: ['a@ss.in'] } });
    // owner=a@ss.in already narrows to l1 (stage=demo); adding stage=new on top -> 0
    expect(countFor('lead_stages', 'demo')).toBe(1);
    expect(countFor('lead_stages', 'new')).toBe(0);
  });

  test('honors the active search term too', () => {
    const countFor = makeCountFor({ kind: 'school', list: schools, ctx: contexts.school, searchTerm: 'Dwarka' });
    expect(countFor('school_types', 'ICSE')).toBe(1);
    expect(countFor('school_types', 'CBSE')).toBe(0);
  });
});

describe('tabKind', () => {
  test('maps tabs to their entity kind, defaulting to lead', () => {
    expect(tabKind('schools')).toBe('school');
    expect(tabKind('contacts')).toBe('contact');
    expect(tabKind('list')).toBe('lead');
    expect(tabKind('pipeline')).toBe('lead');
    expect(tabKind('tasks')).toBe('lead');
    expect(tabKind('reports')).toBe('lead');
  });
});
