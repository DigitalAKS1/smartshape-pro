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
import { buildCrmContext, matchesCrmFilter } from './crmFilter';

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
