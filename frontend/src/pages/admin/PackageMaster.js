import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { packages } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Edit2, Package, X, GripVertical } from 'lucide-react';

const ITEM_TYPES = [
  { value: 'standard_die', label: 'Standard Die' },
  { value: 'large_die', label: 'Large Die' },
  { value: 'machine', label: 'Machine' },
  { value: 'die_set', label: 'Die Set' },
  { value: 'custom', label: 'Other / Custom' },
];

export default function PackageMaster() {
  const [pkgList, setPkgList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPkg, setEditPkg] = useState(null);
  const [form, setForm] = useState({ display_name: '', base_price: 0, gst_pct: 18, items: [] });

  const fetchPackages = async () => {
    try {
      const res = await packages.getAll();
      setPkgList(res.data);
    } catch { toast.error('Failed to load packages'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPackages(); }, []);

  const openCreate = () => {
    setEditPkg(null);
    setForm({ display_name: '', base_price: 0, gst_pct: 18, items: [
      { type: 'standard_die', name: 'Standard Die', qty: 10, unit_price: 2000, gst_pct: 18 },
    ]});
    setDialogOpen(true);
  };

  const openEdit = (pkg) => {
    setEditPkg(pkg);
    setForm({
      display_name: pkg.display_name,
      base_price: pkg.base_price,
      gst_pct: pkg.gst_pct,
      items: pkg.items || [],
    });
    setDialogOpen(true);
  };

  const addItem = () => {
    setForm({ ...form, items: [...form.items, { type: 'custom', name: '', qty: 1, unit_price: 0, gst_pct: 18 }] });
  };

  const removeItem = (idx) => {
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: field === 'name' || field === 'type' ? value : parseFloat(value) || 0 };
    if (field === 'type') {
      const typeLabel = ITEM_TYPES.find(t => t.value === value);
      if (typeLabel && !items[idx].name) items[idx].name = typeLabel.label;
    }
    setForm({ ...form, items });
  };

  const calcItemTotal = (item) => item.qty * item.unit_price;
  const calcPackageTotal = () => form.items.reduce((s, item) => s + calcItemTotal(item), 0);

  const handleSave = async () => {
    if (!form.display_name) { toast.error('Package name is required'); return; }
    try {
      const payload = {
        display_name: form.display_name,
        name: form.display_name.toLowerCase().replace(/\s+/g, '_'),
        base_price: calcPackageTotal(),
        gst_pct: form.gst_pct,
        items: form.items,
        std_die_qty: form.items.filter(i => i.type === 'standard_die').reduce((s, i) => s + i.qty, 0),
        large_die_qty: form.items.filter(i => i.type === 'large_die').reduce((s, i) => s + i.qty, 0),
        machine_qty: form.items.filter(i => i.type === 'machine').reduce((s, i) => s + i.qty, 0),
      };
      if (editPkg) {
        await packages.update(editPkg.package_id, payload);
        toast.success('Package updated');
      } else {
        await packages.create(payload);
        toast.success('Package created');
      }
      setDialogOpen(false);
      fetchPackages();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save');
    }
  };

  const handleDelete = async (pkgId) => {
    if (!window.confirm('Delete this package?')) return;
    try {
      await packages.delete(pkgId);
      toast.success('Package deleted');
      fetchPackages();
    } catch { toast.error('Failed to delete'); }
  };

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="package-master-title">Package Master</h1>
            <p className="text-[var(--text-secondary)] mt-1">Configure packages with item-level pricing</p>
          </div>
          <Button onClick={openCreate} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-package-button">
            <Plus className="mr-2 h-4 w-4" /> New Package
          </Button>
        </div>

        {/* Package Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="packages-grid">
          {pkgList.filter(p => p.is_active !== false).map((pkg) => {
            const items = pkg.items || [];
            const itemTotal = items.reduce((s, i) => s + (i.qty * i.unit_price), 0);
            return (
              <div key={pkg.package_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden" data-testid={`package-card-${pkg.name}`}>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-[#e94560]/10 flex items-center justify-center">
                        <Package className="h-5 w-5 text-[#e94560]" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-[var(--text-primary)]">{pkg.display_name}</h2>
                        <p className="text-xs text-[var(--text-muted)] font-mono">{pkg.package_id}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(pkg)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" data-testid={`edit-pkg-${pkg.name}`}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(pkg.package_id)} className="text-red-400 hover:text-red-300" data-testid={`delete-pkg-${pkg.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="space-y-2 mb-4">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-sm bg-[var(--bg-primary)] rounded px-3 py-2 border border-[var(--border-color)]">
                        <div>
                          <span className="text-[var(--text-primary)]">{item.name || item.type}</span>
                          <span className="text-[var(--text-muted)] ml-2">x{item.qty}</span>
                        </div>
                        <span className="font-mono text-[var(--text-primary)]">{formatCurrency(item.qty * item.unit_price)}</span>
                      </div>
                    ))}
                    {items.length === 0 && <p className="text-[var(--text-muted)] text-sm text-center py-2">No items configured</p>}
                  </div>

                  {/* Summary */}
                  <div className="border-t border-[var(--border-color)] pt-4 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Items Total</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatCurrency(itemTotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">GST ({pkg.gst_pct}%)</span>
                      <span className="font-mono text-[var(--text-secondary)]">{formatCurrency(itemTotal * pkg.gst_pct / 100)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold pt-2 border-t border-[var(--border-color)]">
                      <span className="text-[var(--text-primary)]">Total</span>
                      <span className="font-mono text-[#e94560]">{formatCurrency(itemTotal * (1 + pkg.gst_pct / 100))}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-[var(--text-primary)] text-xl" data-testid="pkg-dialog-title">
                {editPkg ? 'Edit Package' : 'Create New Package'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2 block">Package Name *</Label>
                  <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" placeholder="e.g. Premium Package" data-testid="pkg-name-input" />
                </div>
                <div>
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2 block">GST %</Label>
                  <Input type="number" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: parseFloat(e.target.value) || 0 })} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="pkg-gst-input" />
                </div>
              </div>

              {/* Items Builder */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-[var(--text-secondary)] text-xs uppercase tracking-wide">Package Items</Label>
                  <Button size="sm" onClick={addItem} className="bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 border border-[#e94560]/30" data-testid="add-item-button">
                    <Plus className="mr-1 h-3 w-3" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3" data-testid={`item-row-${idx}`}>
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-3">
                          <Label className="text-[var(--text-muted)] text-xs mb-1 block">Type</Label>
                          <select value={item.type} onChange={(e) => updateItem(idx, 'type', e.target.value)} className="w-full h-9 px-2 bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded text-sm">
                            {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-[var(--text-muted)] text-xs mb-1 block">Name</Label>
                          <Input value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" placeholder="Item name" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[var(--text-muted)] text-xs mb-1 block">Qty</Label>
                          <Input type="number" value={item.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[var(--text-muted)] text-xs mb-1 block">Unit Price</Label>
                          <Input type="number" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] h-9 text-sm" />
                        </div>
                        <div className="col-span-1 text-right">
                          <Label className="text-[var(--text-muted)] text-xs mb-1 block">Total</Label>
                          <p className="text-sm font-mono text-[var(--text-primary)] h-9 flex items-center justify-end">{formatCurrency(calcItemTotal(item))}</p>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 h-9">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">Items Subtotal</span>
                  <span className="font-mono text-[var(--text-primary)]">{formatCurrency(calcPackageTotal())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">GST ({form.gst_pct}%)</span>
                  <span className="font-mono text-[var(--text-secondary)]">{formatCurrency(calcPackageTotal() * form.gst_pct / 100)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-[var(--border-color)] pt-2">
                  <span className="text-[var(--text-primary)]">Package Total (incl. GST)</span>
                  <span className="font-mono text-[#e94560]">{formatCurrency(calcPackageTotal() * (1 + form.gst_pct / 100))}</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-package-button">
                {editPkg ? 'Update Package' : 'Create Package'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
