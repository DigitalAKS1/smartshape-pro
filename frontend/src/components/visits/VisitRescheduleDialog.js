import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '../ui/dialog';
import { RotateCcw, Loader2 } from 'lucide-react';
import { fmtTime } from '../../lib/visitUtils';

/**
 * Reschedule dialog: pick a new date / time + optional reason.
 * Also contains the read-only reschedule-history dialog.
 */
export default function VisitRescheduleDialog({
  rescheduleDialog, setRescheduleDialog,
  rescheduleForm, setRescheduleForm,
  handleReschedule,
  // history dialog
  historyDialog, setHistoryDialog,
  tk, isDark,
}) {
  return (
    <>
      {/* ── Reschedule ──────────────────────────────────────────────────── */}
      <Dialog
        open={rescheduleDialog.open}
        onOpenChange={o => !rescheduleDialog.saving && setRescheduleDialog(d => ({ ...d, open: o }))}
      >
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-sm rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Reschedule Visit</DialogTitle>
            <DialogDescription className={tk.tm}>
              {rescheduleDialog.plan
                ? `${rescheduleDialog.plan.school_name || rescheduleDialog.plan.lead_name} — currently ${rescheduleDialog.plan.visit_date}${rescheduleDialog.plan.visit_time ? ' ' + fmtTime(rescheduleDialog.plan.visit_time) : ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>New Date *</Label>
                <Input type="date" value={rescheduleForm.new_date}
                  onChange={e => setRescheduleForm(f => ({ ...f, new_date: e.target.value }))}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>New Time</Label>
                <Input type="time" value={rescheduleForm.new_time}
                  onChange={e => setRescheduleForm(f => ({ ...f, new_time: e.target.value }))}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
            </div>
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Reason</Label>
              <Input value={rescheduleForm.reason}
                onChange={e => setRescheduleForm(f => ({ ...f, reason: e.target.value }))}
                className={`h-10 text-sm rounded-lg ${tk.input}`}
                placeholder="School holiday, Availability conflict…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost"
              onClick={() => setRescheduleDialog({ open: false, plan: null, saving: false })}
              disabled={rescheduleDialog.saving}
              className={tk.tm}>
              Cancel
            </Button>
            <Button onClick={handleReschedule} disabled={rescheduleDialog.saving}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-5">
              {rescheduleDialog.saving
                ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Saving…</>
                : <><RotateCcw className="h-3.5 w-3.5 mr-2" />Reschedule</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <Dialog open={historyDialog.open} onOpenChange={o => setHistoryDialog(d => ({ ...d, open: o }))}>
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-md rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Reschedule History</DialogTitle>
            <DialogDescription className={tk.tm}>
              {historyDialog.plan?.school_name || historyDialog.plan?.lead_name}
              {' — '}{historyDialog.plan?.reschedule_count || 0} reschedule{historyDialog.plan?.reschedule_count !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 max-h-64 overflow-y-auto">
            {(historyDialog.plan?.reschedule_history || []).map((h, i) => (
              <div key={i} className={`rounded-xl p-3 text-sm ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f8fafc]'} border ${isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-amber-500 text-xs font-semibold">#{i + 1}</span>
                  <span className={`text-xs ${tk.tm}`}>{h.rescheduled_at?.slice(0, 10)} · {h.rescheduled_by}</span>
                </div>
                <p className={`text-xs ${tk.t2}`}>{h.old_date} {h.old_time} → <span className={`font-semibold ${tk.t1}`}>{h.new_date} {h.new_time}</span></p>
                {h.reason && <p className={`text-xs ${tk.tm} italic mt-1`}>"{h.reason}"</p>}
              </div>
            ))}
            {!(historyDialog.plan?.reschedule_history?.length) && (
              <p className={`text-sm text-center py-6 ${tk.tm}`}>No history recorded</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHistoryDialog({ open: false, plan: null })} className={tk.tm}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
