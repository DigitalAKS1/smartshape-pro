import React, { useState, useEffect, useCallback } from 'react';
import { mailRuns } from '../../lib/api';
import { GitCompareArrows } from 'lucide-react';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const GROUPS = [['run', 'By run'], ['sequence', 'By sequence'], ['owner', 'By rep'], ['school', 'By school']];

/** Planned vs actual: how much slipped, and — via the reason Pareto — what to fix. */
export default function GapReportPanel() {
  const [groupBy, setGroupBy] = useState('run');
  const [data, setData] = useState({ rows: [], totals: {}, reasons: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await mailRuns.gapReport({ group_by: groupBy }); setData(r.data); }
    catch { /* non-fatal panel */ }
    finally { setLoading(false); }
  }, [groupBy]);
  useEffect(() => { load(); }, [load]);

  const t = data.totals || {};
  if (!loading && !t.planned) return null;

  const kpis = [
    { label: 'Planned', val: t.planned ?? 0 },
    { label: 'Posted', val: t.sent ?? 0 },
    { label: 'Not sent', val: t.not_sent ?? 0, bad: (t.not_sent || 0) > 0 },
    { label: 'Still pending', val: t.pending ?? 0, bad: (t.pending || 0) > 0 },
    { label: 'Printed, not posted', val: t.printed_not_posted ?? 0, bad: (t.printed_not_posted || 0) > 0 },
    { label: 'On time', val: t.on_time_pct == null ? '—' : `${t.on_time_pct}%` },
    { label: 'Avg days late', val: t.avg_days_late == null ? '—' : t.avg_days_late },
    { label: 'Postage at risk', val: inr(t.postage_exposure) },
  ];

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5" data-testid="gap-report">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-[#e94560]" /> Plan vs Actual
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">What you planned to post against what really went out.</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {GROUPS.map(([k, label]) => (
            <button key={k} onClick={() => setGroupBy(k)} data-testid={`gap-group-${k}`}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${groupBy === k ? 'bg-[#e94560] text-white border-[#e94560]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {kpis.map((k, i) => (
          <div key={i} className={`rounded-xl p-3 border ${k.bad ? 'border-[#C4402E]/40 bg-[#C4402E]/5' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{k.label}</div>
            <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">{k.val}</div>
          </div>
        ))}
      </div>

      {data.reasons?.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Why pieces didn't go out</div>
          <div className="flex flex-wrap gap-1.5">
            {data.reasons.map(r => (
              <span key={r.reason} className="text-[11px] px-2 py-1 rounded-full bg-[#C4402E]/10 text-[#C4402E] border border-[#C4402E]/25">
                {r.reason} · <b>{r.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
              <th className="py-2 pr-3">{GROUPS.find(g => g[0] === groupBy)[1].replace('By ', '')}</th>
              <th className="py-2 pr-3">Planned</th><th className="py-2 pr-3">Posted</th>
              <th className="py-2 pr-3">Not sent</th><th className="py-2 pr-3">Pending</th>
              <th className="py-2 pr-3" title="Stickers printed but never posted">Leaked</th>
              <th className="py-2 pr-3">On time</th><th className="py-2 pr-3">Avg late</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.key} className="border-t border-[var(--border-color)]" data-testid={`gap-row-${r.key}`}>
                <td className="py-2.5 pr-3 text-[var(--text-primary)] font-medium">{r.label}</td>
                <td className="py-2.5 pr-3 font-mono">{r.planned}</td>
                <td className="py-2.5 pr-3 font-mono text-[#2E7D5B] font-semibold">{r.sent}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.not_sent ? '#C4402E' : undefined }}>{r.not_sent}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.pending ? '#9A6A15' : undefined }}>{r.pending}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.printed_not_posted ? '#C4402E' : undefined }}>{r.printed_not_posted}</td>
                <td className="py-2.5 pr-3 font-mono">{r.on_time_pct == null ? '—' : `${r.on_time_pct}%`}</td>
                <td className="py-2.5 pr-3 font-mono">{r.avg_days_late == null ? '—' : r.avg_days_late}</td>
              </tr>
            ))}
            {!loading && data.rows.length === 0 && <tr><td colSpan="8" className="py-6 text-center text-[var(--text-muted)]">Nothing posted or planned yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-3">
        <b>Leaked</b> = a sticker was printed but the piece was never posted. <b>Postage at risk</b> is the budgeted courier cost sitting on pieces that never went out.
      </p>
    </div>
  );
}
