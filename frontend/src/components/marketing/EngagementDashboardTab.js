import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { engagement } from '../../lib/api';
import { Loader2, TrendingUp, Flame, Send, Trophy, BookOpen, Repeat, AlertTriangle, Award, Clock, Activity } from 'lucide-react';
import DrillDownPanel from './DrillDownPanel';

const STAGE_META = {
  new: { label: 'New', color: '#64748b' },
  contacted: { label: 'Contacted', color: '#0ea5e9' },
  demo: { label: 'Demo', color: '#8b5cf6' },
  quoted: { label: 'Quoted', color: '#f59e0b' },
  negotiation: { label: 'Negotiation', color: '#ec4899' },
  won: { label: 'Won', color: '#10b981' },
  lost: { label: 'Lost', color: '#ef4444' },
};
const CH_COLOR = {
  call: '#3b82f6', whatsapp: '#22c55e', email: '#0ea5e9', mail: '#f59e0b',
  drip: '#06b6d4', greeting: '#ec4899', brochure: '#f97316', meeting: '#6366f1',
  webinar: '#7c3aed', sms: '#14b8a6', activity: '#64748b',
};
const money = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`;
  return `₹${v}`;
};

function Kpi({ icon: Icon, label, value, sub, color, onClick }) {
  const clickable = !!onClick;
  return (
    <div onClick={onClick}
      className={`bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 ${clickable ? 'cursor-pointer hover:border-[var(--text-muted)] active:scale-[0.99] transition-all' : ''}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '1a' }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </span>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] font-mono leading-none">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
  );
}

