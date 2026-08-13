import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { activityTypes, activities } from '../../lib/api';
import { X, ClipboardList } from 'lucide-react';

// Bulk Activity Planner dialog. Plans one activity per selected school; default
// auto-assigns each to that school's own account manager, or all to one person.
export default function PlanActivityDialog({ open, onClose, schoolIds = [], spList = [], onDone }) {
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ activity_type: '', title: '', due_date: '', notes: '', assign_mode: 'owner', assigned_to: '', assigned_name: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    activityTypes.getAll().then(r => {
      const t = r.data || [];
      setTypes(t);
      setForm(f => ({ ...f, activity_type: f.activity_type || (t[0]?.name || '') }));
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!form.activity_type || !form.title) { toast.error('Activity type and title are required'); return; }
    if (form.assign_mode === 'person' && !form.assigned_to) { toast.error('Pick a person to assign to'); return; }
    setBusy(true);
    try {
      const r = await activities.bulk({ school_ids: schoolIds, ...form });
      const fb = r.data.unassigned_fallback;
      toast.success(`Planned ${r.data.created} activities${fb ? ` · ${fb} had no owner → assigned to you` : ''}`);
      onClose();
      onDone && onDone();
    } catch { toast.error('Failed to plan activities'); }
    finally { setBusy(false); }
  };

  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="plan-activity-dialog">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardList className="h-4 w-4 text-[#e94560]" /> Plan Activity</h3>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">For <b className="text-[var(--text-secondary)]">{schoolIds.length}</b> selected school(s).</p>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <select className={inp} value={form.activity_type} onChange={e => setForm(f => ({ ...f, activity_type: e.target.value }))} data-testid="activity-type-select">
              {types.map(t => <option key={t.activity_type_id || t.name} value={t.name}>{t.name}</option>)}
            </select>
            <input className={inp} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <input className={inp} placeholder="Title (e.g. Send August newsletter)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="activity-title-input" />
          <textarea className={inp + ' h-16 py-2'} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="rounded-lg border border-[var(--border-color)] p-2.5">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="radio" checked={form.assign_mode === 'owner'} onChange={() => setForm(f => ({ ...f, assign_mode: 'owner' }))} className="accent-[#e94560]" />
              Auto — each school's own account manager
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mt-1.5 cursor-pointer">
              <input type="radio" checked={form.assign_mode === 'person'} onChange={() => setForm(f => ({ ...f, assign_mode: 'person' }))} className="accent-[#e94560]" />
              Assign all to one person
            </label>
            {form.assign_mode === 'person' && (
              <select className={inp + ' mt-2'} value={form.assigned_to}
                onChange={e => { const u = (spList || []).find(x => (x.email || x.value) === e.target.value); setForm(f => ({ ...f, assigned_to: e.target.value, assigned_name: u?.name || '' })); }}>
                <option value="">Select person…</option>
                {(spList || []).map(u => <option key={u.email || u.value} value={u.email || u.value}>{u.name || u.email || u.value}</option>)}
              </select>
            )}
          </div>
          <button className="h-10 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-60" disabled={busy} onClick={submit} data-testid="plan-activity-submit">
            {busy ? 'Planning…' : `Plan for ${schoolIds.length} school(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
