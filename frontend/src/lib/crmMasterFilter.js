// Master-filter glue for the CRM Leads page (Phase 1, O1-O17 spec).
//
// Deliberately thin: all matching/derivation logic lives in the already-shipped
// `crmFilter.js` engine (buildCrmContext / matchesCrmFilter / deriveFilterOptions).
// This module only adds the two things the rail + global search need on top of
// that engine, without touching it:
//   1. a global text-search predicate that mirrors the per-tab search fields
//      that already existed (school/contact/lead), so one search box can drive
//      all three tabs identically (O16).
//   2. `computeMasterFiltered` / `makeCountFor` — pure, framework-free so they
//      are unit-testable without mounting the hook or any component. These are
//      literally what feeds the `masterFiltered.{schools,contacts,leads}.length`
//      numbers that the LeadsCRM tab badges render (O5, honest counts).
import { buildCrmContext, matchesCrmFilter, UNASSIGNED, FACET_LABELS } from './crmFilter';

const norm = (v) => (v == null ? '' : String(v)).toLowerCase();

// Text fields searched per entity kind. Mirrors the field lists that were
// already hard-coded per-tab (LeadsCRM `filteredLeads`, ContactsTab, Schools
// tab) before this module existed — global search must not regress any of
// those matches.
export function matchesGlobalSearch(row, kind, term) {
  const s = norm(term).trim();
  if (!s) return true;
  if (kind === 'school') {
    return [row.school_name, row.email, row.city, row.phone, row.primary_contact_name]
      .some((v) => norm(v).includes(s));
  }
  if (kind === 'contact') {
    return [row.name, row.phone, row.company, row.email].some((v) => norm(v).includes(s));
  }
  // lead
  return [row.company_name, row.contact_name, row.contact_phone, row.school_city]
    .some((v) => norm(v).includes(s));
}

// One buildCrmContext() per entity kind, memoized by the caller (useLeadsCRM).
export function buildMasterContexts({ schoolsList = [], leadsList = [], contactsList = [], rolesList = [] } = {}) {
  return {
    school: buildCrmContext('school', { schools: schoolsList, leads: leadsList, contacts: contactsList, roles: rolesList }),
    contact: buildCrmContext('contact', { schools: schoolsList, leads: leadsList, roles: rolesList }),
    lead: buildCrmContext('lead', { schools: schoolsList, leads: leadsList, roles: rolesList }),
  };
}

// The master-filtered {schools, contacts, leads} — search AND master filter,
// applied identically across all three entity types (O4, O17).
export function computeMasterFiltered({ schoolsList = [], contactsList = [], leadsList = [], contexts, searchTerm = '', masterFilter = {} } = {}) {
  const pass = (row, kind) => matchesGlobalSearch(row, kind, searchTerm) && matchesCrmFilter(row, masterFilter, contexts[kind]);
  return {
    schools: schoolsList.filter((r) => pass(r, 'school')),
    contacts: contactsList.filter((r) => pass(r, 'contact')),
    leads: leadsList.filter((r) => pass(r, 'lead')),
  };
}

// Builds a `countFor(facet, id)` closure answering: "if this facet value were
// ADDED to the current master filter, how many rows of `list` (the current
// tab's entity type) would remain?" Used by FilterRail for live per-option
// counts (O5) and by the search-suggestion row for its trailing count (O3).
export function makeCountFor({ kind, list = [], ctx, searchTerm = '', masterFilter = {} } = {}) {
  return (facet, id) => {
    const cur = masterFilter[facet] || [];
    const next = cur.includes(id) ? cur : [...cur, id];
    const testFilter = { ...masterFilter, [facet]: next };
    return list.filter((r) => matchesGlobalSearch(r, kind, searchTerm) && matchesCrmFilter(r, testFilter, ctx)).length;
  };
}

// Which entity kind a CRM tab is "about", for the rail's honest N-of-M header
// and its live counts. Tabs with no single entity (tasks/reports) fall back
// to leads — the most complete of the three lists.
export function tabKind(activeTab) {
  if (activeTab === 'schools') return 'school';
  if (activeTab === 'contacts') return 'contact';
  return 'lead';
}

// ── O21: Gmail-style search query language ──────────────────────────────────
//
// `owner:parul city:"New Delhi" hot leads` -> operators become real facet ids
// (case-insensitive, resolved against the live options — never raw strings the
// engine wouldn't recognize), residual words stay as free text for
// matchesGlobalSearch. Kept pure/framework-free like the rest of this module.

// operator key -> masterFilter facet key (array-valued, matches crmFilter.js).
const OPERATOR_FACET = {
  owner: 'owners', city: 'cities', source: 'sources', type: 'school_types',
  stage: 'lead_stages', tag: 'tags',
};

