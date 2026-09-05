import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../lib/api';
import { Button } from '../ui/button';

/**
 * Undo for the deletes that cascade.
 *
 * Every owner-only destructive action in the app — deleting a school, a
 * contact, an order, merging duplicates, a bulk data repair — first copies
 * every affected document into `audit_backups` and only then deletes. That
 * safety net has existed for months with no way to reach it: the restore
 * endpoint was written, wired into the API client, and never given a screen.
 * So the answer to "I deleted the wrong school, can we get it back?" was a
 * database session, when it should have been a button.
 *
 * Owner-only, exactly like the deletes it reverses (the server enforces this
 * with require_superadmin; this component is only rendered for that account).
 */

const NOUNS = {
  schools: 'school', contacts: 'contact', leads: 'lead', orders: 'order',
  order_items: 'order item', quotations: 'quotation', tasks: 'task',
  followups: 'follow-up', call_notes: 'call note', visits: 'visit',
  mail_touches: 'mailer', drip_enrollments: 'sequence enrolment',
};

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

// "4 contacts · 9 leads" — the blast radius in plain words. A bare total of 14
// doesn't tell you whether restoring is safe; the breakdown does.
function describeCounts(counts = {}) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([coll, n]) => plural(n, NOUNS[coll] || coll.replace(/_/g, ' ')))
    .join(' · ');
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function RecentlyDeleted() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const load = useCallback(async () => {
    try {
      const r = await adminApi.listAuditBackups(100);
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not load the deletion history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (row) => {
    const what = describeCounts(row.counts) || plural(row.total || 0, 'record');
    const ok = window.confirm(
      `Put back ${what}?\n\n`
      + `This re-creates everything deleted with "${row.root_label || row.root_id}". `
      + `Records that still exist are left alone.\n\n`
      + `A backup can only be restored once.`
    );
    if (!ok) return;
    setBusyId(row.backup_id);
    try {
      const r = await adminApi.restoreAuditBackup(row.backup_id);
      toast.success(`Put back ${plural(r.data?.total ?? row.total ?? 0, 'record')}`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not restore this backup');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <p className={`text-sm ${textMuted}`}>Loading…</p>;

  return (
    <div className="space-y-4" data-testid="recently-deleted">
      <div>
        <h2 className={`text-lg font-medium ${textPri}`}>Recently deleted</h2>
        <p className={`text-sm ${textSec} mt-1 max-w-2xl`}>
          Deleting a school, contact or order also removes everything attached to it. Each of
          those deletions is copied here first, so it can be put back.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-green-400" />
          <p className={`text-sm font-medium ${textPri}`}>Nothing has been deleted</p>
          <p className={`mt-1 text-xs ${textMuted}`}>
            Cascade deletions will be listed here, newest first, ready to put back.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => {
            const breakdown = describeCounts(row.counts);
            return (
              <li
                key={row.backup_id}
                data-testid={`backup-${row.backup_id}`}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] p-3"
              >
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${textPri}`}>
                    {row.root_label || row.root_id || 'Unnamed'}
                    <span className={`ml-2 text-[11px] font-normal ${textMuted} capitalize`}>{row.root_type}</span>
                  </p>
                  <p className={`mt-0.5 text-xs ${textSec}`}>
                    {breakdown || plural(row.total || 0, 'record')}
                  </p>
                  <p className={`mt-0.5 text-[11px] ${textMuted}`}>
                    {when(row.deleted_at)} · {row.deleted_by}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </p>
                  {/* A migration snapshot deleted nothing — it is the "before"
                      image of a bulk edit. Restoring it reverses the edit, which
                      is a different promise from undeleting, so say which it is. */}
                  {row.migration && (
                    <p className="mt-1 text-[11px] text-yellow-500">
                      Before a bulk edit — nothing was deleted. Putting this back reverses that edit.
                    </p>
                  )}
                </div>

                {row.restored ? (
                  <span className={`whitespace-nowrap text-[11px] ${textMuted}`}>
                    Restored {when(row.restored_at)}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.backup_id}
                    onClick={() => restore(row)}
                    data-testid={`restore-${row.backup_id}`}
                    className={`h-8 whitespace-nowrap border-[var(--border-color)] ${textSec} hover:border-[#e94560] hover:text-[#e94560]`}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    {busyId === row.backup_id ? 'Putting back…' : 'Put back'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className={`text-xs ${textMuted}`}>
        Restoring skips anything that still exists, so it is safe. If orders were put back, run
        Stock → Recompute reservations afterwards.
      </p>
    </div>
  );
}
