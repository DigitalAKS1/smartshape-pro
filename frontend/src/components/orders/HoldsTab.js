import React from 'react';
import { Button } from '../ui/button';
import { formatDate } from '../../lib/utils';
import {
  Lock, Unlock, ShieldCheck, AlertTriangle,
  Layers, Square, CheckSquare,
} from 'lucide-react';

/**
 * Full holds-monitor tab — school filter, bulk-select toolbar, desktop table, mobile cards.
 */
export default function HoldsTab({
  holdsList,
  selectedHolds,
  holdSchoolFilter, setHoldSchoolFilter,
  setSelectedHolds,
  bulkReleasing,
  toggleHoldSelect,
  selectAllVisibleHolds,
  selectSchoolHolds,
  handleConfirmHold,
  handleReleaseHold,
  handleBulkRelease,
  // tokens
  textPri, textSec, textMuted, inputCls, card,
}) {
  const schools    = [...new Set(holdsList.map(h => h.school_name).filter(Boolean))].sort();
  const filtered   = holdSchoolFilter === 'all' ? holdsList : holdsList.filter(h => h.school_name === holdSchoolFilter);
  const filteredIds = filtered.map(h => h.order_item_id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedHolds.has(id));

  return (
    <div className="space-y-3" data-testid="holds-list">
      {holdsList.length === 0 ? (
        <div className={`${card} border rounded-md p-12 text-center`}>
          <Lock className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
          <p className={textMuted}>No active holds</p>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Layers className={`h-3.5 w-3.5 ${textMuted}`} />
                <span className={`text-xs ${textMuted}`}>Select by school:</span>
              </div>
              <select
                value={holdSchoolFilter}
                onChange={e => { setHoldSchoolFilter(e.target.value); setSelectedHolds(new Set()); }}
                className={`h-8 px-2 rounded-md text-xs ${inputCls}`}
                data-testid="hold-school-filter"
              >
                <option value="all">All Schools ({holdsList.length})</option>
                {schools.map(s => {
                  const cnt = holdsList.filter(h => h.school_name === s).length;
                  return <option key={s} value={s}>{s} ({cnt})</option>;
                })}
              </select>
              {holdSchoolFilter !== 'all' && (
                <Button size="sm" variant="outline" onClick={() => selectSchoolHolds(holdSchoolFilter)}
                  className={`h-7 text-xs border-[var(--border-color)] ${textSec}`}>
                  Select all for school
                </Button>
              )}
            </div>
            {selectedHolds.size > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-orange-400 font-medium">{selectedHolds.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => setSelectedHolds(new Set())}
                  className={`h-7 text-xs border-[var(--border-color)] ${textSec}`}>
                  Clear
                </Button>
                <Button size="sm" onClick={handleBulkRelease} disabled={bulkReleasing}
                  className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white"
                  data-testid="bulk-release-btn">
                  <Unlock className="mr-1 h-3 w-3" />
                  {bulkReleasing ? 'Releasing…' : `Release ${selectedHolds.size}`}
                </Button>
              </div>
            )}
          </div>

          <div className={`${card} border rounded-md overflow-hidden`}>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-primary)]">
                    <th className="py-3 px-4 w-10">
                      <button onClick={() => selectAllVisibleHolds(filteredIds)} className={textMuted}>
                        {allFilteredSelected
                          ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                          : <Square className="h-4 w-4" />}
                      </button>
                    </th>
                    {['Die', 'School', 'Order', 'Stock', 'Hold Date', 'Actions'].map(h => (
                      <th key={h} className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(h => (
                    <tr key={h.order_item_id}
                      className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer ${selectedHolds.has(h.order_item_id) ? 'bg-red-500/5' : ''}`}
                      data-testid={`hold-row-${h.order_item_id}`}
                      onClick={() => toggleHoldSelect(h.order_item_id)}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleHoldSelect(h.order_item_id)} className={textMuted}>
                          {selectedHolds.has(h.order_item_id)
                            ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                            : <Square className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`${textPri} font-medium`}>{h.die_name}</p>
                        <p className={`text-xs font-mono ${textMuted}`}>{h.die_code}</p>
                      </td>
                      <td className={`px-4 py-3 ${textSec}`}>{h.school_name}</td>
                      <td className="px-4 py-3"><span className="font-mono text-xs text-[#e94560]">{h.order_number}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono ${textPri}`}>{h.stock_qty}</span>
                          <span className={`text-xs ${textMuted}`}>/ {h.reserved_qty} held</span>
                          {h.available < 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-xs ${textMuted}`}>{formatDate(h.hold_date)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline"
                            onClick={() => handleConfirmHold(h.order_item_id)}
                            className="border-green-500/30 text-green-400 hover:bg-green-500/10 h-7 text-xs"
                            data-testid={`confirm-hold-${h.order_item_id}`}>
                            <ShieldCheck className="mr-1 h-3 w-3" /> Confirm
                          </Button>
                          <Button size="sm" variant="outline"
                            onClick={() => handleReleaseHold(h.order_item_id)}
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-7 text-xs"
                            data-testid={`release-hold-${h.order_item_id}`}>
                            <Unlock className="mr-1 h-3 w-3" /> Release
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {filtered.map(h => (
                <div key={h.order_item_id}
                  className={`p-4 space-y-2 ${selectedHolds.has(h.order_item_id) ? 'bg-red-500/5' : ''}`}
                  data-testid={`hold-card-${h.order_item_id}`}
                  onClick={() => toggleHoldSelect(h.order_item_id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button onClick={e => { e.stopPropagation(); toggleHoldSelect(h.order_item_id); }} className={`flex-shrink-0 ${textMuted}`}>
                        {selectedHolds.has(h.order_item_id)
                          ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                          : <Square className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0">
                        <p className={`${textPri} font-medium text-sm`}>{h.die_name} <span className={`font-mono text-xs ${textMuted}`}>({h.die_code})</span></p>
                        <p className={`text-xs ${textMuted}`}>{h.school_name} • {h.order_number}</p>
                      </div>
                    </div>
                    {h.available < 0 && <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />}
                  </div>
                  <div className={`flex items-center gap-3 text-xs ${textMuted}`}>
                    <span>Stock: {h.stock_qty}</span>
                    <span>Held: {h.reserved_qty}</span>
                    <span>Avail: <span className={h.available < 0 ? 'text-red-400' : 'text-green-400'}>{h.available}</span></span>
                  </div>
                  <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                    <Button size="sm" onClick={() => handleConfirmHold(h.order_item_id)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs h-8">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleReleaseHold(h.order_item_id)}
                      className="flex-1 border-red-500/30 text-red-400 text-xs h-8">
                      <Unlock className="mr-1 h-3 w-3" /> Release
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
