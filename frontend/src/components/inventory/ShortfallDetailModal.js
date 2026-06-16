import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { ImageOff, Package } from 'lucide-react';
import { procurement } from '../../lib/api';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';
export const imgSrc = (u) => (u ? (u.startsWith('http') ? u : `${BACKEND}${u}`) : '');

const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

/** Shared product thumbnail used across procurement/store/holds. */
export function ProductThumb({ url, size = 40 }) {
  if (!url) return (
    <div className="flex items-center justify-center rounded bg-[var(--bg-primary)] border border-[var(--border-color)] shrink-0"
      style={{ width: size, height: size }}><ImageOff className="h-4 w-4 text-[var(--text-muted)]" /></div>
  );
  return <img src={imgSrc(url)} alt="" className="rounded object-cover border border-[var(--border-color)] shrink-0"
    style={{ width: size, height: size }} />;
}

function Stat({ label, value, color }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2.5 text-center">
      <p className={`text-[10px] uppercase ${textMuted}`}>{label}</p>
      <p className={`font-mono font-bold text-lg ${color || textPri}`}>{value}</p>
    </div>
  );
}

/**
 * ShortfallDetailModal — "why is this short?" drill-down for one die. Shows the
 * stock summary in plain terms plus which schools/orders are demanding it.
 */
export default function ShortfallDetailModal({ dieId, open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !dieId) return;
    setLoading(true); setData(null);
    procurement.demandDetail(dieId)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, dieId]);

  const overCommitted = data && data.available_qty < 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className={`${textPri} flex items-center gap-2`}>
            <Package className="h-4 w-4 text-[#e94560]" /> Why is this short?
          </DialogTitle>
        </DialogHeader>

        {loading && <p className={`py-8 text-center ${textMuted}`}>Loading…</p>}

        {data && (
          <div className="overflow-y-auto flex-1 space-y-4">
            {/* Header: image + name */}
            <div className="flex items-center gap-3">
              <ProductThumb url={data.image_url} size={48} />
              <div className="min-w-0">
                <p className={`font-semibold ${textPri} truncate`}>{data.name}</p>
                <p className={`text-xs font-mono ${textMuted}`}>{data.code || '—'}</p>
              </div>
            </div>

            {/* Stock summary in plain terms */}
            <div className="grid grid-cols-5 gap-2">
              <Stat label="Physical" value={data.physical_qty} />
              <Stat label="Reserved" value={data.reserved_qty} color="text-blue-400" />
              <Stat label="Available" value={data.available_qty} color={overCommitted ? 'text-red-500' : textPri} />
              <Stat label="Required" value={data.required_qty} />
              <Stat label="Shortfall" value={data.shortfall_qty} color={data.shortfall_qty > 0 ? 'text-amber-400' : 'text-emerald-400'} />
            </div>

            {/* Plain-language explanation */}
            <p className={`text-xs ${textSec} bg-[var(--bg-primary)] rounded-lg p-3 leading-relaxed`}>
              You have <b>{data.physical_qty}</b> on the shelf.{' '}
              {overCommitted
                ? <>But <b>{data.reserved_qty}</b> are already promised to orders — that's <b className="text-red-500">{Math.abs(data.available_qty)} more than you have</b>.</>
                : <><b>{data.reserved_qty}</b> are reserved, leaving <b>{data.available_qty}</b> free.</>}{' '}
              Open sales orders need <b>{data.required_qty}</b> in total, so to cover everything you should buy <b className="text-amber-400">{data.shortfall_qty}</b>.
            </p>

            {/* Per-school breakdown */}
            <div>
              <p className={`text-xs uppercase ${textMuted} mb-2`}>Who needs it</p>
              {(data.schools || []).length === 0 ? (
                <p className={`text-sm ${textMuted}`}>No open sales orders need this item.</p>
              ) : (
                <div className="space-y-2">
                  {data.schools.map((s, i) => (
                    <div key={i} className="rounded-lg border border-[var(--border-color)] p-2.5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${textPri}`}>{s.school_name}</span>
                        <span className={`text-sm font-mono font-bold ${textPri}`}>
                          {s.total_qty} <span className={`text-[10px] font-normal ${textMuted}`}>across {s.order_count} order{s.order_count !== 1 ? 's' : ''}</span>
                        </span>
                      </div>
                      <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] ${textMuted}`}>
                        {s.orders.map((o, j) => (
                          <span key={j} className="font-mono">{o.order_number || o.order_id} · {o.quantity}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter><Button onClick={onClose} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
