import React from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { exportData } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Package, Plus, Download, Upload, Archive, MoreVertical,
  Grid3X3, List, Search, Edit2, TrendingUp, TrendingDown,
  CheckCircle2, AlertCircle, XCircle, Scissors, Filter, X,
  CheckSquare, Square, Trash2, PackageOpen, ArrowUpDown,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../../components/ui/dropdown-menu';

import useInventory, { CATEGORIES, CAT_LABELS, TYPES, SORT_OPTIONS } from '../../hooks/useInventory';
import DieCard from '../../components/inventory/DieCard';
import { CreateDieDialog, EditDieDialog } from '../../components/inventory/DieFormDialog';
import StockMovementDialog from '../../components/inventory/StockMovementDialog';
import { ImportDialog, DeleteConfirmDialog, BulkDeleteConfirmDialog } from '../../components/inventory/ImportDeleteDialogs';

const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

export default function Inventory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const canWrite = isAdmin || user?.role === 'store';

  const inv = useInventory();

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls    = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const renderDieCard = (die) => (
    <DieCard key={die.die_id} die={die} uploading={inv.uploading}
      onUpload={inv.handleImageUpload} onArchive={inv.handleArchive}
      onEdit={inv.openEdit}
      onDeleteRequest={d => { inv.setDeleteTarget(d); inv.setDeleteConfirmOpen(true); }}
      onStockIn={d => inv.openStockAdj(d, 'stock_in')}
      onStockOut={d => inv.openStockAdj(d, 'stock_out')}
      isAdmin={isAdmin} canWrite={canWrite}
      selectMode={isAdmin && inv.selectMode}
      selected={inv.isSelected(die.die_id)}
      onToggleSelect={() => inv.toggleSelect(die.die_id)}
      textPri={textPri} textMuted={textMuted} textSec={textSec}
      card={card} backendUrl={backendUrl} />
  );

  const KPI_ITEMS = [
    { label: 'Total',    value: inv.stats.total,      Icon: Package,      cls: textPri,          bg: 'bg-[var(--bg-primary)]', filter: null   },
    { label: 'In Stock', value: inv.stats.inStock,    Icon: CheckCircle2, cls: 'text-green-500', bg: 'bg-green-500/10',        filter: null   },
    { label: 'Low',      value: inv.stats.lowStock,   Icon: AlertCircle,  cls: 'text-yellow-500',bg: 'bg-yellow-500/10',       filter: 'low'  },
    { label: 'Out',      value: inv.stats.outOfStock, Icon: XCircle,      cls: 'text-red-500',   bg: 'bg-red-500/10',          filter: 'out'  },
  ];

  return (
    <AdminLayout>
      <div className="space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#e94560]/10 hidden sm:flex">
              <Scissors className="h-5 w-5 text-[#e94560]" />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Inventory</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>{inv.activeDies.length} dies · {inv.stats.outOfStock} out of stock</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`hidden sm:flex ${card} border rounded-md p-0.5`}>
              <button onClick={() => inv.setViewMode('catalogue')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${inv.viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : textMuted}`}>
                <Grid3X3 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => inv.setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${inv.viewMode === 'table' ? 'bg-[#e94560] text-white' : textMuted}`}>
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`p-2 rounded-md border ${card} ${textMuted} hover:bg-[var(--bg-hover)]`}>
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={dlgCls}>
                <div className="flex sm:hidden items-center gap-1 px-2 py-1.5 mb-1">
                  <button onClick={() => inv.setViewMode('catalogue')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${inv.viewMode === 'catalogue' ? 'bg-[#e94560] text-white' : `${card} border ${textMuted}`}`}>
                    <Grid3X3 className="h-3.5 w-3.5" /> Grid
                  </button>
                  <button onClick={() => inv.setViewMode('table')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${inv.viewMode === 'table' ? 'bg-[#e94560] text-white' : `${card} border ${textMuted}`}`}>
                    <List className="h-3.5 w-3.5" /> List
                  </button>
                </div>
                <DropdownMenuSeparator className="sm:hidden border-[var(--border-color)]" />
                <DropdownMenuItem onClick={() => inv.setShowArchived(!inv.showArchived)} className="cursor-pointer">
                  <Archive className="mr-2 h-4 w-4" />{inv.showArchived ? 'Hide Archived' : 'Show Archived'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData.download('inventory')} className="cursor-pointer">
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/returnable-challans')} className="cursor-pointer">
                  <PackageOpen className="mr-2 h-4 w-4" /> Returnable Challans
                </DropdownMenuItem>
                {canWrite && (
                  <DropdownMenuItem onClick={() => inv.setImportOpen(true)} className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> Import CSV
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator className="border-[var(--border-color)]" />
                    <DropdownMenuItem onClick={() => inv.setSelectMode(true)} className="cursor-pointer">
                      <CheckSquare className="mr-2 h-4 w-4" /> Select &amp; delete
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={inv.handleSendLowStockAlert} className="cursor-pointer">
                      <AlertCircle className="mr-2 h-4 w-4" /> Send low-stock alert now
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {canWrite && (
              <Button onClick={() => { inv.setCreateOpen(true); }}
                size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9 px-3">
                <Plus className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Add Die</span>
              </Button>
            )}
          </div>
        </div>

        {/* Multi-select toolbar (admin) */}
        {isAdmin && inv.selectMode && (
          <div className="sticky top-2 z-20 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#e94560]/12 border border-[#e94560]/40 backdrop-blur">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={inv.exitSelectMode} className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]" title="Exit selection">
                <X className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-[var(--text-primary)] whitespace-nowrap">
                {inv.selectedIds.length} selected
              </span>
              <button onClick={inv.toggleSelectAllVisible} className="text-xs text-[#e94560] hover:underline font-medium whitespace-nowrap">
                {inv.allVisibleSelected ? 'Clear all' : `Select all (${inv.filteredDies.length})`}
              </button>
            </div>
            <Button size="sm" disabled={inv.selectedIds.length === 0}
              onClick={() => inv.setBulkDeleteOpen(true)}
              className="bg-red-600 hover:bg-red-700 text-white h-8 px-3 disabled:opacity-40">
              <Trash2 className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Delete{inv.selectedIds.length ? ` (${inv.selectedIds.length})` : ''}</span>
            </Button>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {KPI_ITEMS.map(({ label, value, Icon, cls, bg, filter }) => {
            const active = filter && inv.quickFilter === filter;
            return (
              <button key={label}
                onClick={() => filter ? inv.setQuickFilter(inv.quickFilter === filter ? null : filter) : inv.clearFilters()}
                className={`${card} border rounded-xl p-3 sm:p-4 text-center transition-all active:scale-95 ${active ? 'ring-2 ring-[#e94560] border-[#e94560]' : 'hover:border-[var(--text-muted)]/40'}`}>
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${bg} flex items-center justify-center mx-auto mb-1.5`}>
                  <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${cls}`} />
                </div>
                <p className={`text-xl sm:text-2xl font-bold font-mono ${cls} leading-none`}>{value}</p>
                <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5`}>{label}</p>
              </button>
            );
          })}
        </div>

        {/* Needs-reorder prompt */}
        {!inv.isFiltered && inv.stats.needsReorder > 0 && (
          <button onClick={() => inv.setQuickFilter('reorder')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/15 transition-colors">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
              <span className="text-xs font-medium text-yellow-600">
                {inv.stats.needsReorder} item{inv.stats.needsReorder !== 1 ? 's' : ''} at or below minimum level
              </span>
            </div>
            <span className="text-xs text-yellow-600 font-medium">View reorder list →</span>
          </button>
        )}
        {inv.quickFilter === 'reorder' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
              <span className="text-xs font-medium text-yellow-600">
                Reorder list · {inv.filteredDies.length} item{inv.filteredDies.length !== 1 ? 's' : ''} · most urgent first
              </span>
            </div>
            <button onClick={inv.clearFilters} className="text-xs text-yellow-600 hover:underline font-medium">Clear</button>
          </div>
        )}

        {/* Active filter banner */}
        {inv.isFiltered && inv.quickFilter !== 'reorder' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#e94560]/10 border border-[#e94560]/20">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-[#e94560]" />
              <span className="text-xs font-medium text-[#e94560]">
                {inv.filteredDies.length} result{inv.filteredDies.length !== 1 ? 's' : ''} · filters active
              </span>
            </div>
            <button onClick={inv.clearFilters} className="text-xs text-[#e94560] hover:underline font-medium">Clear all</button>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
              <Input placeholder="Search name or code…" value={inv.searchTerm} onChange={e => inv.setSearchTerm(e.target.value)}
                className={`pl-9 ${inv.searchTerm ? 'pr-9' : ''} h-10 ${inputCls}`} />
              {inv.searchTerm && (
                <button onClick={() => inv.setSearchTerm('')} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted} hover:text-[var(--text-secondary)]`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select value={inv.typeFilter} onChange={e => { inv.setTypeFilter(e.target.value); inv.setQuickFilter(null); }}
              className={`h-10 px-2 rounded-md text-sm ${inputCls} shrink-0`}>
              <option value="all">All Types</option>
              {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <div className="relative shrink-0">
              <ArrowUpDown className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none ${textMuted}`} />
              <select value={inv.sortBy} onChange={e => inv.setSortBy(e.target.value)}
                title="Sort by"
                className={`h-10 pl-8 pr-2 rounded-md text-sm ${inputCls} w-full`}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {!inv.quickFilter && (
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              {['all', ...CATEGORIES].map(c => (
                <button key={c} onClick={() => inv.setCategoryFilter(c)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border whitespace-nowrap
                    ${inv.categoryFilter === c ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textMuted} hover:border-[#e94560]/50`}`}>
                  {c === 'all' ? 'All' : CAT_LABELS[c] || c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        {inv.loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
          </div>
        ) : inv.viewMode === 'catalogue' ? (
          <div className="space-y-6">
            {inv.filteredDies.length === 0 ? (
              <div className={`${card} border rounded-xl p-16 text-center`}>
                <Scissors className={`h-12 w-12 mx-auto mb-3 ${textMuted} opacity-20`} strokeWidth={1} />
                <p className={`${textSec} font-medium mb-1`}>No dies found</p>
                {inv.isFiltered
                  ? <button onClick={inv.clearFilters} className="text-xs text-[#e94560] hover:underline">Clear filters to see all</button>
                  : <p className={`text-xs ${textMuted}`}>Add your first die to get started</p>}
              </div>
            ) : inv.sortBy !== 'code' ? (
              /* Explicit sort active → flat sorted grid so the chosen order is visible
                 (category grouping would otherwise re-bucket and hide the sort). */
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs ${textMuted} font-mono`}>
                    {inv.filteredDies.length} item{inv.filteredDies.length !== 1 ? 's' : ''} · sorted by {inv.sortLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {inv.filteredDies.map(renderDieCard)}
                </div>
              </div>
            ) : (
              Object.entries(inv.grouped).map(([cat, catDies]) => {
                const catTotal = catDies.reduce((s, d) => s + (d.stock_qty || 0), 0);
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>{CAT_LABELS[cat] || cat}</h2>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted} font-mono`}>{catDies.length}</span>
                      </div>
                      <span className={`text-xs ${textMuted} font-mono`}>{catTotal} in stock</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                      {catDies.map(renderDieCard)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className={`${card} border rounded-xl overflow-hidden`}>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                    {isAdmin && inv.selectMode && (
                      <th className="px-4 py-3 w-10">
                        <button onClick={inv.toggleSelectAllVisible} title={inv.allVisibleSelected ? 'Clear all' : 'Select all'}>
                          {inv.allVisibleSelected
                            ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                            : <Square className="h-4 w-4 text-[var(--text-muted)]" />}
                        </button>
                      </th>
                    )}
                    {['Image','Code','Name','Category','Type','Stock','Status','Actions'].map(h => (
                      <th key={h} className={`text-left text-xs py-3 px-4 font-medium ${textMuted}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inv.filteredDies.map(die => {
                    const pct = die.min_level > 0 ? Math.min(100, (die.stock_qty / (die.min_level * 3)) * 100) : (die.stock_qty > 0 ? 100 : 0);
                    const barColor = die.stock_qty === 0 ? 'bg-red-500' : die.stock_qty <= die.min_level ? 'bg-yellow-500' : 'bg-green-500';
                    return (
                      <tr key={die.die_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${die.is_active === false ? 'opacity-50' : ''} ${isAdmin && inv.selectMode && inv.isSelected(die.die_id) ? 'bg-[#e94560]/10' : ''}`}>
                        {isAdmin && inv.selectMode && (
                          <td className="px-4 py-3">
                            <button onClick={() => inv.toggleSelect(die.die_id)} title="Select row">
                              {inv.isSelected(die.die_id)
                                ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                                : <Square className="h-4 w-4 text-[var(--text-muted)]" />}
                            </button>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="w-11 h-11 rounded-lg bg-[var(--bg-primary)] overflow-hidden">
                            {die.image_url
                              ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-contain p-1" />
                              : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Scissors className="h-4 w-4 opacity-20" /></div>}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[#e94560] text-xs font-medium">{die.code}</td>
                        <td className={`px-4 py-3 ${textPri} font-medium`}>{die.name}</td>
                        <td className={`px-4 py-3 ${textSec} text-xs`}>{CAT_LABELS[die.category] || die.category}</td>
                        <td className={`px-4 py-3 ${textSec} capitalize text-xs`}>{die.type}</td>
                        <td className="px-4 py-3">
                          <span className={`font-mono font-bold ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</span>
                          <div className="w-14 h-1 bg-[var(--border-color)] rounded-full mt-1 overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          {die.stock_qty <= die.min_level && (
                            <span className="text-[10px] text-yellow-600 font-medium">reorder {Math.max((die.min_level || 0) - die.stock_qty, 1)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {die.stock_qty === 0
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 font-medium">Out</span>
                            : die.stock_qty <= die.min_level
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 font-medium">Low</span>
                            : <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 font-medium">OK</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {canWrite && <>
                              <button onClick={() => inv.openStockAdj(die, 'stock_in')} className="p-1.5 rounded-md hover:bg-green-500/10 text-green-500" title="Stock In"><TrendingUp className="h-3.5 w-3.5" /></button>
                              <button onClick={() => inv.openStockAdj(die, 'stock_out')} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400" title="Stock Out"><TrendingDown className="h-3.5 w-3.5" /></button>
                              <button onClick={() => inv.openEdit(die)} className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`} title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                            </>}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className={dlgCls}>
                                <DropdownMenuItem onClick={() => inv.handleArchive(die)} className="cursor-pointer">
                                  {die.is_active === false ? 'Restore' : 'Archive'}
                                </DropdownMenuItem>
                                {isAdmin && <DropdownMenuItem onClick={() => { inv.setDeleteTarget(die); inv.setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500">Delete</DropdownMenuItem>}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {inv.filteredDies.length === 0 && <tr><td colSpan={isAdmin && inv.selectMode ? 9 : 8} className={`py-16 text-center ${textMuted}`}>No items found</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {inv.filteredDies.length === 0
                ? <p className={`py-12 text-center text-sm ${textMuted}`}>No items found</p>
                : inv.filteredDies.map(die => (
                <div key={die.die_id} className={`p-3 ${die.is_active === false ? 'opacity-50' : ''} ${isAdmin && inv.selectMode && inv.isSelected(die.die_id) ? 'bg-[#e94560]/10' : ''}`}>
                  <div className="flex items-center gap-3">
                    {isAdmin && inv.selectMode && (
                      <button onClick={() => inv.toggleSelect(die.die_id)} className="shrink-0" title="Select">
                        {inv.isSelected(die.die_id)
                          ? <CheckSquare className="h-5 w-5 text-[#e94560]" />
                          : <Square className="h-5 w-5 text-[var(--text-muted)]" />}
                      </button>
                    )}
                    <div className="w-14 h-14 rounded-lg bg-[var(--bg-primary)] flex-shrink-0 overflow-hidden border border-[var(--border-color)]">
                      {die.image_url
                        ? <img src={`${backendUrl}${die.image_url}`} alt="" className="w-full h-full object-contain p-1" />
                        : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Scissors className="h-5 w-5 opacity-20" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${textPri} truncate`}>{die.name}</p>
                      <p className="text-xs font-mono text-[#e94560]">{die.code}</p>
                      <p className={`text-xs ${textMuted} capitalize`}>{die.type} · {CAT_LABELS[die.category] || die.category}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono font-bold text-base ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>{die.stock_qty}</p>
                      {die.stock_qty === 0
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500 font-medium">OUT</span>
                        : die.stock_qty <= die.min_level
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 font-medium">LOW</span>
                        : <span className={`text-[10px] ${textMuted}`}>in stock</span>}
                      {die.stock_qty <= die.min_level && (
                        <p className="text-[9px] text-yellow-600 font-medium mt-0.5">reorder {Math.max((die.min_level || 0) - die.stock_qty, 1)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-[var(--border-color)]">
                    {canWrite && <>
                      <button onClick={() => inv.openStockAdj(die, 'stock_in')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 text-green-500 text-xs font-medium active:scale-95 transition-transform">
                        <TrendingUp className="h-3.5 w-3.5" /> Stock In
                      </button>
                      <button onClick={() => inv.openStockAdj(die, 'stock_out')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium active:scale-95 transition-transform">
                        <TrendingDown className="h-3.5 w-3.5" /> Stock Out
                      </button>
                      <button onClick={() => inv.openEdit(die)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--bg-primary)] ${textSec} text-xs font-medium active:scale-95 transition-transform`}>
                        <Edit2 className="h-3.5 w-3.5" /> Edit
                      </button>
                    </>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={`px-2 py-2 rounded-lg bg-[var(--bg-primary)] ${textMuted}`}><MoreVertical className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className={dlgCls}>
                        <DropdownMenuItem onClick={() => inv.handleArchive(die)} className="cursor-pointer">
                          {die.is_active === false ? 'Restore' : 'Archive'}
                        </DropdownMenuItem>
                        {isAdmin && <DropdownMenuItem onClick={() => { inv.setDeleteTarget(die); inv.setDeleteConfirmOpen(true); }} className="cursor-pointer text-red-500">Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dialogs */}
        <CreateDieDialog
          open={inv.createOpen} onOpenChange={inv.setCreateOpen}
          newDie={inv.newDie} setNewDie={inv.setNewDie}
          newDieImagePreview={inv.newDieImagePreview}
          handleNewImageSelect={inv.handleNewImageSelect}
          handleCreateDie={inv.handleCreateDie} saving={inv.saving}
          inputCls={inputCls} textPri={textPri} textSec={textSec}
          textMuted={textMuted} dlgCls={dlgCls} />

        <EditDieDialog
          open={inv.editOpen} onOpenChange={inv.setEditOpen}
          editTarget={inv.editTarget} editForm={inv.editForm} setEditForm={inv.setEditForm}
          editImagePreview={inv.editImagePreview}
          setEditImage={inv.setEditImage} setEditImagePreview={inv.setEditImagePreview}
          handleSaveEdit={inv.handleSaveEdit} saving={inv.saving}
          inputCls={inputCls} textPri={textPri} textSec={textSec}
          textMuted={textMuted} dlgCls={dlgCls} backendUrl={backendUrl} />

        <StockMovementDialog
          open={inv.stockAdjOpen} onOpenChange={inv.setStockAdjOpen}
          stockAdjTarget={inv.stockAdjTarget} stockAdjType={inv.stockAdjType}
          stockAfter={inv.stockAfter}
          stockAdjQty={inv.stockAdjQty} setStockAdjQty={inv.setStockAdjQty}
          stockAdjNote={inv.stockAdjNote} setStockAdjNote={inv.setStockAdjNote}
          handleStockAdj={inv.handleStockAdj}
          inputCls={inputCls} textPri={textPri} textSec={textSec}
          textMuted={textMuted} dlgCls={dlgCls} />

        <ImportDialog
          open={inv.importOpen} onOpenChange={inv.setImportOpen}
          importRef={inv.importRef} handleImport={inv.handleImport}
          downloadSample={inv.downloadSample}
          textPri={textPri} textSec={textSec} textMuted={textMuted} dlgCls={dlgCls} />

        <DeleteConfirmDialog
          open={inv.deleteConfirmOpen} onOpenChange={inv.setDeleteConfirmOpen}
          deleteTarget={inv.deleteTarget} handleDelete={inv.handleDelete}
          textPri={textPri} textSec={textSec} textMuted={textMuted} dlgCls={dlgCls} />

        <BulkDeleteConfirmDialog
          open={inv.bulkDeleteOpen} onOpenChange={inv.setBulkDeleteOpen}
          count={inv.selectedIds.length} onConfirm={inv.handleBulkDelete} deleting={inv.bulkDeleting}
          textPri={textPri} textSec={textSec} textMuted={textMuted} dlgCls={dlgCls} />

      </div>
    </AdminLayout>
  );
}
