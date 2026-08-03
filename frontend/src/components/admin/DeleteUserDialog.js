import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertTriangle } from 'lucide-react';
import { adminUsers } from '../../lib/api';

const LABELS = {
  leads: 'Leads', schools: 'Schools', contacts: 'Contacts', tasks: 'Tasks',
  followups: 'Follow-ups', visit_plans: 'Visit plans', visits: 'Visits',
  field_visits: 'Field visits', del_task_instances: 'Delegated tasks',
};

export function DeleteUserDialog({ open, onOpenChange, user, users, onConfirm }) {
  const [summary, setSummary] = useState(null);
  const [transferTo, setTransferTo] = useState('');
  const [busy, setBusy] = useState(false);

  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  useEffect(() => {
    if (!open || !user) return;
    setSummary(null);
    setTransferTo('');
    adminUsers.dataSummary(user.user_id)
      .then(res => setSummary(res.data))
      .catch(() => setSummary({ counts: {}, total: 0 }));
  }, [open, user]);

  if (!user) return null;

  const candidates = (users || []).filter(u => u.user_id !== user.user_id && u.is_active !== false);
  const total = summary?.total ?? null;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(user.user_id, transferTo);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`bg-[var(--bg-card)] border-[var(--border-color)] ${textPri} w-[calc(100vw-1rem)] sm:max-w-lg`}>
        <DialogHeader>
          <DialogTitle className={`${textPri} text-lg flex items-center gap-2`}>
            <AlertTriangle className="h-5 w-5 text-[#e94560]" />
            Remove {user.name}?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className={`text-sm ${textSec}`}>
            The account is deactivated, not erased. Past quotations, orders and history keep this
            person's name — only live work needs a new owner.
          </p>

          <div className="rounded-md border border-[var(--border-color)] p-3">
            <p className={`text-xs uppercase tracking-wide ${textMuted} mb-2`}>Live work owned</p>
            {summary === null && <p className={`text-sm ${textMuted}`}>Counting…</p>}
            {summary && total === 0 && (
              <p className={`text-sm ${textMuted}`}>Nothing assigned — nothing to transfer.</p>
            )}
            {summary && total > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.counts).map(([k, v]) => (
                  <span key={k} className="text-xs px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-hover)]">
                    {v} {LABELS[k] || k}
                  </span>
                ))}
              </div>
            )}
          </div>

          {summary && total > 0 && (
            <div>
              <Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Give this work to</Label>
              <Select value={transferTo} onValueChange={setTransferTo}>
                <SelectTrigger className="bg-[var(--bg-primary)] border-[var(--border-color)]">
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-card)] border-[var(--border-color)]">
                  {candidates.map(u => (
                    <SelectItem key={u.user_id} value={u.email} className={`${textPri} hover:bg-[var(--bg-hover)]`}>
                      {u.name} — {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!transferTo && (
                <p className="text-[11px] text-[#e94560] mt-1.5">
                  Pick someone, or this work will be left with no owner.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || summary === null || (total > 0 && !transferTo)}
            className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            {busy ? 'Working…' : 'Deactivate & transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
