import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, stock } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import {
  ClipboardList, TrendingUp, TrendingDown, Minus, CheckCircle,
  AlertTriangle, RefreshCw, Search, Calendar, Package,
} from 'lucide-react';
import { toast } from 'sonner';

export default function PhysicalCount() {
  const [diesList, setDiesList] = useState([]);
  const [counts, setCounts] = useState({});        // { die_id: { counted: '', notes: '' } }
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sessionNotes, setSessionNotes] = useState('');
  const [search, setSearch] = useState('');
  const [filterVariance, setFilterVariance] = useState('all');
  const [submitted, setSubmitted] = useState(false);
  const [submitSummary, setSubmitSummary] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [diesRes, movRes] = await Promise.all([
        diesApi.getAll(),
        stock.getMovements(),
      ]);
      const activeDies = (diesRes.data || []).filter(d => d.is_active !== false);
      setDiesList(activeDies);
      const initCounts = {};
      activeDies.forEach(d => { initCounts[d.die_id] = { counted: '', notes: '' }; });
      setCounts(initCounts);
      setMovements(movRes.data || []);
    } catch {
      toast.error('Failed to load inventory data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getVariance = (die) => {
    const c = counts[die.die_id];
    if (!c || c.counted === '') return null;
    const counted = parseInt(c.counted, 10);
    if (isNaN(counted)) return null;
    return counted - (die.stock_qty || 0);
  };

  const filteredDies = diesList.filter(die => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      die.code?.toLowerCase().includes(q) ||
      die.name?.toLowerCase().includes(q) ||
      die.category?.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (filterVariance === 'over') return (getVariance(die) ?? 0) > 0;
    if (filterVariance === 'under') return (getVariance(die) ?? 0) < 0;
    if (filterVariance === 'exact') return getVariance(die) === 0;
    if (filterVariance === 'entered') return counts[die.die_id]?.counted !== '';
    return true;
  });

  const summary = diesList.reduce((acc, die) => {
    const v = getVariance(die);
    if (v === null) return acc;
    acc.entered++;
    if (v > 0) acc.over++;
    else if (v < 0) acc.under++;
    else acc.exact++;
    acc.totalVariance += v;
    return acc;
  }, { entered: 0, over: 0, under: 0, exact: 0, totalVariance: 0 });

  const handleSubmit = async () => {
    const toAdjust = diesList.filter(d => getVariance(d) !== null && getVariance(d) !== 0);
    if (toAdjust.length === 0) {
      toast.info('No variances to adjust. All counted quantities match system stock.');
      return;
    }
    setSubmitting(true);
    let success = 0;
    let errors = [];
    for (const die of toAdjust) {
      const variance = getVariance(die);
      try {
        await stock.createMovement({
          die_id: die.die_id,
          movement_type: 'physical_adjustment',
          quantity: Math.abs(variance),
          notes: `Physical count ${sessionDate}${sessionNotes ? ': ' + sessionNotes : ''}. Counted: ${counts[die.die_id].counted}, System: ${die.stock_qty || 0}, Variance: ${variance > 0 ? '+' : ''}${variance}`,
          reference_number: `PC-${sessionDate}-${die.die_id.slice(-4)}`,
          direction: variance > 0 ? 'in' : 'out',
        });
        success++;
      } catch {
        errors.push(die.code || die.die_id);
      }
    }
    setSubmitting(false);
    if (errors.length === 0) {
      toast.success(`Stock-take complete. ${success} adjustment${success !== 1 ? 's' : ''} applied.`);
    } else {
      toast.error(`${success} applied, ${errors.length} failed: ${errors.join(', ')}`);
    }
    setSubmitSummary({
      date: sessionDate,
      total: toAdjust.length,
      success,
      errors,
      overCount: summary.over,
      underCount: summary.under,
    });
    setSubmitted(true);
    fetchData();
  };

  // Group past physical_adjustment movements into sessions by date
  const sessions = movements
    .filter(m => m.movement_type === 'physical_adjustment')
    .reduce((acc, m) => {
      const date = (m.movement_date || m.created_at || '').split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push(m);
      return acc;
    }, {});
  const sessionDates = Object.keys(sessions).sort((a, b) => b.localeCompare(a));

  const resetSession = () => {
    const resetCounts = {};
    diesList.forEach(d => { resetCounts[d.die_id] = { counted: '', notes: '' }; });
    setCounts(resetCounts);
    setSessionDate(new Date().toISOString().split('T')[0]);
    setSessionNotes('');
    setSubmitted(false);
    setSubmitSummary(null);
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">Physical Stock Count</h1>
            <p className="text-[var(--text-secondary)] mt-1">Record counted quantities to reconcile system vs physical stock</p>
          </div>
          <Button
            variant="outline"
            onClick={fetchData}
            disabled={loading}
            className="border-[var(--border-color)] text-[var(--text-secondary)]"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
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

          {/* ============================================================ */}
          {/* NEW SESSION TAB                                               */}
          {/* ============================================================ */}
          <TabsContent value="session" className="space-y-6">
            {/* Session config bar */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
                <div className="flex-1">
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1 block">Session Date</Label>
                  <Input
                    type="date"
                    value={sessionDate}
                    onChange={e => setSessionDate(e.target.value)}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] w-48"
                    disabled={submitted}
                  />
                </div>
                <div className="flex-[3]">
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1 block">Session Notes (optional)</Label>
                  <Input
                    value={sessionNotes}
                    onChange={e => setSessionNotes(e.target.value)}
                    placeholder="e.g. Monthly count — Warehouse A"
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    disabled={submitted}
                  />
                </div>
                {submitted && (
                  <Button onClick={resetSession} variant="outline" className="border-[#e94560] text-[#e94560] hover:bg-[#e94560]/10">
                    Start New Session
                  </Button>
                )}
              </div>
            </div>

            {/* Submission success banner */}
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
                <Input
                  placeholder="Search die code, name or category..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'entered', label: 'Entered' },
                  { value: 'over', label: 'Over' },
                  { value: 'under', label: 'Under' },
                  { value: 'exact', label: 'Exact' },
                ].map(opt => (
                  <Button
                    key={opt.value}
                    variant="outline"
                    size="sm"
                    onClick={() => setFilterVariance(opt.value)}
                    className={`border-[var(--border-color)] text-xs ${filterVariance === opt.value ? 'bg-[#e94560] text-white border-[#e94560]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Count worksheet table */}
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
                        <tr>
                          <td colSpan={7} className="text-center py-12 text-[var(--text-muted)]">
                            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p>No dies match your filter</p>
                          </td>
                        </tr>
                      ) : (
                        filteredDies.map(die => {
                          const variance = getVariance(die);
                          const counted = counts[die.die_id]?.counted ?? '';
                          return (
                            <tr key={die.die_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                              <td className="px-4 py-3 font-mono text-[#e94560] font-medium whitespace-nowrap">{die.code}</td>
                              <td className="px-4 py-3 text-[var(--text-primary)]">{die.name}</td>
                              <td className="px-4 py-3 text-[var(--text-secondary)] hidden md:table-cell capitalize">{die.category || '—'}</td>
                              <td className="px-4 py-3 text-right font-mono text-[var(--text-primary)] font-semibold">{die.stock_qty ?? 0}</td>
                              <td className="px-4 py-3 text-right">
                                <Input
                                  type="number"
                                  min="0"
                                  value={counted}
                                  onChange={e => setCounts(prev => ({
                                    ...prev,
                                    [die.die_id]: { ...prev[die.die_id], counted: e.target.value },
                                  }))}
                                  placeholder="—"
                                  disabled={submitted}
                                  className="w-24 ml-auto text-right bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                                />
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                                {variance === null ? (
                                  <span className="text-[var(--text-muted)]">—</span>
                                ) : variance > 0 ? (
                                  <span className="text-[#10b981]">+{variance}</span>
                                ) : variance < 0 ? (
                                  <span className="text-[#ef4444]">{variance}</span>
                                ) : (
                                  <span className="text-[var(--text-muted)]">0</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right hidden lg:table-cell">
                                {variance === null ? null : variance > 0 ? (
                                  <Badge className="bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30">
                                    <TrendingUp className="h-3 w-3 mr-1" />Surplus
                                  </Badge>
                                ) : variance < 0 ? (
                                  <Badge className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30">
                                    <TrendingDown className="h-3 w-3 mr-1" />Shortage
                                  </Badge>
                                ) : (
                                  <Badge className="bg-[var(--bg-primary)] text-[var(--text-muted)] border-[var(--border-color)]">
                                    <Minus className="h-3 w-3 mr-1" />Match
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
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
                      <AlertTriangle className="h-4 w-4" />
                      {summary.over + summary.under} variances to adjust
                    </span>
                  )}
                  {summary.over + summary.under === 0 && summary.entered > 0 && (
                    <span className="flex items-center gap-1 text-[#10b981]">
                      <CheckCircle className="h-4 w-4" />All counted quantities match
                    </span>
                  )}
                </div>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-[#e94560] hover:bg-[#f05c75] text-white min-w-[180px]"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />Adjusting stock...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Finalise Count{summary.over + summary.under > 0 ? ` (${summary.over + summary.under} adj)` : ''}
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ============================================================ */}
          {/* HISTORY TAB                                                   */}
          {/* ============================================================ */}
          <TabsContent value="history" className="space-y-4">
            {sessionDates.length === 0 ? (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-12 text-center">
                <ClipboardList className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
                <p className="text-[var(--text-secondary)]">No stock-take sessions yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Complete a count session above to see history here.</p>
              </div>
            ) : (
              sessionDates.map(date => {
                const items = sessions[date];
                const netVariance = items.reduce((sum, m) => {
                  const note = m.notes || '';
                  const match = note.match(/Variance: ([+-]?\d+)/);
                  return sum + (match ? parseInt(match[1]) : 0);
                }, 0);
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
                        <thead>
                          <tr className="border-b border-[var(--border-color)]">
                            <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Die Code</th>
                            <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Die Name</th>
                            <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2">Qty Adjusted</th>
                            <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-5 py-2 hidden md:table-cell">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(m => {
                            const note = m.notes || '';
                            const varMatch = note.match(/Variance: ([+-]?\d+)/);
                            const variance = varMatch ? parseInt(varMatch[1]) : null;
                            return (
                              <tr key={m.movement_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                                <td className="px-5 py-3 font-mono text-[#e94560] font-medium">{m.die_code || '—'}</td>
                                <td className="px-5 py-3 text-[var(--text-primary)]">{m.die_name || '—'}</td>
                                <td className="px-5 py-3 text-right">
                                  {variance !== null ? (
                                    <span className={`font-mono font-bold ${variance > 0 ? 'text-[#10b981]' : variance < 0 ? 'text-[#ef4444]' : 'text-[var(--text-muted)]'}`}>
                                      {variance > 0 ? '+' : ''}{variance}
                                    </span>
                                  ) : (
                                    <span className="font-mono text-[var(--text-muted)]">{m.quantity}</span>
                                  )}
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
              })
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
