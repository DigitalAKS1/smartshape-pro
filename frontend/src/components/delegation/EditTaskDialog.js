import React, { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PINK = '#e94560';
// Local (IST for our users) calendar date — min for date pickers / past-date guard.
const TODAY = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();

/**
 * Edit an existing task.
 *  - role 'delegator' | 'boss'  → full edit (all fields)
 *  - role 'delegatee'           → soft edit only (priority); core fields disabled
 * onSubmit(payload) is wired by the parent to either updateTask (owner) or
 * patchInstance (delegatee), so this dialog stays id-agnostic.
 */
export default function EditTaskDialog({
  task, role, assignableEmployees = [], saving, onSubmit, onClose,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const isOwner = role === 'delegator' || role === 'boss';
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    task_type: task.task_type || 'onetime',
    frequency: task.frequency || 'daily',
    target_date: task.target_date || '',
    start_date: task.start_date || '',
    end_date: task.end_date || '',
    assignee_ids: task.assignee_ids || [],
    buddy_emp_id: task.buddy_emp_id || '',
    require_verification: !!task.require_verification,
    requires_image: !!task.requires_image,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleAssignee = (id) =>
    set('assignee_ids',
      form.assignee_ids.includes(id)
        ? form.assignee_ids.filter(x => x !== id)
        : [...form.assignee_ids, id]);

  const submit = () => {
    if (isOwner && !form.title.trim()) return;
    if (isOwner) {
      // Block moving the date into the past; leaving an already-past date as-is is fine.
      const d = form.task_type === 'onetime' ? form.target_date : form.start_date;
      const orig = form.task_type === 'onetime' ? (task.target_date || '') : (task.start_date || '');
      if (d && d < TODAY && d !== orig) {
        toast.error("Date can't be in the past — pick today or a future date.");
        return;
      }
    }
    const payload = isOwner
      ? {
          title: form.title, description: form.description, priority: form.priority,
          task_type: form.task_type,
          frequency: form.task_type === 'recurring' ? form.frequency : 'custom',
          target_date: form.task_type === 'onetime' ? form.target_date : null,
          start_date: form.task_type === 'recurring' ? form.start_date : null,
          end_date: form.task_type === 'recurring' ? form.end_date : null,
          assignee_ids: form.assignee_ids,
          buddy_emp_id: form.buddy_emp_id,
          require_verification: form.require_verification,
          requires_image: form.requires_image,
        }
      : { priority: form.priority };
    onSubmit(payload);
  };

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;
  const disabled = !isOwner;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className={`text-base font-semibold ${textPri}`}>Edit Task</h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {isOwner ? 'Changes apply to pending instances' : 'You can adjust priority'}
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={lbl}>Title</label>
            <Input value={form.title} disabled={disabled}
              onChange={e => set('title', e.target.value)}
              className={`h-9 text-sm ${inputCls}`} />
          </div>

          <div>
            <label className={lbl}>Priority</label>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={fld}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>

          {isOwner && (
            <>
              <div>
                <label className={lbl}>Type</label>
                <select value={form.task_type} onChange={e => set('task_type', e.target.value)} className={fld}>
                  <option value="onetime">One-time</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>

              {form.task_type === 'onetime' ? (
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" min={TODAY} value={form.target_date}
                    onChange={e => set('target_date', e.target.value)} className={fld} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Frequency</label>
                    <select value={form.frequency} onChange={e => set('frequency', e.target.value)} className={fld}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Start</label>
                    <input type="date" min={TODAY} value={form.start_date}
                      onChange={e => set('start_date', e.target.value)} className={fld} />
                  </div>
                  <div>
                    <label className={lbl}>End</label>
                    <input type="date" min={form.start_date || TODAY} value={form.end_date}
                      onChange={e => set('end_date', e.target.value)} className={fld} />
                  </div>
                </div>
              )}

              <div>
                <label className={lbl}>Assign To</label>
                <div className="flex flex-wrap gap-1.5">
                  {assignableEmployees.map(e => {
                    const on = form.assignee_ids.includes(e.emp_id);
                    return (
                      <button key={e.emp_id} onClick={() => toggleAssignee(e.emp_id)}
                        className={`px-2.5 h-8 rounded-full text-xs border transition-colors ${on ? 'text-white border-transparent' : `${textSec} border-[var(--border-color)]`}`}
                        style={on ? { background: PINK } : {}}>
                        {e.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={lbl}>Buddy <span className="font-normal normal-case opacity-70">(backup who can complete if owner is out)</span></label>
                <select value={form.buddy_emp_id} onChange={e => set('buddy_emp_id', e.target.value)} className={fld}>
                  <option value="">— No buddy —</option>
                  {assignableEmployees
                    .filter(e => !form.assignee_ids.includes(e.emp_id))
                    .map(e => (
                      <option key={e.emp_id} value={e.emp_id}>
                        {e.name}{e.department_name ? ` (${e.department_name})` : ''}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="outline" onClick={onClose}
            className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submit} disabled={saving}
            className="h-9 text-white font-semibold" style={{ background: PINK }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
