import React, { useEffect, useState, useMemo } from 'react';
import { delegation as delApi } from '../../lib/api';
import { Check, Eye, Search, ArrowDownUp, Calendar, UserCheck, Pencil, History, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const PINK = '#e94560';
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const PRI = { high: 'text-red-500', medium: 'text-amber-500', low: 'text-green-500' };
const STATUS = {
  pending: 'bg-orange-500/15 text-orange-500',
  completed: 'bg-blue-500/15 text-blue-500',
  verified: 'bg-green-500/15 text-green-500',
};

// "14:30" → "2:30 PM"; blank → ''
const fmtTime = (t) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':');
  const hh = +h, ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${m} ${ap}`;
};

// red "Not done" / amber "Partial" pill from the latest submission outcome.
function OutcomeBadge({ t }) {
  if (t.status !== 'pending' || !['not_done', 'partial'].includes(t.last_outcome)) return null;
  const sub = (t.submissions || []).filter(s => s.outcome === t.last_outcome).slice(-1)[0];
  const partial = t.last_outcome === 'partial';
  const tip = sub
    ? `${sub.note || ''}${partial && sub.expected_date ? ` (by ${sub.expected_date}${sub.expected_time ? ' ' + fmtTime(sub.expected_time) : ''})` : ''}`
    : '';
  return (
    <span title={tip}
      className={`ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${partial ? 'bg-amber-500/15 text-amber-600' : 'bg-red-500/15 text-red-500'}`}>
      {partial ? 'Partial' : 'Not done'}
    </span>
  );
}

export default function MyTasksTable({ myEmp, onSubmit, verifyInst, onEditTask, refreshKey, isManager, card, textPri, textSec, textMuted, inputCls }) {
  const [dir, setDir] = useState('to');        // 'to' = assigned to me, 'by' = assigned by me
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [historyInst, setHistoryInst] = useState(null);   // instance whose history is open
  const [selected, setSelected] = useState(new Set());     // selected instance_ids (manager multi-delete)
  const [delDlg, setDelDlg] = useState(null);              // { tasks: [{task_id, task_title}] }
  const [delReason, setDelReason] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const showSelect = dir === 'by' && isManager;            // admins can multi-select in "by me"
  useEffect(() => { setSelected(new Set()); }, [dir]);

  const load = async () => {
    if (!myEmp?.emp_id) { setRows([]); return; }
    setLoading(true);
    try {
      const params = dir === 'to' ? { emp_id: myEmp.emp_id } : { delegator_id: myEmp.emp_id };
      const r = await delApi.instances.list(params);
      setRows(r.data || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dir, myEmp, refreshKey]);

  const filtered = useMemo(() => rows.filter(t => {
    if (status && t.status !== status) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!t.task_title?.toLowerCase().includes(s) &&
        !t.emp_name?.toLowerCase().includes(s) &&
        !t.delegator_name?.toLowerCase().includes(s)) return false;
    }
    return true;
  }).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')), [rows, status, q]);

  const onVerify = async (inst) => { await verifyInst(inst.instance_id); load(); };

  const toggleSel = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const askDeleteOne = (t) => { setDelReason(''); setDelDlg({ tasks: [{ task_id: t.task_id, task_title: t.task_title }] }); };
  const askDeleteSelected = () => {
    const m = new Map();
    rows.filter(r => selected.has(r.instance_id)).forEach(r => m.set(r.task_id, r.task_title));
    if (!m.size) return;
    setDelReason('');
    setDelDlg({ tasks: [...m].map(([task_id, task_title]) => ({ task_id, task_title })) });
  };
  const confirmDelete = async () => {
    if (!delReason.trim() || !delDlg) return;
    setDelBusy(true);
    try {
      for (const tk of delDlg.tasks) await delApi.tasks.delete(tk.task_id, { reason: delReason.trim() });
      toast.success(`Deleted ${delDlg.tasks.length} task${delDlg.tasks.length !== 1 ? 's' : ''}`);
      setDelDlg(null); setSelected(new Set()); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Delete failed'); }
    finally { setDelBusy(false); }
  };

  if (!myEmp) {
    return <div className={`${card} border rounded-xl p-10 text-center`}>
      <p className={`text-sm ${textMuted}`}>Your tasks appear once your account is linked to the team.</p>
    </div>;
  }

  return (
    <div className="space-y-3">
      {/* toggle + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`${card} border rounded-xl p-1 flex gap-0.5`}>
          {[['to', 'Assigned to me'], ['by', 'Assigned by me']].map(([k, label]) => (
            <button key={k} onClick={() => setDir(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${dir === k ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={dir === k ? { background: PINK } : {}}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[140px]">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks…"
            className={`w-full pl-8 h-9 text-xs rounded-lg border px-2 focus:outline-none ${inputCls}`} />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className={`h-9 px-2 text-xs rounded-lg border border-[var(--border-color)] ${inputCls}`}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="verified">Verified</option>
        </select>
      </div>

      {showSelect && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: '#e9456012' }}>
          <span className="text-xs font-semibold" style={{ color: PINK }}>{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className={`text-xs px-2 py-1 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)]`}>Clear</button>
            <button onClick={askDeleteSelected} className="text-xs font-semibold px-3 py-1 rounded-lg text-white flex items-center gap-1" style={{ background: '#ef4444' }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete selected
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-7 w-7 border-4 border-[#e94560] border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${card} border rounded-xl p-10 text-center`}>
          <ArrowDownUp className={`h-8 w-8 mx-auto mb-2 opacity-20 ${textMuted}`} />
          <p className={`text-sm ${textMuted}`}>{dir === 'to' ? 'No tasks assigned to you.' : 'You haven’t assigned any tasks.'}</p>
        </div>
      ) : (
        <div className={`${card} border rounded-xl overflow-hidden`}>
          {/* desktop table */}
          <table className="w-full text-sm hidden sm:table">
            <thead>
              <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                {showSelect && (
                  <th className="py-2.5 pl-3 w-8">
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(t => selected.has(t.instance_id))}
                      onChange={e => setSelected(e.target.checked ? new Set(filtered.map(t => t.instance_id)) : new Set())} />
                  </th>
                )}
                {['Task', dir === 'to' ? 'From' : 'To', 'Due', 'Priority', 'Status', ''].map((h, i) => (
                  <th key={i} className={`py-2.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const overdue = t.status === 'pending' && t.due_date < TODAY;
                return (
                  <tr key={t.instance_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    {showSelect && (
                      <td className="pl-3 w-8">
                        <input type="checkbox" checked={selected.has(t.instance_id)} onChange={() => toggleSel(t.instance_id)} />
                      </td>
                    )}
                    <td className={`px-3 py-2.5 font-medium ${textPri}`}>{t.task_title}</td>
                    <td className={`px-3 py-2.5 ${textSec}`}>{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</td>
                    <td className={`px-3 py-2.5 ${overdue ? 'text-red-500 font-semibold' : textSec}`}>{t.due_date}{t.due_time ? ` · ${fmtTime(t.due_time)}` : ''}{overdue ? ' · overdue' : ''}</td>
                    <td className={`px-3 py-2.5 font-semibold capitalize ${PRI[t.priority] || textSec}`}>{t.priority}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[t.status]}`}>{t.status}</span><OutcomeBadge t={t} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {dir === 'to' && t.status === 'pending' && (
                          <button onClick={() => onSubmit(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white" style={{ background: '#10b981' }}>
                            <Check className="h-3 w-3 inline" /> Submit
                          </button>
                        )}
                        {t.status === 'completed' && (
                          <button onClick={() => onVerify(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-blue-500 hover:bg-blue-500/10">
                            <Eye className="h-3 w-3 inline" /> Verify
                          </button>
                        )}
                        {dir === 'by' && onEditTask && t.status !== 'verified' && (
                          <button onClick={() => onEditTask(t)} title="Edit task" className={`p-1.5 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)]`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {dir === 'by' && (
                          <button onClick={() => askDeleteOne(t)} title="Delete task" className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setHistoryInst(t)} title="Edit history" className={`p-1.5 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)]`}>
                          <History className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* mobile cards */}
          <div className="sm:hidden divide-y divide-[var(--border-color)]">
            {filtered.map(t => {
              const overdue = t.status === 'pending' && t.due_date < TODAY;
              return (
                <div key={t.instance_id} className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium ${textPri}`}>{t.task_title}</p>
                    <span className="flex-shrink-0 flex items-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[t.status]}`}>{t.status}</span>
                      <OutcomeBadge t={t} />
                    </span>
                  </div>
                  <div className={`flex items-center gap-3 text-[11px] ${textMuted} flex-wrap`}>
                    <span className={`flex items-center gap-1 ${overdue ? 'text-red-500 font-semibold' : ''}`}><Calendar className="h-3 w-3" />{t.due_date}{t.due_time ? ` · ${fmtTime(t.due_time)}` : ''}{overdue ? ' · overdue' : ''}</span>
                    <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</span>
                    <span className={`capitalize ${PRI[t.priority] || ''}`}>{t.priority}</span>
                  </div>
                  {(dir === 'to' && t.status === 'pending') && (
                    <button onClick={() => onSubmit(t)} className="w-full h-11 rounded-lg text-sm font-semibold text-white mt-1" style={{ background: '#10b981' }}>
                      <Check className="h-4 w-4 inline mr-1" /> Submit Task
                    </button>
                  )}
                  {t.status === 'completed' && (
                    <button onClick={() => onVerify(t)} className="w-full h-11 rounded-lg text-sm font-semibold text-blue-500 border border-[var(--border-color)] mt-1">
                      <Eye className="h-4 w-4 inline mr-1" /> Verify
                    </button>
                  )}
                  <div className="flex gap-2 mt-1">
                    {dir === 'by' && onEditTask && t.status !== 'verified' && (
                      <button onClick={() => onEditTask(t)} className={`flex-1 h-10 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec}`}>
                        <Pencil className="h-3.5 w-3.5 inline mr-1" /> Edit
                      </button>
                    )}
                    {dir === 'by' && (
                      <button onClick={() => askDeleteOne(t)} className="flex-1 h-10 rounded-lg text-xs font-semibold border border-red-500/30 text-red-500">
                        <Trash2 className="h-3.5 w-3.5 inline mr-1" /> Delete
                      </button>
                    )}
                    <button onClick={() => setHistoryInst(t)} className={`flex-1 h-10 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textMuted}`}>
                      <History className="h-3.5 w-3.5 inline mr-1" /> History
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {delDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !delBusy && setDelDlg(null)}>
          <div className={`${card} border rounded-2xl w-full max-w-sm`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border-color)]">
              <h3 className={`text-sm font-semibold ${textPri}`}>Delete {delDlg.tasks.length > 1 ? `${delDlg.tasks.length} tasks` : 'task'}</h3>
              <p className={`text-xs ${textMuted} mt-0.5 truncate`}>
                {delDlg.tasks.length === 1 ? delDlg.tasks[0].task_title : delDlg.tasks.map(t => t.task_title).join(', ')}
              </p>
            </div>
            <div className="p-5 space-y-2">
              <label className={`block text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>Reason (required)</label>
              <textarea value={delReason} onChange={e => setDelReason(e.target.value)} rows={3}
                placeholder="Why is this being deleted? (saved to the deletion log)"
                className={`w-full px-2.5 py-2 text-sm rounded-lg border border-[var(--border-color)] ${inputCls}`} />
              <p className={`text-[11px] ${textMuted}`}>This removes the task for everyone. The reason + who/when is kept in the audit log.</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setDelDlg(null)} disabled={delBusy} className={`h-9 px-3 rounded-lg text-sm border border-[var(--border-color)] ${textSec}`}>Cancel</button>
              <button onClick={confirmDelete} disabled={delBusy || !delReason.trim()}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#ef4444' }}>
                {delBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyInst && (() => {
        const FIELD_LABEL = {
          title: 'Title', description: 'Description', priority: 'Priority',
          task_type: 'Type', frequency: 'Frequency', target_date: 'Date',
          start_date: 'Start', end_date: 'End', require_verification: 'Needs verification',
          requires_image: 'Photo required', buddy_emp_id: 'Buddy', assignees: 'Assignees',
          due_date: 'Due date', completion_note: 'Completion note', emp_id: 'Assignee',
        };
        const fmt = (v) => v === true ? 'Yes' : v === false ? 'No' : (v === '' || v == null) ? '—' : String(v);
        const log = [...(historyInst.change_log || [])].reverse();   // newest first
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryInst(null)}>
            <div className={`${card} border rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border-color)]">
                <div>
                  <h3 className={`text-sm font-semibold ${textPri}`}>Edit history</h3>
                  <p className={`text-xs ${textMuted} mt-0.5`}>{historyInst.task_title}</p>
                </div>
                <button onClick={() => setHistoryInst(null)} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
              </div>
              <div className="p-5 space-y-3">
                {log.length === 0 ? (
                  <p className={`text-sm ${textMuted} text-center py-6`}>No changes recorded yet.</p>
                ) : log.map((e, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#e94560' }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${textPri}`}>
                        <span className="font-semibold">{FIELD_LABEL[e.field] || e.field}</span>
                        {e.note ? ` — ${e.note}` : <>: <span className={textMuted}>{fmt(e.from)}</span> → <span>{fmt(e.to)}</span></>}
                      </p>
                      <p className={`text-[11px] ${textMuted} mt-0.5`}>
                        {e.by || 'system'}{e.at ? ` · ${new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
