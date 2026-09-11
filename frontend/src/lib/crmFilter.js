export const STAGES = [
  { id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' },
  { id: 'demo', label: 'Demo' }, { id: 'negotiation', label: 'Negotiation' },
  { id: 'quoted', label: 'Quoted' }, { id: 'follow_up', label: 'Follow Up' },
  { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
];

const uniqSorted = (a) =>
  Array.from(new Set((a || []).map(x => (typeof x === 'string' ? x : (x?.name || '')).trim()).filter(Boolean)))
    .sort((x, y) => x.localeCompare(y));

// Sentinel option-id for "rows with no owner". Real owner ids are emails, so a
// non-email token can never collide with one.
export const UNASSIGNED = '__unassigned__';

// Owners for the Owner facet: every salesperson, plus any owner that appears on
// a row but isn't in the directory (so no lead silently loses its owner chip).
function deriveOwners(salespersons, rows) {
  const byEmail = new Map();
  (salespersons || []).forEach(s => {
    const email = (s.email || '').trim();
    if (email) byEmail.set(email, s.name || email);
  });
  (rows || []).forEach(r => {
    const email = (r.assigned_to || '').trim();
    if (email && !byEmail.has(email)) byEmail.set(email, (r.assigned_name || '').trim() || email);
  });
  return Array.from(byEmail, ([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveFilterOptions({ contacts = [], leads = [], schools = [], sources = [], roles = [], tags = [], salespersons = [], dealTypes = [] } = {}) {
  return {
    sources: uniqSorted([...(sources || []).map(s => s.name || s), ...contacts.map(c => c.source), ...leads.map(l => l.source)]),
    roles: uniqSorted([...(roles || []).map(r => r.name || r), ...contacts.map(c => c.designation)]),
    school_types: uniqSorted(schools.map(s => s.school_type)),
    cities: uniqSorted(schools.map(s => s.city)),
    tags: (tags || []).map(t => ({ id: t.tag_id, name: t.name, color: t.color })),
    owners: deriveOwners(salespersons, [...schools, ...contacts, ...leads]),
    // Deal types: the master picklist plus any value actually seen on a lead, so
    // nothing is un-filterable.
    deal_types: uniqSorted([...(dealTypes || []).map(d => d.name || d), ...leads.map(l => l.deal_type)]),
    stages: STAGES,
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

// ── Tag roll-up (spec 2026-09-11, D1-D4) ─────────────────────────────────────
// Tags sit on people and deals, not schools, so a school matches a tag through
// its children. The rule is the backend's services/tag_scope.py, restated here
// over the loaded arrays:
//   D1  a contact matches only on its OWN tag_ids — never through its school
//   D2  a school matches if it, or any live contact or lead of it, is tagged
//   D3  a lead matches if it is tagged, or its school matches under D2
// Soft-deleted rows never match and never contribute, and a school_id with no
// live school behind it rolls nothing up. src/lib/__tests__/
// tagRollupAgreement.test.js runs the backend's fixture through this and must
// produce the resolver's exact sets.
//
// school_id -> Set of every tag id the school reaches under D2. Built ONCE per
// data change (callers memoise the context that holds it), so matching a row is
// a Map lookup — O(rows) per filter pass, not O(rows x children).
export function buildSchoolTagIndex({ schools = [], contacts = [], leads = [] } = {}) {
  const index = new Map();
  const addTags = (sid, tags) => {
    const ids = arr(tags);
    if (!ids.length) return;
    const set = index.get(sid);
    ids.forEach(t => set.add(t));
  };
  (schools || []).forEach(s => {
    if (!s || !s.school_id || s.is_deleted) return;
    if (!index.has(s.school_id)) index.set(s.school_id, new Set());
    addTags(s.school_id, s.tag_ids);
  });
  const addChild = (row) => {
    if (!row || row.is_deleted || !row.school_id || !index.has(row.school_id)) return;
    addTags(row.school_id, row.tag_ids);
  };
  (contacts || []).forEach(addChild);
  (leads || []).forEach(addChild);
  return index;
}

// `schoolTags` is the index above. Pass one already built (buildMasterContexts
// shares a single index across all three contexts); otherwise a school/lead
// context builds its own from the arrays given — and a lead context built
// WITHOUT `contacts` would silently miss every school surfaced by a tagged
// person, so production callers must go through buildMasterContexts. A contact
// context never needs it (D1), so none is built.
export function buildCrmContext(kind, { schools = [], leads = [], contacts = [], roles = [], schoolTags } = {}) {
  const schoolsById = {};
  schools.forEach(s => { schoolsById[s.school_id] = s; });
  const leadsBySchoolId = {};
  leads.forEach(l => { if (l.school_id) (leadsBySchoolId[l.school_id] = leadsBySchoolId[l.school_id] || []).push(l); });
  const contactsBySchoolId = {};
  contacts.forEach(c => { if (c.school_id) (contactsBySchoolId[c.school_id] = contactsBySchoolId[c.school_id] || []).push(c); });
  const rolesById = {};
  (roles || []).forEach(r => { rolesById[r.role_id] = r.name; });
  const tagIndex = schoolTags || (kind === 'contact' ? null : buildSchoolTagIndex({ schools, contacts, leads }));
  return { kind, schoolsById, leadsBySchoolId, contactsBySchoolId, rolesById, schoolTags: tagIndex };
}

// Does `row` (of `kind`) match ANY of `tags` under D1-D3?
export function matchesTagRollup(row, tags, kind, schoolTags) {
  if (!row || row.is_deleted) return false;
  const own = arr(row.tag_ids);
  if (tags.some(t => own.includes(t))) return true;
  if (kind === 'contact') return false;                  // D1: people never roll up
  const rolled = schoolTags && row.school_id ? schoolTags.get(row.school_id) : null;
  return !!rolled && tags.some(t => rolled.has(t));      // D2 school / D3 lead
}

const nonEmpty = (v) => arr(v).length > 0;

const hasDateRange = (f, key) => f[`${key}_from`] != null || f[`${key}_to`] != null;

export function hasActiveFilters(f) {
  if (!f) return false;
  return nonEmpty(f.sources) || nonEmpty(f.lead_stages) || nonEmpty(f.roles) ||
    nonEmpty(f.school_types) || nonEmpty(f.cities) || nonEmpty(f.tags) ||
    nonEmpty(f.owners) || nonEmpty(f.has) || nonEmpty(f.deal_types) || nonEmpty(f.lead_types) ||
    nonEmpty(f.account_status) ||
    f.min_strength != null || f.max_strength != null ||
    hasDateRange(f, 'import_date') || hasDateRange(f, 'assigned_date');
}

export function countActive(f) {
  if (!f) return 0;
  let n = 0;
  ['sources', 'lead_stages', 'roles', 'school_types', 'cities', 'tags', 'owners', 'has',
    'deal_types', 'lead_types', 'account_status'].forEach(k => { if (nonEmpty(f[k])) n++; });
  if (f.min_strength != null || f.max_strength != null) n++;
  if (hasDateRange(f, 'import_date')) n++;
  if (hasDateRange(f, 'assigned_date')) n++;
  return n;
}

// Row's `field` (an ISO datetime/date string, e.g. "2026-07-13T10:58:39+00:00"
// or plain "2026-07-13") is within the picked [from,to] date range (both plain
// "YYYY-MM-DD", inclusive). Only the date portion is compared, so a `to` bound
// still includes every row from that whole day. Absent range = no constraint;
// a range that IS set excludes rows with no date on that field at all.
function withinDateRange(row, field, filter) {
  const from = filter[`${field}_from`];
  const to = filter[`${field}_to`];
  if (from == null && to == null) return true;
  const raw = row[field];
  if (!raw) return false;
  const d = String(raw).slice(0, 10);
  if (from != null && d < from) return false;
  if (to != null && d > to) return false;
  return true;
}

export function matchesCrmFilter(row, filter, ctx) {
  if (!hasActiveFilters(filter)) return true;
  const { kind, schoolsById = {}, leadsBySchoolId = {}, contactsBySchoolId = {}, rolesById = {}, schoolTags = null } = ctx || {};
  const f = filter;

  if (nonEmpty(f.owners)) {
    const owner = (row.assigned_to || '').trim();
    const ok = f.owners.some(o => (o === UNASSIGNED ? !owner : o === owner));
    if (!ok) return false;
  }

  // import_date / assigned_date live on schools, contacts AND leads alike
  // (Phase 2 backend writes both on every entity), so no kind-branching needed.
  if (!withinDateRange(row, 'import_date', f)) return false;
  if (!withinDateRange(row, 'assigned_date', f)) return false;

  // `has: [...]` — field-presence checks (O21 `has:phone` / `has:email` search
  // operators). The phone/email field name differs per kind: leads store the
  // contact's phone/email under contact_phone/contact_email, not phone/email.
  if (nonEmpty(f.has)) {
    const phoneField = kind === 'lead' ? 'contact_phone' : 'phone';
    const emailField = kind === 'lead' ? 'contact_email' : 'email';
    for (const want of f.has) {
      if (want === 'phone' && !String(row[phoneField] || '').trim()) return false;
      if (want === 'email' && !String(row[emailField] || '').trim()) return false;
    }
  }

  // Source lives on leads/contacts. A school row has none, so roll up through
  // its children: match if ANY lead/contact under the school carries a wanted
  // source. (Rule: match the row's own field if present, else roll up.)
  if (nonEmpty(f.sources)) {
    const own = (row.source || '').trim();
    if (own) {
      if (!f.sources.includes(own)) return false;
    } else {
      const kids = [...(leadsBySchoolId[row.school_id] || []), ...(contactsBySchoolId[row.school_id] || [])];
      if (!kids.some(k => f.sources.includes((k.source || '').trim()))) return false;
    }
  }

  // Tags roll up: a school matches through its tagged people and deals, a lead
  // through its school — never a contact through its school (D1-D3 above).
  if (nonEmpty(f.tags) && !matchesTagRollup(row, f.tags, kind, schoolTags)) return false;

  if (nonEmpty(f.roles)) {
    const wanted = f.roles.map(r => r.toLowerCase());
    const cands = [(row.designation || '').toLowerCase(), (rolesById[row.contact_role_id] || '').toLowerCase()].filter(Boolean);
    if (!wanted.some(w => cands.includes(w))) return false;
  }

  if (nonEmpty(f.lead_stages)) {
    if (kind === 'lead') {
      if (!f.lead_stages.includes(row.stage)) return false;
    } else {
      const sl = leadsBySchoolId[row.school_id] || [];
      if (!sl.some(l => f.lead_stages.includes(l.stage))) return false;
    }
  }

  // What the ACCOUNT is — prospect / customer / dormant — derived from its
  // order history, not from any deal's stage. A school row carries it directly;
  // a lead or contact inherits it from the school it belongs to, so "dormant
  // customers" works on every tab. An unclassified row reads as a prospect,
  // because never having ordered is exactly what that means.
  if (nonEmpty(f.account_status)) {
    const own = (row.account_status || '').trim();
    const status = own || (schoolsById[row.school_id] || {}).account_status || 'prospect';
    if (!f.account_status.includes(status)) return false;
  }

  // Lead temperature (Hot/Warm/Cold) lives on leads. A school/contact row rolls
  // up through its leads exactly like lead_stages, so the page's "All Types"
  // dropdown means the same thing on every tab instead of only on Leads.
  if (nonEmpty(f.lead_types)) {
    if (kind === 'lead') {
      if (!f.lead_types.includes((row.lead_type || '').trim())) return false;
    } else {
      const sl = leadsBySchoolId[row.school_id] || [];
      if (!sl.some(l => f.lead_types.includes((l.lead_type || '').trim()))) return false;
    }
  }

  // Deal type lives on leads. For a school row, match if ANY lead under it has a
  // wanted deal type ("schools we sent a Sample / Reorder / New-Machine deal").
  if (nonEmpty(f.deal_types)) {
    if (kind === 'lead') {
      if (!f.deal_types.includes((row.deal_type || '').trim())) return false;
    } else {
      const sl = leadsBySchoolId[row.school_id] || [];
      if (!sl.some(l => f.deal_types.includes((l.deal_type || '').trim()))) return false;
    }
  }

  // School type: leads denormalize `school_type` onto the row itself, so match
  // the row's own value when it has one and only roll up to the school record
  // when it doesn't (same rule as `sources` above). Looking it up by id alone
  // dropped every lead whose school row wasn't loaded.
  if (nonEmpty(f.school_types)) {
    const own = (row.school_type || '').trim();
    if (own) {
      if (!f.school_types.includes(own)) return false;
    } else {
      const s = schoolsById[row.school_id];
      if (!s || !f.school_types.includes(s.school_type)) return false;
    }
  }

  const needsSchool = nonEmpty(f.cities) || f.min_strength != null || f.max_strength != null;
  if (needsSchool) {
    const school = schoolsById[row.school_id];
    if (!school) return false;
    if (nonEmpty(f.cities) && !f.cities.includes(school.city)) return false;
    const strength = Number(school.school_strength) || 0;
    if (f.min_strength != null && strength < f.min_strength) return false;
    if (f.max_strength != null && strength > f.max_strength) return false;
  }
  return true;
}

// Which single-select facet each option belongs to, for chip labels + the
// "Source: Web" prefix. Only the multi-value facets a chip can represent.
export const FACET_LABELS = {
  owners: 'Owner', cities: 'City', sources: 'Source',
  school_types: 'Type', roles: 'Role', lead_stages: 'Stage', tags: 'Tag',
  deal_types: 'Deal Type', lead_types: 'Lead Type', account_status: 'Account',
};

// Turn a free-text term into ranked "add this filter" suggestions. Pure: pass
// `countFor(facet, id) -> number` to attach live counts (zero-count dropped and
// results ranked by count desc), and `applied` (the current filter) to hide
// facet values already chosen. `term` under 2 chars yields nothing.
export function suggestFacets(term, options = {}, { countFor, applied } = {}) {
  const t = (term || '').trim().toLowerCase();
  if (t.length < 2) return [];
  const has = (facet, id) => nonEmpty(applied && applied[facet]) && applied[facet].includes(id);
  const cand = [];
  const add = (facet, id, label) => {
    if (id == null || has(facet, id)) return;
    const text = String(label || '');
    if (text.toLowerCase().includes(t)) cand.push({ facet, id, label: text });
  };
  (options.cities || []).forEach(c => add('cities', c, c));
  (options.sources || []).forEach(s => add('sources', s, s));
  (options.school_types || []).forEach(s => add('school_types', s, s));
  (options.roles || []).forEach(r => add('roles', r, r));
  (options.stages || []).forEach(s => add('lead_stages', s.id, s.label));
  (options.tags || []).forEach(tg => add('tags', tg.id, tg.name));
  (options.owners || []).forEach(o => add('owners', o.id, o.name));
  (options.deal_types || []).forEach(d => add('deal_types', d, d));

  let out = cand;
  if (countFor) {
    out = cand.map(s => ({ ...s, count: countFor(s.facet, s.id) })).filter(s => s.count > 0);
  }
  out.sort((a, b) => {
    if (a.count != null && b.count != null && a.count !== b.count) return b.count - a.count;
    const ap = a.label.toLowerCase().startsWith(t) ? 0 : 1;
    const bp = b.label.toLowerCase().startsWith(t) ? 0 : 1;
    return ap - bp || a.label.localeCompare(b.label);
  });
  return out.slice(0, 8);
}
