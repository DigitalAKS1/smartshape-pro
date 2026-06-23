import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

const fmtDT = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

/**
 * Shown when a user marks a delegation task done: captures an optional completion
 * remark (stored as completion_note) and shows when the task was assigned.
 */
export default function CompleteRemarksDialog({
  instance, onConfirm, onClose, saving,
  dlgCls, textPri, textSec, textMuted, inputCls,
}) {
  const [note, setNote] = useState('');
  useEffect(() => { setNote(''); }, [instance]);
  if (!instance) return null;

  return (
    <Dialog open={!!instance} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
        <DialogHeader><DialogTitle className={textPri}>Complete Task</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <p className={`text-sm font-semibold ${textPri}`}>{instance.task_title || 'Task'}</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              Assigned by {instance.delegator_name || 'System'} · {fmtDT(instance.created_at)}
            </p>
          </div>
          <div>
            <label className={`block text-xs font-semibold ${textSec} mb-1`}>Remarks (optional)</label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Add a note about how you completed this…"
              className={`w-full px-3 py-2 rounded-md text-sm resize-none border ${inputCls}`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}
            className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={() => onConfirm(note)} disabled={saving}
            className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            {saving ? 'Saving…' : 'Mark Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
