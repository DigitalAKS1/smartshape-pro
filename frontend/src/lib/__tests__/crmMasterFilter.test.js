import {
  matchesGlobalSearch, buildMasterContexts, computeMasterFiltered, makeCountFor, tabKind,
  parseSearchQuery, mergeFilters, describeParsedFilter,
} from '../crmMasterFilter';
import { UNASSIGNED } from '../crmFilter';

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

// ── O21: Gmail-style search query language ──────────────────────────────────

const qOptions = {
  owners: [{ id: 'parul@ss.in', name: 'Parul Kanchan' }, { id: 'amit@ss.in', name: 'Amit' }],
  cities: ['Rohini', 'New Delhi'],
  sources: ['Referral', 'Website'],
  school_types: ['CBSE', 'ICSE'],
  stages: [{ id: 'demo', label: 'Demo' }, { id: 'won', label: 'Won' }],
  tags: [{ id: 't_hot', name: 'Hot Lead', color: '#f00' }],
};

describe('parseSearchQuery', () => {
  test('plain free text, no operators', () => {
    expect(parseSearchQuery('hot leads', qOptions)).toEqual({ filter: {}, text: 'hot leads' });
  });

  test('owner: resolves by quoted full name, case-insensitive', () => {
    const out = parseSearchQuery('owner:"parul kanchan"', qOptions);
    expect(out).toEqual({ filter: { owners: ['parul@ss.in'] }, text: '' });
  });

  test('owner: resolves by bare email id, case-insensitive', () => {
    const out = parseSearchQuery('owner:PARUL@SS.IN', qOptions);
    expect(out.filter).toEqual({ owners: ['parul@ss.in'] });
  });

  test('city: source: type: stage: tag: all resolve to real option ids', () => {
    expect(parseSearchQuery('city:rohini', qOptions).filter).toEqual({ cities: ['Rohini'] });
    expect(parseSearchQuery('source:referral', qOptions).filter).toEqual({ sources: ['Referral'] });
    expect(parseSearchQuery('type:cbse', qOptions).filter).toEqual({ school_types: ['CBSE'] });
    expect(parseSearchQuery('stage:demo', qOptions).filter).toEqual({ lead_stages: ['demo'] });
    expect(parseSearchQuery('stage:"Won"', qOptions).filter).toEqual({ lead_stages: ['won'] }); // resolves by label too
    expect(parseSearchQuery('tag:"hot lead"', qOptions).filter).toEqual({ tags: ['t_hot'] });
  });

  test('has:phone / has:email -> has facet; unknown has: value falls back to text', () => {
    expect(parseSearchQuery('has:phone', qOptions).filter).toEqual({ has: ['phone'] });
    expect(parseSearchQuery('has:email', qOptions).filter).toEqual({ has: ['email'] });
    const bad = parseSearchQuery('has:fax', qOptions);
    expect(bad.filter).toEqual({});
    expect(bad.text).toBe('has:fax');
  });

  test('is:unassigned maps to the UNASSIGNED owner sentinel; unknown is: falls back to text', () => {
    expect(parseSearchQuery('is:unassigned', qOptions).filter).toEqual({ owners: [UNASSIGNED] });
    const bad = parseSearchQuery('is:cold', qOptions);
    expect(bad.filter).toEqual({});
    expect(bad.text).toBe('is:cold');
  });

  test('unknown operator key stays as free text verbatim', () => {
    expect(parseSearchQuery('foo:bar', qOptions)).toEqual({ filter: {}, text: 'foo:bar' });
  });

  test('a recognized operator with an unresolvable (typo) value falls back to free text', () => {
    const out = parseSearchQuery('owner:nobody', qOptions);
    expect(out.filter).toEqual({});
    expect(out.text).toBe('owner:nobody');
  });

  test('mixes operators with free text, and dedups repeated operator values', () => {
    const out = parseSearchQuery('owner:"Parul Kanchan" city:rohini hot lead owner:parul@ss.in', qOptions);
    expect(out.filter).toEqual({ owners: ['parul@ss.in'], cities: ['Rohini'] });
    expect(out.text).toBe('hot lead');
  });

  test('a bare quoted phrase with no operator is kept intact as free text', () => {
    expect(parseSearchQuery('"hot lead" city:rohini', qOptions)).toEqual({ filter: { cities: ['Rohini'] }, text: 'hot lead' });
  });

  test('multiple different owners OR-within the same owners facet', () => {
    const out = parseSearchQuery('owner:parul@ss.in owner:amit@ss.in', qOptions);
    expect(out.filter.owners.sort()).toEqual(['amit@ss.in', 'parul@ss.in']);
  });

  test('empty/blank term', () => {
    expect(parseSearchQuery('', qOptions)).toEqual({ filter: {}, text: '' });
    expect(parseSearchQuery(undefined, qOptions)).toEqual({ filter: {}, text: '' });
  });
});

describe('mergeFilters', () => {
  test('unions array-valued facets from both sides, deduping', () => {
    const out = mergeFilters({ owners: ['a@ss.in'] }, { owners: ['a@ss.in', 'b@ss.in'] });
    expect(out.owners.sort()).toEqual(['a@ss.in', 'b@ss.in']);
  });
  test('facet only on one side passes through untouched', () => {
    expect(mergeFilters({ cities: ['Rohini'] }, {})).toEqual({ cities: ['Rohini'] });
    expect(mergeFilters({}, { sources: ['Referral'] })).toEqual({ sources: ['Referral'] });
  });
  test('does not mutate either input', () => {
    const a = { owners: ['a@ss.in'] };
    const b = { owners: ['b@ss.in'] };
    mergeFilters(a, b);
    expect(a.owners).toEqual(['a@ss.in']);
    expect(b.owners).toEqual(['b@ss.in']);
  });
});

describe('describeParsedFilter', () => {
  test('renders human-readable chip labels, resolving ids back to names', () => {
    const chips = describeParsedFilter({ owners: ['parul@ss.in'], cities: ['Rohini'], has: ['phone'] }, qOptions);
    const labels = chips.map((c) => c.label);
    expect(labels).toContain('Owner: Parul Kanchan');
    expect(labels).toContain('City: Rohini');
    expect(labels).toContain('Has: phone');
  });
  test('renders Unassigned for the UNASSIGNED sentinel', () => {
    const chips = describeParsedFilter({ owners: [UNASSIGNED] }, qOptions);
    expect(chips[0].label).toBe('Owner: Unassigned');
  });
  test('empty filter -> no chips', () => {
    expect(describeParsedFilter({}, qOptions)).toEqual([]);
  });
});
