import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

/**
 * Generic row-selection helper for "select rows → delete selected" tables.
 *
 * @param {Array} items      current (possibly filtered) list of rows
 * @param {Function} getId   row -> stable id (default: r.id)
 * @param {Array} [allItems] the FULL universe of rows that exist, before any
 *                           filter is applied. Defaults to `items` — which
 *                           restores the original behaviour for callers that
 *                           don't pass it (see "Legacy callers" below).
 * Returns {
 *   selectedIds:Set, count, isSelected, toggle, toggleAll, allSelected, clear,
 *   hiddenCount, visibleIds
 * }
 *
 * Two different kinds of "not in `items`" are distinguished by `allItems`:
 *  - hidden by filter: the row still exists (it's in `allItems`) but the
 *    current filter doesn't match it. These ids stay selected — `hiddenCount`
 *    / the non-`visibleIds` portion of `selectedIds` — so a caller can show
 *    "N selected (M hidden by filter)" instead of silently losing them.
 *  - gone entirely: the row isn't in `allItems` either (deleted, or dropped
 *    by a refetch). These ids are pruned from the selection automatically —
 *    there's nothing left to act on, and nothing to warn the user is hidden.
 *
 * `toggleAll` selecting-all unions the current `items` into the set (hidden
 * selections untouched); deselecting-all removes only the current `items`,
 * leaving any hidden selection alone.
 *
 * `toggle(id, { shift })` — shift-click range select: selects every id
 * between the last-toggled id (the anchor) and `id`, in the order `items`
 * is currently in. Plain `toggle(id)` (no second argument) is unchanged.
 *
 * Legacy callers (ReceivingQC.js, Procurement.js, StockManagement.js) call
 * this with 2 arguments, so `allItems` defaults to `items` — meaning nothing
 * can ever be "hidden" (a row not in `items` is also not in `allItems`, so
 * it's pruned, not hidden) and unticking the header checkbox clears the
 * selection down to nothing, exactly like before this hook grew hidden-row
 * tracking.
 */
export default function useBulkSelect(items, getId = (r) => r.id, allItems = items) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const lastToggledId = useRef(null);

  const ids = useMemo(() => (items || []).map(getId), [items, getId]);
  const idSet = useMemo(() => new Set(ids), [ids]);

  const allIds = useMemo(() => (allItems || []).map(getId), [allItems, getId]);
  const allIdSet = useMemo(() => new Set(allIds), [allIds]);

  // Prune ids that no longer exist ANYWHERE (not even in allItems) — e.g. a
  // deletion, or a refetch that dropped a row. Guarded so it only ever
  // touches state when something actually needs pruning: returning the same
  // `prev` reference when nothing changed means React bails out of the
  // re-render, so this can't loop even though `allIdSet` may be a fresh
  // object every render for callers that don't memoize their item lists.
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (allIdSet.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [allIdSet]);

  const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id, opts) => {
    const shift = !!(opts && opts.shift);
    // Capture the anchor BEFORE scheduling the update and BEFORE overwriting
    // the ref: `setSelectedIds` queues its updater rather than running it
    // synchronously, so mutating `lastToggledId.current` first (even though
    // it's textually "after" this call) would make the updater see the just-
    // clicked id as its own anchor once React finally invokes it.
    const anchor = lastToggledId.current;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shift && anchor != null) {
        const anchorIdx = ids.indexOf(anchor);
        const clickedIdx = ids.indexOf(id);
        if (anchorIdx !== -1 && clickedIdx !== -1) {
          const from = Math.min(anchorIdx, clickedIdx);
          const to = Math.max(anchorIdx, clickedIdx);
          for (let i = from; i <= to; i++) next.add(ids[i]);
        } else {
          // Anchor (or the clicked row) isn't in the current list — nothing
          // sane to range over, so fall back to a plain toggle.
          next.has(id) ? next.delete(id) : next.add(id);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    lastToggledId.current = id;
  }, [ids]);

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

  const clear = useCallback(() => { setSelectedIds(new Set()); lastToggledId.current = null; }, []);

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
