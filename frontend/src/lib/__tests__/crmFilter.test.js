import { matchesCrmFilter, buildCrmContext, deriveFilterOptions, countActive, suggestFacets } from '../crmFilter';

const schools = [
  { school_id: 's_big', school_type: 'CBSE', school_strength: 700, city: 'Delhi' },
  { school_id: 's_small', school_type: 'CBSE', school_strength: 200, city: 'Delhi' },
  { school_id: 's_icse', school_type: 'ICSE', school_strength: 900, city: 'Mumbai' },
];
const leads = [
  { lead_id: 'l1', school_id: 's_big', stage: 'demo', source: 'LinkedIn', designation: 'Principal' },
  { lead_id: 'l3', school_id: 's_small', stage: 'new' },
];
const roles = [{ role_id: 'r_art', name: 'Art Teacher' }];
const cctx = buildCrmContext('contact', { schools, leads, roles });
const lctx = buildCrmContext('lead', { schools, leads, roles });

const c = (o) => ({ contact_id: 'c', source: 'LinkedIn', designation: 'Art Teacher', school_id: 's_big', tag_ids: [], ...o });

test('empty filter passes all', () => {
  expect(matchesCrmFilter(c({}), {}, cctx)).toBe(true);
});

test('AND across + OR within', () => {
  const f = { sources: ['LinkedIn', 'Referral'], roles: ['Art Teacher'], min_strength: 600 };
  expect(matchesCrmFilter(c({}), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ source: 'Referral' }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ source: 'Cold Call' }), f, cctx)).toBe(false);
  expect(matchesCrmFilter(c({ school_id: 's_small' }), f, cctx)).toBe(false);
  expect(matchesCrmFilter(c({ designation: 'Principal' }), f, cctx)).toBe(false);
});

test('contact stage is school-level', () => {
  expect(matchesCrmFilter(c({}), { lead_stages: ['demo'] }, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ school_id: 's_small' }), { lead_stages: ['demo'] }, cctx)).toBe(false);
});

test('lead stage is native', () => {
  expect(matchesCrmFilter(leads[0], { lead_stages: ['demo'] }, lctx)).toBe(true);
  expect(matchesCrmFilter(leads[1], { lead_stages: ['demo'] }, lctx)).toBe(false);
});

test('role via contact_role_id', () => {
  const row = c({ designation: '', contact_role_id: 'r_art' });
  expect(matchesCrmFilter(row, { roles: ['Art Teacher'] }, cctx)).toBe(true);
});

test('missing school excluded from school facets', () => {
  expect(matchesCrmFilter(c({ school_id: null }), { min_strength: 100 }, cctx)).toBe(false);
});

test('countActive', () => {
  expect(countActive({ sources: ['x'], min_strength: 600 })).toBe(2);
  expect(countActive({})).toBe(0);
});

test('deriveFilterOptions distinct + sorted', () => {
  const opts = deriveFilterOptions({ contacts: [c({}), c({ source: 'Referral' })], schools, tags: [{ tag_id: 't1', name: 'Hot', color: '#f00' }] });
  expect(opts.sources).toEqual(['LinkedIn', 'Referral']);
  expect(opts.school_types).toEqual(['CBSE', 'ICSE']);
  expect(opts.tags[0]).toEqual({ id: 't1', name: 'Hot', color: '#f00' });
});

// ── Owner facet ───────────────────────────────────────────────────────────────

test('owners facet matches on assigned_to', () => {
  const f = { owners: ['parul@ss.in'] };
  expect(matchesCrmFilter(c({ assigned_to: 'parul@ss.in' }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ assigned_to: 'amit@ss.in' }), f, cctx)).toBe(false);
});

test('__unassigned__ matches blank/absent owner only', () => {
  const f = { owners: ['__unassigned__'] };
  expect(matchesCrmFilter(c({ assigned_to: '' }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ assigned_to: undefined }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ assigned_to: 'parul@ss.in' }), f, cctx)).toBe(false);
});

test('owners OR-within: any listed owner passes', () => {
  const f = { owners: ['parul@ss.in', '__unassigned__'] };
  expect(matchesCrmFilter(c({ assigned_to: 'parul@ss.in' }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ assigned_to: '' }), f, cctx)).toBe(true);
  expect(matchesCrmFilter(c({ assigned_to: 'amit@ss.in' }), f, cctx)).toBe(false);
});

test('deriveFilterOptions owners from salespersons + row fallback', () => {
  const opts = deriveFilterOptions({
    salespersons: [{ email: 'parul@ss.in', name: 'Parul' }],
    leads: [{ lead_id: 'lx', assigned_to: 'ghost@ss.in', assigned_name: 'Ghost Rep' }],
  });
  expect(opts.owners).toEqual([
    { id: 'ghost@ss.in', name: 'Ghost Rep' },
    { id: 'parul@ss.in', name: 'Parul' },
  ]);
});

// ── Source roll-up onto a school row ───────────────────────────────────────────

test('source rolls up through school children when row has none', () => {
  // School rows have no own `source`; match via their leads/contacts.
  const schoolCtx = buildCrmContext('school', { schools, leads, contacts: [] });
  const bigSchool = schools[0];   // s_big has lead l1 with source LinkedIn
  const smallSchool = schools[1]; // s_small has lead l3 with no source
  expect(matchesCrmFilter(bigSchool, { sources: ['LinkedIn'] }, schoolCtx)).toBe(true);
  expect(matchesCrmFilter(smallSchool, { sources: ['LinkedIn'] }, schoolCtx)).toBe(false);
});

// ── suggestFacets ──────────────────────────────────────────────────────────────

const sugOpts = {
  cities: ['Rohini', 'Dwarka'],
  sources: ['Referral'],
  stages: [{ id: 'demo', label: 'Demo' }],
  tags: [{ id: 't_roh', name: 'Rohini Zone' }],
  owners: [{ id: 'r@ss.in', name: 'Rohit' }],
};

test('suggestFacets needs >=2 chars', () => {
  expect(suggestFacets('r', sugOpts)).toEqual([]);
  expect(suggestFacets('', sugOpts)).toEqual([]);
});

test('suggestFacets finds across facets, prefix-ranked', () => {
  const out = suggestFacets('roh', sugOpts);
  const keys = out.map(s => `${s.facet}:${s.id}`);
  expect(keys).toContain('cities:Rohini');
  expect(keys).toContain('tags:t_roh');
  expect(keys).toContain('owners:r@ss.in'); // "Rohit" contains "roh"
  // prefix matches ("Rohini", "Rohini Zone", "Rohit") outrank non-prefix
  expect(out[0].label.toLowerCase().startsWith('roh')).toBe(true);
});

test('suggestFacets attaches counts and drops zero-count', () => {
  const countFor = (facet, id) => (facet === 'cities' && id === 'Rohini' ? 3 : 0);
  const out = suggestFacets('roh', sugOpts, { countFor });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ facet: 'cities', id: 'Rohini', count: 3 });
});

test('suggestFacets hides already-applied values', () => {
  const out = suggestFacets('roh', sugOpts, { applied: { cities: ['Rohini'] } });
  expect(out.map(s => `${s.facet}:${s.id}`)).not.toContain('cities:Rohini');
  expect(out.map(s => `${s.facet}:${s.id}`)).toContain('tags:t_roh');
});
