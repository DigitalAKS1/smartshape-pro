import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import {
  ClipboardList, TrendingUp, TrendingDown, Minus, CheckCircle,
  AlertTriangle, RefreshCw, Search, Calendar, Package, Scissors,
} from 'lucide-react';
import { usePhysicalCount } from '../../hooks/usePhysicalCount';

const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

export default function PhysicalCount() {
  const {
    diesList, counts, setCounts, loading, submitting,
    sessionDate, setSessionDate,
    sessionNotes, setSessionNotes,
    search, setSearch,
    filterVariance, setFilterVariance,
    submitted, submitSummary,
    filteredDies, summary,
    sessions, sessionDates,
    getVariance,
    handleSubmit,
    resetSession,
    fetchData,
  } = usePhysicalCount();

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">Physical Stock Count</h1>
            <p className="text-[var(--text-secondary)] mt-1">Record counted quantities to reconcile system vs physical stock</p>
          </div>
          <Button variant="outline" onClick={fetchData} disabled={loading} className="border-[var(--border-color)] text-[var(--text-secondary)]">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>

        {/* Summary KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
            <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">{summary.entered}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1 uppercase tracking-wide">Dies Counted</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
            <div className="text-3xl font-mono font-bold text-[#10b981]">{summary.over}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1 uppercase tracking-wide">Over-counted</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
            <div className="text-3xl font-mono font-bold text-[#ef4444]">{summary.under}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1 uppercase tracking-wide">Under-counted</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
            <div className={`text-3xl font-mono font-bold ${summary.totalVariance > 0 ? 'text-[#10b981]' : summary.totalVariance < 0 ? 'text-[#ef4444]' : 'text-[var(--text-primary)]'}`}>
              {summary.totalVariance > 0 ? '+' : ''}{summary.totalVariance}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1 uppercase tracking-wide">Net Variance</p>
          </div>
        </div>

        <Tabs defaultValue="session" className="space-y-6">
          <TabsList className="bg-[var(--bg-card)] border border-[var(--border-color)]">
            <TabsTrigger value="session" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">
              <ClipboardList className="h-4 w-4 mr-2" />New Count Session
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">
              <Calendar className="h-4 w-4 mr-2" />History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="session" className="space-y-6">
            {/* Session config bar */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
                <div className="flex-1">
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1 block">Session Date</Label>
                  <Input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] w-48" disabled={submitted} />
                </div>
                <div className="flex-[3]">
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1 block">Session Notes (optional)</Label>
                  <Input value={sessionNotes} onChange={e => setSessionNotes(e.target.value)}
                    placeholder="e.g. Monthly count — Warehouse A"
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" disabled={submitted} />
                </div>
                {submitted && (
                  <Button onClick={resetSession} variant="outline" className="border-[#e94560] text-[#e94560] hover:bg-[#e94560]/10">
                    Start New Session
                  </Button>
                )}
              </div>
            </div>

            {/* Success banner */}
            {submitted && submitSummary && (
              <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-md p-5 flex items-start gap-4">
                <CheckCircle className="h-6 w-6 text-[#10b981] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[#10b981]">Stock-take submitted for {submitSummary.date}</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    {submitSummary.success} adjustment{submitSummary.success !== 1 ? 's' : ''} applied
                    {submitSummary.overCount > 0 && ` · ${submitSummary.overCount} over`}
                    {submitSummary.underCount > 0 && ` · ${submitSummary.underCount} under`}
                    {submitSummary.errors.length > 0 && ` · ${submitSummary.errors.length} failed`}
                  </p>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <Input placeholder="Search die code, name or category..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-10 bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]" />
              </div>
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'entered', label: 'Entered' },
                  { value: 'over', label: 'Over' },
                  { value: 'under', label: 'Under' },
                  { value: 'exact', label: 'Exact' },
                ].map(opt => (
                  <Button key={opt.value} variant="outline" size="sm" onClick={() => setFilterVariance(opt.value)}
                    className={`border-[var(--border-color)] text-xs ${filterVariance === opt.value ? 'bg-[#e94560] text-white border-[#e94560]' : 'text-[var(--text-secondary)]'}`}>
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Count worksheet */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
              </div>
            ) : (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-primary)]/50">
                      <tr className="border-b border-[var(--border-color)]">
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3 w-14">Image</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3">Code</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3">Name</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3 hidden md:table-cell">Category</th>
                        <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3">System Qty</th>
                        <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3">Counted Qty</th>
                        <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3">Variance</th>
                        <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-3 hidden lg:table-cell">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDies.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-12 text-[var(--text-muted)]">
                          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                          <p>No dies match your filter</p>
                        </td></tr>
                      ) : filteredDies.map(die => {
                        const variance = getVariance(die);
                        const counted = counts[die.die_id]?.counted ?? '';
                        return (
                          <tr key={die.die_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                            <td className="px-4 py-3">
                              <div className="w-10 h-10 rounded-lg bg-[var(--bg-primary)] overflow-hidden border border-[var(--border-color)]">
                                {die.image_url
                                  ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-contain p-0.5" />
                                  : <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]"><Scissors className="h-4 w-4 opacity-20" /></div>}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-[#e94560] font-medium whitespace-nowrap">{die.code}</td>
                            <td className="px-4 py-3 text-[var(--text-primary)]">{die.name}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)] hidden md:table-cell capitalize">{die.category || '—'}</td>
                            <td className="px-4 py-3 text-right font-mono text-[var(--text-primary)] font-semibold">{die.stock_qty ?? 0}</td>
                            <td className="px-4 py-3 text-right">
                              <Input type="number" min="0" value={counted}
                                onChange={e => setCounts(prev => ({ ...prev, [die.die_id]: { ...prev[die.die_id], counted: e.target.value } }))}
                                placeholder="—" disabled={submitted}
                                className="w-24 ml-auto text-right bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono" />
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                              {variance === null ? <span className="text-[var(--text-muted)]">—</span>
                                : variance > 0 ? <span className="text-[#10b981]">+{variance}</span>
                                : variance < 0 ? <span className="text-[#ef4444]">{variance}</span>
                                : <span className="text-[var(--text-muted)]">0</span>}
                            </td>
                            <td className="px-4 py-3 text-right hidden lg:table-cell">
                              {variance === null ? null : variance > 0 ? (
                                <Badge className="bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30"><TrendingUp className="h-3 w-3 mr-1" />Surplus</Badge>
                              ) : variance < 0 ? (
                                <Badge className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30"><TrendingDown className="h-3 w-3 mr-1" />Shortage</Badge>
                              ) : (
                                <Badge className="bg-[var(--bg-primary)] text-[var(--text-muted)] border-[var(--border-color)]"><Minus className="h-3 w-3 mr-1" />Match</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Submit bar */}
            {!submitted && summary.entered > 0 && (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{summary.entered}</span> of {diesList.length} counted
                  </span>
                  {(summary.over + summary.under) > 0 && (
                    <span className="flex items-center gap-1 text-[#f59e0b]">
                      <AlertTriangle className="h-4 w-4" />{summary.over + summary.under} variances to adjust
                    </span>
                  )}
                  {summary.over + summary.under === 0 && summary.entered > 0 && (
                    <span className="flex items-center gap-1 text-[#10b981]">
                      <CheckCircle className="h-4 w-4" />All counted quantities match
                    </span>
                  )}
                </div>
                <Button onClick={handleSubmit} disabled={submitting} className="bg-[#e94560] hover:bg-[#f05c75] text-white min-w-[180px]">
                  {submitting ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Adjusting stock...</>
                    : <><CheckCircle className="h-4 w-4 mr-2" />Finalise Count{summary.over + summary.under > 0 ? ` (${summary.over + summary.under} adj)` : ''}</>}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {sessionDates.length === 0 ? (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-12 text-center">
                <ClipboardList className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
                <p className="text-[var(--text-secondary)]">No stock-take sessions yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Complete a count session above to see history here.</p>
              </div>
            ) : sessionDates.map(date => {
              const items = sessions[date];
              const varOf = (m) => {
                if (typeof m.variance === 'number') return m.variance;
                const match = (m.notes || '').match(/Variance: ([+-]?\d+)/);
                return match ? parseInt(match[1]) : 0;
              };
              const netVariance = items.reduce((sum, m) => sum + varOf(m), 0);
              return (
                <div key={date} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/30">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
                      <span className="font-semibold text-[var(--text-primary)]">{formatDate(date)}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-[var(--text-secondary)]">{items.length} adjustments</span>
                      <span className={netVariance > 0 ? 'text-[#10b981] font-mono' : netVariance < 0 ? 'text-[#ef4444] font-mono' : 'text-[var(--text-muted)] font-mono'}>
                        Net: {netVariance > 0 ? '+' : ''}{netVariance}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-[var(--border-color)]">
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Die Code</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Die Name</th>
                        <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Qty Adjusted</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2 hidden md:table-cell">Notes</th>
                      </tr></thead>
                      <tbody>
                        {items.map(m => {
                          const note = m.notes || '';
                          const varMatch = note.match(/Variance: ([+-]?\d+)/);
                          const variance = typeof m.variance === 'number'
                            ? m.variance
                            : (varMatch ? parseInt(varMatch[1]) : null);
                          return (
                            <tr key={m.movement_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                              <td className="px-5 py-3 font-mono text-[#e94560] font-medium">{m.die_code || '—'}</td>
                              <td className="px-5 py-3 text-[var(--text-primary)]">{m.die_name || '—'}</td>
                              <td className="px-5 py-3 text-right">
                                {variance !== null ? (
                                  <span className={`font-mono font-bold ${variance > 0 ? 'text-[#10b981]' : variance < 0 ? 'text-[#ef4444]' : 'text-[var(--text-muted)]'}`}>
                                    {variance > 0 ? '+' : ''}{variance}
                                  </span>
                                ) : <span className="font-mono text-[var(--text-muted)]">{m.quantity}</span>}
                              </td>
                              <td className="px-5 py-3 text-[var(--text-muted)] text-xs hidden md:table-cell max-w-xs truncate">{note}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
