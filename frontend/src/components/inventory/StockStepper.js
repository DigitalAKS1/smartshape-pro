import React, { useState } from 'react';
import { Minus, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { stock as stockApi } from '../../lib/api';

export const REDUCE_REASONS = ['Damaged', 'Sample given', 'Used for demo', 'Count correction', 'Other'];

/**
 * Store page inline stock change: [−] [n] [+].
 * + applies at once; − asks for a reason first (it's a loss, so it must say why).
 * Calls onChanged({stock_qty, reserved_qty}) with the server's numbers.
 */
export default function StockStepper({ die, onChanged }) {
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(REDUCE_REASONS[0]);

  const n = Math.max(1, Math.min(1000, parseInt(amount, 10) || 1));

  const apply = async (delta, why) => {
    setBusy(true);
    try {
      const r = await stockApi.quickAdjust({ die_id: die.die_id, delta, reason: why || '' });
      onChanged(r.data);
      toast.success(`${die.code}: ${delta > 0 ? '+' : ''}${delta} → ${r.data.stock_qty} in stock`);
      if (r.data.below_reserved) toast.warning(`${die.code}: stock is now below what's reserved for orders`);
      setAsking(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not change stock');
    } finally { setBusy(false); }
  };

  const btn = 'h-7 w-7 flex items-center justify-center rounded border border-[var(--border-color)] disabled:opacity-40';

  if (asking) {
    return (
      <div className="flex items-center justify-end gap-1" data-testid={`stepper-reason-${die.code}`}>
        <span className="text-xs text-red-400 font-mono">−{n}</span>
        <select value={reason} onChange={e => setReason(e.target.value)}
          className="h-7 px-1 rounded text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
          {REDUCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className={`${btn} text-green-500`} disabled={busy} onClick={() => apply(-n, reason)} title="Confirm" data-testid={`stepper-confirm-${die.code}`}>
          <Check className="h-3.5 w-3.5" />
        </button>
        <button className={`${btn} text-[var(--text-muted)]`} disabled={busy} onClick={() => setAsking(false)} title="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1" data-testid={`stepper-${die.code}`}>
      <button className={`${btn} text-red-400 hover:bg-red-500/10`} disabled={busy || (die.stock_qty || 0) < 1}
        onClick={() => setAsking(true)} title={`Remove ${n}`} aria-label={`Remove ${n} from ${die.code}`} data-testid={`stepper-minus-${die.code}`}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input type="number" min="1" max="1000" value={amount} onChange={e => setAmount(e.target.value)}
        className="h-7 w-12 text-center rounded text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]"
        aria-label="Amount" />
      <button className={`${btn} text-green-500 hover:bg-green-500/10`} disabled={busy}
        onClick={() => apply(n)} title={`Add ${n}`} aria-label={`Add ${n} to ${die.code}`} data-testid={`stepper-plus-${die.code}`}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
