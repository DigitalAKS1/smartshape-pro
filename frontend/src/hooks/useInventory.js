import { useState, useEffect, useRef, useCallback } from 'react';
import { dies as diesApi, stock as stockApi, formatApiErrorDetail } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { sortByCode, compareCodes } from '../lib/utils';
import { toast } from 'sonner';

export const CATEGORIES = [
  'decorative','flowers','leaf','alphabets','numbers','butterfly','borders',
  'giant_flowers','3d_flowers','animals_birds','snowflake','fruits','shapes','other',
];
export const CAT_LABELS = {
  decorative:'Decorative', flowers:'Flowers', leaf:'Leaf', alphabets:'Alphabets',
  numbers:'Numbers', butterfly:'Butterfly', borders:'Borders', giant_flowers:'Giant Flowers',
  '3d_flowers':'3D Flowers', animals_birds:'Animals & Birds', snowflake:'Snowflake',
  fruits:'Fruits', shapes:'Shapes', other:'Other',
};
export const TYPES = ['standard','large','machine'];
export const BLANK_DIE = { code:'', name:'', type:'standard', category:'decorative', min_level:5, description:'', stock_qty:0 };

// Sort options for the inventory list. 'code' is the default (natural code order).
export const SORT_OPTIONS = [
  { value: 'code',       label: 'Code (A→Z)'       },
  { value: 'code_desc',  label: 'Code (Z→A)'       },
  { value: 'name',       label: 'Name (A→Z)'       },
  { value: 'name_desc',  label: 'Name (Z→A)'       },
  { value: 'stock_desc', label: 'Stock (High→Low)' },
  { value: 'stock_asc',  label: 'Stock (Low→High)' },
];

const nameOf = (d) => String(d?.name ?? '').trim().toLowerCase();
function applySort(items, sortBy) {
  const list = [...(items || [])];
  switch (sortBy) {
    case 'code_desc':  return list.sort((a, b) => compareCodes(b.code, a.code));
    case 'name':       return list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || compareCodes(a.code, b.code));
    case 'name_desc':  return list.sort((a, b) => nameOf(b).localeCompare(nameOf(a)) || compareCodes(a.code, b.code));
    case 'stock_desc': return list.sort((a, b) => (b.stock_qty || 0) - (a.stock_qty || 0) || compareCodes(a.code, b.code));
    case 'stock_asc':  return list.sort((a, b) => (a.stock_qty || 0) - (b.stock_qty || 0) || compareCodes(a.code, b.code));
    case 'code':
    default:           return sortByCode(list);
  }
}

