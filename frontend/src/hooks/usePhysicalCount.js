import { useState, useEffect, useCallback } from 'react';
import { dies as diesApi, stock } from '../lib/api';
import { sortByCode } from '../lib/utils';
import { toast } from 'sonner';

export function usePhysicalCount() {
  const [diesList, setDiesList] = useState([]);
  const [counts, setCounts] = useState({});
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
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
      const activeDies = sortByCode((diesRes.data || []).filter(d => d.is_active !== false));
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
    const toAdjust = diesList.filter(
      d => getVariance(d) !== null && getVariance(d) !== 0
    );
    if (toAdjust.length === 0) {
      toast.info('No variances to adjust. All counted quantities match system stock.');
      return;
    }
    setSubmitting(true);
    let successCount = 0;
    const errors = [];
    for (const die of toAdjust) {
      const variance = getVariance(die);
      try {
        await stock.createMovement({
          die_id: die.die_id,
          movement_type: 'physical_adjustment',
          quantity: Math.abs(variance),
          counted_qty: parseInt(counts[die.die_id].counted, 10),
          session_date: sessionDate,
          session_notes: sessionNotes,
          notes: `Physical count ${sessionDate}${sessionNotes ? ': ' + sessionNotes : ''}. Counted: ${counts[die.die_id].counted}, System: ${die.stock_qty || 0}, Variance: ${variance > 0 ? '+' : ''}${variance}`,
          reference_number: `PC-${sessionDate}-${die.die_id.slice(-4)}`,
        });
        successCount++;
      } catch {
        errors.push(die.code || die.die_id);
      }
    }
    setSubmitting(false);
    if (errors.length === 0) {
      toast.success(`Stock-take complete. ${successCount} adjustment${successCount !== 1 ? 's' : ''} applied.`);
    } else {
      toast.error(`${successCount} applied, ${errors.length} failed: ${errors.join(', ')}`);
    }
    setSubmitSummary({
      date: sessionDate,
      total: toAdjust.length,
      success: successCount,
      errors,
      overCount: summary.over,
      underCount: summary.under,
    });
    setSubmitted(true);
    fetchData();
  };

  const sessions = movements
    .filter(m => m.movement_type === 'physical_adjustment')
    .reduce((acc, m) => {
      const date = m.session_date || (m.movement_date || m.created_at || '').split('T')[0];
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

  return {
    diesList, counts, setCounts, movements,
    loading, submitting,
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
  };
}
