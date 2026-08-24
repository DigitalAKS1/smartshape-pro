import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { activities, dealTypes } from '../../lib/api';
import { X, ClipboardList, Phone, MessageCircle, Mail, Truck, Video, MapPin } from 'lucide-react';

// Channel-first "plan a touch" (Phase 1c). Pick a channel → each selected school
// gets one planned activity on that channel, landing on the calendar + the rep's
// daily queue + the engagement timeline. Auto-assigns to each school's own
// account manager, or all to one person.
const CHANNELS = [
  { key: 'call',     label: 'Call',     type: 'Call',     color: '#3b82f6', icon: Phone,         title: 'Follow-up call' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'WhatsApp', color: '#22c55e', icon: MessageCircle, title: 'WhatsApp check-in' },
  { key: 'email',    label: 'Email',    type: 'Email',    color: '#0ea5e9', icon: Mail,          title: 'Send email' },
  { key: 'mail',     label: 'Post',     type: 'Post',     color: '#f59e0b', icon: Truck,         title: 'Send catalogue by post' },
  { key: 'meeting',  label: 'Meeting',  type: 'Meeting',  color: '#6366f1', icon: Video,         title: 'Schedule meeting' },
  { key: 'visit',    label: 'Visit',    type: 'Visit',    color: '#06b6d4', icon: MapPin,        title: 'Plan school visit' },
  { key: 'other',    label: 'Task',     type: 'Task',     color: '#64748b', icon: ClipboardList, title: '' },
];
const DEFAULT_TITLES = CHANNELS.map(c => c.title).filter(Boolean);

export default function PlanActivityDialog({ open, onClose, schoolIds = [], spList = [], onDone }) {
  const [form, setForm] = useState({
    channel: '', activity_type: '', title: '', due_date: '', notes: '', deal_type: '',
    assign_mode: 'owner', assigned_to: '', assigned_name: '',
  });
  const [dealTypesList, setDealTypesList] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    dealTypes.getAll().then(r => setDealTypesList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [open]);

  if (!open) return null;

  const pickChannel = (c) => {
    setForm(f => {
      // Only overwrite the title if it is still a default (untouched by the user).
      const titleIsAuto = !f.title || DEFAULT_TITLES.includes(f.title);
      return { ...f, channel: c.key, activity_type: c.type,
               title: titleIsAuto ? c.title : f.title };
    });
  };

  const submit = async () => {
    if (!form.channel) { toast.error('Pick a channel'); return; }
    if (!form.title.trim()) { toast.error('Add a title'); return; }
    if (form.assign_mode === 'person' && !form.assigned_to) { toast.error('Pick a person to assign to'); return; }
    setBusy(true);
    try {
      const r = await activities.bulk({ school_ids: schoolIds, ...form });
      const fb = r.data.unassigned_fallback;
      toast.success(`Planned ${r.data.created} ${form.activity_type || 'touch'}${r.data.created === 1 ? '' : 's'}${fb ? ` · ${fb} had no owner → assigned to you` : ''}`);
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
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><ClipboardList className="h-4 w-4 text-[#e94560]" /> Plan a Touch</h3>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">For <b className="text-[var(--text-secondary)]">{schoolIds.length}</b> selected school(s).</p>
        <div className="grid gap-3">

          {/* Channel picker */}
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Channel</label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5">
              {CHANNELS.map(c => {
                const on = form.channel === c.key;
                const Icon = c.icon;
                return (
                  <button key={c.key} type="button" onClick={() => pickChannel(c)}
                    data-testid={`channel-${c.key}`}
                    className="flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors"
                    style={{
                      borderColor: on ? c.color : 'var(--border-color)',
                      background: on ? c.color + '18' : 'transparent',
                      color: on ? c.color : 'var(--text-secondary)',
                    }}>
                    <Icon className="h-4 w-4" style={{ color: c.color }} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Deal Type</label>
            <select className={inp + ' mt-1.5'} value={form.deal_type}
              onChange={e => setForm(f => ({ ...f, deal_type: e.target.value }))} data-testid="deal-type-select">
              <option value="">Deal type (optional)…</option>
              {dealTypesList.map(d => <option key={d.deal_type_id || d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input className={inp} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} data-testid="activity-due-date" />
            <input className={inp} placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} data-testid="activity-title-input" />
          </div>
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
