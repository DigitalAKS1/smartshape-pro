import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Plus, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';
import ItemPicker from './ItemPicker';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

const TYPE_LABELS = { returnable_out: 'Returnable (Out)', returnable_in: 'Returnable (In)', vendor_return_delivery: 'Return Delivery' };
const STATUS_MAP = { open: 'bg-blue-500/15 text-blue-300', partially_returned: 'bg-amber-500/15 text-amber-300', closed: 'bg-emerald-500/15 text-emerald-400' };

export default function ChallansTab() {
  const [list, setList] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ type: 'returnable_out', direction: 'outbound', party_type: 'vendor', vendor_id: '', party_name: '', challan_date: '', notes: '', lines: [] });

  const load = useCallback(() => { procurement.challans.getAll().then(r => setList(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { load(); procurement.vendors.getAll().then(r => setVendors(r.data || [])).catch(() => {}); }, [load]);

  const openNew = () => { setForm({ type: 'returnable_out', direction: 'outbound', party_type: 'vendor', vendor_id: '', party_name: '', challan_date: '', notes: '', lines: [] }); setFormOpen(true); };
  const save = async () => {
    if (form.lines.length === 0) { toast.error('Add at least one item'); return; }
    try {
      await procurement.challans.create({
        ...form,
        party_name: form.party_name || vendors.find(v => v.vendor_id === form.vendor_id)?.name || '',
        lines: form.lines.map(l => ({ item_ref: l.item_ref, name: l.name, code: l.code, uom: l.uom, qty: Number(l.qty) || 1 })),
      });
      toast.success('Challan created'); setFormOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const recordReturn = async (ch, idx, qty) => {
    try {
      const r = await procurement.challans.recordReturn(ch.challan_id, [{ index: idx, returned_qty: Number(qty) || 0 }]);
      setDetail(r.data); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className={`${card} border rounded-md p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-medium ${textPri}`}>Challans ({list.length})</h2>
        <Button onClick={openNew} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white"><Plus className="mr-1 h-3 w-3" />New Challan</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)]">{['Challan', 'Type', 'Party', 'Date', 'Items', 'Status', ''].map(h => <th key={h} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map(ch => (
              <tr key={ch.challan_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => setDetail(ch)}>
                <td className={`py-2.5 px-3 ${textPri} font-medium`}>{ch.challan_no}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{TYPE_LABELS[ch.type] || ch.type}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{ch.party_name}</td>
                <td className={`py-2.5 px-3 ${textMuted}`}>{ch.challan_date}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{ch.lines?.length || 0}</td>
                <td className="py-2.5 px-3"><span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_MAP[ch.status] || ''}`}>{(ch.status || '').replace('_', ' ')}</span></td>
                <td className="py-2.5 px-3 text-right"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); procurement.challans.downloadPdf(ch.challan_id, ch.challan_no).catch(() => toast.error('Download failed')); }} className={`${textSec} h-7`}><Download className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className={`py-10 text-center ${textMuted}`}>No challans yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>New Challan</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>Type</Label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, direction: e.target.value === 'returnable_in' ? 'inbound' : 'outbound' })} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`}>
                  <option value="returnable_out">Returnable (Out)</option>
                  <option value="returnable_in">Returnable (In)</option>
                  <option value="vendor_return_delivery">Return Delivery</option>
                </select>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Vendor</Label>
                <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`}>
                  <option value="">Select…</option>
                  {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className={`${textSec} text-xs`}>Party name (if not vendor)</Label><Input value={form.party_name} onChange={e => setForm({ ...form, party_name: e.target.value })} className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Challan date</Label><Input type="date" value={form.challan_date} onChange={e => setForm({ ...form, challan_date: e.target.value })} className={inputCls} /></div>
            </div>
            <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} /></div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
            </div>
            {form.lines.length === 0 ? <p className={`text-xs ${textMuted} text-center py-4`}>No items yet.</p> : (
              <div className="space-y-1.5">
                {form.lines.map((l, i) => (
                  <div key={i} className={`flex items-center gap-2 ${card} border rounded-md p-2`}>
                    <div className="flex-1 min-w-0"><p className={`${textPri} text-sm truncate`}>{l.name}{l.code ? <span className="ml-2 text-[11px] font-mono text-[#e94560]">{l.code}</span> : null}</p></div>
                    <Input type="number" min="1" value={l.qty} onChange={e => setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) })} className={`${inputCls} h-8 w-20 text-sm`} />
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })} className="text-red-400 h-8">✕</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={save} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto`}>
          {detail && (
            <>
              <DialogHeader><DialogTitle className={textPri}>{detail.challan_no} · {TYPE_LABELS[detail.type]}</DialogTitle></DialogHeader>
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">{['Item', 'Code', 'Qty', 'Returned', ''].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {detail.lines.map((l, i) => {
                    const bal = (l.qty || 0) - (l.returned_qty || 0);
                    return (
                      <tr key={i} className="border-t border-[var(--border-color)]">
                        <td className={`py-2 px-2 ${textPri}`}>{l.name}</td>
                        <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{l.code || '—'}</td>
                        <td className={`py-2 px-2 ${textSec}`}>{l.qty}</td>
                        <td className={`py-2 px-2 ${textSec}`}>{l.returned_qty}</td>
                        <td className="py-2 px-2">
                          {detail.status !== 'closed' && bal > 0 && (
                            <Button size="sm" variant="outline" onClick={() => recordReturn(detail, i, bal)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><RotateCcw className="h-3 w-3 mr-1" />Return {bal}</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <DialogFooter>
                <Button variant="outline" onClick={() => procurement.challans.downloadPdf(detail.challan_id, detail.challan_no).catch(() => toast.error('Download failed'))} className="border-[var(--border-color)] text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={(picked) => setForm(f => ({ ...f, lines: [...f.lines, ...picked] }))} />
    </div>
  );
}
