import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatDate } from '../../lib/utils';
import {
  Lock, Unlock, ShieldCheck, AlertTriangle,
  Layers, Square, CheckSquare, Building2, Package, ShoppingCart,
} from 'lucide-react';
import { ProductThumb } from '../inventory/ShortfallDetailModal';
import { groupHoldsBySchool, groupHoldsByItem } from '../../lib/holdsUtils';
import CreatePoFromHoldsDialog from './CreatePoFromHoldsDialog';

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
  const navigate = useNavigate();
  // View mode: 'school' (per-school holds) or 'item' (item-wise totals → procure).
  const [holdView, setHoldView] = useState('school');
  const [itemSel, setItemSel] = useState(new Set());
  const [itemQty, setItemQty] = useState({});
  const [poOpen, setPoOpen] = useState(false);
  const [poLines, setPoLines] = useState([]);

  const itemGroups = groupHoldsByItem(holdsList);
  const qtyFor = (it) => (itemQty[it.die_id] ?? it.suggestedQty);
  const toggleItem = (it) => {
    setItemSel(prev => {
      const next = new Set(prev);
      if (next.has(it.die_id)) next.delete(it.die_id);
      else { next.add(it.die_id); setItemQty(q => ({ ...q, [it.die_id]: q[it.die_id] ?? it.suggestedQty })); }
      return next;
    });
  };
  const allItemsSelected = itemGroups.length > 0 && itemGroups.every(it => itemSel.has(it.die_id));
  const toggleAllItems = () => {
    if (allItemsSelected) { setItemSel(new Set()); return; }
    const next = new Set(itemGroups.map(it => it.die_id));
    setItemSel(next);
    setItemQty(q => { const m = { ...q }; itemGroups.forEach(it => { if (m[it.die_id] == null) m[it.die_id] = it.suggestedQty; }); return m; });
  };
  const openPo = () => {
    const lines = itemGroups
      .filter(it => itemSel.has(it.die_id))
      .map(it => ({ die_id: it.die_id, die_name: it.die_name, die_code: it.die_code, die_image_url: it.die_image_url, qty: qtyFor(it) }));
    setPoLines(lines);
    setPoOpen(true);
  };

  const schools    = [...new Set(holdsList.map(h => h.school_name).filter(Boolean))].sort();
  const filtered   = holdSchoolFilter === 'all' ? holdsList : holdsList.filter(h => h.school_name === holdSchoolFilter);
  const filteredIds = filtered.map(h => h.order_item_id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedHolds.has(id));
  // When "All Schools" is selected, show per-school groups with subtotals.
  const grouped = holdSchoolFilter === 'all';
  const groups = grouped ? groupHoldsBySchool(filtered) : null;

  const DesktopRow = (h) => (
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
        <div className="flex items-center gap-2.5">
          <ProductThumb url={h.die_image_url} size={34} />
          <div>
            <p className={`${textPri} font-medium`}>{h.die_name}</p>
            <p className={`text-xs font-mono ${textMuted}`}>{h.die_code}</p>
          </div>
        </div>
      </td>
      <td className={`px-4 py-3 ${textSec}`}>{h.school_name}</td>
      <td className="px-4 py-3"><span className="font-mono text-xs text-[#e94560]">{h.order_number}</span></td>
      <td className="px-4 py-3"><span className={`font-mono ${textPri}`}>{h.quantity}</span></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${textMuted}`}>Stock {h.stock_qty} · Avail </span>
          <span className={`font-mono ${(h.available ?? 0) < 0 ? 'text-red-400' : textPri}`}>{h.available}</span>
          {h.short > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-red-500/15 text-red-400 text-[10px] font-semibold px-1.5 py-0.5">
              <AlertTriangle className="h-3 w-3" /> Short {h.short}
            </span>
          )}
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
  );

  const SchoolHeaderRow = (g) => (
    <tr key={`hdr-${g.school_name}`} className="bg-[var(--bg-primary)]">
      <td className="px-4 py-2" />
      <td colSpan={7} className="px-4 py-2">
        <span className={`text-xs font-semibold ${textPri}`}>{g.school_name}</span>
        <span className={`text-[11px] ${textMuted} ml-2`}>{g.items.length} item{g.items.length !== 1 ? 's' : ''} · {g.totalQty} qty</span>
        {g.shortCount > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 rounded bg-red-500/15 text-red-400 text-[10px] font-semibold px-1.5 py-0.5">
            <AlertTriangle className="h-3 w-3" /> {g.shortCount} short
          </span>
        )}
      </td>
    </tr>
  );

  const MobileCard = (h) => (
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
          <ProductThumb url={h.die_image_url} size={36} />
          <div className="min-w-0">
            <p className={`${textPri} font-medium text-sm`}>{h.die_name} <span className={`font-mono text-xs ${textMuted}`}>({h.die_code})</span></p>
            <p className={`text-xs ${textMuted}`}>{h.school_name} • {h.order_number}</p>
          </div>
        </div>
        {h.short > 0 && <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />}
      </div>
      <div className={`flex items-center gap-3 text-xs ${textMuted} flex-wrap`}>
        <span>Need: <span className={textPri}>{h.quantity}</span></span>
        <span>Stock: {h.stock_qty}</span>
        <span>Avail: <span className={(h.available ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}>{h.available}</span></span>
        {h.short > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-red-500/15 text-red-400 text-[10px] font-semibold px-1.5 py-0.5">
            Short {h.short}
          </span>
        )}
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
  );

  return (
    <div className="space-y-3" data-testid="holds-list">
      {holdsList.length === 0 ? (
        <div className={`${card} border rounded-md p-12 text-center`}>
          <Lock className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
          <p className={textMuted}>No active holds</p>
        </div>
      ) : (
        <>
          {/* View toggle: per-school vs item-wise totals */}
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] rounded-lg p-1 w-fit">
            {[['school', 'By School', Building2], ['item', 'By Item', Package]].map(([v, label, Icon]) => (
              <button key={v} onClick={() => setHoldView(v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${holdView === v ? 'bg-[#e94560] text-white' : textSec}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {holdView === 'school' && (<>
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
                <option value="all">All Schools ({holdsList.length} items · {holdsList.reduce((s, h) => s + Number(h.quantity || 0), 0)} qty)</option>
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
                    {['Die', 'School', 'Order', 'Qty', 'Availability', 'Hold Date', 'Actions'].map(h => (
                      <th key={h} className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped
                    ? groups.map(g => (
                        <React.Fragment key={g.school_name}>
                          {SchoolHeaderRow(g)}
                          {g.items.map(DesktopRow)}
                        </React.Fragment>
                      ))
                    : filtered.map(DesktopRow)}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[var(--border-color)]">
              {grouped
                ? groups.map(g => (
                    <div key={g.school_name}>
                      <div className="px-4 py-2 bg-[var(--bg-primary)] flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${textPri}`}>{g.school_name}</span>
                        <span className={`text-[11px] ${textMuted}`}>{g.items.length} item{g.items.length !== 1 ? 's' : ''} · {g.totalQty} qty</span>
                        {g.shortCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-red-500/15 text-red-400 text-[10px] font-semibold px-1.5 py-0.5">
                            <AlertTriangle className="h-3 w-3" /> {g.shortCount} short
                          </span>
                        )}
                      </div>
                      <div className="divide-y divide-[var(--border-color)]">{g.items.map(MobileCard)}</div>
                    </div>
                  ))
                : filtered.map(MobileCard)}
            </div>
          </div>
          </>)}

          {holdView === 'item' && (
            <>
              {/* Item-wise toolbar */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className={`text-xs ${textMuted}`}>Item-wise totals across all schools — pick items, set quantities, and raise a PO.</span>
                {itemSel.size > 0 && (
                  <Button size="sm" onClick={openPo} className="h-8 text-xs bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-po-from-holds">
                    <ShoppingCart className="mr-1.5 h-3.5 w-3.5" /> Create Purchase Order ({itemSel.size})
                  </Button>
                )}
              </div>

              <div className={`${card} border rounded-md overflow-hidden`}>
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--bg-primary)]">
                        <th className="py-3 px-4 w-10">
                          <button onClick={toggleAllItems} className={textMuted}>
                            {allItemsSelected ? <CheckSquare className="h-4 w-4 text-[#e94560]" /> : <Square className="h-4 w-4" />}
                          </button>
                        </th>
                        {['Item', 'Spread', 'Held Qty', 'Available', 'Short', 'Order Qty'].map(h => (
                          <th key={h} className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {itemGroups.map(it => {
                        const sel = itemSel.has(it.die_id);
                        return (
                          <tr key={it.die_id} className={`border-t border-[var(--border-color)] ${sel ? 'bg-[#e94560]/5' : ''}`}>
                            <td className="px-4 py-3" onClick={() => toggleItem(it)}>
                              <button className={textMuted}>
                                {sel ? <CheckSquare className="h-4 w-4 text-[#e94560]" /> : <Square className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <ProductThumb url={it.die_image_url} size={34} />
                                <div>
                                  <p className={`${textPri} font-medium`}>{it.die_name}</p>
                                  <p className={`text-xs font-mono ${textMuted}`}>{it.die_code}</p>
                                </div>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-xs ${textMuted}`}>{it.schoolCount} school{it.schoolCount !== 1 ? 's' : ''} · {it.orderCount} order{it.orderCount !== 1 ? 's' : ''}</td>
                            <td className={`px-4 py-3 font-mono ${textPri}`}>{it.totalQty}</td>
                            <td className={`px-4 py-3 font-mono ${it.available < 0 ? 'text-red-400' : textSec}`}>{it.available}</td>
                            <td className="px-4 py-3">
                              {it.short > 0
                                ? <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-400 text-[11px] font-semibold px-1.5 py-0.5">{it.short}</span>
                                : <span className={textMuted}>0</span>}
                            </td>
                            <td className="px-4 py-3">
                              <Input type="number" min={1} value={qtyFor(it)}
                                onChange={e => setItemQty(q => ({ ...q, [it.die_id]: e.target.value }))}
                                className={`h-8 w-20 text-center font-mono ${inputCls}`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden divide-y divide-[var(--border-color)]">
                  {itemGroups.map(it => {
                    const sel = itemSel.has(it.die_id);
                    return (
                      <div key={it.die_id} className={`p-3 ${sel ? 'bg-[#e94560]/5' : ''}`}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleItem(it)} className={`shrink-0 ${textMuted}`}>
                            {sel ? <CheckSquare className="h-4 w-4 text-[#e94560]" /> : <Square className="h-4 w-4" />}
                          </button>
                          <ProductThumb url={it.die_image_url} size={36} />
                          <div className="min-w-0 flex-1">
                            <p className={`${textPri} font-medium text-sm`}>{it.die_name} <span className={`font-mono text-xs ${textMuted}`}>({it.die_code})</span></p>
                            <p className={`text-xs ${textMuted}`}>{it.schoolCount} school{it.schoolCount !== 1 ? 's' : ''} · held {it.totalQty}{it.short > 0 ? ` · short ${it.short}` : ''}</p>
                          </div>
                          <Input type="number" min={1} value={qtyFor(it)}
                            onChange={e => setItemQty(q => ({ ...q, [it.die_id]: e.target.value }))}
                            className={`h-8 w-16 text-center font-mono ${inputCls}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <CreatePoFromHoldsDialog
            open={poOpen} onClose={() => setPoOpen(false)} initialLines={poLines}
            onCreated={() => { setItemSel(new Set()); setItemQty({}); navigate('/procurement'); }}
          />
        </>
      )}
    </div>
  );
}
