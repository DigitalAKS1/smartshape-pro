import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { activities } from '../../lib/api';
import { ClipboardList, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

// Manager view: every planned activity across schools, filter by rep / type /
// status. "Overdue" = still pending with a due date in the past.
export default function ActivityMonitor() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ rep: '', type: '', status: '' });

  const load = useCallback(async () => {
    try { const r = await activities.list(); setRows(r.data || []); }
    catch { toast.error('Failed to load activities'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reps = useMemo(() => Array.from(new Set(rows.map(r => r.assigned_name || r.assigned_to).filter(Boolean))).sort(), [rows]);
  const types = useMemo(() => Array.from(new Set(rows.map(r => r.activity_type).filter(Boolean))).sort(), [rows]);

  const filtered = rows.filter(r => {
    if (f.rep && (r.assigned_name || r.assigned_to) !== f.rep) return false;
    if (f.type && r.activity_type !== f.type) return false;
    if (f.status === 'overdue' && !r.overdue) return false;
    if (f.status && f.status !== 'overdue' && r.status !== f.status) return false;
    return true;
  });

  const counts = {
    pending: rows.filter(r => r.status === 'pending').length,
    done: rows.filter(r => r.status === 'done').length,
    overdue: rows.filter(r => r.overdue).length,
  };

  const markDone = async (a) => {
    try { await activities.update(a.activity_id, { status: a.status === 'done' ? 'pending' : 'done' }); load(); }
    catch { toast.error('Update failed'); }
  };

  const inp = 'h-9 rounded-lg px-2.5 text-sm bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const Stat = ({ icon: I, label, n, color }) => (
    <div className="flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3.5 flex items-center gap-3">
      <I className="h-5 w-5" style={{ color }} />
      <div><div className="text-[11px] text-[var(--text-muted)]">{label}</div><div className="text-xl font-bold font-mono" style={{ color }}>{n}</div></div>
    </div>
  );

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-[#e94560]" /> Activity Monitor
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Every planned activity across schools, by rep. Overdue = still pending past its due date.</p>
        </div>

        <div className="flex gap-3 mb-4">
          <Stat icon={Clock} label="Pending" n={counts.pending} color="#9A6A15" />
          <Stat icon={AlertTriangle} label="Overdue" n={counts.overdue} color="#C4402E" />
          <Stat icon={CheckCircle2} label="Done" n={counts.done} color="#2E7D5B" />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <select className={inp} value={f.rep} onChange={e => setF(p => ({ ...p, rep: e.target.value }))}><option value="">All reps</option>{reps.map(r => <option key={r} value={r}>{r}</option>)}</select>
          <select className={inp} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}><option value="">All types</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className={inp} value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value }))}><option value="">All status</option><option value="pending">Pending</option><option value="overdue">Overdue</option><option value="done">Done</option></select>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-x-auto">
          {loading ? <div className="py-16 text-center text-[var(--text-muted)]">Loading…</div> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                  <th className="py-2.5 px-3">School</th><th className="py-2.5 px-3">Activity</th><th className="py-2.5 px-3">Assigned</th><th className="py-2.5 px-3">Due</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.activity_id} className="border-t border-[var(--border-color)]" data-testid={`activity-${a.activity_id}`}>
                    <td className="py-2.5 px-3 text-[var(--text-primary)] font-medium">{a.school_name}</td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]"><span className="text-[11px] font-semibold text-[#e94560]">{a.activity_type}</span> · {a.title}</td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]">{a.assigned_name || a.assigned_to || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-xs" style={{ color: a.overdue ? '#C4402E' : 'var(--text-secondary)' }}>{a.due_date || '—'}</td>
                    <td className="py-2.5 px-3">
                      {a.status === 'done'
                        ? <span className="text-[11px] font-semibold text-[#2E7D5B]">✓ done</span>
                        : <span className="text-[11px] font-semibold" style={{ color: a.overdue ? '#C4402E' : '#9A6A15' }}>{a.overdue ? 'overdue' : 'pending'}</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <button onClick={() => markDone(a)} className="text-[11px] font-semibold text-[#e94560] hover:underline">{a.status === 'done' ? 'reopen' : 'mark done'}</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="6" className="py-8 text-center text-[var(--text-muted)]">No activities. Plan some from the Schools tab (select schools → Plan Activity).</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