function resolveOperatorValue(key, rawVal, options) {
  const v = rawVal.toLowerCase();
  if (key === 'owner') {
    const hit = (options.owners || []).find((o) => o.name.toLowerCase() === v || o.id.toLowerCase() === v);
    return hit ? hit.id : null;
  }
  if (key === 'city') return (options.cities || []).find((c) => c.toLowerCase() === v) ?? null;
  if (key === 'source') return (options.sources || []).find((s) => s.toLowerCase() === v) ?? null;
  if (key === 'type') return (options.school_types || []).find((t) => t.toLowerCase() === v) ?? null;
  if (key === 'stage') {
    const hit = (options.stages || []).find((s) => s.id.toLowerCase() === v || s.label.toLowerCase() === v);
    return hit ? hit.id : null;
  }
  if (key === 'tag') {
    const hit = (options.tags || []).find((t) => t.name.toLowerCase() === v);
    return hit ? hit.id : null;
  }
  if (key === 'has') return ['phone', 'email'].includes(v) ? v : null;
  if (key === 'is') return v === 'unassigned' ? UNASSIGNED : null;
  return null; // unrecognized operator key
}

// key:"quoted value" | key:bareValue | "quoted phrase" | bareWord
const TOKEN_RE = /([a-zA-Z]+):"([^"]*)"|([a-zA-Z]+):(\S+)|"([^"]*)"|(\S+)/g;

/**
 * Parse a raw search-box string into structured facets + residual free text.
 * Supported operators: owner: city: source: type: stage: tag: has: is:
 * Quote multi-word values: `owner:"Parul Kanchan"`. An unrecognized operator
 * key, or a recognized one whose value doesn't resolve to a real option
 * (typos), falls back to free text — a typo returns "no matches on this
 * word" instead of silently zeroing the whole result set forever.
 * @returns {{filter: object, text: string}}
 */
export function parseSearchQuery(term, options = {}) {
  const raw = String(term || '');
  const filter = {};
  const words = [];
  const pushFacet = (facetKey, id) => {
    filter[facetKey] = filter[facetKey] || [];
    if (!filter[facetKey].includes(id)) filter[facetKey].push(id);
  };

  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(raw)) !== null) {
    const [, qKey, qVal, bKey, bVal, quotedPhrase, bareWord] = m;
    const key = (qKey || bKey || '').toLowerCase();
    const val = qVal !== undefined ? qVal : bVal;

    if (quotedPhrase !== undefined) { if (quotedPhrase.trim()) words.push(quotedPhrase); continue; }
    if (bareWord !== undefined) { words.push(bareWord); continue; }

    const resolved = resolveOperatorValue(key, val, options);
    if (resolved == null) { words.push(`${key}:${val}`); continue; } // unresolved -> free text

    const facetKey = key === 'has' || key === 'is' ? (key === 'is' ? 'owners' : 'has') : OPERATOR_FACET[key];
    pushFacet(facetKey, resolved);
  }

  return { filter, text: words.join(' ').trim() };
}

// Combine the FilterRail's clicked-in `masterFilter` with a query's parsed
// operator filter — union array-valued facets so e.g. `owner:parul` typed
// into search and an Owner checkbox both apply (OR-within is already how the
// engine treats a facet's own array). Rail state itself is left untouched;
// callers merge only for matching/counting (see useLeadsCRM).
export function mergeFilters(a = {}, b = {}) {
  const out = { ...a };
  Object.keys(b).forEach((key) => {
    const bv = b[key];
    if (Array.isArray(bv)) {
      const av = Array.isArray(out[key]) ? out[key] : [];
      out[key] = Array.from(new Set([...av, ...bv]));
    } else if (bv !== undefined) {
      out[key] = bv;
    }
  });
  return out;
}

const QUERY_FACET_LABELS = { ...FACET_LABELS, has: 'Has' };

// Human-readable chips for "here's what your search query applied" (O21 —
// visible feedback for the parsed operators). Pure/presentational data only;
// mirrors FilterRail's own chip formatting for a consistent look.
export function describeParsedFilter(filter = {}, options = {}) {
  const nameFor = (facet, id) => {
    if (facet === 'owners') return id === UNASSIGNED ? 'Unassigned' : (options.owners || []).find((o) => o.id === id)?.name || id;
    if (facet === 'tags') return (options.tags || []).find((t) => t.id === id)?.name || id;
    if (facet === 'lead_stages') return (options.stages || []).find((s) => s.id === id)?.label || id;
    return id;
  };
  const chips = [];
  Object.keys(QUERY_FACET_LABELS).forEach((facet) => {
    (filter[facet] || []).forEach((id) => chips.push({ facet, id, label: `${QUERY_FACET_LABELS[facet]}: ${nameFor(facet, id)}` }));
  });
  return chips;
}
