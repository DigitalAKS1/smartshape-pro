import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { IndianRupee, RefreshCw, ChevronRight } from 'lucide-react';
import { invoices as invoicesApi } from '../../lib/api';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

const money = (n) => {
  n = Number(n || 0);
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
};
const AGE_CLS = {
  '0-30': 'bg-emerald-500/15 text-emerald-500',
  '31-60': 'bg-amber-500/15 text-amber-500',
  '61-90': 'bg-orange-500/15 text-orange-500',
  '90+': 'bg-red-500/15 text-red-500',
};

/**
 * Org-wide receivables: schools with outstanding (invoiced − paid), aged and
 * sorted by amount due. Admin/accounts. Auto-hides when nothing is owed.
 */
export default function ReceivablesPanel({ refreshKey }) {
  const [data, setData] = useState({ rows: [], totals: { invoiced: 0, paid: 0, outstanding: 0 } });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await invoicesApi.receivables();
      setData(r.data || { rows: [], totals: {} });
    } catch { /* non-blocking */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data.rows || [];
  if (!loading && rows.length === 0) return null;
  const t = data.totals || {};

  return (
    <div className={`${card} border rounded-md p-4`} data-testid="receivables-panel">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className={`text-sm font-semibold ${textPri} flex items-center gap-1.5`}>
          <IndianRupee className="h-4 w-4 text-[#e94560]" /> Receivables
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs ${textMuted}`}>Invoiced {money(t.invoiced)} · Paid {money(t.paid)}</span>
          <span className="text-sm font-bold text-[#e94560]">Outstanding {money(t.outstanding)}</span>
          <Button size="sm" variant="ghost" onClick={load} className={`${textSec} h-7 w-7 p-0`} title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {rows.slice(0, 10).map(r => (
          <Link key={r.school_id} to={`/school-profile/${r.school_id}`}
            className="flex items-center gap-3 py-2 px-1 rounded hover:bg-[var(--bg-hover)]" data-testid={`receivable-${r.school_id}`}>
            <span className={`flex-1 min-w-0 text-sm ${textPri} truncate`}>{r.school_name || r.school_id}</span>
            {r.aging_bucket && r.aging_bucket !== '—' && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${AGE_CLS[r.aging_bucket] || 'bg-slate-500/15 text-slate-400'}`}>{r.aging_bucket}d</span>
            )}
            <span className={`text-xs ${textMuted} hidden sm:inline`}>{r.invoices} inv</span>
            <span className="text-sm font-bold text-[#e94560] w-20 text-right">{money(r.outstanding)}</span>
            <ChevronRight className={`h-4 w-4 ${textMuted} flex-shrink-0`} />
          </Link>
        ))}
      </div>
      {rows.length > 10 && <p className={`text-xs ${textMuted} mt-2`}>+{rows.length - 10} more schools with dues</p>}
    </div>
  );
}
