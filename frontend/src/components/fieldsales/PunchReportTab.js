import React from 'react';
import { BarChart2, LogIn, LogOut, MapPin } from 'lucide-react';

const EFF_CLS = {
  optimal:        'bg-green-500/20 text-green-400 border-green-500/30',
  good:           'bg-blue-500/20 text-blue-400 border-blue-500/30',
  moderate:       'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  frequent_exits: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Punch clock report tab — date filters, efficiency legend, data table with expandable rows.
 */
export default function PunchReportTab({
  punchReport, punchLoading,
  reportDateFrom, setReportDateFrom,
  reportDateTo, setReportDateTo,
  reportUserEmail, setReportUserEmail,
  expandedRows, toggleRow,
  loadPunchReport,
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">From</p>
          <input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)}
            className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">To</p>
          <input type="date" value={reportDateTo} onChange={e => setReportDateTo(e.target.value)}
            className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
        </div>
        <div className="flex-1 min-w-40">
          <p className="text-xs text-[var(--text-muted)] mb-1">Employee Email (optional)</p>
          <input type="email" value={reportUserEmail} onChange={e => setReportUserEmail(e.target.value)}
            placeholder="all employees"
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
        </div>
        <button onClick={loadPunchReport} disabled={punchLoading}
          className="px-5 py-2 bg-[#e94560] hover:bg-[#f05c75] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors">
          <BarChart2 className="h-4 w-4" />
          {punchLoading ? 'Loading…' : 'Load Report'}
        </button>
      </div>

      {/* Efficiency legend */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'optimal',        label: '1 cycle — Optimal',          cls: EFF_CLS.optimal },
          { key: 'good',           label: '2 cycles — Good',            cls: EFF_CLS.good },
          { key: 'moderate',       label: '3 cycles — Moderate',        cls: EFF_CLS.moderate },
          { key: 'frequent_exits', label: '4+ cycles — Frequent Exits', cls: EFF_CLS.frequent_exits },
        ].map(e => (
          <span key={e.key} className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${e.cls}`}>{e.label}</span>
        ))}
        <span className="text-xs text-[var(--text-muted)] self-center">· One cycle = 1 punch-in + 1 punch-out</span>
      </div>

      {punchLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
        </div>
      ) : punchReport.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-12 text-center">
          <BarChart2 className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
          <p className="text-[var(--text-secondary)] text-sm">No punch data for selected range</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">Click "Load Report" to fetch data</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-color)]">
              <tr>
                {['Employee', 'Date', 'First In', 'Last Out', 'Hours', 'Punches', 'Efficiency', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {punchReport.map((row) => {
                const rowKey  = `${row.date}-${row.user_email}`;
                const expanded = expandedRows[rowKey];
                return (
                  <React.Fragment key={rowKey}>
                    <tr className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${row.auto_logout_count > 0 ? 'bg-orange-500/5' : ''}`}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-[var(--text-primary)]">{row.user_name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{row.user_email}</p>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs font-mono">{row.date}</td>
                      <td className="px-3 py-2.5"><span className="text-green-400 font-mono text-xs">{fmtT(row.first_in)}</span></td>
                      <td className="px-3 py-2.5"><span className="text-red-400 font-mono text-xs">{fmtT(row.last_out)}</span></td>
                      <td className="px-3 py-2.5">
                        <span className="text-[var(--text-primary)] font-semibold text-xs">{row.total_hours != null ? `${row.total_hours}h` : '—'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[var(--text-primary)] font-bold text-sm">{row.punch_count}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">({row.in_count}↑ {row.out_count}↓)</span>
                          {row.auto_logout_count > 0 && (
                            <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-semibold">{row.auto_logout_count} auto</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${EFF_CLS[row.efficiency] || EFF_CLS.frequent_exits}`}>
                          {row.efficiency?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => toggleRow(rowKey)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1">
                          {expanded ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
                        <td colSpan={8} className="px-6 py-3">
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">Full Punch Timeline</p>
                          <div className="flex flex-wrap gap-3">
                            {row.punches.map((p, i) => (
                              <div key={p.punch_id} className={`flex items-start gap-2 rounded-lg px-3 py-2 ${p.type === 'in' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${p.type === 'in' ? 'bg-green-500/30' : 'bg-red-500/30'}`}>
                                  {p.type === 'in' ? <LogIn className="h-2.5 w-2.5 text-green-400" /> : <LogOut className="h-2.5 w-2.5 text-red-400" />}
                                </div>
                                <div>
                                  <p className={`text-xs font-semibold ${p.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>
                                    #{i + 1} {p.type === 'in' ? 'In' : 'Out'} — {fmtT(p.timestamp)}
                                  </p>
                                  {p.source === 'geofence_auto_logout' && <span className="text-[10px] text-orange-400">Auto-logout</span>}
                                  {p.distance_from_office_m != null && <p className="text-[10px] text-[var(--text-muted)]">{p.distance_from_office_m}m from office</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Summary footer */}
          <div className="px-4 py-3 border-t border-[var(--border-color)] flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
            <span>Total records: <strong className="text-[var(--text-primary)]">{punchReport.length}</strong></span>
            <span>Total punches: <strong className="text-[var(--text-primary)]">{punchReport.reduce((s, r) => s + r.punch_count, 0)}</strong></span>
            <span>Auto-logouts: <strong className="text-orange-400">{punchReport.reduce((s, r) => s + r.auto_logout_count, 0)}</strong></span>
            <span>Avg hours/day: <strong className="text-[var(--text-primary)]">{
              (() => {
                const valid = punchReport.filter(r => r.total_hours != null);
                return valid.length ? (valid.reduce((s, r) => s + r.total_hours, 0) / valid.length).toFixed(1) + 'h' : '—';
              })()
            }</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}
