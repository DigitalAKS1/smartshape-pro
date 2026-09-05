import { useMemo, useState } from 'react';
import { deriveFilterOptions } from '../lib/crmFilter';
import {
  buildMasterContexts, computeMasterFiltered, makeCountFor, tabKind,
  parseSearchQuery, mergeFilters,
} from '../lib/crmMasterFilter';

/**
 * One filter pipeline for the whole CRM page.
 *
 * Search box, left rail and the two dropdowns all end up in the same place, so
 * schools, contacts and leads are narrowed identically and a tab badge cannot
 * disagree with the rows underneath it. Pulled out of useLeadsCRM — which holds
 * 69 pieces of state across data loading, filtering, forms and dialogs — because
 * this part is pure derivation over the lists it is handed, and reasoning about
 * it should not require reading a lead form's validation.
 *
 * State lives here rather than being passed in: the rail's selections and the
 * search box are this pipeline's own inputs, and nothing outside sets them
 * except the controls that belong to it.
 */
export default function useCrmFilters({
  schoolsList = [], contactsList = [], leadsList = [],
  sourcesList = [], rolesList = [], tagsList = [], spList = [], dealTypesList = [],
  activeTab = 'schools',
} = {}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [masterFilter, setMasterFilter] = useState({});

  const filterOptions = useMemo(() => deriveFilterOptions({
    contacts: contactsList, leads: leadsList, schools: schoolsList,
    sources: sourcesList, roles: rolesList, tags: tagsList, salespersons: spList,
    dealTypes: dealTypesList,
  }), [contactsList, leadsList, schoolsList, sourcesList, rolesList, tagsList, spList, dealTypesList]);

  const masterContexts = useMemo(() => buildMasterContexts({
    schoolsList, leadsList, contactsList, rolesList,
  }), [schoolsList, leadsList, contactsList, rolesList]);

  // Gmail-style search: `owner:parul city:rohini hot` parses into real facet ids
  // plus residual free text. Parsed operators are merged with the rail's own
  // selections ONLY for matching — the rail's clickable state is never mutated
  // by typing, so deleting a word cannot silently un-tick a checkbox.
  const parsedQuery = useMemo(() => parseSearchQuery(searchTerm, filterOptions), [searchTerm, filterOptions]);

  // The "All Types" / "All Tags" dropdowns sit beside the search box, so they
  // have to mean the same thing on every tab. Expressing them as ordinary facets
  // is what makes that true; applied only to `filteredLeads`, they appeared to
  // do nothing everywhere else.
  const dropdownFilter = useMemo(() => {
    const f = {};
    if (filterType !== 'all') {
      if (['hot', 'warm', 'cold'].includes(filterType)) f.lead_types = [filterType];
      else f.school_types = [filterType];
    }
    if (filterTag) f.tags = [filterTag];
    return f;
  }, [filterType, filterTag]);

  const effectiveFilter = useMemo(
    () => mergeFilters(mergeFilters(masterFilter, parsedQuery.filter), dropdownFilter),
    [masterFilter, parsedQuery.filter, dropdownFilter]);

  const masterFiltered = useMemo(() => computeMasterFiltered({
    schoolsList, contactsList, leadsList, contexts: masterContexts,
    searchTerm: parsedQuery.text, masterFilter: effectiveFilter,
  }), [schoolsList, contactsList, leadsList, masterContexts, parsedQuery.text, effectiveFilter]);

  // "If this facet value were added, how many rows would remain" for the CURRENT
  // tab's entity — the rail's per-option counts and the search suggestions.
  const activeTabKind = tabKind(activeTab);
  const activeTabList = activeTabKind === 'school' ? schoolsList
    : activeTabKind === 'contact' ? contactsList : leadsList;
  const masterCountFor = useMemo(() => makeCountFor({
    kind: activeTabKind, list: activeTabList, ctx: masterContexts[activeTabKind],
    searchTerm: parsedQuery.text, masterFilter: effectiveFilter,
  }), [activeTabKind, activeTabList, masterContexts, parsedQuery.text, effectiveFilter]);

  // The type and tag dropdowns are already part of effectiveFilter, so this is
  // just the master-filtered pool — no second, leads-only copy of the same rules
  // that the other tabs never got.
  const filteredLeads = masterFiltered.leads;

  return {
    searchTerm, setSearchTerm,
    filterType, setFilterType,
    filterTag, setFilterTag,
    masterFilter, setMasterFilter,
    filterOptions, parsedQuery, effectiveFilter,
    masterFiltered, filteredLeads,
    masterCountFor, activeTabKind,
  };
}
