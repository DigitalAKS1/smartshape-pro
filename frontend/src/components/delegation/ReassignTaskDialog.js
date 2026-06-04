import React, { useState } from 'react';
import { X, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { Button } from '../ui/button';

const PINK = '#e94560';

/**
 * Request to reassign an instance to another person.
 * Reason is mandatory; the move only happens after a delegator/boss approves.
 * onSubmit(instanceId, toEmpId, reason) → hook's submitReassign.
 */
export default function ReassignTaskDialog({
  instance, employees = [], onSubmit, onClose,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const [toEmpId, setToEmpId] = useState('');
  const [reason, setReason] = useState('');
  const frequentHandoff = (instance.reassignment_count || 0) > 2;

  const candidates = employees.filter(
    e => e.is_active !== false && e.emp_id !== instance.emp_id);

  const valid = toEmpId && reason.trim();
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;
  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-md`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" style={{ color: PINK }} />
            <h2 className={`text-base font-semibold ${textPri}`}>Request Reassignment</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className={`text-xs ${textMuted}`}>
            <span className={textSec}>“{instance.task_title}”</span> — currently with{' '}
            <span className={textSec}>{instance.emp_name}</span>. A delegator or manager must
            approve before it moves.
          </p>

          {frequentHandoff && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This task has been handed off {instance.reassignment_count} times. Consider whether
                it needs a different owner or more support.
              </p>
            </div>
          )}

          <div>
            <label className={lbl}>Reassign to</label>
            <select value={toEmpId} onChange={e => setToEmpId(e.target.value)} className={fld}>
              <option value="">— Select person —</option>
              {candidates.map(e => (
                <option key={e.emp_id} value={e.emp_id}>
                  {e.name}{e.department_name ? ` (${e.department_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={lbl}>Reason <span className="text-red-400">*</span></label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="Why does this need to move?"
              className={`w-full px-2.5 py-2 rounded text-sm border border-[var(--border-color)] ${inputCls}`} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="outline" onClick={onClose}
            className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={() => onSubmit(instance.instance_id, toEmpId, reason.trim())}
            disabled={!valid}
            className="h-9 text-white font-semibold" style={{ background: PINK }}>
            Send Request
          </Button>
        </div>
      </div>
    </div>
  );
}
