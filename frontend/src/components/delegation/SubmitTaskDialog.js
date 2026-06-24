import React, { useRef, useState } from 'react';
import { X, Check, AlertCircle, Hourglass, Camera, ArrowRightLeft } from 'lucide-react';
import { Button } from '../ui/button';

const PINK = '#e94560';
const GREEN = '#10b981';
const RED = '#ef4444';
const AMBER = '#f59e0b';
const TODAY = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();

/**
 * Submit a task with one of three outcomes:
 *   - done      : finished it (optional remark; photo if proof is required)
 *   - not_done  : couldn't do it (reason required) — stays open, assigner notified
 *   - partial   : did part of it (progress + expected finish date; optional hand-off)
 *
 * onDone(instance, { note, file })   → hook submitDone
 * onReport(instance, payload)        → hook reportInst  (not_done / partial)
 */
export default function SubmitTaskDialog({
  instance, employees = [], onDone, onReport, onClose,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const [tab, setTab] = useState('done');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // done
  const [doneNote, setDoneNote] = useState('');
  const [file, setFile] = useState(null);
  // not done
  const [reason, setReason] = useState('');
  // partial
  const [partialNote, setPartialNote] = useState('');
  const [expectedDate, setExpectedDate] = useState(instance.due_date && instance.due_date >= TODAY ? instance.due_date : TODAY);
  const [expectedTime, setExpectedTime] = useState(instance.due_time || '');
  const [reassignTo, setReassignTo] = useState('');

  const needsPhoto = !!instance.requires_image;
  const candidates = employees.filter(e => e.is_active !== false && e.emp_id !== instance.emp_id);

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;
  const area = `w-full px-2.5 py-2 rounded text-sm border border-[var(--border-color)] ${inputCls}`;

  const valid =
    tab === 'done' ? (!needsPhoto || !!file)
    : tab === 'not_done' ? !!reason.trim()
    : !!partialNote.trim() && !!expectedDate;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (tab === 'done') {
        await onDone(instance, { note: doneNote.trim(), file });
      } else if (tab === 'not_done') {
        await onReport(instance, { outcome: 'not_done', note: reason.trim() });
      } else {
        await onReport(instance, {
          outcome: 'partial',
          note: partialNote.trim(),
          expected_date: expectedDate,
          expected_time: expectedTime || '',
          reassign_to_emp_id: reassignTo || undefined,
        });
      }
    } catch { /* toast handled by caller; keep dialog open to retry */ }
    finally { setBusy(false); }
  };

  const TABS = [
    { id: 'done', label: 'Done', Icon: Check, color: GREEN },
    { id: 'not_done', label: 'Not done', Icon: AlertCircle, color: RED },
    { id: 'partial', label: 'Partial', Icon: Hourglass, color: AMBER },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className={`${card} border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h2 className={`text-base font-semibold ${textPri}`}>Submit task</h2>
            <p className={`text-xs ${textMuted} mt-0.5 truncate`}>“{instance.task_title}”</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* outcome tabs */}
        <div className="flex gap-1 px-5 pt-4">
          {TABS.map(({ id, label, Icon, color }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold border transition-colors"
              style={tab === id
                ? { background: color, color: '#fff', borderColor: 'transparent' }
                : { borderColor: 'var(--border-color)' }}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === 'done' && (
            <>
              <div>
                <label className={lbl}>Remark <span className="font-normal normal-case opacity-70">(optional)</span></label>
                <textarea value={doneNote} onChange={e => setDoneNote(e.target.value)} rows={3}
                  placeholder="Anything to note about how it went?" className={area} />
              </div>
              {needsPhoto && (
                <div>
                  <label className={lbl}>Photo proof <span className="text-red-400">*</span></label>
                  <input type="file" accept="image/*" capture="environment" ref={fileRef} className="hidden"
                    onChange={e => setFile(e.target.files[0] || null)} />
                  <button onClick={() => fileRef.current?.click()}
                    className={`w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] flex items-center gap-2 ${textSec}`}>
                    <Camera className="h-4 w-4" style={{ color: PINK }} />
                    {file ? file.name : 'Add a photo (required for this task)'}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'not_done' && (
            <div>
              <label className={lbl}>Why couldn’t it be done? <span className="text-red-400">*</span></label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Reason — the assigner will see this and the task stays open." className={area} />
            </div>
          )}

          {tab === 'partial' && (
            <>
              <div>
                <label className={lbl}>What’s done so far? <span className="text-red-400">*</span></label>
                <textarea value={partialNote} onChange={e => setPartialNote(e.target.value)} rows={3}
                  placeholder="Describe the progress and what’s left." className={area} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Will finish by <span className="text-red-400">*</span></label>
                  <input type="date" min={TODAY} value={expectedDate}
                    onChange={e => setExpectedDate(e.target.value)} className={fld} />
                </div>
                <div>
                  <label className={lbl}>Time <span className="font-normal normal-case opacity-70">(optional)</span></label>
                  <input type="time" value={expectedTime}
                    onChange={e => setExpectedTime(e.target.value)} className={fld} />
                </div>
              </div>
              <div>
                <label className={lbl}>
                  <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" /> Hand off the rest to</span>
                  <span className="font-normal normal-case opacity-70"> (optional — needs approval)</span>
                </label>
                <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} className={fld}>
                  <option value="">— Keep it with me —</option>
                  {candidates.map(e => (
                    <option key={e.emp_id} value={e.emp_id}>
                      {e.name}{e.department_name ? ` (${e.department_name})` : ''}
                    </option>
                  ))}
                </select>
                {reassignTo && (
                  <p className={`text-[11px] mt-1 ${textMuted}`}>
                    A reassignment request is sent to the assigner for approval; the task stays with you until they approve.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="outline" onClick={onClose} disabled={busy}
            className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || busy}
            className="h-9 text-white font-semibold"
            style={{ background: tab === 'done' ? GREEN : tab === 'not_done' ? RED : AMBER }}>
            {busy ? 'Submitting…' : tab === 'done' ? 'Mark Done' : tab === 'not_done' ? 'Report Not Done' : 'Save Progress'}
          </Button>
        </div>
      </div>
    </div>
  );
}
