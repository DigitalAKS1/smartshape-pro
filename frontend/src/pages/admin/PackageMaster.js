import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Plus, Search, X, Package, LayoutList, ChevronRight, Trash2 } from 'lucide-react';
import { usePackageMaster } from '../../hooks/usePackageMaster';
import PackageCard from '../../components/packages/PackageCard';
import PackageFormPanel from '../../components/packages/PackageFormPanel';

export default function PackageMaster() {
  const { isDark } = useTheme();

  const card      = 'bg-[var(--bg-card)]';
  const bg        = isDark ? 'bg-[var(--bg-primary)]' : 'bg-gray-50/80';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const borderCls = 'border-[var(--border-color)]';
  const inputCls  = `bg-[var(--bg-primary)] border-[var(--border-color)] ${textPri} text-sm`;

  const {
    filtered, loading, saving,
    editPkg, form, setForm,
    editorOpen, search, setSearch,
    showInactive, setShowInactive,
    confirmDelete, setConfirmDelete,
    activeCount, inactiveCount,
    nameInputRef, summary,
    openNew, openEdit, duplicatePkg, discard,
    addItem, removeItem, updateItem,
    handleSave, confirmAndDelete,
  } = usePackageMaster();

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

        {/* Top Bar */}
        <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 flex-shrink-0`}>
          <div>
            <h1 className={`text-xl font-bold ${textPri}`}>Package Master</h1>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} archived` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {inactiveCount > 0 && (
              <button
                onClick={() => setShowInactive(v => !v)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${showInactive ? 'bg-[#e94560]/10 text-[#e94560] border-[#e94560]/30' : `${borderCls} ${textMuted} hover:${textSec}`}`}
              >
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

        {/* Split Panel */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT: Package List */}
          <div className={`${editorOpen ? 'hidden lg:flex' : 'flex'} lg:w-80 xl:w-96 flex-col flex-shrink-0 border-r ${borderCls}`}>
            {/* Search */}
            {filtered.length > 3 && (
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
                filtered.map(pkg => (
                  <PackageCard
                    key={pkg.package_id}
                    pkg={pkg}
                    isSelected={editPkg?.package_id === pkg.package_id}
                    onSelect={() => openEdit(pkg)}
                    onDuplicate={duplicatePkg}
                    onDelete={(p) => setConfirmDelete(p)}
                    textPri={textPri}
                    textMuted={textMuted}
                    borderCls={borderCls}
                    card={card}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Editor */}
          <div className={`${editorOpen ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden`}>
            <PackageFormPanel
              editPkg={editPkg}
              form={form}
              setForm={setForm}
              nameInputRef={nameInputRef}
              saving={saving}
              onSave={handleSave}
              onDiscard={discard}
              onRequestDelete={(p) => setConfirmDelete(p)}
              addItem={addItem}
              removeItem={removeItem}
              updateItem={updateItem}
              summary={summary}
              textPri={textPri}
              textSec={textSec}
              textMuted={textMuted}
              borderCls={borderCls}
              card={card}
              inputCls={inputCls}
              bg={bg}
            />
          </div>
        </div>

        {/* Delete Confirm Overlay */}
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
