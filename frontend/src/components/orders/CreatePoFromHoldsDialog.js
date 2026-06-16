import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Trash2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';
import { ProductThumb } from '../inventory/ShortfallDetailModal';

const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

/**
 * CreatePoFromHoldsDialog — pick a vendor, fine-tune quantities, and raise a draft
 * Purchase Order for the chosen held items. Reuses POST /purchase-orders (origin
 * 'direct'); the backend prices each line from vendor/catalog data.
 *
 * Props:
 *   open, onClose
 *   initialLines: [{ die_id, die_name, die_code, die_image_url, qty }]
 *   onCreated(po)  — called after a PO is created
 */
export default function CreatePoFromHoldsDialog({ open, onClose, initialLines = [], onCreated }) {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines(initialLines.map(l => ({ ...l })));
    setVendorId('');
    procurement.vendors.getAll().then(r => setVendors(r.data || [])).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = (i, v) => setLines(prev => prev.map((l, j) => j === i ? { ...l, qty: v } : l));
  const removeLine = (i) => setLines(prev => prev.filter((_, j) => j !== i));

  const validLines = lines.filter(l => Number(l.qty) > 0);

  const create = async () => {
    if (!vendorId) { toast.error('Pick a vendor'); return; }
    if (validLines.length === 0) { toast.error('Add at least one item with quantity'); return; }
    setSaving(true);
    try {
      const payload = {
        vendor_id: vendorId,
        origin: 'direct',
        lines: validLines.map(l => ({
          item_ref: { source: 'die', id: l.die_id },
          name: l.die_name, code: l.die_code, qty: Number(l.qty),
        })),
      };
      const r = await procurement.purchaseOrders.create(payload);
      toast.success(`Draft PO created (${validLines.length} item${validLines.length !== 1 ? 's' : ''})`);
      onCreated?.(r.data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not create PO');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className={`${textPri} flex items-center gap-2`}>
            <ShoppingCart className="h-4 w-4 text-[#e94560]" /> Create Purchase Order
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto flex-1">
          {/* Vendor */}
          <div>
            <label className={`text-xs ${textMuted} block mb-1`}>Vendor *</label>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)}
              className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
            </select>
          </div>

          {/* Lines */}
          <div className="rounded-lg border border-[var(--border-color)] divide-y divide-[var(--border-color)]">
            {lines.length === 0 && <p className={`p-4 text-sm ${textMuted}`}>No items selected.</p>}
            {lines.map((l, i) => (
              <div key={l.die_id} className="flex items-center gap-3 p-2.5">
                <ProductThumb url={l.die_image_url} size={36} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${textPri} truncate`}>{l.die_name}</p>
                  <p className={`text-xs font-mono ${textMuted}`}>{l.die_code}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs ${textMuted}`}>Qty</span>
                  <Input type="number" min={1} value={l.qty}
                    onChange={e => setQty(i, e.target.value)}
                    className={`h-9 w-20 text-center font-mono ${inputCls}`} />
                </div>
                <button onClick={() => removeLine(i)} className="text-[var(--text-muted)] hover:text-red-400 p-1" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className={`text-[11px] ${textMuted}`}>
            Prices, tax and HSN are filled automatically from the vendor/catalog when the PO is created.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}
            className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={create} disabled={saving || !vendorId || validLines.length === 0}
            className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            {saving ? 'Creating…' : `Create PO (${validLines.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
