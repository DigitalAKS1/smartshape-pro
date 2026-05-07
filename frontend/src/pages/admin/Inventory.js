import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, exportData } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Package, AlertTriangle, Plus, Camera, Image, X, Download, Upload, Archive, ArchiveRestore, Trash2, MoreVertical, Grid3X3, List, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';

const CATEGORIES = ['decorative', 'flowers', 'leaf', 'alphabets', 'numbers', 'butterfly', 'borders', 'giant_flowers', '3d_flowers', 'animals_birds', 'snowflake', 'fruits', 'shapes', 'other'];
const CAT_LABELS = { decorative: 'Decorative Dies', flowers: 'Flowers', leaf: 'Leaf', alphabets: 'Alphabets', numbers: 'Numbers', butterfly: 'Butterfly', borders: 'Borders', giant_flowers: 'Giant Flowers', '3d_flowers': '3D Rolled Flowers', animals_birds: 'Animals & Birds', snowflake: 'Snowflake', fruits: 'Fruits', shapes: 'Shapes', other: 'Other' };

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [dies, setDies] = useState([]);
  const [filteredDies, setFilteredDies] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState('catalogue'); // 'catalogue' or 'table'
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [newDie, setNewDie] = useState({ code: '', name: '', type: 'standard', category: 'decorative', min_level: 5, description: '' });
  const [newDieImage, setNewDieImage] = useState(null);
  const [newDieImagePreview, setNewDieImagePreview] = useState('');
  const [uploading, setUploading] = useState(null);
  const importRef = useRef(null);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';
  const backendUrl = process.env.REACT_APP_BACKEND_URL;

  useEffect(() => { fetchDies(); }, [showArchived]);
  const fetchDies = async () => {
    try { const res = await diesApi.getAll(showArchived); setDies(res.data); setFilteredDies(res.data); }
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

  const handleCreateDie = async (e) => {
    e.preventDefault();
    try {
      const res = await diesApi.create(newDie);
      if (newDieImage && res.data.die_id) { try { await diesApi.uploadImage(res.data.die_id, newDieImage); } catch {} }
      toast.success('Die created');
      setDialogOpen(false);
      setNewDie({ code: '', name: '', type: 'standard', category: 'decorative', min_level: 5, description: '' });
      setNewDieImage(null); setNewDieImagePreview('');
      fetchDies();
    } catch { toast.error('Failed to create die'); }
  };

  const handleImageUpload = async (dieId, file) => {
    if (!file || file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setUploading(dieId);
    try { await diesApi.uploadImage(dieId, file); toast.success('Photo uploaded'); fetchDies(); }
    catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };

  const handleImport = async (file) => {
    try { const res = await diesApi.importCsv(file); toast.success(`Import: ${res.data.created} created, ${res.data.duplicates} duplicates`); setImportOpen(false); fetchDies(); }
    catch { toast.error('Import failed'); }
  };

  const handleArchive = async (die) => {
    try { await diesApi.archive(die.die_id); toast.success(die.is_active !== false ? 'Archived' : 'Restored'); fetchDies(); }
    catch { toast.error('Failed'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await diesApi.delete(deleteTarget.die_id); toast.success('Deleted'); setDeleteConfirmOpen(false); setDeleteTarget(null); fetchDies(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleNewImageSelect = (file) => {
    if (!file) return;
    setNewDieImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setNewDieImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const activeDies = dies.filter(d => d.is_active !== false);
  const stats = { total: activeDies.length, inStock: activeDies.filter(d => d.stock_qty > d.min_level).length, lowStock: activeDies.filter(d => d.stock_qty <= d.min_level && d.stock_qty > 0).length, outOfStock: activeDies.filter(d => d.stock_qty === 0).length };

  // Group by category for catalogue view
  const grouped = {};
  filteredDies.forEach(d => {
    const cat = d.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="inventory-title">Inventory</h1>
            <p className={`${textSec} mt-1 text-sm`}>{activeDies.length} dies in catalogue</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={`flex ${card} border rounded-md p-0.5`}>
              <button onClick={() => setViewMode('catalogue')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : textMuted}`} data-testid="view-catalogue">
                <Grid3X3 className="h-3 w-3" />
              </button>
              <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewMode === 'table' ? 'bg-[#e94560] text-white' : textMuted}`} data-testid="view-table">
                <List className="h-3 w-3" />
              </button>
            </div>
            <Button onClick={() => setShowArchived(!showArchived)} variant="outline" size="sm" className={`${showArchived ? 'bg-[#e94560]/10 border-[#e94560] text-[#e94560]' : `border-[var(--border-color)] ${textMuted}`}`} data-testid="toggle-archived-button">
              <Archive className="mr-1 h-3 w-3" /> {showArchived ? 'Hide Archived' : 'Archived'}
            </Button>
            <Button onClick={() => { exportData.download('inventory'); }} variant="outline" size="sm" className={`border-[var(--border-color)] ${textMuted}`}><Download className="mr-1 h-3 w-3" /> Export</Button>
            <Button onClick={() => setImportOpen(true)} variant="outline" size="sm" className={`border-[var(--border-color)] ${textMuted}`}><Upload className="mr-1 h-3 w-3" /> Import</Button>
            <Button onClick={() => { setNewDie({ code: '', name: '', type: 'standard', category: 'decorative', min_level: 5, description: '' }); setNewDieImage(null); setNewDieImagePreview(''); setDialogOpen(true); }} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-die-button"><Plus className="mr-1 h-3 w-3" /> Add Die</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`${card} border rounded-md p-3`}><div className={`text-2xl font-mono font-bold ${textPri}`}>{stats.total}</div><p className={`text-xs ${textMuted}`}>Active</p></div>
          <div className={`${card} border rounded-md p-3`}><div className="text-2xl font-mono font-bold text-green-400">{stats.inStock}</div><p className={`text-xs ${textMuted}`}>In Stock</p></div>
          <div className={`${card} border rounded-md p-3`}><div className="text-2xl font-mono font-bold text-yellow-400">{stats.lowStock}</div><p className={`text-xs ${textMuted}`}>Low Stock</p></div>
          <div className={`${card} border rounded-md p-3`}><div className="text-2xl font-mono font-bold text-red-400">{stats.outOfStock}</div><p className={`text-xs ${textMuted}`}>Out of Stock</p></div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input placeholder="Search name or code..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={`pl-10 ${inputCls}`} data-testid="inventory-search" />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="category-filter">
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="type-filter">
            <option value="all">All Types</option>
            <option value="standard">Standard</option><option value="large">Large</option><option value="machine">Machine</option>
          </select>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>
        ) : viewMode === 'catalogue' ? (
          /* CATALOGUE VIEW - grouped by category with full images */
          <div className="space-y-8" data-testid="catalogue-view">
            {Object.keys(grouped).length === 0 ? (
              <div className={`${card} border rounded-md p-16 text-center`}><Package className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No items found</p></div>
            ) : (
              Object.entries(grouped).map(([cat, catDies]) => (
                <div key={cat}>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className={`text-xl font-semibold ${textPri}`}>{CAT_LABELS[cat] || cat}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted}`}>{catDies.length}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {catDies.map(die => (
                      <CatalogueCard key={die.die_id} die={die} uploading={uploading} onUpload={handleImageUpload}
                        onArchive={handleArchive} onDeleteRequest={(d) => { setDeleteTarget(d); setDeleteConfirmOpen(true); }}
                        isAdmin={isAdmin} textPri={textPri} textMuted={textMuted} textSec={textSec} card={card} backendUrl={backendUrl} />
                    ))}
                  </div>
                </div>
              ))
            )}
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
                  <th className={`text-left text-xs py-3 px-4 ${textMuted}`}>Actions</th>
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
                      <td className={`px-4 py-3 ${textSec} capitalize text-xs`}>{CAT_LABELS[die.category] || die.category || 'Other'}</td>
                      <td className={`px-4 py-3 ${textSec} capitalize`}>{die.type}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono font-bold ${die.stock_qty <= die.min_level ? (die.stock_qty === 0 ? 'text-red-400' : 'text-yellow-400') : textPri}`}>{die.stock_qty}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-yellow-400">{die.reserved_qty}</td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><button className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className={dlgCls}>
                            <DropdownMenuItem onClick={() => handleArchive(die)} className="cursor-pointer">{die.is_active === false ? <><ArchiveRestore className="mr-2 h-4 w-4" /> Restore</> : <><Archive className="mr-2 h-4 w-4" /> Archive</>}</DropdownMenuItem>
                            {isAdmin && <DropdownMenuItem onClick={() => { setDeleteTarget(die); setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
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
                    <p className={`text-xs font-mono ${textMuted}`}>{die.code} • {die.type}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-bold text-sm ${die.stock_qty === 0 ? 'text-red-400' : textPri}`}>{die.stock_qty}</p>
                    <p className={`text-[10px] ${textMuted}`}>stock</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ADD DIE DIALOG */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Add New Die</DialogTitle></DialogHeader>
            <form onSubmit={handleCreateDie} className="space-y-3">
              <div>
                <Label className={`${textSec} text-xs`}>Photo</Label>
                <div className={`bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-md p-4 text-center cursor-pointer`} onClick={() => document.getElementById('new-die-image')?.click()}>
                  {newDieImagePreview ? (
                    <div className="relative"><img src={newDieImagePreview} alt="Preview" className="h-24 mx-auto object-contain rounded" />
                      <button type="button" onClick={(e) => { e.stopPropagation(); setNewDieImage(null); setNewDieImagePreview(''); }} className="absolute top-0 right-0 p-1 bg-red-500 rounded-full"><X className="h-3 w-3 text-white" /></button>
                    </div>
                  ) : (<><Camera className={`h-6 w-6 mx-auto mb-1 ${textMuted}`} /><p className={`text-xs ${textMuted}`}>Click to add photo</p></>)}
                  <input id="new-die-image" type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleNewImageSelect(e.target.files[0]); }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Code *</Label><Input value={newDie.code} onChange={(e) => setNewDie({...newDie, code: e.target.value})} required className={inputCls} data-testid="die-code-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={newDie.name} onChange={(e) => setNewDie({...newDie, name: e.target.value})} required className={inputCls} data-testid="die-name-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={newDie.type} onChange={(e) => setNewDie({...newDie, type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="standard">Standard</option><option value="large">Large</option><option value="machine">Machine</option>
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Category</Label>
                  <select value={newDie.category} onChange={(e) => setNewDie({...newDie, category: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="die-category-select">
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Min Level</Label><Input type="number" value={newDie.min_level} onChange={(e) => setNewDie({...newDie, min_level: parseInt(e.target.value)})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Description</Label><Input value={newDie.description} onChange={(e) => setNewDie({...newDie, description: e.target.value})} className={inputCls} placeholder="Optional" /></div>
              </div>
              <Button type="submit" className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-die-submit">Create Die</Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* IMPORT DIALOG */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Import Dies from CSV</DialogTitle></DialogHeader>
            <p className={`text-sm ${textSec}`}>CSV columns: code, name, type, category, stock_qty, min_level, description</p>
            <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-md p-8 text-center cursor-pointer" onClick={() => importRef.current?.click()}>
              <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} /><p className={textSec}>Click to upload CSV</p>
              <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); }} />
            </div>
          </DialogContent>
        </Dialog>

        {/* DELETE DIALOG */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className="text-red-500">Permanently Delete?</DialogTitle></DialogHeader>
            <p className={`text-sm ${textSec}`}>Delete <strong className={textPri}>{deleteTarget?.name}</strong> ({deleteTarget?.code})?</p>
            {deleteTarget?.stock_qty > 0 && <p className="text-sm text-yellow-500 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Has {deleteTarget.stock_qty} units in stock.</p>}
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} className={`border-[var(--border-color)] ${textMuted}`}>Cancel</Button>
              <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white" data-testid="delete-confirm-button"><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

function CatalogueCard({ die, uploading, onUpload, onArchive, onDeleteRequest, isAdmin, textPri, textMuted, textSec, card, backendUrl }) {
  const fileRef = useRef(null);
  const isUploading = uploading === die.die_id;
  const isArchived = die.is_active === false;
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <div className={`${card} border rounded-lg overflow-hidden group transition-all hover:-translate-y-1 hover:shadow-lg ${isArchived ? 'opacity-50' : ''}`} data-testid={`die-card-${die.code}`}>
      {/* Image - large, prominent */}
      <div className="relative aspect-square bg-[var(--bg-primary)] flex items-center justify-center overflow-hidden">
        {die.image_url ? (
          <img src={`${backendUrl}${die.image_url}`} alt={die.name} className="w-full h-full object-contain p-2" />
        ) : (
          <div className={`flex flex-col items-center ${textMuted}`}><Image className="h-10 w-10 mb-1 opacity-30" /><span className="text-[10px]">No image</span></div>
        )}
        {!isArchived && (
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
            {isUploading ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" /> : <Camera className="h-6 w-6 text-white" />}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) onUpload(die.die_id, e.target.files[0]); e.target.value = ''; }} />
        {isArchived && <div className="absolute top-1.5 left-1.5 bg-amber-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">ARCHIVED</div>}
        {die.stock_qty <= die.min_level && die.is_active !== false && (
          <div className={`absolute top-1.5 right-1.5 ${die.stock_qty === 0 ? 'bg-red-500' : 'bg-yellow-500'} text-white text-[9px] font-bold px-1.5 py-0.5 rounded`}>
            {die.stock_qty === 0 ? 'OUT' : 'LOW'}
          </div>
        )}
        {/* Menu */}
        <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="p-1 rounded bg-black/50 hover:bg-black/70"><MoreVertical className="h-3.5 w-3.5 text-white" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={dlgCls}>
              <DropdownMenuItem onClick={() => onArchive(die)} className="cursor-pointer">{isArchived ? 'Restore' : 'Archive'}</DropdownMenuItem>
              {isAdmin && <DropdownMenuItem onClick={() => onDeleteRequest(die)} className="cursor-pointer text-red-500">Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Info */}
      <div className="p-2.5">
        <p className="font-mono text-[10px] text-[#e94560] font-medium">{die.code}</p>
        <h3 className={`text-sm font-medium ${textPri} leading-tight mt-0.5 line-clamp-1`}>{die.name}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-[10px] ${textMuted} capitalize`}>{die.type}</span>
          <span className={`font-mono text-xs font-bold ${die.stock_qty === 0 ? 'text-red-400' : die.stock_qty <= die.min_level ? 'text-yellow-400' : textPri}`}>{die.stock_qty}</span>
        </div>
      </div>
    </div>
  );
}
