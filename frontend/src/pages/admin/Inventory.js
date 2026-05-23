import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, exportData, stock as stockApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, AlertTriangle, Plus, Camera, Image, X, Download, Upload,
  Archive, ArchiveRestore, Trash2, MoreVertical, Grid3X3, List, Search,
  Edit2, TrendingUp, TrendingDown, FileDown,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';

const CATEGORIES = ['decorative','flowers','leaf','alphabets','numbers','butterfly','borders','giant_flowers','3d_flowers','animals_birds','snowflake','fruits','shapes','other'];
const CAT_LABELS = { decorative:'Decorative', flowers:'Flowers', leaf:'Leaf', alphabets:'Alphabets', numbers:'Numbers', butterfly:'Butterfly', borders:'Borders', giant_flowers:'Giant Flowers', '3d_flowers':'3D Flowers', animals_birds:'Animals & Birds', snowflake:'Snowflake', fruits:'Fruits', shapes:'Shapes', other:'Other' };
const TYPES = ['standard','large','machine'];
const BLANK_DIE = { code:'', name:'', type:'standard', category:'decorative', min_level:5, description:'', stock_qty:0 };

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canWrite = isAdmin || user?.role === 'store';

  const [dies, setDies] = useState([]);
  const [filteredDies, setFilteredDies] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState('catalogue');
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  const card     = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri  = 'text-[var(--text-primary)]';
  const textSec  = 'text-[var(--text-secondary)]';
  const textMuted= 'text-[var(--text-muted)]';
  const dlgCls   = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';
  const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

  useEffect(() => { fetchDies(); }, [showArchived]); // eslint-disable-line
  const fetchDies = async () => {
    try { const res = await diesApi.getAll(showArchived); setDies(res.data); }
    catch { toast.error('Failed to load inventory'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let f = dies;
    if (typeFilter !== 'all') f = f.filter(d => d.type === typeFilter);
    if (categoryFilter !== 'all') f = f.filter(d => (d.category || 'decorative') === categoryFilter);
    if (searchTerm) f = f.filter(d =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredDies(f);
  }, [typeFilter, categoryFilter, searchTerm, dies]);

  // ── Create ──
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
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create die'); }
    finally { setSaving(false); }
  };

  // ── Edit ──
  const openEdit = (die) => {
    setEditTarget(die);
    setEditForm({ code: die.code, name: die.name, type: die.type || 'standard', category: die.category || 'decorative', min_level: die.min_level ?? 5, description: die.description || '' });
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
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  // ── Image upload ──
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

  // ── Stock adjust ──
  const openStockAdj = (die, type) => {
    setStockAdjTarget(die); setStockAdjType(type);
    setStockAdjQty(1); setStockAdjNote('');
    setStockAdjOpen(true);
  };
  const handleStockAdj = async () => {
    if (!stockAdjQty || stockAdjQty < 1) { toast.error('Quantity must be at least 1'); return; }
    try {
      await stockApi.createMovement({ die_id: stockAdjTarget.die_id, movement_type: stockAdjType, quantity: Number(stockAdjQty), notes: stockAdjNote || `Quick ${stockAdjType === 'stock_in' ? 'stock-in' : 'stock-out'}` });
      toast.success(`Stock ${stockAdjType === 'stock_in' ? 'added' : 'removed'}: ${stockAdjQty} units`);
      setStockAdjOpen(false); fetchDies();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  // ── Import ──
  const handleImport = async (file) => {
    try {
      const res = await diesApi.importCsv(file);
      toast.success(`Created ${res.data.created}, skipped ${res.data.duplicates} duplicates`);
      setImportOpen(false); fetchDies();
    } catch { toast.error('Import failed'); }
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
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    toast.success('Sample CSV downloaded');
  };

  // ── Archive / Delete ──
  const handleArchive = async (die) => {
    try { await diesApi.archive(die.die_id); toast.success(die.is_active !== false ? 'Archived' : 'Restored'); fetchDies(); }
    catch { toast.error('Failed'); }
  };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await diesApi.delete(deleteTarget.die_id); toast.success('Deleted'); setDeleteConfirmOpen(false); setDeleteTarget(null); fetchDies(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const activeDies = dies.filter(d => d.is_active !== false);
  const stats = {
    total: activeDies.length,
    inStock: activeDies.filter(d => d.stock_qty > d.min_level).length,
    lowStock: activeDies.filter(d => d.stock_qty <= d.min_level && d.stock_qty > 0).length,
    outOfStock: activeDies.filter(d => d.stock_qty === 0).length,
  };

  const grouped = {};
  filteredDies.forEach(d => { const cat = d.category || 'other'; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(d); });

  return (
    <AdminLayout>
      <div className="space-y-4">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Inventory</h1>
            <p className={`${textMuted} text-xs mt-0.5`}>{activeDies.length} dies · {stats.outOfStock} out of stock</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle — desktop only */}
            <div className={`hidden sm:flex ${card} border rounded-md p-0.5`}>
              <button onClick={() => setViewMode('catalogue')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : textMuted}`}>
                <Grid3X3 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-[#e94560] text-white' : textMuted}`}>
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Secondary actions → collapsed on mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`p-2 rounded-md border ${card} ${textMuted} hover:bg-[var(--bg-hover)]`}>
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={dlgCls}>
                {/* View toggle — mobile only, inside menu */}
                <div className="flex sm:hidden items-center gap-1 px-2 py-1.5 mb-1">
                  <button onClick={() => setViewMode('catalogue')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : `${card} border ${textMuted}`}`}>
                    <Grid3X3 className="h-3.5 w-3.5" /> Grid
                  </button>
                  <button onClick={() => setViewMode('table')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-[#e94560] text-white' : `${card} border ${textMuted}`}`}>
                    <List className="h-3.5 w-3.5" /> List
                  </button>
                </div>
                <DropdownMenuSeparator className="sm:hidden border-[var(--border-color)]" />
                <DropdownMenuItem onClick={() => setShowArchived(!showArchived)} className="cursor-pointer">
                  <Archive className="mr-2 h-4 w-4" />{showArchived ? 'Hide Archived' : 'Show Archived'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData.download('inventory')} className="cursor-pointer">
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </DropdownMenuItem>
                {canWrite && (
                  <DropdownMenuItem onClick={() => setImportOpen(true)} className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> Import CSV
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {canWrite && (
              <Button onClick={() => { setNewDie(BLANK_DIE); setNewDieImage(null); setNewDieImagePreview(''); setCreateOpen(true); }}
                size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9 px-3">
                <Plus className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Add Die</span>
              </Button>
            )}
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {[
            { label: 'Total', value: stats.total, cls: textPri },
            { label: 'In Stock', value: stats.inStock, cls: 'text-green-500' },
            { label: 'Low', value: stats.lowStock, cls: 'text-yellow-500' },
            { label: 'Out', value: stats.outOfStock, cls: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-xl p-3 sm:p-4 text-center`}>
              <p className={`text-xl sm:text-2xl font-bold font-mono ${s.cls}`}>{s.value}</p>
              <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="space-y-2">
          {/* Search + type */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
              <Input placeholder="Search name or code…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className={`pl-9 h-10 ${inputCls}`} />
            </div>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`h-10 px-2 rounded-md text-sm ${inputCls} shrink-0`}>
              <option value="all">All Types</option>
              {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          {/* Category chips — horizontal scroll */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            {['all', ...CATEGORIES].map(c => (
              <button key={c} onClick={() => setCategoryFilter(c)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border whitespace-nowrap
                  ${categoryFilter === c
                    ? 'bg-[#e94560] text-white border-[#e94560]'
                    : `${card} border ${textMuted} hover:border-[#e94560]/50`}`}>
                {c === 'all' ? 'All' : CAT_LABELS[c] || c}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
          </div>
        ) : viewMode === 'catalogue' ? (

          /* CATALOGUE VIEW */
          <div className="space-y-6">
            {Object.keys(grouped).length === 0
              ? <div className={`${card} border rounded-xl p-16 text-center`}>
                  <Package className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                  <p className={textMuted}>No items found</p>
                </div>
              : Object.entries(grouped).map(([cat, catDies]) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>{CAT_LABELS[cat] || cat}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted}`}>{catDies.length}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {catDies.map(die => (
                      <CatalogueCard key={die.die_id} die={die} uploading={uploading}
                        onUpload={handleImageUpload} onArchive={handleArchive} onEdit={openEdit}
                        onDeleteRequest={d => { setDeleteTarget(d); setDeleteConfirmOpen(true); }}
                        onStockIn={d => openStockAdj(d, 'stock_in')}
                        onStockOut={d => openStockAdj(d, 'stock_out')}
                        isAdmin={isAdmin} canWrite={canWrite}
                        textPri={textPri} textMuted={textMuted} textSec={textSec} card={card} backendUrl={backendUrl} />
                    ))}
                  </div>
                </div>
              ))
            }
          </div>

        ) : (

          /* LIST VIEW */
          <div className={`${card} border rounded-xl overflow-hidden`}>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                    {['Image','Code','Name','Category','Type','Stock','Min','Actions'].map(h => (
                      <th key={h} className={`text-left text-xs py-3 px-4 font-medium ${textMuted}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDies.map(die => (
                    <tr key={die.die_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${die.is_active === false ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="w-11 h-11 rounded-lg bg-[var(--bg-primary)] overflow-hidden">
                          {die.image_url
                            ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-contain p-1" />
                            : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Image className="h-4 w-4" /></div>}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[#e94560] text-xs font-medium">{die.code}</td>
                      <td className={`px-4 py-3 ${textPri} font-medium`}>{die.name}</td>
                      <td className={`px-4 py-3 ${textSec} text-xs`}>{CAT_LABELS[die.category] || die.category}</td>
                      <td className={`px-4 py-3 ${textSec} capitalize text-xs`}>{die.type}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono font-bold ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</span>
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs ${textMuted}`}>{die.min_level}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {canWrite && <>
                            <button onClick={() => openStockAdj(die, 'stock_in')} className="p-1.5 rounded-md hover:bg-green-500/10 text-green-500" title="Stock In"><TrendingUp className="h-3.5 w-3.5" /></button>
                            <button onClick={() => openStockAdj(die, 'stock_out')} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400" title="Stock Out"><TrendingDown className="h-3.5 w-3.5" /></button>
                            <button onClick={() => openEdit(die)} className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`} title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                          </>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className={dlgCls}>
                              <DropdownMenuItem onClick={() => handleArchive(die)} className="cursor-pointer">
                                {die.is_active === false ? <><ArchiveRestore className="mr-2 h-4 w-4" />Restore</> : <><Archive className="mr-2 h-4 w-4" />Archive</>}
                              </DropdownMenuItem>
                              {isAdmin && <DropdownMenuItem onClick={() => { setDeleteTarget(die); setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500">
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredDies.length === 0 && <tr><td colSpan="8" className={`py-16 text-center ${textMuted}`}>No items found</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {filteredDies.length === 0
                ? <p className={`py-12 text-center text-sm ${textMuted}`}>No items found</p>
                : filteredDies.map(die => (
                <div key={die.die_id} className={`p-3 ${die.is_active === false ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3">
                    {/* Image */}
                    <div className="w-14 h-14 rounded-lg bg-[var(--bg-primary)] flex-shrink-0 overflow-hidden border border-[var(--border-color)]">
                      {die.image_url
                        ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-contain p-1" />
                        : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Image className="h-5 w-5" /></div>}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${textPri} truncate`}>{die.name}</p>
                      <p className={`text-xs font-mono text-[#e94560]`}>{die.code}</p>
                      <p className={`text-xs ${textMuted} capitalize`}>{die.type} · {CAT_LABELS[die.category] || die.category}</p>
                    </div>
                    {/* Stock badge */}
                    <div className="text-right shrink-0">
                      <p className={`font-mono font-bold text-base ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</p>
                      <p className={`text-[10px] ${textMuted}`}>in stock</p>
                    </div>
                  </div>
                  {/* Action row */}
                  <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-[var(--border-color)]">
                    {canWrite && <>
                      <button onClick={() => openStockAdj(die, 'stock_in')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 text-green-500 text-xs font-medium active:scale-95 transition-transform">
                        <TrendingUp className="h-3.5 w-3.5" /> Stock In
                      </button>
                      <button onClick={() => openStockAdj(die, 'stock_out')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium active:scale-95 transition-transform">
                        <TrendingDown className="h-3.5 w-3.5" /> Stock Out
                      </button>
                      <button onClick={() => openEdit(die)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--bg-primary)] ${textSec} text-xs font-medium active:scale-95 transition-transform`}>
                        <Edit2 className="h-3.5 w-3.5" /> Edit
                      </button>
                    </>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={`px-2 py-2 rounded-lg bg-[var(--bg-primary)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className={dlgCls}>
                        <DropdownMenuItem onClick={() => handleArchive(die)} className="cursor-pointer">
                          {die.is_active === false ? <><ArchiveRestore className="mr-2 h-4 w-4" />Restore</> : <><Archive className="mr-2 h-4 w-4" />Archive</>}
                        </DropdownMenuItem>
                        {isAdmin && <DropdownMenuItem onClick={() => { setDeleteTarget(die); setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500">
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CREATE DIE DIALOG ══ */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Add New Die</DialogTitle></DialogHeader>
            <form onSubmit={handleCreateDie} className="space-y-4">
              {/* Photo */}
              <div>
                <Label className={`${textSec} text-xs mb-1.5 block`}>Photo</Label>
                <div className={`bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-xl overflow-hidden cursor-pointer`}
                  onClick={() => document.getElementById('new-die-image')?.click()}>
                  {newDieImagePreview
                    ? <div className="relative">
                        <img src={newDieImagePreview} alt="Preview" className="w-full h-40 object-contain" />
                        <button type="button" onClick={e => { e.stopPropagation(); setNewDieImage(null); setNewDieImagePreview(''); }}
                          className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-full shadow"><X className="h-3.5 w-3.5 text-white" /></button>
                      </div>
                    : <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Camera className={`h-8 w-8 ${textMuted}`} />
                        <p className={`text-sm ${textSec}`}>Tap to add photo</p>
                        <p className={`text-xs ${textMuted}`}>JPG, PNG — max 5 MB</p>
                      </div>}
                  <input id="new-die-image" type="file" accept="image/*" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleNewImageSelect(e.target.files[0]); }} />
                </div>
              </div>
              {/* Code + Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Code *</Label>
                  <Input value={newDie.code} onChange={e => setNewDie({...newDie, code: e.target.value})} required className={`h-11 ${inputCls}`} placeholder="D-STD-001" />
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Name *</Label>
                  <Input value={newDie.name} onChange={e => setNewDie({...newDie, name: e.target.value})} required className={`h-11 ${inputCls}`} placeholder="Rose Flower" />
                </div>
              </div>
              {/* Type + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Type</Label>
                  <select value={newDie.type} onChange={e => setNewDie({...newDie, type: e.target.value})} className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
                  <select value={newDie.category} onChange={e => setNewDie({...newDie, category: e.target.value})} className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              {/* Stock + Min level */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Initial Stock</Label>
                  <Input type="number" min={0} value={newDie.stock_qty} onChange={e => setNewDie({...newDie, stock_qty: parseInt(e.target.value) || 0})} className={`h-11 ${inputCls}`} />
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
                  <Input type="number" min={0} value={newDie.min_level} onChange={e => setNewDie({...newDie, min_level: parseInt(e.target.value) || 0})} className={`h-11 ${inputCls}`} />
                </div>
              </div>
              <div>
                <Label className={`${textSec} text-xs mb-1 block`}>Description</Label>
                <Input value={newDie.description} onChange={e => setNewDie({...newDie, description: e.target.value})} className={`h-11 ${inputCls}`} placeholder="Optional notes" />
              </div>
              <Button type="submit" disabled={saving} className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-medium disabled:opacity-60">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Saving…</> : 'Add Die'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* ══ EDIT DIE DIALOG ══ */}
        <Dialog open={editOpen} onOpenChange={open => { if (!saving) setEditOpen(open); }}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Edit Die — {editTarget?.code}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-1">
              {/* Photo */}
              <div>
                <Label className={`${textSec} text-xs mb-1.5 block`}>Photo</Label>
                <div className={`bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-xl overflow-hidden cursor-pointer`}
                  onClick={() => document.getElementById('edit-die-image')?.click()}>
                  {editImagePreview
                    ? <div className="relative">
                        <img src={editImagePreview} alt="Preview" className="w-full h-40 object-contain" />
                        <button type="button" onClick={e => { e.stopPropagation(); setEditImage(null); setEditImagePreview(''); }}
                          className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-full shadow"><X className="h-3.5 w-3.5 text-white" /></button>
                      </div>
                    : editTarget?.image_url
                    ? <div className="relative">
                        <img src={`${backendUrl}${editTarget.image_url}`} alt="Current" className="w-full h-40 object-contain opacity-60" />
                        <div className="absolute inset-0 flex items-end justify-center pb-3">
                          <span className={`text-xs px-3 py-1 rounded-full bg-black/40 text-white`}>Tap to replace</span>
                        </div>
                      </div>
                    : <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Camera className={`h-8 w-8 ${textMuted}`} />
                        <p className={`text-sm ${textSec}`}>Tap to add photo</p>
                      </div>}
                  <input id="edit-die-image" type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (!f) return; setEditImage(f); const r = new FileReader(); r.onload = ev => setEditImagePreview(ev.target.result); r.readAsDataURL(f); e.target.value = ''; }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Code *</Label>
                  <Input value={editForm.code} onChange={e => setEditForm({...editForm, code: e.target.value})} className={`h-11 ${inputCls}`} />
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Name *</Label>
                  <Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className={`h-11 ${inputCls}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Type</Label>
                  <select value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})} className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
                  <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
                  <Input type="number" min={0} value={editForm.min_level} onChange={e => setEditForm({...editForm, min_level: parseInt(e.target.value) || 0})} className={`h-11 ${inputCls}`} />
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1 block`}>Description</Label>
                  <Input value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className={`h-11 ${inputCls}`} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving} className={`flex-1 h-11 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={saving} className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-60">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Saving…</> : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ══ STOCK ADJUST DIALOG ══ */}
        <Dialog open={stockAdjOpen} onOpenChange={setStockAdjOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-sm`}>
            <DialogHeader>
              <DialogTitle className={`${textPri} flex items-center gap-2`}>
                {stockAdjType === 'stock_in'
                  ? <TrendingUp className="h-5 w-5 text-green-500" />
                  : <TrendingDown className="h-5 w-5 text-red-400" />}
                {stockAdjType === 'stock_in' ? 'Stock In' : 'Stock Out'}
              </DialogTitle>
              <p className={`text-sm ${textSec} truncate`}>{stockAdjTarget?.name}</p>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 flex justify-between items-center`}>
                <span className={`text-sm ${textSec}`}>Current Stock</span>
                <span className={`font-mono font-bold text-lg ${textPri}`}>{stockAdjTarget?.stock_qty ?? 0}</span>
              </div>
              <div>
                <Label className={`${textSec} text-xs mb-1 block`}>Quantity *</Label>
                <Input type="number" min={1} value={stockAdjQty} onChange={e => setStockAdjQty(e.target.value)} className={`h-12 text-center text-lg font-mono ${inputCls}`} autoFocus />
              </div>
              <div>
                <Label className={`${textSec} text-xs mb-1 block`}>Note (optional)</Label>
                <Input value={stockAdjNote} onChange={e => setStockAdjNote(e.target.value)} className={`h-11 ${inputCls}`} placeholder="Purchase order ref, reason…" />
              </div>
              {stockAdjType === 'stock_out' && stockAdjTarget && Number(stockAdjQty) > stockAdjTarget.stock_qty && (
                <p className="text-xs text-yellow-500 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Quantity exceeds current stock</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStockAdjOpen(false)} className={`flex-1 h-11 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleStockAdj} className={`flex-1 h-11 text-white font-medium ${stockAdjType === 'stock_in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {stockAdjType === 'stock_in' ? 'Add Stock' : 'Remove Stock'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ══ IMPORT DIALOG ══ */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Import Dies from CSV</DialogTitle></DialogHeader>
            <div className="space-y-3 py-1">
              <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-xs space-y-1`}>
                <p className={`font-semibold ${textSec} mb-1`}>Required columns:</p>
                <p className={`font-mono text-[11px] ${textMuted}`}>code, name, type, category, stock_qty, min_level, description</p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadSample} className={`w-full h-10 border-[var(--border-color)] ${textSec} gap-2`}>
                <FileDown className="h-4 w-4" /> Download Sample CSV
              </Button>
              <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-xl p-8 text-center cursor-pointer active:opacity-70 transition-opacity"
                onClick={() => importRef.current?.click()}>
                <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                <p className={`text-sm ${textSec} font-medium`}>Tap to upload CSV</p>
                <p className={`text-xs ${textMuted} mt-1`}>Duplicate codes are skipped</p>
                <input ref={importRef} type="file" accept=".csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ══ DELETE DIALOG ══ */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] max-w-sm`}>
            <DialogHeader><DialogTitle className="text-red-500">Delete Permanently?</DialogTitle></DialogHeader>
            <p className={`text-sm ${textSec} mt-1`}>
              Delete <strong className={textPri}>{deleteTarget?.name}</strong> ({deleteTarget?.code})?
              <br />This cannot be undone.
            </p>
            {deleteTarget?.stock_qty > 0 && (
              <p className="text-sm text-yellow-500 flex items-center gap-1.5 mt-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />Has {deleteTarget.stock_qty} units in stock.
              </p>
            )}
            <DialogFooter className="gap-2 mt-3">
              <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} className={`flex-1 h-11 border-[var(--border-color)] ${textMuted}`}>Cancel</Button>
              <Button onClick={handleDelete} className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white">
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AdminLayout>
  );
}

function CatalogueCard({ die, uploading, onUpload, onArchive, onEdit, onDeleteRequest, onStockIn, onStockOut, isAdmin, canWrite, textPri, textMuted, textSec, card, backendUrl }) {
  const fileRef = useRef(null);
  const isUploading = uploading === die.die_id;
  const isArchived = die.is_active === false;
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <div className={`${card} border rounded-xl overflow-hidden flex flex-col ${isArchived ? 'opacity-50' : ''}`}>

      {/* Image area */}
      <div className="relative aspect-square bg-[var(--bg-primary)] overflow-hidden">
        {die.image_url
          ? <img src={`${backendUrl}${die.image_url}`} alt={die.name} className="w-full h-full object-contain p-2" />
          : <div className={`w-full h-full flex flex-col items-center justify-center ${textMuted} gap-1`}>
              <Image className="h-8 w-8 opacity-30" />
              <span className="text-[10px] opacity-50">No image</span>
            </div>}

        {/* Stock badge */}
        {die.stock_qty <= die.min_level && !isArchived && (
          <div className={`absolute top-1.5 left-1.5 ${die.stock_qty === 0 ? 'bg-red-500' : 'bg-yellow-500'} text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full`}>
            {die.stock_qty === 0 ? 'OUT' : 'LOW'}
          </div>
        )}
        {isArchived && (
          <div className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">ARCHIVED</div>
        )}

        {/* Camera button — always visible on mobile, hover on desktop */}
        {!isArchived && canWrite && (
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/40 text-white
              sm:opacity-0 sm:group-hover:opacity-100 active:scale-90 transition-all">
            {isUploading
              ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Camera className="h-3.5 w-3.5" />}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { if (e.target.files?.[0]) onUpload(die.die_id, e.target.files[0]); e.target.value = ''; }} />
      </div>

      {/* Info */}
      <div className="p-2 flex-1">
        <p className="font-mono text-[10px] text-[#e94560] font-medium leading-none">{die.code}</p>
        <h3 className={`text-xs font-semibold ${textPri} leading-tight mt-0.5 line-clamp-2`} title={die.name}>{die.name}</h3>
        <div className="flex items-center justify-between mt-1">
          <span className={`text-[10px] ${textMuted} capitalize`}>{die.type}</span>
          <span className={`font-mono text-sm font-bold ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</span>
        </div>
      </div>

      {/* Action strip — always visible */}
      {!isArchived && canWrite && (
        <div className="flex border-t border-[var(--border-color)]">
          <button onClick={() => onStockIn(die)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-green-500 hover:bg-green-500/10 active:bg-green-500/20 transition-colors text-[11px] font-medium">
            <TrendingUp className="h-3 w-3" /><span className="hidden sm:inline">In</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <button onClick={() => onStockOut(die)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-colors text-[11px] font-medium">
            <TrendingDown className="h-3 w-3" /><span className="hidden sm:inline">Out</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <button onClick={() => onEdit(die)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 ${textSec} hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] transition-colors text-[11px] font-medium`}>
            <Edit2 className="h-3 w-3" /><span className="hidden sm:inline">Edit</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`px-2 py-2 ${textMuted} hover:bg-[var(--bg-hover)] transition-colors`}>
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={dlgCls}>
              <DropdownMenuItem onClick={() => onArchive(die)} className="cursor-pointer">
                <Archive className="mr-2 h-4 w-4" />Archive
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => onDeleteRequest(die)} className="cursor-pointer text-red-500">
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Archived card: just restore option */}
      {isArchived && (
        <div className="border-t border-[var(--border-color)]">
          <button onClick={() => onArchive(die)}
            className={`w-full flex items-center justify-center gap-1.5 py-2 text-amber-500 hover:bg-amber-500/10 text-xs font-medium transition-colors`}>
            <ArchiveRestore className="h-3.5 w-3.5" /> Restore
          </button>
        </div>
      )}
    </div>
  );
}
