import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useIsOwner } from '../../hooks/usePermission';
import { schools, contacts, orders } from '../../lib/api';

/**
 * Owner-only ("info@smartshape.in") permanent-delete button + typed-confirmation dialog.
 *
 * Renders nothing for every other account — the backend require_superadmin still
 * enforces the rule, so this is purely UI gating. For schools/contacts it fetches a
 * cascade preview and shows the blast radius (how many records will be erased) before
 * the user types DELETE to confirm.
 *
 * Props:
 *   kind      'order' | 'school' | 'contact'
 *   id        entity id
 *   name      human label shown in the dialog
 *   onDeleted callback after a successful delete (e.g. refresh list / close panel)
 *   label     optional button text (default "Delete")
 *   className optional extra classes for the trigger button
 */
const CFG = {
  order:   { delete: orders.delete,           preview: null,                    noun: 'order' },
  school:  { delete: schools.cascadeDelete,   preview: schools.cascadePreview,  noun: 'school' },
  contact: { delete: contacts.cascadeDelete,  preview: contacts.cascadePreview, noun: 'contact' },
};

export default function OwnerDeleteButton({ kind, id, name, onDeleted, label = 'Delete', className = '' }) {
  const isOwner = useIsOwner();
  const cfg = CFG[kind];
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  if (!isOwner || !cfg) return null;

  const openDialog = async () => {
    setConfirmText(''); setReason(''); setPreview(null); setOpen(true);
    if (cfg.preview) {
      setPreviewLoading(true);
      try {
        const { data } = await cfg.preview(id);
        setPreview(data);
      } catch (e) {
        toast.error('Could not load delete preview');
      } finally {
        setPreviewLoading(false);
      }
    }
  };

  const handleConfirm = async () => {
    if (confirmText !== 'DELETE' || loading) return;
    setLoading(true);
    try {
      const { data } = await cfg.delete(id, reason);
      toast.success(`Permanently deleted — ${data?.total ?? 0} record(s) removed (backup ${data?.backup_id || 'saved'})`);
      setOpen(false);
      onDeleted?.(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || `Failed to delete ${cfg.noun}`);
    } finally {
      setLoading(false);
    }
  };

  const counts = preview?.counts || {};
  const countRows = Object.entries(counts).filter(([, n]) => n > 0);

  return (
    <>
      <Button
        type="button" variant="outline" onClick={openDialog}
        className={`border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 ${className}`}
      >
        <Trash2 className="mr-1.5 h-4 w-4" /> {label}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" /> Permanently delete {cfg.noun}?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1 text-sm">
            <p className="text-[var(--text-secondary)]">
              You are about to permanently delete <span className="font-semibold text-[var(--text-primary)]">{name || id}</span>
              {kind === 'order'
                ? ' along with its items, payments, dispatches and timeline.'
                : ' along with everything related to it.'}
              {' '}This cannot be undone from the app (a backup is saved for manual restore).
            </p>

            {kind === 'order' && (
              <p className="text-xs text-[var(--text-muted)]">
                Reserved stock is released back to available; already-dispatched quantities stay deducted.
              </p>
            )}

            {cfg.preview && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                {previewLoading ? (
                  <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating what will be deleted…
                  </p>
                ) : countRows.length ? (
                  <>
                    <p className="mb-1.5 text-xs font-medium text-red-400">
                      {preview.total} record(s) will be permanently erased:
                    </p>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                      {countRows.map(([coll, n]) => (
                        <li key={coll} className="flex justify-between">
                          <span className="capitalize">{coll.replace(/_/g, ' ')}</span>
                          <span className="font-mono">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">No related records found — only this {cfg.noun} will be removed.</p>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Reason (optional, saved to audit log)</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Why is this being deleted?" />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">
                Type <span className="font-mono font-semibold text-red-400">DELETE</span> to confirm
              </label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE" autoComplete="off" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="button" onClick={handleConfirm} disabled={confirmText !== 'DELETE' || loading}
              className="bg-red-600 text-white hover:bg-red-700">
              {loading ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Deleting…</> : <>Permanently delete</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
