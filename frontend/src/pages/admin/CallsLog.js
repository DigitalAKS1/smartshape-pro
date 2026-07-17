import React, { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Phone, PhoneCall, PhoneOff, RefreshCw, Forward } from 'lucide-react';
import { telephonyApi } from '../../lib/api';

const OUTCOME = {
  connected: { label: 'Connected', cls: 'bg-green-100 text-green-700' },
  no_answer: { label: 'No answer', cls: 'bg-amber-100 text-amber-700' },
  busy:      { label: 'Busy',      cls: 'bg-orange-100 text-orange-700' },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700' },
};

// Derive a display outcome from a telephony_calls row (mirrors the widget).
function outcomeOf(row) {
  const s = (row.status || '').toLowerCase();
  if (['answered', 'bridged', 'connected', 'completed'].includes(s) && (row.duration_sec || 0) > 0) return 'connected';
  if (row.end_time || ['no-answer', 'noanswer'].includes(s)) return s === 'busy' ? 'busy' : (['failed', 'cancelled'].includes(s) ? 'failed' : 'no_answer');
  if (s === 'busy') return 'busy';
  if (['failed', 'cancelled'].includes(s)) return 'failed';
  if (['dialing', 'pending', 'ringing'].includes(s)) return null; // in-progress
  return 'no_answer';
}

const fmtDur = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—';
};
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso.slice(0, 16).replace('T', ' ') : d.toLocaleString();
};

export default function CallsLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = () => {
    setLoading(true);
    telephonyApi.listCalls()
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const todays = rows.filter(r => (r.created_at || '').slice(0, 10) === today);
    const connected = todays.filter(r => outcomeOf(r) === 'connected').length;
    return { total: todays.length, connected, missed: todays.length - connected };
  }, [rows, today]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r =>
      (r.target_phone || '').toLowerCase().includes(t) ||
      (r.rep_name || '').toLowerCase().includes(t) ||
      (r.rep_email || '').toLowerCase().includes(t));
  }, [rows, q]);

  const Stat = ({ label, value, cls }) => (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-semibold ${cls || 'text-[var(--text-primary)]'}`}>{value}</p>
    </div>
  );

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
              <PhoneCall className="h-7 w-7 text-[#e94560]" /> Call Log
            </h1>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">Every click-to-call, its outcome and recording.</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-lg">
          <Stat label="Calls today" value={stats.total} />
          <Stat label="Connected" value={stats.connected} cls="text-green-600" />
          <Stat label="Missed / failed" value={stats.missed} cls="text-amber-600" />
        </div>

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search phone or rep…"
          className="w-full max-w-sm h-10 px-3 rounded-md text-sm bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]" />

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Rep</th>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Recording</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--text-muted)]">
                    <Phone className="h-8 w-8 mx-auto mb-2 opacity-40" /> No calls yet.
                  </td></tr>
                )}
                {filtered.map((r) => {
                  const oc = outcomeOf(r);
                  const badge = oc ? OUTCOME[oc] : { label: r.status || 'In progress…', cls: 'bg-blue-100 text-blue-700' };
                  return (
                    <tr key={r.event_id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-hover)]">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)] whitespace-nowrap">{r.rep_name || r.rep_email || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-mono text-xs whitespace-nowrap">{r.target_phone || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                        {r.forwarded_to && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]" title={`Forwarded to ${r.forwarded_to}`}>
                            <Forward className="h-3 w-3" /> fwd
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDur(r.duration_sec)}</td>
                      <td className="px-4 py-2.5">
                        {r.recording_url
                          ? <audio controls preload="none" src={r.recording_url} className="h-8 w-44" />
                          : <span className="text-[var(--text-muted)] inline-flex items-center gap-1"><PhoneOff className="h-3.5 w-3.5" /> —</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
