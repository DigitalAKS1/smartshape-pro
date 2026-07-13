import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { crmMaintenance } from '../../lib/api';

const CHILD_LABELS = { leads: 'Leads', contacts: 'Contacts', quotations: 'Quotations', orders: 'Orders' };

/**
 * Shared preview -> explicit-confirm -> real-delete dialog for the two guarded
 * bulk school-delete endpoints (SUPERADMIN only on the backend; this dialog is
 * only ever mounted from places that already gate on useIsOwner — see
 * DataCleanupPanel and the Schools tab's bulk bar in LeadsCRM.js).
 *
 * ALWAYS dry-runs first (writes nothing) and shows the real blast radius before
 * any delete can happen; the real delete is disabled until the user types
 * DELETE, mirroring OwnerDeleteButton's established confirm pattern.
 *
 * Props:
 *   open, onOpenChange   controlled visibility (this dialog is shared by two
 *                        different triggers, so it isn't self-triggering)
 *   mode                 'childless' -> POST /schools/delete-blank-childless
 *                         (server picks the set); 'selected' -> POST
 *                         /schools/bulk-delete against `schoolIds`
 *   schoolIds            required for mode='selected'
 *   onDeleted            (result) => void — called after a successful delete
 */
export default function BulkDeleteSchoolsDialog({ open, onOpenChange, mode, schoolIds = [], onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const dryRunCall = () => (mode === 'selected'
    ? crmMaintenance.bulkDeleteSchools({ school_ids: schoolIds, dry_run: true, reason: '' })
    : crmMaintenance.deleteBlankChildlessSchools({ dry_run: true, reason: '' }));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null); setPreviewError(''); setConfirmText(''); setReason('');
    setPreviewLoading(true);
    dryRunCall()
      .then(({ data }) => { if (!cancelled) setPreview(data); })
      .catch((e) => { if (!cancelled) setPreviewError(e.response?.data?.detail || 'Could not load delete preview'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const handleConfirm = async () => {
    if (confirmText !== 'DELETE' || deleting || !preview) return;
    setDeleting(true);
    try {
      // The real delete is guarded server-side: confirm_count MUST equal the
      // exact set the server is about to delete, else 400 (a stale UI can
      // never over-delete). For 'selected' that's the ids we submitted; for
      // 'childless' the server recomputes its own set at delete time, so we
      // send the count our own dry-run just saw — if the set changed in the
      // meantime the server 400s and we surface that below instead of guessing.
      const confirmCount = mode === 'selected' ? schoolIds.length : preview.totals.schools;
      const payload = mode === 'selected'
        ? { school_ids: schoolIds, dry_run: false, confirm_count: confirmCount, reason }
        : { dry_run: false, confirm_count: confirmCount, reason };
      const call = mode === 'selected' ? crmMaintenance.bulkDeleteSchools(payload) : crmMaintenance.deleteBlankChildlessSchools(payload);
      const { data } = await call;
      toast.success(`Deleted ${data.deleted} school(s) — ${data.backups?.length || 0} backup(s) saved, restorable`);
      onOpenChange(false);
      onDeleted?.(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Bulk delete failed — nothing was deleted');
    } finally {
      setDeleting(false);
    }
  };

  const totals = preview?.totals;
  const schoolCount = totals?.schools ?? 0;
  const childrenTotal = (totals?.leads || 0) + (totals?.contacts || 0) + (totals?.quotations || 0) + (totals?.orders || 0);
  const title = mode === 'selected'
    ? `Permanently delete ${schoolIds.length} selected school(s)?`
    : 'Permanently delete blank + childless schools?';

  return (
    <Dialog open={open} onOpenChange={(v) => !deleting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg" data-testid="bulk-delete-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1 text-sm">
          <p className="text-[var(--text-secondary)]">
            This permanently deletes {mode === 'selected' ? 'the selected schools' : 'blank (no-name) schools with zero leads/contacts/quotations/orders'}
            {' '}along with anything still attached to them. This cannot be undone from the app — a backup is
            saved first and is restorable by an engineer from the audit backups.
          </p>

          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3" data-testid="bulk-delete-preview">
            {previewLoading ? (
              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating what will be deleted…
              </p>
            ) : previewError ? (
              <p className="text-xs text-red-400" data-testid="bulk-delete-preview-error">{previewError}</p>
            ) : preview ? (
              <>
                <p className="mb-1.5 text-xs font-medium text-red-400">
                  {schoolCount} school{schoolCount === 1 ? '' : 's'} will be permanently deleted
                  {childrenTotal > 0 && <> — including {childrenTotal} related record(s)</>}:
                </p>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                  <li className="flex justify-between"><span>Schools</span><span className="font-mono">{schoolCount}</span></li>
                  {Object.entries(CHILD_LABELS).map(([key, label]) => (totals?.[key] || 0) > 0 && (
                    <li key={key} className="flex justify-between">
                      <span>{label}</span><span className="font-mono">{totals[key]}</span>
                    </li>
                  ))}
                </ul>
                {childrenTotal > 0 && mode === 'selected' && (
                  <p className="mt-2 text-xs font-medium text-orange-400">
                    Some selected schools still have leads/contacts/quotations/orders attached — those will be deleted too.
                  </p>
                )}
                {schoolCount === 0 && (
                  <p className="text-xs text-[var(--text-muted)]">Nothing to delete — 0 schools matched.</p>
                )}
              </>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">Reason (optional, saved to audit log)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Why is this being deleted?" data-testid="bulk-delete-reason" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Type <span className="font-mono font-semibold text-red-400">DELETE</span> to confirm
            </label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE" autoComplete="off" data-testid="bulk-delete-confirm-input" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>Cancel</Button>
          <Button type="button" onClick={handleConfirm}
            disabled={confirmText !== 'DELETE' || deleting || !preview || schoolCount === 0}
            data-testid="bulk-delete-confirm-btn"
            className="bg-red-600 text-white hover:bg-red-700">
            {deleting ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Deleting…</> : <>Permanently delete</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
