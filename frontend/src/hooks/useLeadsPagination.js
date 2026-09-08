import { useState } from 'react';

/**
 * useLeadsPagination
 *
 * Focused hook for page-navigation UI state, extracted from useLeadsCRM.
 * Purely local (1-indexed) state — has no knowledge of backend pagination,
 * total counts, or data loading. Callers pass totalPages into nextPage()
 * when they want the "cannot advance past last page" bound enforced.
 *
 * @param {number} initialPage - starting page (default 1)
 * @returns {{page: number, setPage: (n:number)=>void, nextPage: (totalPages:number)=>void, prevPage: () => void}}
 */
export function useLeadsPagination(initialPage = 1) {
  const [page, setPageState] = useState(initialPage);

  const setPage = (newPage) => {
    setPageState(Math.max(1, newPage));
  };

  const nextPage = (totalPages) => {
    setPageState((prev) => Math.min(prev + 1, totalPages));
  };

  const prevPage = () => {
    setPageState((prev) => Math.max(prev - 1, 1));
  };

  return { page, setPage, nextPage, prevPage };
}
