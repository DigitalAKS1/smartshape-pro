import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, exportData, stock as stockApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Package, AlertTriangle, Plus, Camera, Image, X, Download, Upload, Archive, ArchiveRestore, Trash2, MoreVertical, Grid3X3, List, Search, Edit2, TrendingUp, TrendingDown, FileDown } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';

const CATEGORIES = ['decorative','flowers','leaf','alphabets','numbers','butterfly','borders','giant_flowers','3d_flowers','animals_birds','snowflake','fruits','shapes','other'];
const CAT_LABELS = { decorative:'Decorative Dies', flowers:'Flowers', leaf:'Leaf', alphabets:'Alphabets', numbers:'Numbers', butterfly:'Butterfly', borders:'Borders', giant_flowers:'Giant Flowers', '3d_flowers':'3D Rolled Flowers', animals_birds:'Animals & Birds', snowflake:'Snowflake', fruits:'Fruits', shapes:'Shapes', other:'Other' };
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

  // Dialogs
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

  // Create form
  const [newDie, setNewDie] = useState(BLANK_DIE);
  const [newDieImage, setNewDieImage] = useState(null);
  const [newDieImagePreview, setNewDieImagePreview] = useState('');

  // Edit form
  const [editForm, setEditForm] = useState(BLANK_DIE);

  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);
  const importRef = useRef(null);

  // Edit image
  const [editImage, setEditImage] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState('');

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';
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
    if (searchTerm) f = f.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()) || d.code.toLowerCase().includes(searchTerm.toLowerCase()));
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
    setEditImage(null);
    setEditImagePreview('');
    setEditOpen(true);
  };
  const handleSaveEdit = async () => {
    if (!editForm.code || !editForm.name) { toast.error('Code and Name required'); return; }
    setSaving(true);
    try {
      await diesApi.update(editTarget.die_id, editForm);
      if (editImage) {
        try { await diesApi.uploadImage(editTarget.die_id, editImage); }
        catch { toast.error('Saved but photo upload failed — try again from the card.'); }
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
    try { await diesApi.uploadImage(dieId, file); toast.success('Photo uploaded'); fetchDies(); }
    catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };
  const handleNewImageSelect = (file) => {
    if (!file) return;
    setNewDieImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setNewDieImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  // ── Quick stock adjust ──
  const openStockAdj = (die, type) => {
    setStockAdjTarget(die);
    setStockAdjType(type);
    setStockAdjQty(1);
    setStockAdjNote('');
    setStockAdjOpen(true);
  };
  const handleStockAdj = async () => {
    if (!stockAdjQty || stockAdjQty < 1) { toast.error('Quantity must be ≥ 1'); return; }
    try {
      await stockApi.createMovement({ die_id: stockAdjTarget.die_id, movement_type: stockAdjType, quantity: Number(stockAdjQty), notes: stockAdjNote || `Quick ${stockAdjType === 'stock_in' ? 'stock-in' : 'stock-out'}` });
      toast.success(`Stock ${stockAdjType === 'stock_in' ? 'added' : 'removed'}: ${stockAdjQty} units`);
      setStockAdjOpen(false);
      fetchDies();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  // ── Import ──
  const handleImport = async (file) => {
    try {
      const res = await diesApi.importCsv(file);
      const msg = `✓ ${res.data.created} created, ${res.data.duplicates} skipped`;
      const errs = res.data.errors?.length ? ` | ${res.data.errors.length} errors` : '';
      toast.success(msg + errs);
      setImportOpen(false); fetchDies();
    } catch { toast.error('Import failed'); }
  };

  // ── Sample CSV download ──
  const downloadSample = () => {
    const headers = 'code,name,type,category,stock_qty,min_level,description';
    const rows = [
      'D-STD-001,Rose Flower,standard,flowers,25,5,Classic rose die for cards and scrapbooking',
      'D-STD-002,Leaf Set,standard,leaf,30,5,Set of 3 leaf shapes',
      'D-LRG-003,Giant Sunflower,large,giant_flowers,10,3,Large sunflower die for centerpieces',
      'D-STD-004,Butterfly Pair,standard,butterfly,20,5,Small and large butterfly pair',
      'D-STD-005,Letter A,standard,alphabets,15,5,Capital letter A alphabet die',
      'D-MCH-006,Machine Border,machine,borders,8,2,Machine-cut decorative border strip',
      'D-STD-007,Star Cluster,standard,shapes,18,5,Five-pointed star cluster set',
      'D-STD-008,Apple,standard,fruits,12,4,Apple shape with leaf detail',
    ];
    const csv = [headers, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sample_inventory_import.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast.success('Sample CSV downloaded');
  };

  // ── Archive / Delete ──
  const handleArchive = async (die) => {
    try { await diesApi.archive(die.die_id); toast.success(die.is_active !== false ? 'Archived' : 'Restored'); fetchDies(); }
    catch { toast.error('Failed'); }
  };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await diesApi.delete(deleteTarget.die_id); toast.success('Deleted permanently'); setDeleteConfirmOpen(false); setDeleteTarget(null); fetchDies(); }
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
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="inventory-title">Inventory</h1>
            <p className={`${textSec} mt-1 text-sm`}>{activeDies.length} dies · {stats.outOfStock} out of stock · {stats.lowStock} low</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={`flex ${card} border rounded-md p-0.5`}>
              <button onClick={() => setViewMode('catalogue')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : textMuted}`} data-testid="view-catalogue"><Grid3X3 className="h-3 w-3" /></button>
              <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewMode === 'table' ? 'bg-[#e94560] text-white' : textMuted}`} data-testid="view-table"><List className="h-3 w-3" /></button>
            </div>
            <Button onClick={() => setShowArchived(!showArchived)} variant="outline" size="sm" className={showArchived ? 'bg-[#e94560]/10 border-[#e94560] text-[#e94560]' : `border-[var(--border-color)] ${textMuted}`} data-testid="toggle-archived-button">
              <Archive className="mr-1 h-3 w-3" />{showArchived ? 'Hide Archived' : 'Archived'}
            </Button>
            <Button onClick={() => exportData.download('inventory')} variant="outline" size="sm" className={`border-[var(--border-color)] ${textMuted}`}><Download className="mr-1 h-3 w-3" /> Export</Button>
            <Button onClick={() => setImportOpen(true)} variant="outline" size="sm" className={`border-[var(--border-color)] ${textMuted}`}><Upload className="mr-1 h-3 w-3" /> Import</Button>
            {canWrite && (
              <Button onClick={() => { setNewDie(BLANK_DIE); setNewDieImage(null); setNewDieImagePreview(''); setCreateOpen(true); }} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-die-button">
                <Plus className="mr-1 h-3 w-3" /> Add Die
              </Button>
            )}
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active', value: stats.total, cls: textPri },
            { label: 'In Stock', value: stats.inStock, cls: 'text-green-500' },
            { label: 'Low Stock', value: stats.lowStock, cls: 'text-yellow-500' },
            { label: 'Out of Stock', value: stats.outOfStock, cls: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-xl p-4`}>
              <p className={`text-2xl font-bold font-mono ${s.cls}`}>{s.value}</p>
              <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input placeholder="Search name or code…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className={`pl-10 ${inputCls}`} data-testid="inventory-search" />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="category-filter">
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="type-filter">
            <option value="all">All Types</option>
            {TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>
        ) : viewMode === 'catalogue' ? (

          /* CATALOGUE VIEW */
          <div className="space-y-8" data-testid="catalogue-view">
            {Object.keys(grouped).length === 0
              ? <div className={`${card} border rounded-md p-16 text-center`}><Package className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No items found</p></div>
              : Object.entries(grouped).map(([cat, catDies]) => (
                <div key={cat}>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className={`text-xl font-semibold ${textPri}`}>{CAT_LABELS[cat] || cat}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted}`}>{catDies.length}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {catDies.map(die => (
                      <CatalogueCard key={die.die_id} die={die} uploading={uploading}
                        onUpload={handleImageUpload} onArchive={handleArchive}
                        onEdit={openEdit}
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

          /* TABLE VIEW */
          <div className={`${card} border rounded-md overflow-hidden`} data-testid="table-view">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Image</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Code</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Name</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Category</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Type</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Stock</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Reserved</th>
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Min</th>
                  <th className={`text-right text-xs py-3 px-4 ${textMuted}`}>Actions</th>
                </tr></thead>
                <tbody>
                  {filteredDies.map(die => (
                    <tr key={die.die_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] ${die.is_active === false ? 'opacity-50' : ''}`} data-testid={`table-row-${die.code}`}>
                      <td className="px-4 py-3">
                        <div className="w-12 h-12 rounded bg-[var(--bg-primary)] overflow-hidden">
                          {die.image_url ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-cover" /> : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Image className="h-4 w-4" /></div>}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[#e94560] text-xs">{die.code}</td>
                      <td className={`px-4 py-3 ${textPri} font-medium`}>{die.name}</td>
                      <td className={`px-4 py-3 ${textSec} text-xs`}>{CAT_LABELS[die.category] || die.category || 'Other'}</td>
                      <td className={`px-4 py-3 ${textSec} capitalize`}>{die.type}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono font-bold ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-yellow-500">{die.reserved_qty}</td>
                      <td className={`px-4 py-3 font-mono text-xs ${textMuted}`}>{die.min_level}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canWrite && <>
                            <Button size="sm" variant="ghost" onClick={() => openStockAdj(die, 'stock_in')} className="text-green-500 h-7 w-7 p-0" title="Stock In"><TrendingUp className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => openStockAdj(die, 'stock_out')} className="text-red-400 h-7 w-7 p-0" title="Stock Out"><TrendingDown className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(die)} className={`${textSec} h-7 w-7 p-0`} title="Edit"><Edit2 className="h-3.5 w-3.5" /></Button>
                          </>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><button className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className={dlgCls}>
                              <DropdownMenuItem onClick={() => handleArchive(die)} className="cursor-pointer">{die.is_active === false ? <><ArchiveRestore className="mr-2 h-4 w-4" /> Restore</> : <><Archive className="mr-2 h-4 w-4" /> Archive</>}</DropdownMenuItem>
                              {isAdmin && <DropdownMenuItem onClick={() => { setDeleteTarget(die); setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredDies.length === 0 && <tr><td colSpan="9" className={`py-16 text-center ${textMuted}`}>No items found</td></tr>}
                </tbody>
              </table>
            </div>
            {/* Mobile list */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {filteredDies.map(die => (
                <div key={die.die_id} className="flex items-center gap-3 p-3">
                  <div className="w-12 h-12 rounded bg-[var(--bg-primary)] flex-shrink-0 overflow-hidden">
                    {die.image_url ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-cover" /> : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Image className="h-4 w-4" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${textPri} truncate`}>{die.name}</p>
                    <p className={`text-xs font-mono ${textMuted}`}>{die.code} · {die.type}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {canWrite && <>
                      <button onClick={() => openStockAdj(die, 'stock_in')} className="p-1.5 text-green-500"><TrendingUp className="h-4 w-4" /></button>
                      <button onClick={() => openStockAdj(die, 'stock_out')} className="p-1.5 text-red-400"><TrendingDown className="h-4 w-4" /></button>
                    </>}
                    <div className="text-right ml-1">
                      <p className={`font-mono font-bold text-sm ${die.stock_qty === 0 ? 'text-red-500' : textPri}`}>{die.stock_qty}</p>
                      <p className={`text-[10px] ${textMuted}`}>stock</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CREATE DIE DIALOG ══ */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Add New Die</DialogTitle></DialogHeader>
            <form onSubmit={handleCreateDie} className="space-y-3">
              <div>
                <Label className={`${textSec} text-xs`}>Photo</Label>
                <div className={`bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-md p-4 text-center cursor-pointer`} onClick={() => document.getElementById('new-die-image')?.click()}>
                  {newDieImagePreview
                    ? <div className="relative"><img src={newDieImagePreview} alt="Preview" className="h-24 mx-auto object-contain rounded" /><button type="button" onClick={e => { e.stopPropagation(); setNewDieImage(null); setNewDieImagePreview(''); }} className="absolute top-0 right-0 p-1 bg-red-500 rounded-full"><X className="h-3 w-3 text-white" /></button></div>
                    : <><Camera className={`h-6 w-6 mx-auto mb-1 ${textMuted}`} /><p className={`text-xs ${textMuted}`}>Click to add photo</p></>}
                  <input id="new-die-image" type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleNewImageSelect(e.target.files[0]); }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Code *</Label><Input value={newDie.code} onChange={e => setNewDie({...newDie, code: e.target.value})} required className={inputCls} data-testid="die-code-input" placeholder="D-STD-001" /></div>
                <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={newDie.name} onChange={e => setNewDie({...newDie, name: e.target.value})} required className={inputCls} data-testid="die-name-input" placeholder="Rose Flower" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={newDie.type} onChange={e => setNewDie({...newDie, type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    {TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Category</Label>
                  <select value={newDie.category} onChange={e => setNewDie({...newDie, category: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="die-category-select">
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs`}>Initial Stock</Label>
                  <Input type="number" min={0} value={newDie.stock_qty} onChange={e => setNewDie({...newDie, stock_qty: parseInt(e.target.value) || 0})} className={inputCls} placeholder="0" data-testid="die-stock-input" />
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Min Level (alert below)</Label>
                  <Input type="number" min={0} value={newDie.min_level} onChange={e => setNewDie({...newDie, min_level: parseInt(e.target.value) || 0})} className={inputCls} />
                </div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Description</Label><Input value={newDie.description} onChange={e => setNewDie({...newDie, description: e.target.value})} className={inputCls} placeholder="Optional notes" /></div>
              <Button type="submit" disabled={saving} className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-60" data-testid="create-die-submit">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 inline-block" />Saving…</> : 'Add Die'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* ══ EDIT DIE DIALOG ══ */}
        <Dialog open={editOpen} onOpenChange={open => { if (!saving) setEditOpen(open); }}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Edit Die — {editTarget?.code}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-1">
              {/* Image */}
              <div>
                <Label className={`${textSec} text-xs`}>Photo</Label>
                <div className={`bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-md p-3 text-center cursor-pointer`}
                  onClick={() => document.getElementById('edit-die-image')?.click()}>
                  {editImagePreview
                    ? <div className="relative inline-block">
                        <img src={editImagePreview} alt="Preview" className="h-24 mx-auto object-contain rounded" />
                        <button type="button" onClick={e => { e.stopPropagation(); setEditImage(null); setEditImagePreview(''); }}
                          className="absolute top-0 right-0 p-1 bg-red-500 rounded-full"><X className="h-3 w-3 text-white" /></button>
                      </div>
                    : editTarget?.image_url
                    ? <div className="relative inline-block">
                        <img src={`${backendUrl}${editTarget.image_url}`} alt="Current" className="h-24 mx-auto object-contain rounded opacity-60" />
                        <p className={`text-[10px] ${textMuted} mt-1`}>Click to replace</p>
                      </div>
                    : <><Camera className={`h-6 w-6 mx-auto mb-1 ${textMuted}`} /><p className={`text-xs ${textMuted}`}>Click to add photo</p></>}
                  <input id="edit-die-image" type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (!f) return; setEditImage(f); const r = new FileReader(); r.onload = ev => setEditImagePreview(ev.target.result); r.readAsDataURL(f); e.target.value = ''; }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Code *</Label><Input value={editForm.code} onChange={e => setEditForm({...editForm, code: e.target.value})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Category</Label>
                  <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Min Level</Label><Input type="number" min={0} value={editForm.min_level} onChange={e => setEditForm({...editForm, min_level: parseInt(e.target.value) || 0})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Description</Label><Input value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className={inputCls} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-60">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 inline-block" />Saving…</> : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ══ QUICK STOCK ADJUST DIALOG ══ */}
        <Dialog open={stockAdjOpen} onOpenChange={setStockAdjOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-sm`}>
            <DialogHeader>
              <DialogTitle className={`${textPri} flex items-center gap-2`}>
                {stockAdjType === 'stock_in'
                  ? <TrendingUp className="h-4 w-4 text-green-500" />
                  : <TrendingDown className="h-4 w-4 text-red-400" />}
                {stockAdjType === 'stock_in' ? 'Stock In' : 'Stock Out'} — {stockAdjTarget?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 flex justify-between`}>
                <span className={`text-sm ${textSec}`}>Current Stock</span>
                <span className={`font-mono font-bold ${textPri}`}>{stockAdjTarget?.stock_qty ?? 0}</span>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Quantity *</Label>
                <Input type="number" min={1} value={stockAdjQty} onChange={e => setStockAdjQty(e.target.value)} className={inputCls} autoFocus />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Note (optional)</Label>
                <Input value={stockAdjNote} onChange={e => setStockAdjNote(e.target.value)} className={inputCls} placeholder="Purchase order ref, reason…" />
              </div>
              {stockAdjType === 'stock_out' && stockAdjTarget && Number(stockAdjQty) > stockAdjTarget.stock_qty && (
                <p className="text-xs text-yellow-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Qty exceeds current stock</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStockAdjOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleStockAdj} className={`${stockAdjType === 'stock_in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white`}>
                {stockAdjType === 'stock_in' ? 'Add Stock' : 'Remove Stock'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ══ IMPORT DIALOG ══ */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Import Dies from CSV</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 text-xs space-y-1`}>
                <p className={`font-semibold ${textSec}`}>Required columns:</p>
                <p className={`font-mono ${textMuted}`}>code, name, type, category, stock_qty, min_level, description</p>
                <p className={textMuted}><strong>type:</strong> standard · large · machine</p>
                <p className={textMuted}><strong>category:</strong> flowers · leaf · alphabets · numbers · butterfly · borders · giant_flowers · 3d_flowers · animals_birds · snowflake · fruits · shapes · decorative · other</p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadSample} className={`w-full border-[var(--border-color)] ${textSec} gap-2`}>
                <FileDown className="h-3.5 w-3.5" /> Download Sample CSV
              </Button>
              <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-md p-8 text-center cursor-pointer" onClick={() => importRef.current?.click()}>
                <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload your CSV</p>
                <p className={`text-xs ${textMuted} mt-1`}>Duplicate codes are skipped automatically</p>
                <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ══ DELETE DIALOG ══ */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className="text-red-500">Permanently Delete?</DialogTitle></DialogHeader>
            <p className={`text-sm ${textSec}`}>Delete <strong className={textPri}>{deleteTarget?.name}</strong> ({deleteTarget?.code})?<br/>This cannot be undone.</p>
            {deleteTarget?.stock_qty > 0 && <p className="text-sm text-yellow-500 flex items-center gap-1 mt-2"><AlertTriangle className="h-4 w-4" /> Has {deleteTarget.stock_qty} units in stock.</p>}
            <DialogFooter className="mt-3">
              <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} className={`border-[var(--border-color)] ${textMuted}`}>Cancel</Button>
              <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white" data-testid="delete-confirm-button"><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
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
    <div className={`${card} border rounded-lg overflow-hidden group transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-black/10 ${isArchived ? 'opacity-50' : ''}`} data-testid={`die-card-${die.code}`}>
      {/* Image */}
      <div className="relative aspect-square bg-[var(--bg-primary)] flex items-center justify-center overflow-hidden">
        {die.image_url
          ? <img src={`${backendUrl}${die.image_url}`} alt={die.name} className="w-full h-full object-contain p-2" />
          : <div className={`flex flex-col items-center ${textMuted}`}><Image className="h-10 w-10 mb-1 opacity-30" /><span className="text-[10px]">No image</span></div>}
        {!isArchived && canWrite && (
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
            {isUploading ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" /> : <Camera className="h-6 w-6 text-white" />}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) onUpload(die.die_id, e.target.files[0]); e.target.value = ''; }} />
        {isArchived && <div className="absolute top-1.5 left-1.5 bg-amber-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">ARCHIVED</div>}
        {die.stock_qty <= die.min_level && !isArchived && (
          <div className={`absolute top-1.5 right-1.5 ${die.stock_qty === 0 ? 'bg-red-500' : 'bg-yellow-500'} text-white text-[9px] font-bold px-1.5 py-0.5 rounded`}>
            {die.stock_qty === 0 ? 'OUT' : 'LOW'}
          </div>
        )}
        {/* Context menu */}
        <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="p-1 rounded bg-black/50 hover:bg-black/70"><MoreVertical className="h-3.5 w-3.5 text-white" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={dlgCls}>
              {canWrite && <DropdownMenuItem onClick={() => onEdit(die)} className="cursor-pointer"><Edit2 className="mr-2 h-3.5 w-3.5" /> Edit</DropdownMenuItem>}
              {canWrite && <DropdownMenuItem onClick={() => onStockIn(die)} className="cursor-pointer text-green-500"><TrendingUp className="mr-2 h-3.5 w-3.5" /> Stock In</DropdownMenuItem>}
              {canWrite && <DropdownMenuItem onClick={() => onStockOut(die)} className="cursor-pointer text-red-400"><TrendingDown className="mr-2 h-3.5 w-3.5" /> Stock Out</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => onArchive(die)} className="cursor-pointer">{isArchived ? 'Restore' : 'Archive'}</DropdownMenuItem>
              {isAdmin && <DropdownMenuItem onClick={() => onDeleteRequest(die)} className="cursor-pointer text-red-500">Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Info */}
      <div className="p-2.5">
        <p className="font-mono text-[10px] text-[#e94560] font-medium">{die.code}</p>
        <h3 className={`text-sm font-medium ${textPri} leading-tight mt-0.5 line-clamp-1`} title={die.name}>{die.name}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-[10px] ${textMuted} capitalize`}>{die.type}</span>
          <span className={`font-mono text-xs font-bold ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</span>
        </div>
      </div>
    </div>
  );
}
