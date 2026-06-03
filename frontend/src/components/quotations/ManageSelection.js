import React from 'react';
import { Button } from '../ui/button';
import { RefreshCw, CheckCircle2, AlertTriangle, X, Search } from 'lucide-react';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

/**
 * ManageSelection — shown below the action bar when catalogue_status === 'submitted'.
 * Receives the full state bag from useViewQuotation via the `state` prop.
 */
export default function ManageSelection({ state }) {
  const {
    quot,
    selItems,
    allDies,
    dieSearch, setDieSearch,
    replacingItem, setReplacingItem,
    replacements, setReplacements,
    selReason, setSelReason,
    savingSelection,
    showManage, setShowManage,
    handleSaveSelection,
  } = state;

  if (quot?.catalogue_status !== 'submitted') return null;

  return (
    <div className="no-print bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-6 py-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">Catalogue Submitted</span>
            <span className="text-xs text-[var(--text-secondary)]">
              — {selItems.filter(i => i.status !== 'removed_by_admin').length} items selected by customer
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowManage(v => !v)}
            className="border-[var(--border-color)] text-[var(--text-secondary)]">
            <RefreshCw className="mr-1.5 h-3 w-3" />
            {showManage ? 'Hide' : 'Manage Selection'}
          </Button>
        </div>

        {showManage && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-4">
            {/* Reason */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reason for changes (sent to customer)</label>
              <input
                value={selReason}
                onChange={e => setSelReason(e.target.value)}
                placeholder="e.g. Some items are out of stock"
                className="w-full h-9 px-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]"
              />
            </div>

            {/* Pending replacements */}
            {replacements.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Queued replacements ({replacements.length}):</p>
                {replacements.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                    <AlertTriangle className="h-3 w-3 text-yellow-400 flex-shrink-0" />
                    <span className="text-[var(--text-secondary)]">Remove <strong className="text-red-400">{r.old_die_name}</strong></span>
                    {r.new_die_id && <><span className="text-[var(--text-secondary)]">→ Add</span><strong className="text-green-400">{r.new_die_name}</strong></>}
                    <button onClick={() => setReplacements(prev => prev.filter((_, j) => j !== i))}
                      className="ml-auto text-[var(--text-secondary)] hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Items list */}
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Selected Items</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {selItems.map((item, i) => {
                  const isRemoved = item.status === 'removed_by_admin';
                  const isAdded   = item.status === 'added_by_admin';
                  const inQueue   = replacements.some(r => r.old_die_id === item.die_id);
                  return (
                    <div key={item.die_id || i}
                      className={`flex items-start gap-2 p-2 rounded-md border text-xs ${
                        isRemoved ? 'border-red-500/30 opacity-60' :
                        isAdded   ? 'border-yellow-400/30 bg-yellow-500/5' :
                        inQueue   ? 'border-orange-400/40 bg-orange-500/5' :
                                    'border-[var(--border-color)]'
                      }`}>
                      {item.die_image_url
                        ? <img src={`${BACKEND}${item.die_image_url}`} alt="" className="w-8 h-8 rounded object-contain bg-[var(--bg-primary)] flex-shrink-0" />
                        : <div className="w-8 h-8 rounded bg-[var(--bg-primary)] flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[10px] text-[#e94560]">{item.die_code}</p>
                        <p className="text-[var(--text-primary)] font-medium leading-tight truncate">{item.die_name}</p>
                        <p className="text-[var(--text-secondary)] capitalize">{item.die_type}</p>
                        {isRemoved && <span className="text-red-400 font-medium">Removed</span>}
                        {isAdded && <span className="text-yellow-400 font-medium">Added by admin</span>}
                        {item.admin_note && <p className="text-yellow-400 italic truncate">Note: {item.admin_note}</p>}
                      </div>
                      {!isRemoved && !isAdded && !inQueue && (
                        <button
                          onClick={() => setReplacingItem(replacingItem === item.die_id ? null : item.die_id)}
                          className="flex-shrink-0 text-[10px] px-2 py-1 rounded bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 font-medium whitespace-nowrap">
                          Replace
                        </button>
                      )}
                      {inQueue && <span className="flex-shrink-0 text-[10px] text-orange-400 font-medium">Queued</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Die picker for replacement */}
            {replacingItem && (() => {
              const srcItem = selItems.find(i => i.die_id === replacingItem);
              const filteredDies = allDies.filter(d =>
                d.die_id !== replacingItem &&
                !selItems.some(i => i.die_id === d.die_id && i.status !== 'removed_by_admin') &&
                (dieSearch === '' ||
                  d.name?.toLowerCase().includes(dieSearch.toLowerCase()) ||
                  d.code?.toLowerCase().includes(dieSearch.toLowerCase()))
              ).slice(0, 20);
              return (
                <div className="border border-[var(--border-color)] rounded-lg p-3 bg-[var(--bg-primary)]">
                  <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                    Choose replacement for <strong className="text-[var(--text-primary)]">{srcItem?.die_name}</strong>
                    <button onClick={() => { setReplacingItem(null); setDieSearch(''); }}
                      className="ml-2 text-[var(--text-secondary)] hover:text-red-400">
                      <X className="h-3 w-3 inline" />
                    </button>
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-secondary)]" />
                      <input value={dieSearch} onChange={e => setDieSearch(e.target.value)}
                        placeholder="Search dies by name or code…"
                        className="w-full h-8 pl-7 pr-3 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]" />
                    </div>
                    <button
                      onClick={() => {
                        setReplacements(prev => [...prev, { old_die_id: replacingItem, old_die_name: srcItem?.die_name, new_die_id: null, new_die_name: null, note: '' }]);
                        setReplacingItem(null); setDieSearch('');
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 whitespace-nowrap">
                      Remove only
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                    {filteredDies.map(die => (
                      <button key={die.die_id}
                        onClick={() => {
                          setReplacements(prev => [...prev, { old_die_id: replacingItem, old_die_name: srcItem?.die_name, new_die_id: die.die_id, new_die_name: die.name, note: '' }]);
                          setReplacingItem(null); setDieSearch('');
                        }}
                        className="flex items-center gap-1.5 p-1.5 rounded border border-[var(--border-color)] hover:border-[#e94560]/50 hover:bg-[#e94560]/5 text-left transition-colors">
                        {die.image_url
                          ? <img src={`${BACKEND}${die.image_url}`} alt="" className="w-7 h-7 rounded object-contain bg-[var(--bg-primary)] flex-shrink-0" />
                          : <div className="w-7 h-7 rounded bg-[var(--bg-primary)] flex-shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-[9px] text-[#e94560] leading-none">{die.code}</p>
                          <p className="text-[10px] text-[var(--text-primary)] leading-tight truncate">{die.name}</p>
                        </div>
                      </button>
                    ))}
                    {filteredDies.length === 0 && (
                      <p className="col-span-3 text-center text-xs text-[var(--text-secondary)] py-4">No dies found</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Save */}
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
              <Button size="sm" variant="outline"
                onClick={() => { setShowManage(false); setReplacements([]); setReplacingItem(null); }}
                className="border-[var(--border-color)] text-[var(--text-secondary)]">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveSelection} disabled={savingSelection || replacements.length === 0}
                className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                {savingSelection ? 'Saving…' : `Save & Notify Customer (${replacements.length} change${replacements.length !== 1 ? 's' : ''})`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
