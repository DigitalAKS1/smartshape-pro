// Pure selection helpers for the Leads bulk bar.
//
// The Contacts table gets all of this from `useBulkSelect`, which owns its
// own Set. Leads can't simply switch to that hook: `selectedLeadIds` is one
// Set shared by the Leads list tab (rows filtered by the page's
// MultiFilterBar), the Pipeline tab's Kanban checkboxes (`filteredLeads`) and
// ReassignLeadDialog's onSuccess. So the Set stays in useLeadsCRM (via
// useLeadSelection) and these functions give it the same semantics as
// useBulkSelect:
//   - hidden-by-filter ids stay selected and are reported, never acted on;
//   - ids that no longer exist at all are pruned, not counted as hidden;
//   - the header checkbox adds/removes only the visible ids;
//   - shift-click selects the range between the last click and this one.
// Every function returns a NEW Set (or the same one when nothing changed)
// and never mutates its input, so it can be passed straight to a setState
// updater.

// The backend caps one bulk request at 2,000 ids (crm_routes.py
// _LEAD_BULK_CAP); the bar disables itself past this.
export const BULK_ID_CAP = 2000;

const asSet = (ids) => (ids instanceof Set ? ids : new Set(ids || []));

/**
 * Split a selection against the list the user is looking at.
 *
 * @param {Set}   selectedIds every selected id
 * @param {Array} visibleIds  ids in the current filtered/sorted list, in order
 * @param {Array|Set} [allIds] every id that still exists. When given, a
 *                    selected id missing from it is gone, not hidden, and is
 *                    left out of every count (the hook prunes it on its next
 *                    effect run; this keeps the bar honest in between).
 * @returns {{visible: string[], hiddenCount: number, total: number}}
 *   `visible` holds the selected ids that are visible, in list order. It is
 *   exactly what a bulk action should send.
 */
export function splitSelection(selectedIds, visibleIds, allIds) {
  const sel = selectedIds || new Set();
  const visible = (visibleIds || []).filter((id) => sel.has(id));
  const visibleSet = new Set(visible);
  const all = allIds ? asSet(allIds) : null;
  let hiddenCount = 0;
  sel.forEach((id) => {
    if (visibleSet.has(id)) return;
    if (all && !all.has(id)) return; // gone, not hidden
    hiddenCount += 1;
  });
  return { visible, hiddenCount, total: visible.length + hiddenCount };
}

/** Header-checkbox state: every visible row is selected (and there is at least one). */
export function allVisibleSelected(selectedIds, visibleIds) {
  const ids = visibleIds || [];
  return ids.length > 0 && ids.every((id) => selectedIds.has(id));
}

/**
 * Header checkbox click. When every visible row is already selected, unticking
 * removes ONLY the visible ids. Anything hidden by the filter stays selected,
 * where the old `setSelectedLeadIds(new Set())` wiped it. Otherwise the
 * visible ids are unioned in.
 */
export function toggleAllVisible(selectedIds, visibleIds) {
  const ids = visibleIds || [];
  const next = new Set(selectedIds);
  if (allVisibleSelected(selectedIds, ids)) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/**
 * Row checkbox click. A plain click flips `id`. A shift-click with a known
 * anchor adds every id between the anchor and `id`, in `orderedIds` order,
 * matching useBulkSelect's `toggle(id, { shift })`. If either end isn't in
 * `orderedIds` it falls back to a plain flip.
 */
export function toggleWithRange(selectedIds, id, { shift = false, orderedIds = null, anchorId = null } = {}) {
  const next = new Set(selectedIds);
  if (shift && anchorId != null && Array.isArray(orderedIds)) {
    const a = orderedIds.indexOf(anchorId);
    const b = orderedIds.indexOf(id);
    if (a !== -1 && b !== -1) {
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(orderedIds[i]);
      return next;
    }
  }
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/**
 * Drop selected ids that no longer exist anywhere (deleted, or gone after a
 * refetch). Returns the SAME Set when nothing was pruned, so a setState
 * updater built on it bails out instead of re-rendering in a loop.
 */
export function pruneSelection(selectedIds, allIds) {
  const all = asSet(allIds);
  let changed = false;
  const next = new Set();
  selectedIds.forEach((id) => {
    if (all.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selectedIds;
}
