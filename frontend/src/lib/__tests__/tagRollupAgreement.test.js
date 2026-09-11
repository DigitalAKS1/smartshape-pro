// Tag roll-up — the frontend half of the D4 agreement test (spec 2026-09-11).
//
// The fixture lives with the backend tests, at
// backend/tests/fixtures/tag_rollup_fixture.json, and backend/tests/
// test_tag_scope.py runs the SAME file through services/tag_scope.
// resolve_tag_scope. Both sides must reproduce the fixture's expected id sets
// exactly, so a pass on both means the CRM screen and every server-side send
// agree on who a tag reaches.
//
// Read with fs rather than import: CRA's Jest only transforms files under
// src/, and a JSON import from outside src/ is also something the webpack
// build refuses. fs keeps the one fixture in one place, and it never ships in
// the bundle.
import fs from 'fs';
import path from 'path';
import { buildSchoolTagIndex, buildCrmContext, matchesCrmFilter, matchesTagRollup } from '../crmFilter';
import { buildMasterContexts, computeMasterFiltered, makeCountFor } from '../crmMasterFilter';

const FIXTURE_PATH = path.resolve(__dirname, '../../../../backend/tests/fixtures/tag_rollup_fixture.json');
const fx = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

// Everything in the fixture — soft-deleted rows included — is handed to the
// filter, exactly as a stale or unfiltered list would be. Deleted rows must
// neither match nor roll anything up.
const contexts = buildMasterContexts({
  schoolsList: fx.schools, contactsList: fx.contacts, leadsList: fx.leads, rolesList: [],
});

const idsOf = (rows, key) => rows.map((r) => r[key]).sort();

describe('agreement with resolve_tag_scope on the shared fixture', () => {
  test.each(fx.queries.map((q) => [q.name, q]))('%s', (_name, q) => {
    const out = computeMasterFiltered({
      schoolsList: fx.schools, contactsList: fx.contacts, leadsList: fx.leads,
      contexts, searchTerm: '', masterFilter: { tags: q.tag_ids },
    });
    expect({
      contact_ids: idsOf(out.contacts, 'contact_id'),
      school_ids: idsOf(out.schools, 'school_id'),
      lead_ids: idsOf(out.leads, 'lead_id'),
    }).toEqual(q.expected);
  });

  test('the fixture carries the spec\'s production shapes', () => {
    const byName = Object.fromEntries(fx.queries.map((q) => [q.name, q.expected]));
    const n = (e) => [e.contact_ids.length, e.school_ids.length, e.lead_ids.length];
    expect(n(byName['GSLC 2026'])).toEqual([98, 92, 2]);
    expect(n(byName['Demo Done'])).toEqual([0, 32, 34]);
  });
});

describe('the filter-rail counts follow the roll-up (makeCountFor)', () => {
  test('each tab counts what its rows would show', () => {
    const count = (kind, list) => makeCountFor({ kind, list, ctx: contexts[kind] });
    expect(count('school', fx.schools)('tags', 't_gslc')).toBe(92);
    expect(count('contact', fx.contacts)('tags', 't_gslc')).toBe(98);
    expect(count('lead', fx.leads)('tags', 't_gslc')).toBe(2);
    expect(count('school', fx.schools)('tags', 't_demo')).toBe(32);
    expect(count('contact', fx.contacts)('tags', 't_demo')).toBe(0);
    expect(count('lead', fx.leads)('tags', 't_demo')).toBe(34);
  });
});

describe('D1-D3 on small data', () => {
  const schools = [{ school_id: 's1' }, { school_id: 's2', tag_ids: ['t'] }, { school_id: 's3' }];
  const contacts = [
    { contact_id: 'c_tagged', school_id: 's1', tag_ids: ['t'] },
    { contact_id: 'c_colleague', school_id: 's1' },
    { contact_id: 'c_at_tagged_school', school_id: 's2' },
  ];
  const leads = [
    { lead_id: 'l_at_s1', school_id: 's1' },
    { lead_id: 'l_at_s3', school_id: 's3' },
  ];
  const ctx = buildMasterContexts({ schoolsList: schools, contactsList: contacts, leadsList: leads });
  const f = { tags: ['t'] };

  test('D1: a contact never matches through its school', () => {
    expect(matchesCrmFilter(contacts[0], f, ctx.contact)).toBe(true);
    expect(matchesCrmFilter(contacts[1], f, ctx.contact)).toBe(false);
    expect(matchesCrmFilter(contacts[2], f, ctx.contact)).toBe(false);
  });

  test('D2: a school matches through a tagged person, or its own tag', () => {
    expect(matchesCrmFilter(schools[0], f, ctx.school)).toBe(true);
    expect(matchesCrmFilter(schools[1], f, ctx.school)).toBe(true);
    expect(matchesCrmFilter(schools[2], f, ctx.school)).toBe(false);
  });

  test('D3: a lead matches through its school\'s roll-up', () => {
    expect(matchesCrmFilter(leads[0], f, ctx.lead)).toBe(true);
    expect(matchesCrmFilter(leads[1], f, ctx.lead)).toBe(false);
  });

  test('the lead context sees contacts through the shared index, one build for all three', () => {
    expect(ctx.lead.schoolTags).toBe(ctx.school.schoolTags);
    expect(ctx.contact.schoolTags).toBe(ctx.school.schoolTags);
    // ...without being handed contacts itself, so `sources` roll-up is unchanged
    expect(ctx.lead.contactsBySchoolId).toEqual({});
  });

  test('a school only rolls up to leads while it is a live, loaded school', () => {
    const idx = buildSchoolTagIndex({
      schools: [{ school_id: 's_dead', is_deleted: true }],
      contacts: [{ contact_id: 'c', school_id: 's_dead', tag_ids: ['t'] },
                 { contact_id: 'g', school_id: 's_ghost', tag_ids: ['t'] }],
    });
    expect(idx.size).toBe(0);
    expect(matchesTagRollup({ lead_id: 'l', school_id: 's_dead' }, ['t'], 'lead', idx)).toBe(false);
    expect(matchesTagRollup({ lead_id: 'l', school_id: 's_ghost' }, ['t'], 'lead', idx)).toBe(false);
  });

  test('a context with no index still matches a row on its own tags', () => {
    expect(matchesCrmFilter({ tag_ids: ['t'] }, f, null)).toBe(true);
    expect(matchesCrmFilter({ tag_ids: [] }, f, buildCrmContext('lead', {}))).toBe(false);
  });
});
