import { useState, useMemo, useCallback } from 'react';

/**
 * Generic row-selection helper for "select rows → delete selected" tables.
 *
 * @param {Array} items     current list of rows
 * @param {Function} getId  row -> stable id (default: r.id)
 * Returns {
 *   selectedIds:Set, count, isSelected, toggle, toggleAll, allSelected, clear,
 *   hiddenCount, visibleIds
 * }
 *
 * `selectedIds` is never pruned when `items` shrinks (e.g. a filter hides
 * some previously-selected rows) — those ids simply stop being "visible".
 * `hiddenCount` / `visibleIds` let a caller show "N selected (M hidden by
 * filter)" and restrict bulk actions to what the user can currently see,
 * without discarding the rest of the selection. `toggleAll` follows suit:
 * selecting-all unions the current `items` into the set (hidden selections
 * untouched); deselecting-all removes only the current `items`, leaving any
 * hidden selection alone.
 */
export default function useBulkSelect(items, getId = (r) => r.id) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const ids = useMemo(() => (items || []).map(getId), [items, getId]);
  const idSet = useMemo(() => new Set(ids), [ids]);

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
      const next = new Set(prev);
      if (everySelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [ids]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const visibleIds = useMemo(
    () => Array.from(selectedIds).filter((id) => idSet.has(id)),
    [selectedIds, idSet],
  );
  const hiddenCount = selectedIds.size - visibleIds.length;

  return {
    selectedIds, count: selectedIds.size, isSelected, toggle, toggleAll, allSelected, clear,
    hiddenCount, visibleIds,
  };
}
