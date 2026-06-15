import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Package, Plus, Minus, Trash2, Ban, RotateCcw } from 'lucide-react';
import { ORDER_STATUSES } from '../../lib/ordersUtils';
import OwnerDeleteButton from '../common/OwnerDeleteButton';
import { useIsOwner } from '../../hooks/usePermission';
import { useAuth } from '../../contexts/AuthContext';
import { orders as ordersApi } from '../../lib/api';
import { toast } from 'sonner';

const CANCEL_BLOCK = ['cancelled', 'dispatched', 'delivered'];

const EDITABLE_ORDER_STATUSES = ['pending', 'confirmed'];
const EDITABLE_ITEM_STATUSES = ['on_hold', 'confirmed'];

/**
 * Order detail dialog — shows items, payment info, and timeline.
 * When `canManage` and the order is still pre-dispatch, staff can add/remove
 * dies and change quantities (Manage Selection).
 */
export default function OrderDetailPanel({
  detailOrder, detailOpen, setDetailOpen,
  canManage = false, diesList = [], onAddItem, onUpdateQty, onRemoveItem, onDeleted,
  textPri, textSec, textMuted, dlgCls, inputCls = '',
}) {
  const [addDieId, setAddDieId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [dieFilter, setDieFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const isOwner = useIsOwner();
  const { user } = useAuth();

  const canCancelOrder = ['admin', 'accounts'].includes(user?.role);
  const status = detailOrder?.order_status;
  const isCancelled = status === 'cancelled';
  const cancellable = status && !CANCEL_BLOCK.includes(status);

  const handleCancel = async () => {
    if (!window.confirm('Cancel this order (not finalising)? Held stock will be released. You can re-open it later.')) return;
    const reason = window.prompt('Reason (optional):', '') || '';
    setBusy(true);
    try {
      await ordersApi.cancel(detailOrder.order_id, reason);
      toast.success('Order cancelled — held stock released');
      onDeleted?.(); setDetailOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Cancel failed');
    } finally { setBusy(false); }
  };

  const handleReopen = async () => {
    setBusy(true);
    try {
      await ordersApi.reopen(detailOrder.order_id);
      toast.success('Order re-opened — stock reserved again');
      onDeleted?.(); setDetailOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Re-open failed');
    } finally { setBusy(false); }
  };

  const editable = canManage && detailOrder && EDITABLE_ORDER_STATUSES.includes(detailOrder.order_status);
  const items = detailOrder?.items || [];
  const onOrderDieIds = new Set(items.map(i => i.die_id));
  const availableDies = diesList.filter(d =>
    !onOrderDieIds.has(d.die_id) &&
    (!dieFilter || `${d.name} ${d.code}`.toLowerCase().includes(dieFilter.toLowerCase()))
  );

  const handleAdd = () => {
    if (!addDieId) return;
    onAddItem(detailOrder.order_id, addDieId, Math.max(1, parseInt(addQty, 10) || 1));
    setAddDieId(''); setAddQty(1); setDieFilter('');
  };

  return (
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
        {detailOrder && (
          <>
            <DialogHeader>
              <DialogTitle className={textPri}>
                <span className="font-mono text-[#e94560]">{detailOrder.order_number}</span> — {detailOrder.school_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">

              {/* Info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className={`text-xs ${textMuted}`}>Status</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${(ORDER_STATUSES.find(s => s.id === detailOrder.order_status) || ORDER_STATUSES[0]).color}`}>
                    {detailOrder.order_status}
                  </span>
                </div>
                <div><p className={`text-xs ${textMuted}`}>Total</p><p className={`font-mono font-bold ${textPri}`}>{formatCurrency(detailOrder.grand_total)}</p></div>
                <div><p className={`text-xs ${textMuted}`}>Items</p><p className={`font-mono ${textPri}`}>{detailOrder.total_items}</p></div>
                <div><p className={`text-xs ${textMuted}`}>Date</p><p className={`text-sm ${textSec}`}>{formatDate(detailOrder.created_at)}</p></div>
              </div>

              {/* Order items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={`text-sm font-medium ${textPri}`}>Order Items</h3>
                  {canManage && !editable && (
                    <span className={`text-[10px] ${textMuted}`}>Locked — order is {detailOrder.order_status}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map(item => {
                    const itemEditable = editable && EDITABLE_ITEM_STATUSES.includes(item.status);
                    return (
                      <div key={item.order_item_id} className="flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
                        <div className="w-10 h-10 rounded bg-[var(--bg-hover)] flex items-center justify-center flex-shrink-0">
                          {item.die_image_url
                            ? <img src={`${process.env.REACT_APP_BACKEND_URL}${item.die_image_url}`} alt="" className="w-full h-full object-cover rounded" />
                            : <Package className={`h-4 w-4 ${textMuted}`} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${textPri}`}>{item.die_name}</p>
                          <p className={`text-xs font-mono ${textMuted}`}>{item.die_code} • {item.die_type}</p>
                        </div>

                        {/* Quantity — editable stepper or static */}
                        {itemEditable ? (
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Decrease"
                              onClick={() => onUpdateQty(detailOrder.order_id, item.order_item_id, Math.max(1, (item.quantity || 1) - 1))}
                              className={`w-6 h-6 rounded border border-[var(--border-color)] flex items-center justify-center ${textSec} hover:border-[#e94560]`}>
                              <Minus className="h-3 w-3" />
                            </button>
                            <input type="number" min="1" value={item.quantity || 1}
                              onChange={e => onUpdateQty(detailOrder.order_id, item.order_item_id, Math.max(1, parseInt(e.target.value, 10) || 1))}
                              data-testid={`item-qty-${item.die_code}`}
                              className={`w-12 h-6 text-center text-sm rounded ${inputCls}`} />
                            <button type="button" aria-label="Increase"
                              onClick={() => onUpdateQty(detailOrder.order_id, item.order_item_id, (item.quantity || 1) + 1)}
                              className={`w-6 h-6 rounded border border-[var(--border-color)] flex items-center justify-center ${textSec} hover:border-[#e94560]`}>
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className={`font-mono text-sm ${textPri}`}>×{item.quantity || 1}</span>
                        )}

                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          item.status === 'on_hold'    ? 'bg-orange-500/20 text-orange-400' :
                          item.status === 'confirmed'  ? 'bg-blue-500/20 text-blue-400' :
                          item.status === 'dispatched' ? 'bg-purple-500/20 text-purple-400' :
                          item.status === 'delivered'  ? 'bg-green-500/20 text-green-400' :
                          item.status === 'released'   ? 'bg-gray-500/20 text-gray-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>{item.status?.replace('_', ' ')}</span>

                        {itemEditable && (
                          <button type="button" aria-label="Remove die"
                            onClick={() => onRemoveItem(detailOrder.order_id, item.order_item_id)}
                            data-testid={`remove-item-${item.die_code}`}
                            className="text-red-400 hover:text-red-300 flex-shrink-0">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className={`text-xs ${textMuted}`}>No items.</p>}
                </div>

                {/* Add a die (Manage Selection) */}
                {editable && (
                  <div className="mt-3 border border-dashed border-[var(--border-color)] rounded-md p-3 space-y-2">
                    <p className={`text-xs font-medium ${textSec}`}>Add a die to this order</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input type="text" placeholder="Search dies…" value={dieFilter}
                        onChange={e => setDieFilter(e.target.value)}
                        className={`flex-1 h-9 px-3 rounded-md text-sm ${inputCls}`} />
                      <select value={addDieId} onChange={e => setAddDieId(e.target.value)}
                        data-testid="add-die-select"
                        className={`flex-1 h-9 px-2 rounded-md text-sm ${inputCls}`}>
                        <option value="">Select die…</option>
                        {availableDies.slice(0, 100).map(d => (
                          <option key={d.die_id} value={d.die_id}>{d.code} — {d.name}</option>
                        ))}
                      </select>
                      <input type="number" min="1" value={addQty}
                        onChange={e => setAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className={`w-20 h-9 px-2 text-center rounded-md text-sm ${inputCls}`} />
                      <Button onClick={handleAdd} disabled={!addDieId}
                        data-testid="add-die-btn"
                        className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9">
                        <Plus className="mr-1 h-4 w-4" /> Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* What changed — readable item-by-item history (staff + school) */}
              {(detailOrder.change_log || []).length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium ${textPri} mb-2`}>What changed</h3>
                  <div className="space-y-2">
                    {[...detailOrder.change_log].reverse().map((cl, i) => (
                      <div key={i} className="rounded-lg border border-[var(--border-color)] p-2.5">
                        <p className={`text-[11px] ${textMuted} mb-1`}>
                          {cl.source === 'staff' ? 'Changed by us' : 'Customer-approved change'} • {formatDate(cl.at)}
                        </p>
                        <ul className="space-y-0.5">
                          {(cl.lines || []).map((ln, j) => (
                            <li key={j} className={`text-xs ${textPri}`}>• {ln}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {(detailOrder.timeline || []).length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium ${textPri} mb-2`}>Timeline</h3>
                  <div className="space-y-2">
                    {detailOrder.timeline.map((tl, i) => (
                      <div key={tl.timeline_id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full ${i === detailOrder.timeline.length - 1 ? 'bg-[#e94560]' : 'bg-[var(--border-color)]'}`} />
                          {i < detailOrder.timeline.length - 1 && <div className="w-px flex-1 bg-[var(--border-color)]" />}
                        </div>
                        <div className="pb-3">
                          <p className={`text-sm ${textPri} capitalize`}>{tl.status}</p>
                          <p className={`text-xs ${textMuted}`}>{tl.note}</p>
                          <p className={`text-[10px] ${textMuted}`}>{formatDate(tl.timestamp)} • {tl.updated_by}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Soft cancel / reopen (admin + accounts) — reversible, keeps the order */}
              {canCancelOrder && (isCancelled || cancellable) && (
                <div className="flex justify-end border-t border-[var(--border-color)] pt-3">
                  {isCancelled ? (
                    <Button variant="outline" disabled={busy} onClick={handleReopen}
                      className="border-[var(--border-color)] text-green-500">
                      <RotateCcw className="mr-1.5 h-4 w-4" /> Re-open order
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={busy} onClick={handleCancel}
                      className="border-[var(--border-color)] text-amber-500">
                      <Ban className="mr-1.5 h-4 w-4" /> Cancel (not finalising)
                    </Button>
                  )}
                </div>
              )}

              {/* Owner-only: permanently delete this order (info@smartshape.in) */}
              {isOwner && (
                <div className="flex justify-end border-t border-[var(--border-color)] pt-3">
                  <OwnerDeleteButton
                    kind="order"
                    id={detailOrder.order_id}
                    name={detailOrder.order_number}
                    label="Delete order"
                    onDeleted={onDeleted}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
