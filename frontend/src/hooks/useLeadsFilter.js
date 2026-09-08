import { useState, useCallback } from 'react';

const DEFAULT_FILTERS = {
  stage: null,
  owner: null,
  tag: null,
  search: '',
};

/**
 * useLeadsFilter
 *
 * Focused hook for filter UI state, extracted from useLeadsCRM. Manages the
 * four filter values (stage, owner, tag, search) that drive the leads list —
 * separate from data loading (useCrmData) and pagination (useLeadsPagination).
 * Purely local state; has no knowledge of the lists being filtered.
 *
 * @param {object} initialFilters - partial overrides merged over the defaults
 * @returns {{filters: object, updateFilter: (key:string, value:any)=>void, clearFilters: ()=>void}}
 */
export function useLeadsFilter(initialFilters = {}) {
  const [filters, setFilters] = useState({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, []);

  return { filters, updateFilter, clearFilters };
}
