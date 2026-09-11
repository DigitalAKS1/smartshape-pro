import { useState, useRef, useEffect, useCallback } from 'react';
import { toggleWithRange, pruneSelection } from '../lib/leadSelection';

/**
 * The lead-row selection shared by the Leads list tab, the Pipeline tab's
 * Kanban checkboxes and ReassignLeadDialog. It lives here, not in
 * `useBulkSelect`, because it serves more than one list: each view passes
 * its own visible ids to the bar (see lib/leadSelection.js).
 *
 * @param {Array}  leadsList every lead that exists. A selected id that
 *                           disappears from it (deleted, or dropped by a
 *                           refetch) is pruned.
 * @param {string} activeTab the page's tab. Changing it clears the selection,
 *                           so nothing carries over between the Leads,
 *                           Pipeline, Contacts and Schools tabs.
 *
 * Returns `selectedLeadIds` / `setSelectedLeadIds` (same contract as before
 * this hook existed), `toggleLeadSelect(id, { shift, orderedIds })` (plain
 * `toggleLeadSelect(id)` still flips one row, as the Kanban calls it), and
 * `clearLeadSelection()`, which also forgets the shift-click anchor.
 */
export default function useLeadSelection(leadsList, activeTab) {
  const [selectedLeadIds, setSelectedLeadIds] = useState(() => new Set());
  const anchorRef = useRef(null);

  const toggleLeadSelect = useCallback((id, opts = {}) => {
    // Read the anchor before the (deferred) updater runs and before it's
    // overwritten, or the updater would see this click as its own anchor.
    const anchorId = anchorRef.current;
    setSelectedLeadIds((prev) => toggleWithRange(prev, id, { ...opts, anchorId }));
    anchorRef.current = id;
  }, []);

  const clearLeadSelection = useCallback(() => {
    setSelectedLeadIds((prev) => (prev.size ? new Set() : prev));
    anchorRef.current = null;
  }, []);

  // Tab change clears the selection. Returning `prev` when it's already empty
  // skips the extra render on mount.
  useEffect(() => { clearLeadSelection(); }, [activeTab, clearLeadSelection]);

  // Prune ids that no longer exist. `pruneSelection` hands back the same Set
  // when nothing changed, so this can't loop.
  useEffect(() => {
    const all = new Set((leadsList || []).map((l) => l.lead_id));
    setSelectedLeadIds((prev) => pruneSelection(prev, all));
  }, [leadsList]);

  return { selectedLeadIds, setSelectedLeadIds, toggleLeadSelect, clearLeadSelection };
}
