import React from 'react';
import { UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useTheme } from '../../contexts/ThemeContext';
import { leads as leadsApi } from '../../lib/api';
import { settableStages } from '../../lib/crmConstants';
import { splitSelection, BULK_ID_CAP } from '../../lib/leadSelection';

/**
 * Bulk-action bar for lead rows. The Leads list tab and the Pipeline tab both
 * render this one component, so the two can't drift apart.
 *
 * Looks and behaves like the Contacts bulk bar (ContactsTab.js):
 *   - "N selected (M hidden by filter)" plus Clear. N and M ignore ids that
 *     no longer exist (`allIds`).
 *   - every action sends ONLY the selected ids that are visible, meaning
 *     present in `visibleIds`, the list on screen. Hidden selections stay
 *     selected but are never acted on out of sight.
 *   - past 2,000 visible ids the controls are disabled and a cap note shows,
 *     rather than letting the server 400.
 *   - on success: toast `updated` (plus `skipped` when non-zero, for a scoped
 *     rep who selected leads they can't reach), refetch, clear. On error:
 *     toast, and the selection is kept for a retry.
 *
 * Reassign (admin only) opens ReassignLeadDialog through `onReassign(ids)`.
 * That dialog is the confirmation step (pick an agent, give a mandatory
 * reason, press Reassign), and it clears and refetches on success.
 *
 * Props:
 *   selectedIds  Set of every selected lead_id (shared with the Kanban)
 *   visibleIds   lead_ids of the list on screen, in display order
 *   allIds       lead_ids that still exist (optional; for pruning)
 *   tagsList     [{tag_id, name}]
 *   isAdmin      shows Reassign
 *   onReassign   (ids) => void
 *   onClear      () => void, empties the whole selection (hidden included)
 *   onDone       () => void, refetch after a successful action
 */
export default function LeadsBulkBar({
  selectedIds, visibleIds, allIds,
  tagsList = [], isAdmin = false,
  onReassign, onClear, onDone,
}) {
  const { isDark } = useTheme();
  const [busy, setBusy] = React.useState(false);

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const { visible, hiddenCount, total } = splitSelection(selectedIds, visibleIds, allIds);
  // Shown whenever anything is selected, even if the filter now hides all of
  // it, so the user can still see the hidden count and clear it.
  if (total === 0) return null;

  const overCap = visible.length > BULK_ID_CAP;
  const disabled = busy || overCap;

  const finish = () => { if (onDone) onDone(); if (onClear) onClear(); };
  const skippedNote = (skipped) => (skipped ? ` (${skipped} skipped)` : '');

  const bulkTag = async (tagId, action) => {
    if (!tagId || visible.length === 0 || overCap) return;
    const tagName = tagsList.find(t => t.tag_id === tagId)?.name || 'tag';
    setBusy(true);
    try {
      const res = await leadsApi.bulkTag({ lead_ids: visible, tag_id: tagId, action });
      const d = res?.data || {};
      const updated = d.updated ?? d.modified ?? 0;
      const verb = action === 'remove' ? 'Removed tag from' : 'Tagged';
      toast.success(`${verb} ${updated} lead(s) — “${tagName}”${skippedNote(d.skipped)}`);
      finish();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Bulk tag failed');
    } finally {
      setBusy(false);
    }
  };

  const bulkStage = async (stage) => {
    if (!stage || visible.length === 0 || overCap) return;
    if (!window.confirm(`Move ${visible.length} lead(s) to stage "${stage}"?`)) return;
    setBusy(true);
    try {
      const res = await leadsApi.bulkStage({ lead_ids: visible, stage });
      const d = res?.data || {};
      const updated = d.updated ?? d.modified ?? 0;
      toast.success(`${updated} lead(s) moved to ${stage}${skippedNote(d.skipped)}`);
      finish();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Bulk stage change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} border rounded-md p-2.5 flex items-center gap-2 flex-wrap`} data-testid="bulk-actions-bar">
      <span className={`text-xs font-medium ${textPri}`} data-testid="leads-bulk-count">
        {total} selected{hiddenCount > 0 ? ` (${hiddenCount} hidden by filter)` : ''}
      </span>
      {overCap && (
        <span className="text-[11px] text-red-400 font-medium" data-testid="leads-bulk-cap-note">
          Max 2,000 at a time — narrow the filter
        </span>
      )}
      {isAdmin && (
        <Button size="sm" disabled={disabled || visible.length === 0}
          onClick={() => { if (onReassign && visible.length > 0 && !overCap) onReassign(visible); }}
          className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid="bulk-reassign-btn">
          <UserCog className="mr-1 h-3 w-3" /> Reassign
        </Button>
      )}
      <select defaultValue="" disabled={disabled} className={`h-8 px-2 rounded text-xs ${inputCls} cursor-pointer`} data-testid="leads-bulk-tag-add"
        onChange={async e => { const v = e.target.value; e.target.value = ''; await bulkTag(v, 'add'); }}>
        <option value="">Add tag…</option>
        {tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
      </select>
      <select defaultValue="" disabled={disabled} className={`h-8 px-2 rounded text-xs ${inputCls} cursor-pointer`} data-testid="leads-bulk-tag-remove"
        onChange={async e => { const v = e.target.value; e.target.value = ''; await bulkTag(v, 'remove'); }}>
        <option value="">Remove tag…</option>
        {tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
      </select>
      <select defaultValue="" disabled={disabled} className={`h-8 px-2 rounded text-xs ${inputCls} cursor-pointer`} data-testid="leads-bulk-stage"
        onChange={async e => { const v = e.target.value; e.target.value = ''; await bulkStage(v); }}>
        <option value="">Move to Stage</option>
        {/* Live stages only. A bulk move has no single current stage to make
            an exception for, and nothing should move INTO a retired one. */}
        {settableStages().map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => { if (onClear) onClear(); }}
        className={`border-[var(--border-color)] ${textSec} h-8`} data-testid="leads-bulk-clear">Clear</Button>
    </div>
  );
}
