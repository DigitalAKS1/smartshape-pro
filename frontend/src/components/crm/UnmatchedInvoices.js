import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { invoices as invoicesApi, schools as schoolsApi } from '../../lib/api';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * Review + one-click map for invoices the bulk import couldn't auto-match to a
 * school. Self-fetches; auto-hides when there's nothing to review. `refreshKey`
 * bumps after a new import to reload.
 */
export default function UnmatchedInvoices({ refreshKey }) {
  const [list, setList] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [inv, sch] = await Promise.all([
        invoicesApi.list({ match_status: 'unmatched' }),
        schoolsApi.getAll(),
      ]);
      setList(inv.data || []);
      setSchools(sch.data || []);
    } catch { /* non-blocking */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapTo = async (inv, school_id) => {
    if (!school_id) return;
    try {
      await invoicesApi.map(inv.invoice_id, { school_id });
      setList(prev => prev.filter(i => i.invoice_id !== inv.invoice_id));
      const name = schools.find(s => s.school_id === school_id)?.school_name;
      toast.success(`${inv.invoice_number} → ${name}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Map failed');
    }
  };

  if (!loading && list.length === 0) return null;

  return (
    <div className={`${card} border rounded-md p-4`} data-testid="unmatched-invoices">
      <div className="flex items-center justify-between mb-1">
        <h3 className={`text-sm font-semibold ${textPri} flex items-center gap-1.5`}>
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Unmatched Invoices ({list.length})
        </h3>
        <Button size="sm" variant="ghost" onClick={load} className={`${textSec} h-7 w-7 p-0`} title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <p className={`text-xs ${textMuted} mb-3`}>These invoices couldn't be auto-matched to a school. Pick the right school to link each one.</p>
      <div className="space-y-2">
        {list.map(inv => (
          <div key={inv.invoice_id} className={`${card} border rounded-md p-2.5 flex items-center gap-3 flex-wrap`} data-testid={`unmatched-${inv.invoice_id}`}>
            <div className="flex-1 min-w-0">
              <span className={`text-sm font-semibold ${textPri}`}>{inv.invoice_number}</span>
              <span className={`text-xs ${textMuted} ml-2`}>
                {inv.school_name || 'no name in file'} · {money(inv.total_amount)}{inv.order_number ? ` · SO ${inv.order_number}` : ''}
              </span>
            </div>
            <select defaultValue="" onChange={e => mapTo(inv, e.target.value)}
              className={`h-8 px-2 rounded text-xs border ${inputCls} max-w-[220px]`} data-testid={`map-${inv.invoice_id}`}>
              <option value="">Map to school…</option>
              {schools.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
