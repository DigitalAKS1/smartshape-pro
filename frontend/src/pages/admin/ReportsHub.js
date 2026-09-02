import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { reports } from '../../lib/api';
import { BarChart3, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';

const TONE = {
  warn: { fg: '#9A6A15', bg: 'rgba(154,106,21,0.10)', bd: 'rgba(154,106,21,0.35)' },
  bad: { fg: '#C4402E', bg: 'rgba(196,64,46,0.10)', bd: 'rgba(196,64,46,0.35)' },
  good: { fg: '#2E7D5B', bg: 'rgba(46,125,91,0.10)', bd: 'rgba(46,125,91,0.35)' },
};

/**
 * Every report in one place. The reports themselves live on their own screens —
 * this answers "which one do I need, and is anything slipping right now?".
 */
export default function ReportsHub() {
  const [data, setData] = useState({ sections: [], needs_attention: 0 });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await reports.hub(); setData(r.data || { sections: [], needs_attention: 0 }); }
    catch { toast.error('Could not load reports'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-[#e94560]" /> Reports
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Every report in the system, with a live number on each.
              {data.needs_attention > 0 && (
                <span className="text-[#9A6A15] font-semibold">
                  {' '}{data.needs_attention} need{data.needs_attention === 1 ? 's' : ''} attention.
                </span>
              )}
            </p>
          </div>
          <button onClick={load} disabled={loading} data-testid="reports-refresh"
            className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-sm font-semibold disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-[var(--text-muted)]">Loading reports…</div>
        ) : (
          <div className="grid gap-6">
            {data.sections.map(sec => (
              <div key={sec.key} className={`${card} p-5`} data-testid={`section-${sec.key}`}>
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  {sec.title}
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sec.reports.map(r => {
                    const t = TONE[r.metric?.tone];
                    return (
                      <button key={r.key} onClick={() => navigate(r.route)}
                        data-testid={`report-${r.key}`}
                        className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-left hover:border-[#e94560] transition-colors group">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                            {r.title}
                            {t && r.metric.tone !== 'neutral' && (
                              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.fg }} />
                            )}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{r.description}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <div className="text-lg font-bold font-mono leading-none"
                              style={{ color: t ? t.fg : 'var(--text-primary)' }}>
                              {r.metric?.value ?? '—'}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-1">{r.metric?.label}</div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[#e94560]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {data.sections.length === 0 && (
              <div className={`${card} p-10 text-center text-[var(--text-muted)]`}>
                No reports are available for your account.
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
