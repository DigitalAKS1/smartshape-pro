import { matchesCrmFilter, buildCrmContext, deriveFilterOptions, countActive } from '../crmFilter';

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
