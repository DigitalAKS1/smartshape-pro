import React, { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { useIsOwner } from '../../hooks/usePermission';
import { crmMaintenance } from '../../lib/api';
import BulkDeleteSchoolsDialog from './BulkDeleteSchoolsDialog';

function Stat({ label, value, tone }) {
  const toneCls = { warn: 'text-orange-400', ok: 'text-green-400', danger: 'text-red-400' }[tone] || 'text-[var(--text-primary)]';
  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

/**
 * SUPERADMIN-only "Data Cleanup" entry point (O19/O20 UI). Renders nothing for
 * every other account — same gate as OwnerDeleteButton (`useIsOwner`); the
 * backend's `require_admin`/`require_superadmin` on every endpoint underneath
 * still enforces this for real, this only hides the UI.
 *
 * Loads the read-only blank-schools audit, shows it plainly (total vs blank,
 * safe-to-delete vs still-referenced, who created the junk), and offers a
 * guarded "clean up blank+childless" action via the shared
 * BulkDeleteSchoolsDialog (dry-run preview -> explicit DELETE confirm -> real
 * delete). Never deletes anything itself.
 */
export default function DataCleanupPanel({ onCleaned }) {
  const isOwner = useIsOwner();
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadAudit = useCallback(() => {
    setLoading(true); setError('');
    crmMaintenance.blankSchoolsAudit()
      .then(({ data }) => setAudit(data))
      .catch((e) => setError(e.response?.data?.detail || 'Could not load audit'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open) loadAudit(); }, [open, loadAudit]);

  if (!isOwner) return null;

  const handleDeleted = () => {
    loadAudit();
    onCleaned?.();
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}
        className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300" data-testid="data-cleanup-trigger">
        <ShieldAlert className="mr-1.5 h-3.5 w-3.5" /> Data Cleanup
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl" data-testid="data-cleanup-panel">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-400" /> Data Cleanup — Blank Schools
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audit…
            </p>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-red-400" data-testid="data-cleanup-error">{error}</p>
              <Button size="sm" variant="outline" onClick={loadAudit}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>
            </div>
          ) : audit ? (
            <div className="space-y-4 text-sm" data-testid="data-cleanup-audit">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="Total schools" value={audit.total_schools} />
                <Stat label="Blank (no name)" value={audit.blank_schools} tone="warn" />
                <Stat label="Blank + childless (safe)" value={audit.blank_childless} tone="ok" />
                <Stat label="Blank + has children (NOT safe)" value={audit.blank_with_children} tone="danger" />
              </div>

              {audit.blank_with_children > 0 && (
                <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3">
                  <p className="mb-1 text-xs font-medium text-orange-400">
                    Children still attached to blank schools — never blind-deleted:
                  </p>
                  <ul className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                    {Object.entries(audit.children_breakdown || {}).map(([k, v]) => (
                      <li key={k} className="flex justify-between capitalize"><span>{k}</span><span className="font-mono">{v}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {Object.keys(audit.by_creator || {}).length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">Created by</p>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-[var(--text-muted)]">
                    {Object.entries(audit.by_creator).sort((a, b) => b[1] - a[1]).map(([who, n]) => (
                      <li key={who} className="flex justify-between"><span>{who}</span><span className="font-mono">{n}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {(audit.created_at_earliest || audit.created_at_latest) && (
                <p className="text-xs text-[var(--text-muted)]">
                  Created between {audit.created_at_earliest ? audit.created_at_earliest.slice(0, 10) : '—'} and {audit.created_at_latest ? audit.created_at_latest.slice(0, 10) : '—'}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
                <p className="text-xs text-[var(--text-muted)]">Permanent, but restorable from audit backups.</p>
                <Button type="button" onClick={() => setDeleteOpen(true)} disabled={!audit.blank_childless}
                  data-testid="cleanup-blank-childless-btn"
                  className="bg-red-600 text-white hover:bg-red-700">
                  Clean up {audit.blank_childless} blank + childless
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <BulkDeleteSchoolsDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        mode="childless"
        onDeleted={handleDeleted}
      />
    </>
  );
}
