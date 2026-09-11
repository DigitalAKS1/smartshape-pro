import React from 'react';
import { Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useTheme } from '../../contexts/ThemeContext';
import { schools as schoolsApi } from '../../lib/api';
import { BULK_ID_CAP } from '../../lib/leadSelection';
import AssignToPicker from './AssignToPicker';
import BulkTagPicker, { formatTagResult } from './BulkTagPicker';

/**
 * Bulk-action bar for the Schools tab — same shape as the Contacts and Leads
 * bars:
 *   - "N selected (M hidden by filter)" plus Clear;
 *   - every action works on `visibleIds` ONLY (the selected schools the
 *     current filter still shows) — hidden selections are never acted on
 *     out of sight;
 *   - past 2,000 visible ids the actions disable and a cap note shows,
 *     rather than letting the server 400.
 *
 * Tagging goes through BulkTagPicker (several tags, or a new one, in one
 * step). Its extra slot carries "Also tag their contacts (N) and leads (M)":
 * OFF by default, because a school label ("CBSE") usually belongs on the
 * school alone, while a campaign tag belongs on everyone there. N and M are
 * counted from the loaded lists (deleted records excluded) at the visible
 * selected schools; the server re-scopes, so for a rep the real numbers come
 * back in the toast.
 *
 * Tagging is handled here (API call, toast, then onDone + onClear; on error a
 * toast and the selection is kept). Everything else is the parent's, through
 * callbacks, because it opens the parent's dialogs or navigates.
 *
 * Props:
 *   count, hiddenCount, visibleIds   from useBulkSelect
 *   tagsList, contactsList, leadsList
 *   isAdmin     assign / plan activity / sequence / mail run
 *   isOwner     delete selected
 *   spList, onAssign(email, name), onPlanActivity(), onStartSequence(),
 *   onMailRun(), mailRunBusy, onDelete(), onClear(), onDone(), onTagCreated(tag)
 */
export default function SchoolsBulkBar({
  count = 0, hiddenCount = 0, visibleIds = [],
  tagsList = [], contactsList = [], leadsList = [],
  isAdmin = false, isOwner = false,
  spList = [], onAssign, onPlanActivity, onStartSequence, onMailRun, mailRunBusy = false,
  onDelete, onClear, onDone, onTagCreated,
}) {
  const { isDark } = useTheme();
  const [busy, setBusy] = React.useState(false);
  const [includePeople, setIncludePeople] = React.useState(false);
  const [assignPick, setAssignPick] = React.useState({ email: '', name: '' });

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const people = React.useMemo(() => {
    const ids = new Set(visibleIds);
    const at = (r) => !r.is_deleted && r.school_id && ids.has(r.school_id);
    return {
      contacts: contactsList.filter(at).length,
      leads: leadsList.filter(at).length,
    };
  }, [visibleIds, contactsList, leadsList]);

  if (count === 0) return null;

  const overCap = visibleIds.length > BULK_ID_CAP;
  const none = visibleIds.length === 0;
  const disabled = busy || overCap || none;

  const bulkTag = async ({ tagIds, action }) => {
    if (!tagIds || tagIds.length === 0 || none || overCap) return false;
    setBusy(true);
    try {
      const res = await schoolsApi.bulkTag({
        school_ids: visibleIds, tag_ids: tagIds, action, include_people: includePeople,
      });
      const d = res?.data || {};
      const targets = [[d.updated ?? 0, 'school']];
      if (includePeople) targets.push([d.contacts_updated ?? 0, 'contact'], [d.leads_updated ?? 0, 'lead']);
      toast.success(formatTagResult({ action, tagIds, tags: tagsList, targets, skipped: d.skipped }));
      setIncludePeople(false);
      if (onDone) onDone();
      if (onClear) onClear();
      return true;
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not update the tags');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const includeBox = (
    <label className={`flex items-start gap-2 text-xs cursor-pointer ${textPri}`} data-testid="school-bulk-include-people-label">
      <input type="checkbox" className="accent-[#e94560] mt-0.5 flex-shrink-0"
        checked={includePeople} onChange={e => setIncludePeople(e.target.checked)}
        data-testid="school-bulk-include-people" />
      <span>
        Also tag their contacts ({people.contacts}) and leads ({people.leads})
        <span className={`block text-[10px] ${textMuted}`}>Leave off for school-only labels like “CBSE”. Remove applies to them too.</span>
      </span>
    </label>
  );

  return (
    <div className={`${card} border rounded-md p-2.5 flex items-center gap-2 flex-wrap`} data-testid="school-bulk-bar">
      <span className={`text-xs font-medium ${textPri}`} data-testid="school-bulk-count">
        {count} selected{hiddenCount > 0 ? ` (${hiddenCount} hidden by filter)` : ''}
      </span>
      {overCap && (
        <span className="text-[11px] text-red-400 font-medium" data-testid="school-bulk-cap-note">
          Max 2,000 at a time — narrow the filter
        </span>
      )}
      {isAdmin && (
        <AssignToPicker
          value={assignPick.email}
          valueName={assignPick.name}
          users={spList}
          onChange={(email, name) => {
            setAssignPick({ email: '', name: '' }); // resets after each pick, like the old native <select>
            if (email && !disabled && onAssign) onAssign(email, name);
          }}
          placeholder="Assign owner to…"
          className="w-48"
          disabled={disabled}
        />
      )}
      <BulkTagPicker
        tags={tagsList}
        disabled={disabled}
        onApply={bulkTag}
        onTagCreated={onTagCreated}
        extra={includeBox}
        testIdPrefix="school-bulk-tags"
      />
      {isAdmin && <>
        <Button size="sm" disabled={disabled} onClick={() => onPlanActivity && onPlanActivity()} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid="plan-activity-btn">Plan Activity</Button>
        <Button size="sm" disabled={disabled} onClick={() => onStartSequence && onStartSequence()} className="bg-[#6d4ad8] hover:bg-[#7d5ae0] text-white h-8" data-testid="start-sequence-btn">Start Sequence</Button>
        <Button size="sm" variant="outline" onClick={() => onMailRun && onMailRun()} disabled={disabled || mailRunBusy} className={`border-[var(--border-color)] ${textSec} h-8`} data-testid="mail-run-btn">
          <Printer className="mr-1 h-3 w-3" /> {mailRunBusy ? 'Creating…' : 'Mail Run'}
        </Button>
      </>}
      <Button size="sm" variant="outline" onClick={() => onClear && onClear()} className={`border-[var(--border-color)] ${textSec} h-8`} data-testid="school-bulk-clear">Clear</Button>
      {/* Superadmin-only (O20): guarded bulk delete of the current selection,
          same dry-run-preview -> confirm -> delete flow as Data Cleanup. */}
      {isOwner && (
        <Button size="sm" disabled={disabled} onClick={() => onDelete && onDelete()} data-testid="school-bulk-delete-btn"
          className="bg-red-600 hover:bg-red-700 text-white h-8 ml-auto">
          <Trash2 className="mr-1 h-3 w-3" /> Delete selected
        </Button>
      )}
    </div>
  );
}
