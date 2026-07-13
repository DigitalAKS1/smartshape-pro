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

export function deriveFilterOptions({ contacts = [], leads = [], schools = [], sources = [], roles = [], tags = [], salespersons = [] } = {}) {
  return {
    sources: uniqSorted([...(sources || []).map(s => s.name || s), ...contacts.map(c => c.source), ...leads.map(l => l.source)]),
    roles: uniqSorted([...(roles || []).map(r => r.name || r), ...contacts.map(c => c.designation)]),
    school_types: uniqSorted(schools.map(s => s.school_type)),
    cities: uniqSorted(schools.map(s => s.city)),
    tags: (tags || []).map(t => ({ id: t.tag_id, name: t.name, color: t.color })),
    owners: deriveOwners(salespersons, [...schools, ...contacts, ...leads]),
    stages: STAGES,
  };
}

export function buildCrmContext(kind, { schools = [], leads = [], contacts = [], roles = [] } = {}) {
  const schoolsById = {};
  schools.forEach(s => { schoolsById[s.school_id] = s; });
  const leadsBySchoolId = {};
  leads.forEach(l => { if (l.school_id) (leadsBySchoolId[l.school_id] = leadsBySchoolId[l.school_id] || []).push(l); });
  const contactsBySchoolId = {};
  contacts.forEach(c => { if (c.school_id) (contactsBySchoolId[c.school_id] = contactsBySchoolId[c.school_id] || []).push(c); });
  const rolesById = {};
  (roles || []).forEach(r => { rolesById[r.role_id] = r.name; });
  return { kind, schoolsById, leadsBySchoolId, contactsBySchoolId, rolesById };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const nonEmpty = (v) => arr(v).length > 0;

export function hasActiveFilters(f) {
  if (!f) return false;
  return nonEmpty(f.sources) || nonEmpty(f.lead_stages) || nonEmpty(f.roles) ||
    nonEmpty(f.school_types) || nonEmpty(f.cities) || nonEmpty(f.tags) ||
    nonEmpty(f.owners) || f.min_strength != null || f.max_strength != null;
}

export function countActive(f) {
  if (!f) return 0;
  let n = 0;
  ['sources', 'lead_stages', 'roles', 'school_types', 'cities', 'tags', 'owners'].forEach(k => { if (nonEmpty(f[k])) n++; });
  if (f.min_strength != null || f.max_strength != null) n++;
  return n;
}

export function matchesCrmFilter(row, filter, ctx) {
  if (!hasActiveFilters(filter)) return true;
  const { kind, schoolsById = {}, leadsBySchoolId = {}, contactsBySchoolId = {}, rolesById = {} } = ctx || {};
  const f = filter;

  if (nonEmpty(f.owners)) {
    const owner = (row.assigned_to || '').trim();
    const ok = f.owners.some(o => (o === UNASSIGNED ? !owner : o === owner));
    if (!ok) return false;
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

  if (nonEmpty(f.tags)) {
    const rowTags = arr(row.tag_ids).length ? arr(row.tag_ids) : arr(row.tags);
    if (!f.tags.some(t => rowTags.includes(t))) return false;
  }

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

  const needsSchool = nonEmpty(f.school_types) || nonEmpty(f.cities) || f.min_strength != null || f.max_strength != null;
  if (needsSchool) {
    const school = schoolsById[row.school_id];
    if (!school) return false;
    if (nonEmpty(f.school_types) && !f.school_types.includes(school.school_type)) return false;
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
