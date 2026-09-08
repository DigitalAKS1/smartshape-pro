import { useState, useEffect } from 'react';
import { leads as leadsApi } from '../lib/api';

/**
 * useLeadsData
 *
 * Focused data-loading hook, extracted from the 803-line useLeadsCRM. Talks to
 * the paginated GET /leads endpoint (routes/crm_routes.py get_leads) and owns
 * nothing about filter UI state or pagination-control state — just "given a
 * page/limit/filters, what did the server say".
 *
 * axios (lib/api.js) resolves with the raw response, so the payload lives at
 * res.data — same convention as every other hook in this codebase (see
 * useCrmData.js). The backend's paginated envelope is
 * {leads, total, page, pages, limit, facets}; array/object fields are
 * defensively defaulted so a malformed/empty response never crashes a caller
 * that does leads.map(...) or Object.entries(facets).
 *
 * @param {number} page - 1-indexed page number
 * @param {number} limit - page size
 * @param {{stage?, owner?, tag?, search?, sort?}} filters - server-side filter params
 * @returns {{leads: Array, total: number, facets: Object, loading: boolean, error: string|null}}
 */
export function useLeadsData(page = 1, limit = 50, filters = {}) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stable string key so an inline `{}` literal passed by the caller on every
  // render doesn't re-trigger the fetch — only an actual change in filter
  // values should.
  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    let cancelled = false;

    const fetchLeads = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await leadsApi.list({ ...filters, page, limit });
        if (cancelled) return;
        const data = res?.data || {};
        setLeads(Array.isArray(data.leads) ? data.leads : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setFacets(data.facets && typeof data.facets === 'object' ? data.facets : {});
      } catch (err) {
        if (cancelled) return;
        setError(err?.response?.data?.detail || err?.message || 'Failed to load leads');
        setLeads([]);
        setTotal(0);
        setFacets({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLeads();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, filtersKey]);

  return { leads, total, facets, loading, error };
}

export default useLeadsData;
