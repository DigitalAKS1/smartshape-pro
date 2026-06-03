import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Package } from 'lucide-react';
import { ORDER_STATUSES } from '../../lib/ordersUtils';

/**
 * Order detail dialog — shows items, payment info, and timeline.
 */
export default function OrderDetailPanel({ detailOrder, detailOpen, setDetailOpen, textPri, textSec, textMuted, dlgCls }) {
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
                <h3 className={`text-sm font-medium ${textPri} mb-2`}>Order Items</h3>
                <div className="space-y-2">
                  {(detailOrder.items || []).map(item => (
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
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        item.status === 'on_hold'    ? 'bg-orange-500/20 text-orange-400' :
                        item.status === 'confirmed'  ? 'bg-blue-500/20 text-blue-400' :
                        item.status === 'dispatched' ? 'bg-purple-500/20 text-purple-400' :
                        item.status === 'delivered'  ? 'bg-green-500/20 text-green-400' :
                        item.status === 'released'   ? 'bg-gray-500/20 text-gray-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{item.status?.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>

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
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
