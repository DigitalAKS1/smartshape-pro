import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { activities } from '../../lib/api';
import { ClipboardList, CheckCircle2, Clock, AlertTriangle, Users } from 'lucide-react';

// Manager view: every planned activity across schools, filter by rep / type /
// status. "Overdue" = still pending with a due date in the past.
export default function ActivityMonitor() {
  const [rows, setRows] = useState([]);
  const [scorecard, setScorecard] = useState({ reps: [], totals: {} });
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ rep: '', type: '', status: '' });

  const load = useCallback(async () => {
    try {
      const [r, sc] = await Promise.all([activities.list(), activities.scorecard()]);
      setRows(r.data || []);
      setScorecard(sc.data || { reps: [], totals: {} });
    } catch { toast.error('Failed to load activities'); }
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

        {/* REP SCORECARD — who is keeping up with the tasks the system assigns */}
        {!loading && scorecard.reps.length > 0 && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Users className="h-4 w-4 text-[#e94560]" /> Rep Scorecard</h2>
              <span className="text-[11px] text-[var(--text-muted)]">team completion <b className="text-[var(--text-secondary)]">{Math.round((scorecard.totals.completion_rate || 0) * 100)}%</b></span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                    <th className="py-1.5 pr-3">Rep</th><th className="py-1.5 pr-3">Done</th><th className="py-1.5 pr-3">Pending</th>
                    <th className="py-1.5 pr-3">Overdue</th><th className="py-1.5 pr-3 w-[34%]">Completion</th><th className="py-1.5 pr-3">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.reps.map(r => {
                    const pct = Math.round((r.completion_rate || 0) * 100);
                    const col = pct >= 80 ? '#2E7D5B' : pct >= 50 ? '#9A6A15' : '#C4402E';
                    const name = r.assigned_name || r.assigned_to || '—';
                    const active = f.rep === name;
                    return (
                      <tr key={r.assigned_to || name} onClick={() => setF(p => ({ ...p, rep: active ? '' : name }))}
                        className={`border-t border-[var(--border-color)] cursor-pointer ${active ? 'bg-[#e94560]/5' : 'hover:bg-[var(--bg-primary)]'}`}
                        data-testid={`scorecard-${r.assigned_to}`}>
                        <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">{name}</td>
                        <td className="py-2 pr-3 font-mono text-[#2E7D5B]">{r.done}</td>
                        <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">{r.pending}</td>
                        <td className="py-2 pr-3 font-mono font-semibold" style={{ color: r.overdue ? '#C4402E' : 'var(--text-muted)' }}>{r.overdue}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden max-w-[160px]">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                            </div>
                            <span className="font-mono text-xs font-semibold" style={{ color: col }}>{pct}%</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.oldest_overdue_days > 0 ? '#C4402E' : 'var(--text-muted)' }}>
                          {r.oldest_overdue_days > 0 ? `${r.oldest_overdue_days}d` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">Click a rep to filter the list below. Sorted worst-first (most overdue on top).</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <select className={inp} value={f.rep} onChange={e => setF(p => ({ ...p, rep: e.target.value }))}><option value="">All reps</option>{reps.map(r => <option key={r} value={r}>{r}</option>)}</select>
          <select className={inp} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}><option value="">All types</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select className={inp} value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value }))}><option value="">All status</option><option value="pending">Pending</option><option value="overdue">Overdue</option><option value="done">Done</option></select>
        </div>

        {/* Mobile: each task as a card (the 6-col table is cramped on a phone) */}
        <div className="sm:hidden grid gap-2.5">
          {loading ? <div className="py-16 text-center text-[var(--text-muted)]">Loading…</div> : filtered.map(a => (
            <div key={a.activity_id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3" data-testid={`activity-card-${a.activity_id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.school_name}</p>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-0.5"><span className="font-semibold text-[#e94560]">{a.activity_type}</span> · {a.title}</p>
                </div>
                {a.status === 'done'
                  ? <span className="text-[11px] font-semibold text-[#2E7D5B] flex-shrink-0">✓ done</span>
                  : <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: a.overdue ? '#C4402E' : '#9A6A15' }}>{a.overdue ? 'overdue' : 'pending'}</span>}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-[var(--text-muted)]">{a.assigned_name || a.assigned_to || '—'}{a.due_date ? ` · due ${a.due_date}` : ''}</span>
                <button onClick={() => markDone(a)} className="text-[12px] font-semibold text-[#e94560]">{a.status === 'done' ? 'reopen' : 'mark done'}</button>
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No activities. Plan some from the Schools tab.</p>}
        </div>

        {/* Desktop: full table */}
        <div className="hidden sm:block rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-x-auto">
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
