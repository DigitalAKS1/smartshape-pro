import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Plus, Trash2, X, Save, Layers, Tag, AlertCircle,
  ToggleLeft, ToggleRight, IndianRupee, Keyboard,
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { ITEM_TYPES, TYPE_COLORS, calcItemTotal } from '../../hooks/usePackageMaster';

/* ── Item row component ──────────────────────────────────────────────────── */
function ItemRow({ item, idx, updateItem, removeItem, inputCls, textPri, textMuted, borderCls, bg }) {
  const itemTotal = calcItemTotal(item);
  const typeColor = TYPE_COLORS[item.type] || TYPE_COLORS.custom;
  return (
    <div className={`border ${borderCls} rounded-lg overflow-hidden`} data-testid={`item-row-${idx}`}>
      {/* Desktop */}
      <div className="hidden sm:grid grid-cols-12 gap-2 items-center px-3 py-2.5 bg-[var(--bg-card)]">
        <div className="col-span-2">
          <select
            value={item.type}
            onChange={e => updateItem(idx, 'type', e.target.value)}
            className={`w-full h-8 px-2 rounded-md text-xs border bg-[var(--bg-primary)] border-[var(--border-color)] ${textPri}`}
          >
            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="col-span-3">
          <Input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
            className={`${inputCls} h-8 text-xs`} placeholder="Product name" />
        </div>
        <div className="col-span-1">
          <Input type="number" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)}
            className={`${inputCls} h-8 text-xs text-center`} min={1} />
        </div>
        <div className="col-span-2">
          <Input type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
            className={`${inputCls} h-8 text-xs text-right`} placeholder="0" />
        </div>
        <div className="col-span-1">
          <Input type="number" value={item.gst_pct ?? 18} onChange={e => updateItem(idx, 'gst_pct', e.target.value)}
            className={`${inputCls} h-8 text-xs text-center`} min={0} max={100} />
        </div>
        <div className="col-span-2 text-right pr-2">
          <p className={`font-mono text-sm font-semibold ${textPri}`}>{formatCurrency(itemTotal)}</p>
          <p className={`text-[9px] ${textMuted}`}>+GST {item.gst_pct ?? 18}%</p>
        </div>
        <div className="col-span-1 flex justify-end">
          <button onClick={() => removeItem(idx)}
            className="h-8 w-8 flex items-center justify-center rounded text-red-400 hover:bg-red-500/10 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mobile */}
      <div className={`sm:hidden p-3 ${bg} space-y-2`}>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${typeColor}`}>
            {ITEM_TYPES.find(t => t.value === item.type)?.label || item.type}
          </span>
          <div className="flex-1" />
          <button onClick={() => removeItem(idx)}
            className="h-7 w-7 flex items-center justify-center rounded text-red-400 hover:bg-red-500/10">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <select value={item.type} onChange={e => updateItem(idx, 'type', e.target.value)}
          className={`w-full h-9 px-2 rounded-md text-sm border bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`}>
          {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
          className={`${inputCls} h-9`} placeholder="Product name" />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>Qty</p>
            <Input type="number" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)}
              className={`${inputCls} h-9 text-center`} min={1} />
          </div>
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>Unit Price</p>
            <Input type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
              className={`${inputCls} h-9`} />
          </div>
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>GST %</p>
            <Input type="number" value={item.gst_pct ?? 18} onChange={e => updateItem(idx, 'gst_pct', e.target.value)}
              className={`${inputCls} h-9 text-center`} />
          </div>
        </div>
        <div className={`flex justify-between items-center text-xs pt-2 border-t ${borderCls}`}>
          <span className={textMuted}>Item Total (excl. GST)</span>
          <span className={`font-mono font-bold ${textPri}`}>{formatCurrency(itemTotal)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Full create/edit package form panel — package details, items builder, pricing summary, delete zone.
 */
export default function PackageFormPanel({
  editPkg, form, setForm, nameInputRef,
  saving, onSave, onDiscard, onRequestDelete,
  addItem, removeItem, updateItem,
  summary,
  textPri, textSec, textMuted, borderCls, card, inputCls, bg,
}) {
  const { subtotal, gst, total } = summary;

  if (!editPkg && !form.display_name && !form.items?.length) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 px-6 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[#e94560]/10 flex items-center justify-center">
          <Tag className="h-10 w-10 text-[#e94560]" strokeWidth={1.5} />
        </div>
        <div>
          <p className={`font-bold text-lg ${textPri}`}>Select a package</p>
          <p className={`text-sm ${textMuted} mt-1`}>Click any package on the left to edit it, or create a new one.</p>
        </div>
        <p className={`text-[11px] ${textMuted} flex items-center gap-1.5 mt-2`}>
          <Keyboard className="h-3 w-3" /> Press <kbd className={`px-1.5 py-0.5 rounded border ${borderCls} text-[10px] font-mono`}>Ctrl+S</kbd> to save while editing
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Editor Header */}
      <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 flex-shrink-0`}>
        <div className="min-w-0">
          <h2 className={`font-bold ${textPri} truncate`}>{editPkg ? editPkg.display_name : 'New Package'}</h2>
          <p className={`text-xs ${textMuted} mt-0.5`}>{editPkg ? 'Editing existing package' : 'Creating new package'}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" onClick={onDiscard} className={`${textSec} border ${borderCls} h-9`}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Discard
          </Button>
          <Button onClick={onSave} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9" data-testid="save-package-button">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? 'Saving…' : editPkg ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

        {/* Package Info */}
        <section className={`${card} border ${borderCls} rounded-xl p-4 sm:p-5`}>
          <div className="flex items-center gap-2 mb-4">
            <Tag className="h-4 w-4 text-[#e94560]" />
            <h3 className={`font-semibold text-sm ${textPri}`}>Package Details</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Package Name *</Label>
              <Input
                ref={nameInputRef}
                value={form.display_name}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                className={`${inputCls} h-10`}
                placeholder="e.g. Premium Die Kit — 10 Standard"
                data-testid="pkg-name-input"
              />
            </div>
            <div>
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Default GST %</Label>
              <Input
                type="number" min="0" max="28" step="0.5"
                value={form.gst_pct}
                onChange={e => setForm(f => ({ ...f, gst_pct: parseFloat(e.target.value) || 0 }))}
                className={`${inputCls} h-10`}
                data-testid="pkg-gst-input"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className={`${inputCls} h-10`}
                placeholder="Brief description…"
              />
            </div>
            <div className="flex flex-col justify-end">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Status</Label>
              <button
                onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                className={`h-10 flex items-center gap-2 px-3 rounded-md border transition-colors text-sm font-medium ${
                  form.is_active
                    ? 'border-green-500/40 bg-green-500/10 text-green-400'
                    : `${borderCls} ${textMuted}`
                }`}
              >
                {form.is_active
                  ? <><ToggleRight className="h-4 w-4" /> Active</>
                  : <><ToggleLeft className="h-4 w-4" /> Archived</>
                }
              </button>
            </div>
          </div>
        </section>

        {/* Items Builder */}
        <section className={`${card} border ${borderCls} rounded-xl p-4 sm:p-5`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#e94560]" />
              <h3 className={`font-semibold text-sm ${textPri}`}>Products / Items</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560] font-bold">{form.items.length}</span>
            </div>
            <Button size="sm" onClick={addItem}
              className="bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 border border-[#e94560]/30 h-8"
              data-testid="add-item-button">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
            </Button>
          </div>

          {form.items.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-10 gap-3 rounded-xl border-2 border-dashed ${borderCls}`}>
              <AlertCircle className={`h-7 w-7 ${textMuted} opacity-30`} />
              <p className={`text-sm ${textMuted}`}>No items added yet</p>
              <Button size="sm" onClick={addItem} className="bg-[#e94560]/10 text-[#e94560] border border-[#e94560]/30 hover:bg-[#e94560]/20 h-8">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add First Item
              </Button>
            </div>
          ) : (
            <>
              {/* Column headers — desktop */}
              <div className={`hidden sm:grid grid-cols-12 gap-2 px-3 pb-2 text-[10px] ${textMuted} uppercase tracking-wider`}>
                <div className="col-span-2">Type</div>
                <div className="col-span-3">Name</div>
                <div className="col-span-1 text-center">Qty</div>
                <div className="col-span-2 text-right">Unit Price</div>
                <div className="col-span-1 text-center">GST%</div>
                <div className="col-span-2 text-right">Total</div>
                <div className="col-span-1" />
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <ItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    updateItem={updateItem}
                    removeItem={removeItem}
                    inputCls={inputCls}
                    textPri={textPri}
                    textMuted={textMuted}
                    borderCls={borderCls}
                    bg={bg}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Pricing Summary */}
        {form.items.length > 0 && (
          <section className={`${card} border ${borderCls} rounded-xl overflow-hidden`}>
            <div className={`px-4 sm:px-5 py-3 border-b ${borderCls} flex items-center gap-2`}>
              <IndianRupee className="h-3.5 w-3.5 text-[#e94560]" />
              <h3 className={`font-semibold text-sm ${textPri}`}>Pricing Summary</h3>
            </div>
            <div className="px-4 sm:px-5 py-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className={textSec}>Subtotal ({form.items.length} items)</span>
                <span className={`font-mono ${textPri}`}>{formatCurrency(subtotal)}</span>
              </div>
              <div className="space-y-1">
                {form.items.map((item, i) => {
                  const itemBase = calcItemTotal(item);
                  const itemGst  = itemBase * ((item.gst_pct ?? form.gst_pct ?? 18) / 100);
                  return itemBase > 0 ? (
                    <div key={i} className="flex justify-between text-xs">
                      <span className={textMuted}>GST {item.gst_pct ?? form.gst_pct}% on {item.name || item.type}</span>
                      <span className={`font-mono ${textMuted}`}>{formatCurrency(itemGst)}</span>
                    </div>
                  ) : null;
                })}
              </div>
              <div className={`flex justify-between text-sm pt-1 border-t ${borderCls}`}>
                <span className={textSec}>Total GST</span>
                <span className={`font-mono ${textSec}`}>{formatCurrency(gst)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t-2 border-[#e94560]/20">
                <span className={`font-bold text-base ${textPri}`}>Total (incl. GST)</span>
                <span className="font-bold font-mono text-2xl text-[#e94560]">{formatCurrency(total)}</span>
              </div>
            </div>
          </section>
        )}

        {/* Delete zone */}
        {editPkg && (
          <div className="rounded-xl border border-red-500/20 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-red-400">Delete Package</p>
              <p className={`text-xs ${textMuted} mt-0.5`}>This action cannot be undone. Consider archiving instead.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onRequestDelete(editPkg)}
              className="text-red-400 border border-red-400/30 hover:bg-red-500/10 h-9 flex-shrink-0">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