export default function useInventory() {
  const [dies, setDies] = useState([]);
  const [filteredDies, setFilteredDies] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('code');
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState('catalogue');
  const [quickFilter, setQuickFilter] = useState(null);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [stockAdjOpen, setStockAdjOpen] = useState(false);
  const [stockAdjTarget, setStockAdjTarget] = useState(null);
  const [stockAdjType, setStockAdjType] = useState('stock_in');
  const [stockAdjQty, setStockAdjQty] = useState(1);
  const [stockAdjNote, setStockAdjNote] = useState('');

  const [newDie, setNewDie] = useState(BLANK_DIE);
  const [newDieImage, setNewDieImage] = useState(null);
  const [newDieImagePreview, setNewDieImagePreview] = useState('');
  const [editForm, setEditForm] = useState(BLANK_DIE);
  const [editImage, setEditImage] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState('');
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);
  const importRef = useRef(null);

  const fetchDies = useCallback(async () => {
    try {
      const res = await diesApi.getAll(showArchived);
      setDies(res.data);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchDies(); }, [fetchDies]);
  useDataSync('inventory', fetchDies);
  useAutoRefresh(fetchDies, 60000);

  useEffect(() => {
    let f = dies;
    if (quickFilter === 'low') f = f.filter(d => d.stock_qty <= d.min_level && d.stock_qty > 0 && d.is_active !== false);
    else if (quickFilter === 'out') f = f.filter(d => d.stock_qty === 0 && d.is_active !== false);
    else if (quickFilter === 'reorder') f = f.filter(d => d.stock_qty <= d.min_level && d.is_active !== false);
    if (typeFilter !== 'all') f = f.filter(d => d.type === typeFilter);
    if (categoryFilter !== 'all') f = f.filter(d => (d.category || 'decorative') === categoryFilter);
    if (searchTerm) f = f.filter(d =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
    // For shortage views, default to surfacing the most urgent first (biggest gap
    // below min); the user can still override with an explicit sort choice.
    const isShortageView = quickFilter === 'low' || quickFilter === 'out' || quickFilter === 'reorder';
    if (isShortageView && sortBy === 'code') {
      f = [...f].sort((a, b) =>
        ((b.min_level || 0) - b.stock_qty) - ((a.min_level || 0) - a.stock_qty) ||
        compareCodes(a.code, b.code)
      );
      setFilteredDies(f);
    } else {
      setFilteredDies(applySort(f, sortBy));
    }
  }, [quickFilter, typeFilter, categoryFilter, searchTerm, sortBy, dies]);

  const clearFilters = () => { setQuickFilter(null); setTypeFilter('all'); setCategoryFilter('all'); setSearchTerm(''); setSortBy('code'); };
  const isFiltered = quickFilter || typeFilter !== 'all' || categoryFilter !== 'all' || searchTerm;

  const handleCreateDie = async (e) => {
    e.preventDefault();
    if (!newDie.code || !newDie.name) { toast.error('Code and Name required'); return; }
    setSaving(true);
    try {
      const res = await diesApi.create(newDie);
      if (newDieImage && res.data.die_id) {
        try { await diesApi.uploadImage(res.data.die_id, newDieImage); }
        catch { toast.error('Die saved but photo upload failed — try re-uploading from the card.'); }
      }
      toast.success('Die created');
      setCreateOpen(false);
      setNewDie(BLANK_DIE); setNewDieImage(null); setNewDieImagePreview('');
      fetchDies();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed to create die');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (die) => {
    setEditTarget(die);
    setEditForm({
      code: die.code, name: die.name, type: die.type || 'standard',
      category: die.category || 'decorative', min_level: die.min_level ?? 5,
      description: die.description || '',
    });
    setEditImage(null); setEditImagePreview('');
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editForm.code || !editForm.name) { toast.error('Code and Name required'); return; }
    setSaving(true);
    try {
      await diesApi.update(editTarget.die_id, editForm);
      if (editImage) {
        try { await diesApi.uploadImage(editTarget.die_id, editImage); }
        catch { toast.error('Saved but photo upload failed.'); }
      }
      toast.success('Die updated');
      setEditOpen(false); setEditTarget(null); setEditImage(null); setEditImagePreview('');
      fetchDies();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (dieId, file) => {
    if (!file || file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return; }
    setUploading(dieId);
    try { await diesApi.uploadImage(dieId, file); toast.success('Photo updated'); fetchDies(); }
    catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };

  const handleNewImageSelect = (file) => {
    if (!file) return;
    setNewDieImage(file);
    const reader = new FileReader();
    reader.onload = e => setNewDieImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const openStockAdj = (die, type) => {
    setStockAdjTarget(die); setStockAdjType(type);
    setStockAdjQty(1); setStockAdjNote('');
    setStockAdjOpen(true);
  };

  const handleStockAdj = async () => {
    if (!stockAdjQty || stockAdjQty < 1) { toast.error('Quantity must be at least 1'); return; }
    try {
      await stockApi.createMovement({
        die_id: stockAdjTarget.die_id,
        movement_type: stockAdjType,
        quantity: Number(stockAdjQty),
        notes: stockAdjNote || `Quick ${stockAdjType === 'stock_in' ? 'stock-in' : 'stock-out'}`,
      });
      toast.success(`Stock ${stockAdjType === 'stock_in' ? 'added' : 'removed'}: ${stockAdjQty} units`);
      setStockAdjOpen(false); fetchDies();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed');
    }
  };

  const handleImport = async (file) => {
    try {
      const res = await diesApi.importCsv(file);
      toast.success(`Created ${res.data.created}, updated ${res.data.updated ?? 0}`);
      setImportOpen(false); fetchDies();
    } catch {
      toast.error('Import failed');
    }
  };

  const downloadSample = () => {
    const csv = [
      'code,name,type,category,stock_qty,min_level,description',
      'D-STD-001,Rose Flower,standard,flowers,25,5,Classic rose die',
      'D-STD-002,Leaf Set,standard,leaf,30,5,Set of 3 leaf shapes',
      'D-LRG-003,Giant Sunflower,large,giant_flowers,10,3,Large sunflower die',
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'sample_inventory_import.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast.success('Sample CSV downloaded');
  };

  const handleSendLowStockAlert = async () => {
    try {
      const res = await diesApi.runLowStockAlert();
      const { low = 0, out = 0, emailed = 0 } = res.data || {};
      if (low === 0) toast.success('All good — nothing at or below minimum level.');
      else toast.success(`Alerted: ${low} low (${out} out of stock)${emailed ? ` · email sent to ${emailed}` : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed to send alert');
    }
  };

  const handleArchive = async (die) => {
    try {
      await diesApi.archive(die.die_id);
      toast.success(die.is_active !== false ? 'Archived' : 'Restored');
      fetchDies();
    } catch {
      toast.error('Failed');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await diesApi.delete(deleteTarget.die_id);
      toast.success('Deleted');
      setDeleteConfirmOpen(false); setDeleteTarget(null); fetchDies();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed');
    }
  };

  // ── Multi-select bulk delete (admin only) ──
  const toggleSelect = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const clearSelection = () => setSelectedIds([]);
  const isSelected = (id) => selectedIds.includes(id);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds([]); };
  // Select / clear all currently-visible (filtered) dies
  const allVisibleSelected = filteredDies.length > 0 && filteredDies.every(d => selectedIds.includes(d.die_id));
  const toggleSelectAllVisible = () =>
    setSelectedIds(allVisibleSelected ? [] : filteredDies.map(d => d.die_id));

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleting(true);
    try {
      const res = await diesApi.bulkDelete(selectedIds);
      toast.success(`Deleted ${res.data?.deleted ?? selectedIds.length} item${(res.data?.deleted ?? selectedIds.length) !== 1 ? 's' : ''}`);
      setBulkDeleteOpen(false);
      exitSelectMode();
      fetchDies();
    } catch (err) {
      toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  const activeDies = dies.filter(d => d.is_active !== false);
  const stats = {
    total: activeDies.length,
    inStock: activeDies.filter(d => d.stock_qty > d.min_level).length,
    lowStock: activeDies.filter(d => d.stock_qty <= d.min_level && d.stock_qty > 0).length,
    outOfStock: activeDies.filter(d => d.stock_qty === 0).length,
    needsReorder: activeDies.filter(d => d.stock_qty <= d.min_level).length,
  };

  const grouped = {};
  filteredDies.forEach(d => { const cat = d.category || 'other'; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(d); });

  const stockAfter = stockAdjTarget
    ? stockAdjType === 'stock_in'
      ? (stockAdjTarget.stock_qty || 0) + Number(stockAdjQty || 0)
      : Math.max(0, (stockAdjTarget.stock_qty || 0) - Number(stockAdjQty || 0))
    : 0;

  return {
    // data
    dies, filteredDies, grouped, stats, activeDies, stockAfter,
    loading,
    // filters
    typeFilter, setTypeFilter, categoryFilter, setCategoryFilter,
    searchTerm, setSearchTerm, sortBy, setSortBy,
    sortLabel: (SORT_OPTIONS.find(o => o.value === sortBy) || SORT_OPTIONS[0]).label,
    showArchived, setShowArchived,
    viewMode, setViewMode, quickFilter, setQuickFilter,
    isFiltered, clearFilters,
    // create dialog
    createOpen, setCreateOpen, newDie, setNewDie,
    newDieImage, newDieImagePreview, handleNewImageSelect, handleCreateDie,
    // edit dialog
    editOpen, setEditOpen, editTarget, editForm, setEditForm,
    editImage, setEditImage, editImagePreview, setEditImagePreview, openEdit, handleSaveEdit,
    // image upload
    uploading, handleImageUpload,
    // stock adj dialog
    stockAdjOpen, setStockAdjOpen, stockAdjTarget, stockAdjType,
    stockAdjQty, setStockAdjQty, stockAdjNote, setStockAdjNote,
    openStockAdj, handleStockAdj,
    // import dialog
    importOpen, setImportOpen, importRef, handleImport, downloadSample,
    // delete dialog
    deleteConfirmOpen, setDeleteConfirmOpen, deleteTarget, setDeleteTarget, handleDelete,
    // multi-select bulk delete (admin)
    selectMode, setSelectMode, exitSelectMode,
    selectedIds, isSelected, toggleSelect, clearSelection,
    allVisibleSelected, toggleSelectAllVisible,
    bulkDeleteOpen, setBulkDeleteOpen, bulkDeleting, handleBulkDelete,
    // misc
    handleArchive, saving, handleSendLowStockAlert,
  };
}
