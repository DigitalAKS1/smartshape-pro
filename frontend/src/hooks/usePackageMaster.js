import { useState, useEffect, useCallback, useRef } from 'react';
import { packages } from '../lib/api';
import { toast } from 'sonner';

export const ITEM_TYPES = [
  { value: 'standard_die', label: 'Standard Die' },
  { value: 'large_die',    label: 'Large Die' },
  { value: 'machine',      label: 'Machine' },
  { value: 'die_set',      label: 'Die Set' },
  { value: 'accessories',  label: 'Accessories' },
  { value: 'custom',       label: 'Other / Custom' },
];

export const TYPE_COLORS = {
  standard_die: 'bg-blue-500/15 text-blue-400',
  large_die:    'bg-purple-500/15 text-purple-400',
  machine:      'bg-orange-500/15 text-orange-400',
  die_set:      'bg-teal-500/15 text-teal-400',
  accessories:  'bg-pink-500/15 text-pink-400',
  custom:       'bg-gray-500/15 text-gray-400',
};

export const DEFAULT_ITEM = { type: 'standard_die', name: '', qty: 1, unit_price: 0, gst_pct: 18 };
export const DEFAULT_FORM = { display_name: '', gst_pct: 18, description: '', is_active: true, items: [] };

export function calcItemTotal(item) {
  return (item.qty || 0) * (item.unit_price || 0);
}

export function calcSummary(form) {
  const subtotal = form.items.reduce((s, i) => s + calcItemTotal(i), 0);
  const gst = form.items.reduce((s, i) => s + calcItemTotal(i) * ((i.gst_pct ?? form.gst_pct ?? 18) / 100), 0);
  return { subtotal, gst, total: subtotal + gst };
}

/**
 * Hook encapsulating all PackageMaster state, fetching, and handlers.
 */
export function usePackageMaster() {
  const [pkgList, setPkgList]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [editPkg, setEditPkg]           = useState(null);
  const [form, setForm]                 = useState(DEFAULT_FORM);
  const [editorOpen, setEditorOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const nameInputRef = useRef(null);

  const fetchPackages = useCallback(async () => {
    try {
      const res = await packages.getAll();
      setPkgList(res.data);
    } catch {
      toast.error('Failed to load packages');
    } finally {
      setLoading(false);
    }
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
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    pkg.is_active !== false,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
    setEditorOpen(true);
  };

  const duplicatePkg = (pkg, e) => {
    e.stopPropagation();
    setEditPkg(null);
    setForm({
      display_name: `${pkg.display_name} (Copy)`,
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    true,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
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

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...DEFAULT_ITEM }] }));

  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

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
        name:         form.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        description:  form.description,
        base_price:   subtotal,
        gst_pct:      form.gst_pct,
        is_active:    form.is_active,
        items:        form.items,
        std_die_qty:  form.items.filter(i => i.type === 'standard_die').reduce((s, i) => s + (i.qty || 0), 0),
        large_die_qty:form.items.filter(i => i.type === 'large_die').reduce((s, i) => s + (i.qty || 0), 0),
        machine_qty:  form.items.filter(i => i.type === 'machine').reduce((s, i) => s + (i.qty || 0), 0),
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
    } catch {
      toast.error('Failed to delete');
    } finally {
      setConfirmDelete(null);
    }
  };

  const filtered = pkgList.filter(p => {
    if (!showInactive && p.is_active === false) return false;
    if (search) return p.display_name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const activeCount   = pkgList.filter(p => p.is_active !== false).length;
  const inactiveCount = pkgList.length - activeCount;
  const summary       = calcSummary(form);

  return {
    pkgList, filtered, loading, saving,
    editPkg, form, setForm,
    editorOpen, search, setSearch,
    showInactive, setShowInactive,
    confirmDelete, setConfirmDelete,
    activeCount, inactiveCount,
    nameInputRef,
    summary,
    openNew, openEdit, duplicatePkg, discard,
    addItem, removeItem, updateItem,
    handleSave, confirmAndDelete,
  };
}
