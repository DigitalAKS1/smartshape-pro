import React, { useCallback, useEffect, useState } from 'react';
import { History, Plus, Edit2, Trash2, Package, Cog } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { pastPurchases } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import PastPurchaseDialog from './PastPurchaseDialog';

const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtMoney = (n) => (n ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '');

/**
 * Everything this school has bought: real app orders + old orders entered by hand
 * or uploaded. The "What they own" chips are what the quotation/catalogue step will
 * use to warn about repeat dies.
 */
export default function PurchaseHistorySection({ schoolId, tk, onChanged }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.team === 'admin';
  const [data, setData] = useState({ entries: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ open: false, existing: null });

  const load = useCallback(() => {
    setLoading(true);
    pastPurchases.history(schoolId)
      .then(r => setData(r.data || { entries: [], items: [] }))
      .catch(() => setData({ entries: [], items: [] }))
      .finally(() => setLoading(false));
  }, [schoolId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (e) => {
    if (!window.confirm(`Delete old order ${e.number || fmtDate(e.date)}?`)) return;
    try { await pastPurchases.remove(e.id); toast.success('Deleted'); load(); onChanged && onChanged(); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Delete failed'); }
  };

  const saved = () => { load(); onChanged && onChanged(); };

  return (
    <div data-testid="purchase-history">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm}`}>Purchase History · {data.entries.length}</p>
        <Button size="sm" onClick={() => setDialog({ open: true, existing: null })} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid="add-old-order-btn">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add old order
        </Button>
      </div>

      {data.items.length > 0 && (
        <div className={`${tk.card} border ${tk.border} rounded-2xl p-4 mb-3`}>
          <p className={`text-xs font-semibold ${tk.t1} mb-2`}>What they already own</p>
          <div className="flex flex-wrap gap-1.5">
            {data.items.map(i => (
              <span key={i.key} title={`Bought ${i.times}× · last ${fmtDate(i.last_date)}`}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${tk.border} ${tk.t1}`}>
                {i.item_type === 'machine' ? <Cog className="h-3 w-3 text-[#e94560]" /> : <Package className={`h-3 w-3 ${tk.tm}`} />}
                {i.die_code && <span className="font-mono text-[10px]">{i.die_code}</span>}
                <span>{i.name}</span>
                <span className="font-semibold text-[#e94560]">×{i.total_qty}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className={`text-sm ${tk.tm} py-4`}>Loading…</p>
      ) : data.entries.length === 0 ? (
        <div className={`${tk.card} border ${tk.border} rounded-2xl px-5 py-8 text-center`}>
          <History className={`h-8 w-8 mx-auto mb-2 ${tk.tm} opacity-40`} />
          <p className={`text-sm ${tk.tm}`}>No purchases recorded. Add old orders from before the app so the team knows what this school already has.</p>
        </div>
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {data.entries.map(e => {
            const canDelete = e.kind === 'past' && (isAdmin || e.created_by === user?.email);
            return (
              <div key={`${e.kind}-${e.id}`} className="px-5 py-3.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold text-sm ${tk.t1}`}>{e.number || (e.kind === 'past' ? 'Old order' : e.id)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${e.kind === 'order' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                    {e.kind === 'order' ? 'App order' : e.source === 'import' ? 'Old order · uploaded' : 'Old order'}
                  </span>
                  <span className={`text-xs ${tk.tm}`}>{fmtDate(e.date)}</span>
                  {e.amount > 0 && <span className="text-xs font-semibold text-[#e94560]">{fmtMoney(e.amount)}</span>}
                  {e.kind === 'past' && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" className={`h-7 px-1.5 ${tk.tm}`} title="Edit" onClick={() => setDialog({ open: true, existing: e })}><Edit2 className="h-3 w-3" /></Button>
                      {canDelete && <Button size="sm" variant="ghost" className="h-7 px-1.5 text-red-400" title="Delete" onClick={() => remove(e)}><Trash2 className="h-3 w-3" /></Button>}
                    </span>
                  )}
                </div>
                {e.items.length > 0 && (
                  <p className={`text-xs ${tk.tm} mt-1`}>
                    {e.items.map(i => `${i.die_code ? `${i.die_code} ` : ''}${i.name} ×${i.qty}`).join(' · ')}
                  </p>
                )}
                {e.notes && <p className={`text-[11px] ${tk.tm} mt-0.5 italic`}>{e.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      <PastPurchaseDialog open={dialog.open} existing={dialog.existing} schoolId={schoolId}
        onOpenChange={(v) => setDialog(d => ({ ...d, open: v }))} onSaved={saved} />
    </div>
  );
}
