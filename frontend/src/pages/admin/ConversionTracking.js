import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { conversionAnalytics, leads as leadsApi, engagement } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { STAGES } from '../../lib/crmConstants';
import DrillDownPanel from '../../components/marketing/DrillDownPanel';
import { TrendingUp, Users, Target, Trophy, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const stageLabel = (id) => STAGES.find(s => s.id === id)?.label || id;

export default function ConversionTracking() {
  const [data, setData] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState({ open: false, loading: false, title: '', rows: [] });

  const openDrill = async (metric, value = '', extra = {}) => {
    setDrill({ open: true, loading: true, title: '', rows: [] });
    try {
      const r = await engagement.drill(metric, value, 90, extra);
      setDrill({ open: true, loading: false, title: r.data.title, rows: r.data.rows || [] });
    } catch {
      setDrill({ open: true, loading: false, title: 'Details', rows: [] });
    }
  };
  const closeDrill = () => setDrill(d => ({ ...d, open: false }));

  useEffect(() => {
    const fetch = async () => {
      try {
        const [res, fn, fc] = await Promise.all([
          conversionAnalytics.get(),
          leadsApi.funnel().catch(() => ({ data: null })),
          leadsApi.forecast().catch(() => ({ data: null })),
        ]);
        setData(res.data);
        setFunnel(fn.data);
        setForecast(fc.data);
      } catch { }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  if (loading || !data) {
    return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;
  }

  const { pipeline, total_leads, won, lost, conversion_rate, salesperson_conversion, quotation_stats, task_stats } = data;

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="conversion-title">Conversion Tracking</h1>
          <p className="text-[var(--text-secondary)] mt-1">Lead pipeline, salesperson performance, and quotation analytics</p>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Target} label="Total Leads" value={total_leads} color="#3b82f6" onClick={() => openDrill('all_leads')} />
          <StatCard icon={Trophy} label="Won" value={won} color="#10b981" onClick={() => openDrill('stage', 'won')} />
          <StatCard icon={AlertTriangle} label="Lost" value={lost} color="#ef4444" onClick={() => openDrill('stage', 'lost')} />
          <StatCard icon={TrendingUp} label="Conversion Rate" value={`${conversion_rate}%`} color="#e94560" />
        </div>

        {/* Pipeline Funnel */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Lead Pipeline Funnel</h2>
          <div className="space-y-3" data-testid="pipeline-funnel">
            {Object.entries(pipeline).map(([stage, count]) => {
              const pct = total_leads > 0 ? (count / total_leads * 100) : 0;
              const colors = {
                new: '#3b82f6', contacted: '#06b6d4', demo: '#8b5cf6',
                quoted: '#f59e0b', negotiation: '#f97316', won: '#10b981', lost: '#ef4444'
              };
              return (
                <button key={stage} onClick={() => count > 0 && openDrill('stage', stage)}
                  disabled={count === 0}
                  className={`w-full flex items-center gap-4 text-left ${count > 0 ? 'cursor-pointer group' : 'cursor-default'}`}>
                  <span className="text-sm text-[var(--text-secondary)] w-28 capitalize">{stage}</span>
                  <div className="flex-1 h-8 bg-[var(--bg-primary)] rounded-md overflow-hidden relative">
                    <div className="h-full rounded-md transition-all group-hover:brightness-110" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: colors[stage] || '#6b6b80' }} />
                    <span className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-primary)] font-mono">{count}</span>
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-12 text-right">{pct.toFixed(0)}%</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Weighted Forecast (Phase 1) */}
        {forecast && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Revenue Forecast (open pipeline)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-[var(--bg-primary)] rounded-md p-4">
                <p className="text-xs text-[var(--text-muted)]">Open pipeline value</p>
                <p className="text-2xl font-mono font-bold text-[var(--text-primary)]">{inr(forecast.total_value)}</p>
              </div>
              <div className="bg-[var(--bg-primary)] rounded-md p-4">
                <p className="text-xs text-[var(--text-muted)]">Weighted forecast</p>
                <p className="text-2xl font-mono font-bold text-[#e94560]">{inr(forecast.total_weighted)}</p>
              </div>
              <div className="bg-[var(--bg-primary)] rounded-md p-4">
                <p className="text-xs text-[var(--text-muted)]">Reps with pipeline</p>
                <p className="text-2xl font-mono font-bold text-[var(--text-primary)]">{Object.keys(forecast.by_rep || {}).length}</p>
              </div>
            </div>
            {Object.keys(forecast.by_stage || {}).length > 0 && (
              <div className="mt-4 space-y-2">
                {Object.entries(forecast.by_stage).filter(([, v]) => v.count > 0).map(([stage, v]) => (
                  <button key={stage} onClick={() => openDrill('stage', stage)}
                    className="w-full flex items-center gap-3 text-sm text-left rounded-md px-1 py-0.5 hover:bg-[var(--bg-hover)]">
                    <span className="w-24 text-[var(--text-secondary)]">{stageLabel(stage)}</span>
                    <span className="text-[var(--text-muted)] w-16">{v.count} leads</span>
                    <span className="text-[var(--text-primary)] font-mono">{inr(v.value)}</span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span className="text-[#e94560] font-mono">{inr(v.weighted)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stage conversion & velocity + lost reasons (Phase 1) */}
        {funnel && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
              <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Stage Conversion & Velocity</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-xs uppercase text-[var(--text-secondary)]">
                    <th className="text-left py-2">Stage</th>
                    <th className="text-center py-2">Reached</th>
                    <th className="text-center py-2">Advanced</th>
                    <th className="text-right py-2">Avg days</th>
                  </tr>
                </thead>
                <tbody>
                  {(funnel.stages || []).map(s => (
                    <tr key={s.stage} className="border-b border-[var(--border-color)]">
                      <td className="py-2 text-[var(--text-primary)]">{stageLabel(s.stage)}</td>
                      <td className="py-2 text-center font-mono text-[var(--text-primary)]">
                        {s.count > 0
                          ? <button onClick={() => openDrill('stage', s.stage)} className="underline decoration-dotted underline-offset-2 hover:text-[#e94560]">{s.count}</button>
                          : s.count}
                      </td>
                      <td className="py-2 text-center font-mono text-[var(--text-secondary)]">{s.advanced_pct}%</td>
                      <td className="py-2 text-right font-mono text-[var(--text-muted)]">{s.avg_days || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
              <h2 className="text-lg font-medium text-[var(--text-primary)] mb-1">Why We Lose</h2>
              <p className="text-xs text-[var(--text-muted)] mb-4">{funnel.lost?.count || 0} lost leads, by reason</p>
              {Object.keys(funnel.lost_reasons || {}).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No lost leads recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(funnel.lost_reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => {
                    const max = Math.max(...Object.values(funnel.lost_reasons));
                    return (
                      <button key={reason} onClick={() => openDrill('lost_reason', reason)}
                        className="w-full flex items-center gap-3 text-left rounded px-1 py-0.5 hover:bg-[var(--bg-hover)]">
                        <span className="w-28 text-sm text-[var(--text-secondary)] truncate">{reason}</span>
                        <div className="flex-1 h-6 bg-[var(--bg-primary)] rounded overflow-hidden">
                          <div className="h-full bg-red-500/60 rounded" style={{ width: `${Math.max((count / max) * 100, 6)}%` }} />
                        </div>
                        <span className="w-8 text-right font-mono text-sm text-[var(--text-primary)]">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Salesperson Leaderboard */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Salesperson Leaderboard</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sp-leaderboard">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">#</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Name</th>
                  <th className="text-center text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Leads</th>
                  <th className="text-center text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Won</th>
                  <th className="text-center text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Lost</th>
                  <th className="text-center text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Active</th>
                  <th className="text-center text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Quotations</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Revenue</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-2">Conv. Rate</th>
                </tr>
              </thead>
              <tbody>
                {salesperson_conversion.map((sp, idx) => (
                  <tr key={sp.email} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="py-3 px-2">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx === 0 ? 'bg-yellow-500/20 text-yellow-300' : idx === 1 ? 'bg-gray-400/20 text-gray-300' : idx === 2 ? 'bg-orange-500/20 text-orange-300' : 'bg-[#2d2d44] text-[var(--text-muted)]'}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <p className="text-[var(--text-primary)] font-medium">{sp.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{sp.email}</p>
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-[var(--text-primary)]"><RepNum n={sp.total_leads} onClick={() => openDrill('rep', sp.email, { sub: 'leads' })} /></td>
                    <td className="py-3 px-2 text-center font-mono text-green-400"><RepNum n={sp.won} onClick={() => openDrill('rep', sp.email, { sub: 'won' })} /></td>
                    <td className="py-3 px-2 text-center font-mono text-red-400"><RepNum n={sp.lost} onClick={() => openDrill('rep', sp.email, { sub: 'lost' })} /></td>
                    <td className="py-3 px-2 text-center font-mono text-blue-300"><RepNum n={sp.active} onClick={() => openDrill('rep', sp.email, { sub: 'active' })} /></td>
                    <td className="py-3 px-2 text-center font-mono text-[var(--text-primary)]"><RepNum n={sp.quotations} onClick={() => openDrill('rep', sp.email, { sub: 'quotations' })} /></td>
                    <td className="py-3 px-2 text-right font-mono text-[var(--text-primary)] font-bold">
                      {sp.revenue > 0
                        ? <button onClick={() => openDrill('rep', sp.email, { sub: 'revenue' })} className="underline decoration-dotted underline-offset-2 hover:text-[#e94560]">{formatCurrency(sp.revenue)}</button>
                        : formatCurrency(sp.revenue)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${sp.conversion_rate >= 50 ? 'bg-green-500/20 text-green-300' : sp.conversion_rate >= 25 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-300'}`}>
                        {sp.conversion_rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {salesperson_conversion.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-[var(--text-muted)] py-8">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quotation & Task Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Quotation Stats</h2>
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Total" value={quotation_stats.total} onClick={() => openDrill('quotations', 'total')} />
              <MiniStat label="Draft" value={quotation_stats.draft} color="text-yellow-300" onClick={() => openDrill('quotations', 'draft')} />
              <MiniStat label="Sent" value={quotation_stats.sent} color="text-blue-300" onClick={() => openDrill('quotations', 'sent')} />
              <MiniStat label="Confirmed" value={quotation_stats.confirmed} color="text-green-300" onClick={() => openDrill('quotations', 'confirmed')} />
            </div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Task Stats</h2>
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Total" value={task_stats.total} onClick={() => openDrill('tasks', 'total')} />
              <MiniStat label="Pending" value={task_stats.pending} color="text-yellow-300" onClick={() => openDrill('tasks', 'pending')} />
              <MiniStat label="Done" value={task_stats.done} color="text-green-300" onClick={() => openDrill('tasks', 'done')} />
              <MiniStat label="Missed" value={task_stats.missed} color="text-red-300" onClick={() => openDrill('tasks', 'missed')} />
            </div>
          </div>
        </div>
      </div>

      <DrillDownPanel open={drill.open} title={drill.title} rows={drill.rows} loading={drill.loading} onClose={closeDrill} />
    </AdminLayout>
  );
}

function RepNum({ n, onClick }) {
  if (!n) return <span>{n}</span>;
  return <button onClick={onClick} className="underline decoration-dotted underline-offset-2 hover:text-[#e94560]">{n}</button>;
}

function StatCard({ icon: Icon, label, value, color, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5 text-left ${clickable ? 'hover:border-[#e94560]/50 hover:bg-[var(--bg-hover)] cursor-pointer' : 'cursor-default'} transition-colors`}>
      <Icon className="h-6 w-6 mb-3" style={{ color }} strokeWidth={1.5} />
      <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">{value}</div>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
    </button>
  );
}

function MiniStat({ label, value, color = 'text-[var(--text-primary)]', onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`bg-[var(--bg-primary)] rounded-md p-3 text-center w-full ${clickable ? 'hover:ring-1 hover:ring-[#e94560]/40 cursor-pointer' : 'cursor-default'} transition-all`}>
      <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
    </button>
  );
}
