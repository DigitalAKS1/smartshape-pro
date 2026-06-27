import { useState, useMemo, useCallback } from 'react';

/**
 * Generic row-selection helper for "select rows → delete selected" tables.
 *
 * @param {Array} items     current list of rows
 * @param {Function} getId  row -> stable id (default: r.id)
 * Returns { selectedIds:Set, count, isSelected, toggle, toggleAll, allSelected, clear }
 */
export default function useBulkSelect(items, getId = (r) => r.id) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const ids = useMemo(() => (items || []).map(getId), [items, getId]);

  const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const everySelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return everySelected ? new Set() : new Set(ids);
    });
  }, [ids]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, count: selectedIds.size, isSelected, toggle, toggleAll, allSelected, clear };
}
