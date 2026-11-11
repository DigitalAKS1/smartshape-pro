import React from 'react';
import { History, Package, Cog } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Shown when a quotation is started for a school that has bought before (app
 * orders + old orders). It tells the rep what the school already owns so the
 * new quote offers NEW dies instead of repeats.
 */
export default function AlreadyBoughtDialog({ data, onClose }) {
  if (!data) return null;
  const machines = data.items.filter(i => i.item_type === 'machine');
  const dies = data.items.filter(i => i.item_type !== 'machine');
  return (
    <Dialog open={!!data} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-lg max-h-[85dvh] overflow-y-auto" data-testid="already-bought-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-amber-500" /> {data.schoolName} has bought before</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[var(--text-secondary)] -mt-1">
          {data.orderCount} earlier order{data.orderCount !== 1 ? 's' : ''}
          {data.lastDate ? `, last on ${fmtDate(data.lastDate)}` : ''}. Offer dies they don't have yet.
        </p>

        {machines.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Machines</p>
            <div className="flex flex-wrap gap-1.5">
              {machines.map(i => (
                <span key={i.key} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[var(--border-color)]">
                  <Cog className="h-3 w-3 text-[#e94560]" /> {i.name} ×{i.total_qty}
                </span>
              ))}
            </div>
          </div>
        )}

        {dies.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Dies already with them · {dies.length}</p>
            <div className="max-h-64 overflow-y-auto rounded border border-[var(--border-color)] divide-y divide-[var(--border-color)]">
              {dies.map(i => (
                <div key={i.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Package className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                  {i.die_code && <span className="font-mono text-xs text-[#e94560]">{i.die_code}</span>}
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">×{i.total_qty} · {fmtDate(i.last_date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="already-bought-ok">Got it — continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
