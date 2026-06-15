import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export default function StockMovementDialog({
  open, onOpenChange,
  stockAdjTarget, stockAdjType, stockAfter,
  stockAdjQty, setStockAdjQty,
  stockAdjNote, setStockAdjNote,
  handleStockAdj,
  inputCls, textPri, textSec, textMuted, dlgCls,
}) {
  const isPhysical = stockAdjType === 'physical_set';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-sm`}>
        <DialogHeader>
          <DialogTitle className={`${textPri} flex items-center gap-2`}>
            {isPhysical
              ? <ClipboardCheck className="h-5 w-5 text-[#e94560]" />
              : stockAdjType === 'stock_in'
                ? <TrendingUp className="h-5 w-5 text-green-500" />
                : <TrendingDown className="h-5 w-5 text-red-400" />}
            {isPhysical ? 'Set Physical Count' : stockAdjType === 'stock_in' ? 'Stock In' : 'Stock Out'}
          </DialogTitle>
          <p className={`text-sm ${textSec} truncate`}>{stockAdjTarget?.name}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Before / After */}
          <div className="grid grid-cols-2 gap-2">
            <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-center`}>
              <p className={`text-xs ${textMuted} mb-0.5`}>Current</p>
              <p className={`font-mono font-bold text-2xl ${textPri}`}>{stockAdjTarget?.stock_qty ?? 0}</p>
            </div>
            <div className={`rounded-lg p-3 text-center border ${
              stockAfter === 0 ? 'bg-red-500/10 border-red-500/30'
              : stockAfter <= (stockAdjTarget?.min_level || 0) ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-green-500/10 border-green-500/30'
            }`}>
              <p className={`text-xs ${textMuted} mb-0.5`}>After</p>
              <p className={`font-mono font-bold text-2xl ${
                stockAfter === 0 ? 'text-red-500'
                : stockAfter <= (stockAdjTarget?.min_level || 0) ? 'text-yellow-500'
                : 'text-green-500'
              }`}>{stockAfter}</p>
            </div>
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>
              {isPhysical ? 'Counted physical quantity *' : 'Quantity *'}
            </Label>
            <Input type="number" min={isPhysical ? 0 : 1} value={stockAdjQty} onChange={e => setStockAdjQty(e.target.value)}
              className={`h-12 text-center text-lg font-mono ${inputCls}`} autoFocus />
            {isPhysical && (
              <p className={`text-[11px] ${textMuted} mt-1`}>
                Sets the system stock to this exact number and re-syncs reserved/available.
              </p>
            )}
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Note (optional)</Label>
            <Input value={stockAdjNote} onChange={e => setStockAdjNote(e.target.value)}
              className={`h-11 ${inputCls}`} placeholder="Purchase order ref, reason…" />
          </div>
          {stockAdjType === 'stock_out' && stockAdjTarget && Number(stockAdjQty) > stockAdjTarget.stock_qty && (
            <p className="text-xs text-yellow-500 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />Quantity exceeds current stock
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className={`flex-1 h-11 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={handleStockAdj}
            className={`flex-1 h-11 text-white font-medium ${
              isPhysical ? 'bg-[#e94560] hover:bg-[#f05c75]'
              : stockAdjType === 'stock_in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
            {isPhysical ? 'Save Count' : stockAdjType === 'stock_in' ? 'Add Stock' : 'Remove Stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
