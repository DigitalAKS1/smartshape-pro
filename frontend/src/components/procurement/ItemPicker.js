import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Search, ImageOff, Check, Package } from 'lucide-react';
import { procurement } from '../../lib/api';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';
const imgSrc = (u) => (u ? (u.startsWith('http') ? u : `${BACKEND}${u}`) : '');
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

function Thumb({ url, size = 56 }) {
  if (!url) return (
    <div className="flex items-center justify-center rounded bg-[var(--bg-primary)] border border-[var(--border-color)]"
      style={{ width: size, height: size }}><ImageOff className="h-5 w-5 text-[var(--text-muted)]" /></div>
  );
  return <img src={imgSrc(url)} alt="" className="rounded object-cover border border-[var(--border-color)]"
    style={{ width: size, height: size }} />;
}

/**
 * ItemPicker — image-grid modal to choose catalog items (dies + purchase items)
 * with a quantity each. onConfirm receives an array of line objects:
 *   { item_ref, name, image_url, uom, hsn, gst_pct, default_rate, qty }
 */
export default function ItemPicker({ open, onClose, onConfirm }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all'); // all | die | purchase_item
  const [picked, setPicked] = useState({}); // key -> { row, qty }

  useEffect(() => {
    if (!open) return;
    setLoading(true); setPicked({}); setQ(''); setSource('all');
    procurement.itemCatalog().then(r => setCatalog(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [open]);

  const keyOf = (row) => `${row.source}:${row.id}`;
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return catalog.filter(r =>
      (source === 'all' || r.source === source) &&
      (!ql || (r.name || '').toLowerCase().includes(ql) || (String(r.code || '')).toLowerCase().includes(ql)));
  }, [catalog, q, source]);

  const toggle = (row) => {
    const k = keyOf(row);
    setPicked(p => {
      const next = { ...p };
      if (next[k]) delete next[k];
      else next[k] = { row, qty: 1 };
      return next;
    });
  };
  const setQty = (k, qty) => setPicked(p => ({ ...p, [k]: { ...p[k], qty } }));

  const confirm = () => {
    const lines = Object.values(picked)
      .filter(({ qty }) => Number(qty) > 0)
      .map(({ row, qty }) => ({
        item_ref: row.item_ref, name: row.name, image_url: row.image_url,
        uom: row.uom, hsn: row.hsn, gst_pct: row.gst_pct,
        default_rate: row.default_rate, qty: Number(qty),
      }));
    onConfirm(lines);
    onClose();
  };

  const pickedCount = Object.keys(picked).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader><DialogTitle className={textPri}>Select Items</DialogTitle></DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search items…" className={`${inputCls} pl-8`} data-testid="itempicker-search" />
          </div>
          <div className="flex gap-1">
            {[['all', 'All'], ['die', 'Products'], ['purchase_item', 'Materials']].map(([val, lbl]) => (
              <button key={val} onClick={() => setSource(val)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${source === val ? 'bg-[#e94560] text-white' : `${textSec} bg-[var(--bg-primary)]`}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 -mx-1 px-1 mt-2">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-40 ${textMuted}`}>
              <Package className="h-8 w-8 mb-2" /> No items found.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filtered.map(row => {
                const k = keyOf(row);
                const sel = picked[k];
                return (
                  <div key={k} onClick={() => toggle(row)}
                    className={`relative cursor-pointer rounded-md border p-2 transition-all ${sel ? 'border-[#e94560] bg-[#e94560]/5' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'}`}
                    data-testid={`itempicker-card-${k}`}>
                    {sel && <span className="absolute top-1.5 right-1.5 bg-[#e94560] text-white rounded-full p-0.5"><Check className="h-3 w-3" /></span>}
                    <div className="flex gap-2">
                      <Thumb url={row.image_url} />
                      <div className="min-w-0 flex-1">
                        <p className={`${textPri} text-sm font-medium truncate`}>{row.name}</p>
                        <p className={`${textMuted} text-[11px]`}>{row.source === 'die' ? 'Product' : 'Material'} · {row.uom}</p>
                        {row.default_rate ? <p className={`${textSec} text-[11px]`}>₹{Number(row.default_rate).toLocaleString('en-IN')}</p> : null}
                      </div>
                    </div>
                    {sel && (
                      <div className="mt-2 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <span className={`text-[11px] ${textMuted}`}>Qty</span>
                        <Input type="number" min="1" value={sel.qty}
                          onChange={e => setQty(k, e.target.value)}
                          className={`${inputCls} h-7 w-20 text-sm`} data-testid={`itempicker-qty-${k}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <span className={`text-xs ${textMuted} mr-auto self-center`}>{pickedCount} selected</span>
          <Button variant="outline" onClick={onClose} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={confirm} disabled={pickedCount === 0} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="itempicker-add">
            Add {pickedCount > 0 ? pickedCount : ''} Item{pickedCount === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
