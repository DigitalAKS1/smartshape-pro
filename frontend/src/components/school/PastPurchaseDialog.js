import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { dies as diesApi, pastPurchases } from '../../lib/api';

const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const today = () => new Date().toISOString().slice(0, 10);
const blankLine = () => ({ die_id: '', name: '', item_type: 'die', qty: 1, search: '' });

/** One item line: search inventory by code/name, or type a free-text item (e.g. a machine). */
function ItemLine({ line, allDies, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = (line.search || '').trim().toLowerCase();
    if (t.length < 1) return [];
    return allDies.filter(d => (d.code || '').toLowerCase().includes(t) || (d.name || '').toLowerCase().includes(t)).slice(0, 8);
  }, [line.search, allDies]);
  const picked = line.die_id ? allDies.find(d => d.die_id === line.die_id) : null;

  return (
    <div className="flex gap-2 items-start">
      <div className="flex-1 relative">
        {picked ? (
          <div className={`h-9 px-3 flex items-center justify-between rounded-md border ${inputCls} text-sm`}>
            <span className="truncate"><span className="font-mono text-xs mr-1.5">{picked.code}</span>{picked.name}</span>
            <button type="button" className={`text-xs ${textMuted} hover:text-[#e94560]`} onClick={() => onChange({ ...line, die_id: '', search: '' })}>change</button>
          </div>
        ) : (
          <>
            <Search className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${textMuted}`} />
            <Input value={line.search} placeholder="Die code / name, or type a machine…"
              onChange={e => { onChange({ ...line, search: e.target.value, name: e.target.value }); setOpen(true); }}
              onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              className={`${inputCls} h-9 pl-8 text-sm`} data-testid="pp-item-search" />
            {open && matches.length > 0 && (
              <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg">
                {matches.map(d => (
                  <button type="button" key={d.die_id} onMouseDown={() => onChange({ ...line, die_id: d.die_id, search: '', name: '' })}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] text-[var(--text-primary)]">
                    <span className="font-mono text-xs mr-1.5">{d.code}</span>{d.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {!picked && line.search && (
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[11px] ${textMuted}`}>Not in inventory? saved as:</span>
            <select value={line.item_type} onChange={e => onChange({ ...line, item_type: e.target.value })}
              className={`h-6 px-1.5 rounded text-[11px] ${inputCls}`}>
              <option value="die">Die</option><option value="machine">Machine</option><option value="other">Other</option>
            </select>
          </div>
        )}
      </div>
      <Input type="number" min="1" value={line.qty} onChange={e => onChange({ ...line, qty: e.target.value })}
        className={`${inputCls} h-9 w-20 text-sm`} aria-label="Quantity" />
      <Button type="button" size="sm" variant="ghost" onClick={onRemove} className="h-9 px-2 text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

/** Add or edit one old order for a school. `existing` = a history entry of kind "past". */
export default function PastPurchaseDialog({ open, onOpenChange, schoolId, existing, onSaved }) {
  const [allDies, setAllDies] = useState([]);
  const [form, setForm] = useState({ purchase_date: today(), reference: '', amount: '', notes: '' });
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Include archived dies: old orders are exactly where retired designs show up.
    diesApi.getAll(true).then(r => setAllDies(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    if (existing) {
      setForm({ purchase_date: existing.date || today(), reference: existing.number || '', amount: existing.amount || '', notes: existing.notes || '' });
      setLines((existing.items || []).map(i => ({ die_id: i.die_id || '', die_code: i.die_id ? '' : (i.die_code || ''), name: i.die_id ? '' : i.name, search: i.die_id ? '' : i.name, item_type: i.item_type || 'die', qty: i.qty || 1 })));
    } else {
      setForm({ purchase_date: today(), reference: '', amount: '', notes: '' });
      setLines([blankLine()]);
    }
  }, [open, existing]);

  const save = async () => {
    const items = lines
      .filter(l => l.die_id || (l.name || '').trim())
      .map(l => (l.die_id
        ? { die_id: l.die_id, qty: Number(l.qty) }
        : { name: l.name.trim(), die_code: l.die_code || '', item_type: l.item_type, qty: Number(l.qty) }));
    if (!items.length) { toast.error('Add at least one item'); return; }
    if (items.some(i => !(i.qty >= 1))) { toast.error('Quantity must be 1 or more'); return; }
    setSaving(true);
    try {
      const payload = { ...form, amount: form.amount === '' ? 0 : Number(form.amount), items };
      if (existing) await pastPurchases.update(existing.id, payload);
      else await pastPurchases.create({ ...payload, school_id: schoolId });
      toast.success(existing ? 'Old order updated' : 'Old order added');
      onOpenChange(false);
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{existing ? 'Edit old order' : 'Add old order'}</DialogTitle></DialogHeader>
        <p className={`text-xs ${textMuted} -mt-1`}>For orders placed before the app, or outside it. This is history only — it doesn't touch stock, production or payments.</p>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label className={`${textSec} text-xs`}>Date *</Label>
              <Input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} className={inputCls} data-testid="pp-date" /></div>
            <div><Label className={`${textSec} text-xs`}>Bill / Invoice no.</Label>
              <Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} className={inputCls} placeholder="optional" /></div>
            <div><Label className={`${textSec} text-xs`}>Amount (₹)</Label>
              <Input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={inputCls} placeholder="optional" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className={`${textSec} text-xs`}>Items *</Label>
              <span className={`text-[11px] ${textMuted}`}>Qty</span>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <ItemLine key={i} line={l} allDies={allDies}
                  onChange={nl => setLines(ls => ls.map((x, j) => (j === i ? nl : x)))}
                  onRemove={() => setLines(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))} />
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines(ls => [...ls, blankLine()])}
              className="mt-2 border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="pp-add-line">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add item
            </Button>
          </div>
          <div><Label className={`${textSec} text-xs`}>Notes</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="pp-save">
            {saving ? 'Saving…' : existing ? 'Update' : 'Save old order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
