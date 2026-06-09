import React, { useEffect, useState, useMemo } from 'react';
import { delegation as delApi } from '../../lib/api';
import { Check, Eye, Search, ArrowDownUp, Calendar, UserCheck } from 'lucide-react';

const PINK = '#e94560';
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const PRI = { high: 'text-red-500', medium: 'text-amber-500', low: 'text-green-500' };
const STATUS = {
  pending: 'bg-orange-500/15 text-orange-500',
  completed: 'bg-blue-500/15 text-blue-500',
  verified: 'bg-green-500/15 text-green-500',
};

export default function MyTasksTable({ myEmp, completeInst, verifyInst, card, textPri, textSec, textMuted, inputCls }) {
  const [dir, setDir] = useState('to');        // 'to' = assigned to me, 'by' = assigned by me
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dir, myEmp]);

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

  const onDone = async (inst) => { await completeInst(inst); load(); };
  const onVerify = async (inst) => { await verifyInst(inst.instance_id); load(); };

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
                    <td className={`px-3 py-2.5 font-medium ${textPri}`}>{t.task_title}</td>
                    <td className={`px-3 py-2.5 ${textSec}`}>{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</td>
                    <td className={`px-3 py-2.5 ${overdue ? 'text-red-500 font-semibold' : textSec}`}>{t.due_date}{overdue ? ' · overdue' : ''}</td>
                    <td className={`px-3 py-2.5 font-semibold capitalize ${PRI[t.priority] || textSec}`}>{t.priority}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[t.status]}`}>{t.status}</span></td>
                    <td className="px-3 py-2.5 text-right">
                      {dir === 'to' && t.status === 'pending' && (
                        <button onClick={() => onDone(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white" style={{ background: '#10b981' }}>
                          <Check className="h-3 w-3 inline" /> Done
                        </button>
                      )}
                      {t.status === 'completed' && (
                        <button onClick={() => onVerify(t)} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-blue-500 hover:bg-blue-500/10">
                          <Eye className="h-3 w-3 inline" /> Verify
                        </button>
                      )}
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
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS[t.status]}`}>{t.status}</span>
                  </div>
                  <div className={`flex items-center gap-3 text-[11px] ${textMuted} flex-wrap`}>
                    <span className={`flex items-center gap-1 ${overdue ? 'text-red-500 font-semibold' : ''}`}><Calendar className="h-3 w-3" />{t.due_date}{overdue ? ' · overdue' : ''}</span>
                    <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{dir === 'to' ? (t.delegator_name || '—') : t.emp_name}</span>
                    <span className={`capitalize ${PRI[t.priority] || ''}`}>{t.priority}</span>
                  </div>
                  {(dir === 'to' && t.status === 'pending') && (
                    <button onClick={() => onDone(t)} className="w-full h-8 rounded-lg text-xs font-semibold text-white mt-1" style={{ background: '#10b981' }}>
                      <Check className="h-3.5 w-3.5 inline mr-1" /> Mark Done
                    </button>
                  )}
                  {t.status === 'completed' && (
                    <button onClick={() => onVerify(t)} className="w-full h-8 rounded-lg text-xs font-semibold text-blue-500 border border-[var(--border-color)] mt-1">
                      <Eye className="h-3.5 w-3.5 inline mr-1" /> Verify
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