export default function EngagementDashboardTab() {
  const nav = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [attr, setAttr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState({ open: false, loading: false, title: '', rows: [] });

  const openDrill = async (metric, value = '') => {
    setDrill({ open: true, loading: true, title: '', rows: [] });
    try {
      const r = await engagement.drill(metric, value, days);
      setDrill({ open: true, loading: false, title: r.data.title, rows: r.data.rows || [] });
    } catch {
      setDrill({ open: true, loading: false, title: 'Details', rows: [] });
    }
  };
  const closeDrill = () => setDrill(d => ({ ...d, open: false }));

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      engagement.dashboard(days).then(r => r.data).catch(() => null),
      engagement.attribution(Math.max(days, 90)).then(r => r.data).catch(() => null),
    ]).then(([d, a]) => { if (live) { setData(d); setAttr(a); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [days]);

  if (loading) {
    return <div className="flex items-center justify-center h-72"><Loader2 className="h-8 w-8 animate-spin text-[#e94560]" /></div>;
  }
  if (!data) return <div className="p-6 text-[var(--text-muted)]">Could not load the engagement dashboard.</div>;

  const funnelMax = Math.max(1, ...data.funnel.map(f => f.count));
  const chMax = Math.max(1, ...data.channels.map(c => c.out + c.in));

  return (
    <div className="space-y-5">
      {/* Header + period */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Engagement scoreboard</h2>
          <p className="text-[11px] text-[var(--text-muted)]">Tap any number to see the records behind it →</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-lg text-xs font-semibold border ${days === d
                ? 'bg-[#e94560] border-[#e94560] text-white'
                : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="Active leads" value={data.totals.active_leads} color="#0ea5e9" />
        <Kpi icon={Trophy} label="Won" value={data.totals.won_count} sub={money(data.totals.won_value)} color="#10b981" />
        <Kpi icon={Send} label={`Touches · ${days}d`} value={data.touches_total} color="#6366f1" />
        <Kpi icon={Flame} label="Hot signals" value={data.hot_signals} sub="brochure opens" color="#f97316"
          onClick={() => openDrill('hot_signals')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pipeline funnel */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)] mb-3">Pipeline funnel</p>
          <div className="space-y-2.5">
            {data.funnel.map(f => {
              const m = STAGE_META[f.stage] || { label: f.stage, color: '#64748b' };
              return (
                <button key={f.stage} type="button" onClick={() => f.count && openDrill('stage', f.stage)}
                  className={`w-full flex items-center gap-3 rounded ${f.count ? 'hover:opacity-80 active:scale-[0.99] transition-all' : 'cursor-default'}`}>
                  <span className="w-20 text-xs font-medium text-[var(--text-secondary)] flex-shrink-0 text-left">{m.label}</span>
                  <div className="flex-1 h-5 rounded bg-[var(--bg-primary)] overflow-hidden">
                    <div className="h-full rounded flex items-center px-2 min-w-[24px] transition-all"
                      style={{ width: `${Math.max(6, (f.count / funnelMax) * 100)}%`, background: m.color }}>
                      <span className="text-[10px] font-bold text-white font-mono">{f.count}</span>
                    </div>
                  </div>
                  <span className="w-16 text-right text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">{f.value ? money(f.value) : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Channel mix */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)] mb-3">Touches by channel · {days}d</p>
          {data.channels.length === 0 ? (
            <p className="text-sm italic text-[var(--text-muted)] py-6 text-center">No touches recorded in this window yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.channels.map(c => {
                const color = CH_COLOR[c.channel] || '#94a3b8';
                const total = c.out + c.in;
                return (
                  <button key={c.channel} type="button" onClick={() => openDrill('channel', c.channel)}
                    className="w-full flex items-center gap-3 rounded hover:opacity-80 active:scale-[0.99] transition-all">
                    <span className="w-20 text-xs font-medium text-[var(--text-secondary)] capitalize flex-shrink-0 text-left">{c.channel}</span>
                    <div className="flex-1 h-5 rounded bg-[var(--bg-primary)] overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.max(6, (total / chMax) * 100)}%`, background: color }} />
                    </div>
                    <span className="w-24 text-right text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">
                      {c.out} sent{c.in ? ` · ${c.in} in` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Brochure + sequences strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi icon={BookOpen} label="Brochures shared" value={data.brochures.shared} color="#f97316"
          onClick={() => openDrill('brochures_shared')} />
        <Kpi icon={BookOpen} label="Brochure open rate" value={`${data.brochures.open_rate}%`} sub={`${data.brochures.opened} opened`} color="#22c55e"
          onClick={() => openDrill('brochures_opened')} />
        <Kpi icon={Repeat} label="Active sequences" value={data.sequences_active} color="#06b6d4" />
      </div>

      {/* What wins deals — close attribution */}
      {attr && (
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Award className="h-4 w-4 text-emerald-500" />
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)]">
              What wins deals · last {attr.days}d
            </p>
          </div>
          {attr.won_count === 0 ? (
            <p className="text-sm italic text-[var(--text-muted)] py-4 text-center">No deals won in this window yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-[var(--text-primary)] leading-none">{attr.won_count}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-1 flex items-center justify-center gap-1"><Trophy className="h-3 w-3" /> won</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-[var(--text-primary)] leading-none">{attr.avg_touches}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-1 flex items-center justify-center gap-1"><Activity className="h-3 w-3" /> avg touches</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-[var(--text-primary)] leading-none">{attr.avg_days_to_close ?? '—'}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-1 flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> days to close</p>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mb-2">Share of won deals that had each touch:</p>
              <div className="space-y-2">
                {attr.signals.map(s => (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="w-28 text-xs font-medium text-[var(--text-secondary)] flex-shrink-0">{s.label}</span>
                    <div className="flex-1 h-5 rounded bg-[var(--bg-primary)] overflow-hidden">
                      <div className="h-full rounded flex items-center px-2 min-w-[28px] transition-all"
                        style={{ width: `${Math.max(8, s.pct)}%`, background: '#10b981' }}>
                        <span className="text-[10px] font-bold text-white font-mono">{s.pct}%</span>
                      </div>
                    </div>
                    <span className="w-14 text-right text-[11px] text-[var(--text-muted)] font-mono flex-shrink-0">{s.count}/{attr.won_count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Stuck deals */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)]">Stuck deals — quoted/negotiating, quiet 14+ days</p>
        </div>
        {data.stuck.length === 0 ? (
          <p className="text-sm italic text-[var(--text-muted)] py-4 text-center">Nothing stuck — every quote is being worked. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="text-left font-semibold py-1.5">School</th>
                  <th className="text-left font-semibold">Stage</th>
                  <th className="text-right font-semibold">Value</th>
                  <th className="text-left font-semibold pl-3">Owner</th>
                  <th className="text-right font-semibold">Silent</th>
                </tr>
              </thead>
              <tbody>
                {data.stuck.map(s => {
                  const m = STAGE_META[s.stage] || { label: s.stage, color: '#64748b' };
                  return (
                    <tr key={s.lead_id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-hover)] cursor-pointer"
                      onClick={() => s.school_id && nav(`/school-profile/${s.school_id}`)}>
                      <td className="py-2 text-[var(--text-primary)] font-medium">{s.company_name || '—'}</td>
                      <td><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: m.color + '1a', color: m.color }}>{m.label}</span></td>
                      <td className="text-right font-mono text-[var(--text-secondary)]">{s.expected_value ? money(s.expected_value) : '—'}</td>
                      <td className="pl-3 text-[var(--text-secondary)]">{s.assigned_name || '—'}</td>
                      <td className="text-right font-mono font-semibold text-amber-500">{s.days_silent}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DrillDownPanel open={drill.open} title={drill.title} rows={drill.rows} loading={drill.loading} onClose={closeDrill} />
    </div>
  );
}
