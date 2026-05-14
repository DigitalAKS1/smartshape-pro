import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { packages } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import {
  Plus, Trash2, Edit2, Package, X, Save, ChevronRight,
  Layers, Tag, LayoutList, AlertCircle,
} from 'lucide-react';

const ITEM_TYPES = [
  { value: 'standard_die', label: 'Standard Die' },
  { value: 'large_die', label: 'Large Die' },
  { value: 'machine', label: 'Machine' },
  { value: 'die_set', label: 'Die Set' },
  { value: 'custom', label: 'Other / Custom' },
];

const DEFAULT_ITEM = { type: 'custom', name: '', qty: 1, unit_price: 0, gst_pct: 18 };
const DEFAULT_FORM = { display_name: '', gst_pct: 18, description: '', items: [] };

function calcItemTotal(item) {
  return (item.qty || 0) * (item.unit_price || 0);
}

function calcSummary(form) {
  const subtotal = form.items.reduce((s, item) => s + calcItemTotal(item), 0);
  const gst = form.items.reduce((s, item) => s + calcItemTotal(item) * ((item.gst_pct || form.gst_pct || 18) / 100), 0);
  return { subtotal, gst, total: subtotal + gst };
}

export default function PackageMaster() {
  const { isDark } = useTheme();
  const [pkgList, setPkgList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editPkg, setEditPkg] = useState(null); // null = new
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editorOpen, setEditorOpen] = useState(false); // mobile toggle

  const card = 'bg-[var(--bg-card)]';
  const bg = isDark ? 'bg-[var(--bg-primary)]' : 'bg-gray-50';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const borderCls = 'border-[var(--border-color)]';
  const inputCls = `bg-[var(--bg-primary)] border-[var(--border-color)] ${textPri} text-sm`;

  const fetchPackages = async () => {
    try {
      const res = await packages.getAll();
      setPkgList(res.data);
    } catch { toast.error('Failed to load packages'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPackages(); }, []);

  const selectNew = () => {
    setEditPkg(null);
    setForm({
      ...DEFAULT_FORM,
      items: [{ ...DEFAULT_ITEM, type: 'standard_die', name: 'Standard Die', qty: 10, unit_price: 2000 }],
    });
    setEditorOpen(true);
  };

  const selectEdit = (pkg) => {
    setEditPkg(pkg);
    setForm({
      display_name: pkg.display_name || '',
      gst_pct: pkg.gst_pct ?? 18,
      description: pkg.description || '',
      items: (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
    setEditorOpen(true);
  };

  const addItem = () => {
    setForm(f => ({ ...f, items: [...f.items, { ...DEFAULT_ITEM }] }));
  };

  const removeItem = (idx) => {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const updateItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = {
        ...items[idx],
        [field]: (field === 'name' || field === 'type') ? value : (parseFloat(value) || 0),
      };
      if (field === 'type') {
        const found = ITEM_TYPES.find(t => t.value === value);
        if (found && !items[idx].name) items[idx].name = found.label;
      }
      return { ...f, items };
    });
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) { toast.error('Package name is required'); return; }
    if (form.items.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      const { subtotal } = calcSummary(form);
      const payload = {
        display_name: form.display_name.trim(),
        name: form.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        description: form.description,
        base_price: subtotal,
        gst_pct: form.gst_pct,
        items: form.items,
        std_die_qty: form.items.filter(i => i.type === 'standard_die').reduce((s, i) => s + (i.qty || 0), 0),
        large_die_qty: form.items.filter(i => i.type === 'large_die').reduce((s, i) => s + (i.qty || 0), 0),
        machine_qty: form.items.filter(i => i.type === 'machine').reduce((s, i) => s + (i.qty || 0), 0),
      };
      if (editPkg) {
        await packages.update(editPkg.package_id, payload);
        toast.success('Package updated');
      } else {
        await packages.create(payload);
        toast.success('Package created');
      }
      setEditorOpen(false);
      setEditPkg(null);
      setForm(DEFAULT_FORM);
      fetchPackages();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${pkg.display_name}"?`)) return;
    try {
      await packages.delete(pkg.package_id);
      toast.success('Package deleted');
      if (editPkg?.package_id === pkg.package_id) {
        setEditPkg(null);
        setForm(DEFAULT_FORM);
        setEditorOpen(false);
      }
      fetchPackages();
    } catch { toast.error('Failed to delete'); }
  };

  const { subtotal, gst, total } = calcSummary(form);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  const activePkgs = pkgList.filter(p => p.is_active !== false);

  return (
    <AdminLayout>
      <div className={`-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 min-h-screen ${bg} flex flex-col`}>

        {/* Top Bar */}
        <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0`}>
          <div>
            <h1 className={`text-xl font-bold ${textPri}`} data-testid="package-master-title">Package Master</h1>
            <p className={`text-xs ${textMuted} mt-0.5`}>{activePkgs.length} package{activePkgs.length !== 1 ? 's' : ''} configured</p>
          </div>
          <Button onClick={selectNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-package-button">
            <Plus className="mr-2 h-4 w-4" /> New Package
          </Button>
        </div>

        {/* Mobile: toggle between list and editor */}
        {editorOpen && (
          <div className={`lg:hidden ${card} border-b ${borderCls} px-4 py-2 flex items-center gap-2`}>
            <Button variant="ghost" size="sm" onClick={() => setEditorOpen(false)} className={`${textMuted} gap-1.5 text-xs h-7`}>
              <LayoutList className="h-3.5 w-3.5" /> All Packages
            </Button>
            <ChevronRight className={`h-3.5 w-3.5 ${textMuted}`} />
            <span className={`text-xs font-medium ${textPri}`}>{editPkg ? editPkg.display_name : 'New Package'}</span>
          </div>
        )}

        {/* Main Split Panel */}
        <div className="flex flex-1 overflow-hidden">

          {/* ─── LEFT: Package List ─── */}
          <div className={`${editorOpen ? 'hidden lg:flex' : 'flex'} lg:w-80 xl:w-96 flex-col flex-shrink-0 border-r ${borderCls} overflow-y-auto`}>
            <div className="flex-1 p-3 space-y-2">
              {activePkgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Package className={`h-12 w-12 ${textMuted} opacity-30`} />
                  <p className={`text-sm ${textMuted}`}>No packages yet</p>
                  <Button size="sm" onClick={selectNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Create First Package
                  </Button>
                </div>
              ) : (
                activePkgs.map(pkg => {
                  const items = pkg.items || [];
                  const pkgSubtotal = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
                  const pkgGst = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0) * ((i.gst_pct || pkg.gst_pct || 18) / 100), 0);
                  const pkgTotal = pkgSubtotal + pkgGst;
                  const isSelected = editPkg?.package_id === pkg.package_id;
                  return (
                    <div
                      key={pkg.package_id}
                      onClick={() => selectEdit(pkg)}
                      data-testid={`package-card-${pkg.name}`}
                      className={`group cursor-pointer rounded-xl border transition-all ${
                        isSelected
                          ? 'border-[#e94560] bg-[#e94560]/5 shadow-sm'
                          : `${borderCls} ${card} hover:border-[#e94560]/50`
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-[#e94560]/20' : 'bg-[var(--bg-primary)]'}`}>
                              <Package className={`h-4 w-4 ${isSelected ? 'text-[#e94560]' : textMuted}`} />
                            </div>
                            <div className="min-w-0">
                              <p className={`font-semibold ${textPri} truncate`}>{pkg.display_name}</p>
                              <p className={`text-xs ${textMuted} mt-0.5`}>{items.length} item{items.length !== 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); selectEdit(pkg); }}
                              className={`${textSec} h-7 w-7 p-0`} data-testid={`edit-pkg-${pkg.name}`}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={(e) => handleDelete(pkg, e)}
                              className="text-red-400 h-7 w-7 p-0" data-testid={`delete-pkg-${pkg.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Item chips */}
                        {items.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-3">
                            {items.slice(0, 4).map((item, i) => (
                              <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full ${isSelected ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] ' + textMuted}`}>
                                {item.name || item.type} ×{item.qty}
                              </span>
                            ))}
                            {items.length > 4 && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-primary)] ${textMuted}`}>
                                +{items.length - 4} more
                              </span>
                            )}
                          </div>
                        )}

                        {/* Price footer */}
                        <div className={`flex items-center justify-between mt-3 pt-3 border-t ${borderCls}`}>
                          <span className={`text-xs ${textMuted}`}>Incl. GST</span>
                          <span className={`font-bold font-mono ${isSelected ? 'text-[#e94560]' : textPri}`}>
                            {formatCurrency(pkgTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── RIGHT: Editor Panel ─── */}
          <div className={`${editorOpen ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-y-auto`}>
            {!editorOpen && !editPkg && activePkgs.length > 0 ? (
              // Empty state when nothing selected on desktop
              <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20">
                <div className="w-16 h-16 rounded-2xl bg-[#e94560]/10 flex items-center justify-center">
                  <Package className="h-8 w-8 text-[#e94560]" />
                </div>
                <div className="text-center">
                  <p className={`font-semibold ${textPri}`}>Select a package to edit</p>
                  <p className={`text-sm ${textMuted} mt-1`}>Or create a new one to get started</p>
                </div>
                <Button onClick={selectNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                  <Plus className="mr-2 h-4 w-4" /> New Package
                </Button>
              </div>
            ) : editorOpen || editPkg ? (
              <div className="flex flex-col h-full">
                {/* Editor Header */}
                <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0`}>
                  <div>
                    <h2 className={`font-bold ${textPri}`}>{editPkg ? 'Edit Package' : 'New Package'}</h2>
                    {editPkg && <p className={`text-xs ${textMuted} font-mono mt-0.5`}>{editPkg.package_id}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => { setEditorOpen(false); setEditPkg(null); setForm(DEFAULT_FORM); }}
                      className={`${textSec} border ${borderCls} h-9`}>
                      <X className="mr-1.5 h-3.5 w-3.5" /> Discard
                    </Button>
                    <Button onClick={handleSave} disabled={saving}
                      className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9" data-testid="save-package-button">
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      {saving ? 'Saving…' : editPkg ? 'Update' : 'Create'}
                    </Button>
                  </div>
                </div>

                {/* Editor Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

                  {/* Package Info */}
                  <section className={`${card} border ${borderCls} rounded-xl p-4 sm:p-5`}>
                    <div className="flex items-center gap-2 mb-4">
                      <Tag className="h-4 w-4 text-[#e94560]" />
                      <h3 className={`font-semibold ${textPri} text-sm`}>Package Details</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Package Name *</Label>
                        <Input
                          value={form.display_name}
                          onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                          className={`${inputCls} h-10`}
                          placeholder="e.g. Premium Die Package"
                          data-testid="pkg-name-input"
                        />
                      </div>
                      <div>
                        <Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Default GST %</Label>
                        <Input
                          type="number"
                          value={form.gst_pct}
                          onChange={e => setForm(f => ({ ...f, gst_pct: parseFloat(e.target.value) || 0 }))}
                          className={`${inputCls} h-10`}
                          data-testid="pkg-gst-input"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Label className={`${textSec} text-xs uppercase tracking-wide mb-1.5 block`}>Description</Label>
                        <Input
                          value={form.description}
                          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                          className={`${inputCls} h-10`}
                          placeholder="Brief description of what this package includes..."
                        />
                      </div>
                    </div>
                  </section>

                  {/* Items Builder */}
                  <section className={`${card} border ${borderCls} rounded-xl p-4 sm:p-5`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-[#e94560]" />
                        <h3 className={`font-semibold ${textPri} text-sm`}>Package Items</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560] font-bold`}>{form.items.length}</span>
                      </div>
                      <Button size="sm" onClick={addItem}
                        className="bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 border border-[#e94560]/30 h-8"
                        data-testid="add-item-button">
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
                      </Button>
                    </div>

                    {form.items.length === 0 ? (
                      <div className={`flex flex-col items-center justify-center py-10 gap-2 rounded-lg border-2 border-dashed ${borderCls}`}>
                        <AlertCircle className={`h-8 w-8 ${textMuted} opacity-40`} />
                        <p className={`text-sm ${textMuted}`}>No items yet — click "Add Item" to start</p>
                      </div>
                    ) : (
                      <>
                        {/* Column headers — desktop */}
                        <div className={`hidden sm:grid grid-cols-12 gap-2 px-3 pb-2 text-xs ${textMuted} uppercase tracking-wide`}>
                          <div className="col-span-2">Type</div>
                          <div className="col-span-3">Name</div>
                          <div className="col-span-1 text-center">Qty</div>
                          <div className="col-span-2">Unit Price</div>
                          <div className="col-span-1 text-center">GST %</div>
                          <div className="col-span-2 text-right">Item Total</div>
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
                  <section className={`${card} border ${borderCls} rounded-xl overflow-hidden`}>
                    <div className={`px-4 sm:px-5 py-3 border-b ${borderCls} flex items-center gap-2`}>
                      <h3 className={`font-semibold ${textPri} text-sm`}>Pricing Summary</h3>
                    </div>
                    <div className="px-4 sm:px-5 py-4 space-y-2">
                      <SummaryRow label="Items Subtotal" value={formatCurrency(subtotal)} muted textPri={textPri} textSec={textSec} />
                      <SummaryRow
                        label={`GST (per-item rates)`}
                        value={formatCurrency(gst)}
                        muted
                        textPri={textPri}
                        textSec={textSec}
                        sub={form.items.length > 0 ? form.items.map(i => `${i.name || i.type} @ ${i.gst_pct ?? form.gst_pct}%`).join(', ') : ''}
                      />
                      <div className={`flex items-center justify-between pt-3 border-t ${borderCls}`}>
                        <span className={`font-bold ${textPri}`}>Total Payable (incl. GST)</span>
                        <span className="font-bold font-mono text-xl text-[#e94560]">{formatCurrency(total)}</span>
                      </div>
                    </div>
                  </section>

                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function ItemRow({ item, idx, updateItem, removeItem, inputCls, textPri, textMuted, borderCls, bg }) {
  const itemTotal = calcItemTotal(item);
  return (
    <div className={`border ${borderCls} rounded-lg p-3 ${bg}`} data-testid={`item-row-${idx}`}>
      {/* Desktop: single row grid */}
      <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
        <div className="col-span-2">
          <select
            value={item.type}
            onChange={e => updateItem(idx, 'type', e.target.value)}
            className={`w-full h-9 px-2 rounded-md text-sm border bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`}
          >
            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="col-span-3">
          <Input
            value={item.name}
            onChange={e => updateItem(idx, 'name', e.target.value)}
            className={`${inputCls} h-9`}
            placeholder="Item name"
          />
        </div>
        <div className="col-span-1">
          <Input
            type="number"
            value={item.qty}
            onChange={e => updateItem(idx, 'qty', e.target.value)}
            className={`${inputCls} h-9 text-center`}
            min={1}
          />
        </div>
        <div className="col-span-2">
          <Input
            type="number"
            value={item.unit_price}
            onChange={e => updateItem(idx, 'unit_price', e.target.value)}
            className={`${inputCls} h-9`}
            placeholder="0"
          />
        </div>
        <div className="col-span-1">
          <Input
            type="number"
            value={item.gst_pct ?? 18}
            onChange={e => updateItem(idx, 'gst_pct', e.target.value)}
            className={`${inputCls} h-9 text-center`}
            min={0}
            max={100}
          />
        </div>
        <div className="col-span-2 text-right">
          <p className={`font-mono font-semibold ${textPri} text-sm pr-2`}>{formatCurrency(itemTotal)}</p>
        </div>
        <div className="col-span-1 flex justify-end">
          <button
            onClick={() => removeItem(idx)}
            className="text-red-400 hover:text-red-300 h-9 w-9 flex items-center justify-center rounded-md hover:bg-red-500/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile: stacked layout */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center justify-between gap-2">
          <select
            value={item.type}
            onChange={e => updateItem(idx, 'type', e.target.value)}
            className={`flex-1 h-9 px-2 rounded-md text-sm border bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`}
          >
            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button
            onClick={() => removeItem(idx)}
            className="text-red-400 hover:text-red-300 h-9 w-9 flex items-center justify-center rounded-md hover:bg-red-500/10 transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Input
          value={item.name}
          onChange={e => updateItem(idx, 'name', e.target.value)}
          className={`${inputCls} h-9 w-full`}
          placeholder="Item name"
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>Qty</p>
            <Input type="number" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} className={`${inputCls} h-9 text-center`} min={1} />
          </div>
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>Unit Price</p>
            <Input type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} className={`${inputCls} h-9`} />
          </div>
          <div>
            <p className={`text-[10px] ${textMuted} mb-1`}>GST %</p>
            <Input type="number" value={item.gst_pct ?? 18} onChange={e => updateItem(idx, 'gst_pct', e.target.value)} className={`${inputCls} h-9 text-center`} />
          </div>
        </div>
        <div className={`flex items-center justify-between text-xs pt-1 border-t ${borderCls}`}>
          <span className={textMuted}>Item Total</span>
          <span className={`font-mono font-bold ${textPri}`}>{formatCurrency(itemTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, muted, textPri, textSec, sub }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={muted ? textSec : `font-semibold ${textPri}`}>{label}</span>
        <span className={`font-mono ${muted ? textSec : textPri}`}>{value}</span>
      </div>
      {sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
