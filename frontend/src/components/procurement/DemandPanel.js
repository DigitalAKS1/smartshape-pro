import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { procurement } from '../../lib/api';
import ShortfallDetailModal, { ProductThumb } from '../inventory/ShortfallDetailModal';

const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

/**
 * DemandPanel — modal listing open-sales-order demand. onAdd(line) appends a PO line.
 */
export default function DemandPanel({ open, onClose, onAdd }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shortfallOnly, setShortfallOnly] = useState(true);
  const [detailDie, setDetailDie] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    procurement.demand(shortfallOnly).then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [open, shortfallOnly]);

  const add = (r, qty) => {
    if (qty <= 0) return;
    onAdd({ item_ref: r.item_ref, name: r.name, code: r.code, uom: r.uom, gst_pct: r.gst_pct, default_rate: r.default_rate, qty });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader><DialogTitle className={textPri}>Required from Sales Orders</DialogTitle></DialogHeader>
        <label className={`flex items-center gap-2 text-xs ${textSec}`}>
          <input type="checkbox" checked={shortfallOnly} onChange={e => setShortfallOnly(e.target.checked)} /> Show only items short of stock
        </label>
        <div className="overflow-y-auto flex-1 mt-2">
          <table className="w-full text-sm">
            <thead><tr className="bg-[var(--bg-primary)]">{['', 'Item', 'Code', 'Required', 'Physical', 'Available', 'Shortfall', ''].map((h, i) => <th key={i} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-color)]">
                  <td className="py-2 px-2"><ProductThumb url={r.image_url} size={32} /></td>
                  <td className={`py-2 px-2 ${textPri}`}>{r.name}</td>
                  <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{r.code || '—'}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.required_qty}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.physical_qty}</td>
                  <td className={`py-2 px-2 ${r.available_qty < 0 ? 'text-red-500 font-medium' : textSec}`}>{r.available_qty}</td>
                  <td className="py-2 px-2">
                    <button onClick={() => setDetailDie(r.die_id)} title="Click to see which schools need it"
                      className={`font-medium underline decoration-dotted underline-offset-2 ${r.shortfall_qty > 0 ? 'text-amber-400 hover:text-amber-300' : 'text-emerald-400'}`}>
                      {r.shortfall_qty}
                    </button>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={r.shortfall_qty <= 0} onClick={() => add(r, r.shortfall_qty)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7 mr-1">+ Shortfall</Button>
                    <Button size="sm" variant="ghost" onClick={() => add(r, r.required_qty)} className={`${textSec} h-7`}>+ Full</Button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className={`py-8 text-center ${textMuted}`}>No open sales-order demand.</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter><Button onClick={onClose} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Done</Button></DialogFooter>
        <ShortfallDetailModal dieId={detailDie} open={!!detailDie} onClose={() => setDetailDie(null)} />
      </DialogContent>
    </Dialog>
  );
}
