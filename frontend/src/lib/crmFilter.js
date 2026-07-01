export const STAGES = [
  { id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' },
  { id: 'demo', label: 'Demo' }, { id: 'negotiation', label: 'Negotiation' },
  { id: 'quoted', label: 'Quoted' }, { id: 'follow_up', label: 'Follow Up' },
  { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
];

const uniqSorted = (a) =>
  Array.from(new Set((a || []).map(x => (typeof x === 'string' ? x : (x?.name || '')).trim()).filter(Boolean)))
    .sort((x, y) => x.localeCompare(y));

export function deriveFilterOptions({ contacts = [], leads = [], schools = [], sources = [], roles = [], tags = [] } = {}) {
  return {
    sources: uniqSorted([...(sources || []).map(s => s.name || s), ...contacts.map(c => c.source), ...leads.map(l => l.source)]),
    roles: uniqSorted([...(roles || []).map(r => r.name || r), ...contacts.map(c => c.designation)]),
    school_types: uniqSorted(schools.map(s => s.school_type)),
    cities: uniqSorted(schools.map(s => s.city)),
    tags: (tags || []).map(t => ({ id: t.tag_id, name: t.name, color: t.color })),
    stages: STAGES,
  };
}

export function buildCrmContext(kind, { schools = [], leads = [], roles = [] } = {}) {
  const schoolsById = {};
  schools.forEach(s => { schoolsById[s.school_id] = s; });
  const leadsBySchoolId = {};
  leads.forEach(l => { if (l.school_id) (leadsBySchoolId[l.school_id] = leadsBySchoolId[l.school_id] || []).push(l); });
  const rolesById = {};
  (roles || []).forEach(r => { rolesById[r.role_id] = r.name; });
  return { kind, schoolsById, leadsBySchoolId, rolesById };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const nonEmpty = (v) => arr(v).length > 0;

export function hasActiveFilters(f) {
  if (!f) return false;
  return nonEmpty(f.sources) || nonEmpty(f.lead_stages) || nonEmpty(f.roles) ||
    nonEmpty(f.school_types) || nonEmpty(f.cities) || nonEmpty(f.tags) ||
    f.min_strength != null || f.max_strength != null;
}

export function countActive(f) {
  if (!f) return 0;
  let n = 0;
  ['sources', 'lead_stages', 'roles', 'school_types', 'cities', 'tags'].forEach(k => { if (nonEmpty(f[k])) n++; });
  if (f.min_strength != null || f.max_strength != null) n++;
  return n;
}

export function matchesCrmFilter(row, filter, ctx) {
  if (!hasActiveFilters(filter)) return true;
  const { kind, schoolsById = {}, leadsBySchoolId = {}, rolesById = {} } = ctx || {};
  const f = filter;

  if (nonEmpty(f.sources) && !f.sources.includes((row.source || '').trim())) return false;

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
