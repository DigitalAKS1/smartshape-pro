import React, { useState, useEffect, useCallback, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { packages } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import {
  Plus, Trash2, Package, X, Save, ChevronRight,
  Layers, Tag, LayoutList, AlertCircle, Copy, Search,
  ToggleLeft, ToggleRight, IndianRupee, Keyboard,
} from 'lucide-react';

const ITEM_TYPES = [
  { value: 'standard_die', label: 'Standard Die' },
  { value: 'large_die', label: 'Large Die' },
  { value: 'machine', label: 'Machine' },
  { value: 'die_set', label: 'Die Set' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'custom', label: 'Other / Custom' },
];

const TYPE_COLORS = {
  standard_die: 'bg-blue-500/15 text-blue-400',
  large_die: 'bg-purple-500/15 text-purple-400',
  machine: 'bg-orange-500/15 text-orange-400',
  die_set: 'bg-teal-500/15 text-teal-400',
  accessories: 'bg-pink-500/15 text-pink-400',
  custom: 'bg-gray-500/15 text-gray-400',
};

const DEFAULT_ITEM = { type: 'standard_die', name: '', qty: 1, unit_price: 0, gst_pct: 18 };
const DEFAULT_FORM = { display_name: '', gst_pct: 18, description: '', is_active: true, items: [] };

function calcItemTotal(item) {
  return (item.qty || 0) * (item.unit_price || 0);
}

function calcSummary(form) {
  const subtotal = form.items.reduce((s, i) => s + calcItemTotal(i), 0);
  const gst = form.items.reduce((s, i) => s + calcItemTotal(i) * ((i.gst_pct ?? form.gst_pct ?? 18) / 100), 0);
  return { subtotal, gst, total: subtotal + gst };
}

export default function PackageMaster() {
  const { isDark } = useTheme();
  const [pkgList, setPkgList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editPkg, setEditPkg] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const nameInputRef = useRef(null);

  const card = 'bg-[var(--bg-card)]';
  const bg = isDark ? 'bg-[var(--bg-primary)]' : 'bg-gray-50/80';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const borderCls = 'border-[var(--border-color)]';
  const inputCls = `bg-[var(--bg-primary)] border-[var(--border-color)] ${textPri} text-sm`;

  const fetchPackages = useCallback(async () => {
    try {
      const res = await packages.getAll();
      setPkgList(res.data);
    } catch { toast.error('Failed to load packages'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // Ctrl+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editorOpen) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openNew = () => {
    setEditPkg(null);
    setForm({
      ...DEFAULT_FORM,
      items: [{ ...DEFAULT_ITEM, type: 'standard_die', name: 'Standard Die', qty: 10, unit_price: 2000 }],
    });
    setEditorOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const openEdit = (pkg) => {
    setEditPkg(pkg);
    setForm({
      display_name: pkg.display_name || '',
      gst_pct: pkg.gst_pct ?? 18,
      description: pkg.description || '',
      is_active: pkg.is_active !== false,
      items: (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
    setEditorOpen(true);
  };

  const duplicatePkg = (pkg, e) => {
    e.stopPropagation();
    setEditPkg(null);
    setForm({
      display_name: `${pkg.display_name} (Copy)`,
      gst_pct: pkg.gst_pct ?? 18,
      description: pkg.description || '',
      is_active: true,
      items: (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
    setEditorOpen(true);
    toast.info('Duplicated — review and save');
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const discard = () => {
    setEditorOpen(false);
    setEditPkg(null);
    setForm(DEFAULT_FORM);
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
    if (!form.display_name.trim()) { toast.error('Package name is required'); nameInputRef.current?.focus(); return; }
    if (form.items.length === 0) { toast.error('Add at least one product item'); return; }
    setSaving(true);
    try {
      const { subtotal } = calcSummary(form);
      const payload = {
        display_name: form.display_name.trim(),
        name: form.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        description: form.description,
        base_price: subtotal,
        gst_pct: form.gst_pct,
        is_active: form.is_active,
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
      discard();
      fetchPackages();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const confirmAndDelete = async () => {
    if (!confirmDelete) return;
    try {
      await packages.delete(confirmDelete.package_id);
      toast.success('Package deleted');
      if (editPkg?.package_id === confirmDelete.package_id) discard();
      fetchPackages();
    } catch { toast.error('Failed to delete'); }
    finally { setConfirmDelete(null); }
  };

  const { subtotal, gst, total } = calcSummary(form);

  const filtered = pkgList.filter(p => {
    if (!showInactive && p.is_active === false) return false;
    if (search) return p.display_name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const activeCount = pkgList.filter(p => p.is_active !== false).length;
  const inactiveCount = pkgList.length - activeCount;

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className={`-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 min-h-screen ${bg} flex flex-col`}>

        {/* ── Top Bar ── */}
        <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 flex-shrink-0`}>
          <div>
            <h1 className={`text-xl font-bold ${textPri}`}>Package Master</h1>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} archived` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {inactiveCount > 0 && (
              <button onClick={() => setShowInactive(v => !v)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${showInactive ? 'bg-[#e94560]/10 text-[#e94560] border-[#e94560]/30' : `${borderCls} ${textMuted} hover:${textSec}`}`}>
                {showInactive ? 'Hide Archived' : 'Show Archived'}
              </button>
            )}
            <Button onClick={openNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-package-button">
              <Plus className="mr-1.5 h-4 w-4" /> New Package
            </Button>
          </div>
        </div>

        {/* Mobile breadcrumb */}
        {editorOpen && (
          <div className={`lg:hidden ${card} border-b ${borderCls} px-4 py-2 flex items-center gap-2`}>
            <button onClick={discard} className={`flex items-center gap-1.5 text-xs ${textMuted} hover:${textSec}`}>
              <LayoutList className="h-3.5 w-3.5" /> All Packages
            </button>
            <ChevronRight className={`h-3.5 w-3.5 ${textMuted}`} />
            <span className={`text-xs font-semibold ${textPri} truncate`}>{editPkg ? editPkg.display_name : 'New Package'}</span>
          </div>
        )}

        {/* ── Split Panel ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ─── LEFT: Package List ─── */}
          <div className={`${editorOpen ? 'hidden lg:flex' : 'flex'} lg:w-80 xl:w-96 flex-col flex-shrink-0 border-r ${borderCls}`}>

            {/* Search */}
            {pkgList.length > 3 && (
              <div className={`px-3 pt-3 pb-2 border-b ${borderCls} flex-shrink-0`}>
                <div className="relative">
                  <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search packages…"
                    className={`${inputCls} h-8 pl-8 text-xs`}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className={`absolute right-2 top-1/2 -translate-y-1/2 ${textMuted}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Package className={`h-10 w-10 ${textMuted} opacity-25`} />
                  <p className={`text-sm ${textMuted}`}>
                    {search ? `No packages matching "${search}"` : 'No packages yet'}
                  </p>
                  {!search && (
                    <Button size="sm" onClick={openNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Create First Package
                    </Button>
                  )}
                </div>
              ) : (
                filtered.map(pkg => {
                  const items = pkg.items || [];
                  const pkgSubtotal = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
                  const pkgGst = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0) * ((i.gst_pct ?? pkg.gst_pct ?? 18) / 100), 0);
                  const pkgTotal = pkgSubtotal + pkgGst;
                  const isSelected = editPkg?.package_id === pkg.package_id;
                  const inactive = pkg.is_active === false;
                  return (
                    <div
                      key={pkg.package_id}
                      onClick={() => selectEdit(pkg)}
                      data-testid={`package-card-${pkg.name}`}
                      className={`group cursor-pointer rounded-xl border transition-all ${
                        isSelected
                          ? 'border-[#e94560] bg-[#e94560]/5 shadow-sm shadow-[#e94560]/10'
                          : inactive
                          ? `${borderCls} bg-[var(--bg-primary)] opacity-60`
                          : `${borderCls} ${card} hover:border-[#e94560]/40 hover:shadow-sm`
                      }`}
                    >
                      <div className="p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-[#e94560]/20' : 'bg-[var(--bg-primary)]'}`}>
                              <Package className={`h-3.5 w-3.5 ${isSelected ? 'text-[#e94560]' : textMuted}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className={`font-semibold text-sm ${isSelected ? 'text-[#e94560]' : textPri} truncate`}>{pkg.display_name}</p>
                                {inactive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 flex-shrink-0">Archived</span>}
                              </div>
                              <p className={`text-[10px] ${textMuted} mt-0.5`}>{items.length} item{items.length !== 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          {/* Action buttons — visible on hover */}
                          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => duplicatePkg(pkg, e)}
                              title="Duplicate"
                              className={`h-7 w-7 rounded flex items-center justify-center ${textMuted} hover:text-[#e94560] hover:bg-[#e94560]/10 transition-colors`}>
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(pkg); }}
                              title="Delete"
                              className="h-7 w-7 rounded flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-colors">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* Item type chips */}
                        {items.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2.5">
                            {items.slice(0, 3).map((item, i) => (
                              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[item.type] || TYPE_COLORS.custom}`}>
                                {item.name || item.type} ×{item.qty}
                              </span>
                            ))}
                            {items.length > 3 && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] ${textMuted}`}>
                                +{items.length - 3}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Price footer */}
                        <div className={`flex items-center justify-between mt-2.5 pt-2.5 border-t ${borderCls}`}>
                          <span className={`text-[10px] ${textMuted}`}>Incl. GST</span>
                          <span className={`text-sm font-bold font-mono ${isSelected ? 'text-[#e94560]' : textPri}`}>
                            {formatCurrency(pkgTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                  function selectEdit(pkg) { openEdit(pkg); }
                })
              )}
            </div>
          </div>

          {/* ─── RIGHT: Editor ─── */}
          <div className={`${editorOpen ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden`}>

            {!editorOpen && !editPkg ? (
              /* Empty / select-prompt */
              <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 px-6 text-center">
                <div className="w-20 h-20 rounded-2xl bg-[#e94560]/10 flex items-center justify-center">
                  <Package className="h-10 w-10 text-[#e94560]" strokeWidth={1.5} />
                </div>
                <div>
                  <p className={`font-bold text-lg ${textPri}`}>Select a package</p>
                  <p className={`text-sm ${textMuted} mt-1`}>Click any package on the left to edit it, or create a new one.</p>
                </div>
                <Button onClick={openNew} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                  <Plus className="mr-2 h-4 w-4" /> New Package
                </Button>
                <p className={`text-[11px] ${textMuted} flex items-center gap-1.5 mt-2`}>
                  <Keyboard className="h-3 w-3" /> Press <kbd className={`px-1.5 py-0.5 rounded border ${borderCls} text-[10px] font-mono`}>Ctrl+S</kbd> to save while editing
                </p>
              </div>
            ) : (
              <div className="flex flex-col h-full">

                {/* Editor Header */}
                <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 flex-shrink-0`}>
                  <div className="min-w-0">
                    <h2 className={`font-bold ${textPri} truncate`}>{editPkg ? editPkg.display_name : 'New Package'}</h2>
                    <p className={`text-xs ${textMuted} mt-0.5`}>{editPkg ? 'Editing existing package' : 'Creating new package'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="ghost" onClick={discard}
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
                        {/* Per-item GST breakdown */}
                        <div className="space-y-1">
                          {form.items.map((item, i) => {
                            const itemBase = calcItemTotal(item);
                            const itemGst = itemBase * ((item.gst_pct ?? form.gst_pct ?? 18) / 100);
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
                        <div className={`flex items-center justify-between pt-2 border-t-2 border-[#e94560]/20`}>
                          <span className={`font-bold text-base ${textPri}`}>Total (incl. GST)</span>
                          <span className="font-bold font-mono text-2xl text-[#e94560]">{formatCurrency(total)}</span>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Delete zone — editing only */}
                  {editPkg && (
                    <div className={`rounded-xl border border-red-500/20 p-4 flex items-center justify-between gap-3`}>
                      <div>
                        <p className={`text-sm font-medium text-red-400`}>Delete Package</p>
                        <p className={`text-xs ${textMuted} mt-0.5`}>This action cannot be undone. Consider archiving instead.</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(editPkg)}
                        className="text-red-400 border border-red-400/30 hover:bg-red-500/10 h-9 flex-shrink-0">
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Delete Confirm Overlay ── */}
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${card} border ${borderCls} rounded-2xl p-6 w-full max-w-sm shadow-2xl`}>
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-red-400" />
              </div>
              <h3 className={`font-bold text-center ${textPri} mb-1`}>Delete Package?</h3>
              <p className={`text-sm ${textMuted} text-center mb-5`}>
                "<span className="font-medium">{confirmDelete.display_name}</span>" will be permanently deleted.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setConfirmDelete(null)}
                  className={`flex-1 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                <Button onClick={confirmAndDelete}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white">Delete</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function ItemRow({ item, idx, updateItem, removeItem, inputCls, textPri, textMuted, borderCls, bg }) {
  const itemTotal = calcItemTotal(item);
  const typeColor = TYPE_COLORS[item.type] || TYPE_COLORS.custom;
  return (
    <div className={`border ${borderCls} rounded-lg overflow-hidden`} data-testid={`item-row-${idx}`}>

      {/* Desktop: single-row grid */}
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

      {/* Mobile: stacked */}
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
