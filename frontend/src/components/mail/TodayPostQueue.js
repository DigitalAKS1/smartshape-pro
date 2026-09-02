import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailRuns } from '../../lib/api';
import { Printer, AlertTriangle, PackageCheck } from 'lucide-react';
import { useDataSync } from '../../lib/dataSync';

/**
 * The posting job for today, across every run — a drip mailer and a manual run are
 * the same task to whoever carries the bundle to the counter. Overdue pieces from
 * earlier days come along and sort first, so slipped work can't quietly disappear.
 */
export default function TodayPostQueue({ onOpenRun }) {
  const [q, setQ] = useState({ total: 0, overdue: 0, groups: [] });
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try { const r = await mailRuns.todayQueue(); setQ(r.data || { total: 0, overdue: 0, groups: [] }); }
    catch { /* the page already surfaces load errors */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useDataSync('mail', load);

  const printAll = async () => {
    setPrinting(true);
    try {
      const res = await mailRuns.queueStickers({ skip_incomplete: '1' });
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, '_blank');
      if (!w) {
        // Popup blocked → download instead. The anchor must be in the DOM or
        // Firefox/Safari silently ignore the click.
        const a = document.createElement('a');
        a.href = url; a.download = `post-${q.date}.pdf`; a.rel = 'noopener'; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      load();
    } catch { toast.error('Could not build the print batch'); }
    finally { setPrinting(false); }
  };

  if (!q.total) return null;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 border-l-4"
      style={{ borderLeftColor: q.overdue ? '#C4402E' : '#e94560' }} data-testid="today-post-queue">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-[#e94560]" /> To post today
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            <b className="text-[var(--text-secondary)]">{q.total}</b> piece{q.total !== 1 ? 's' : ''} across {q.groups.length} run{q.groups.length !== 1 ? 's' : ''}
            {q.overdue > 0 && <span className="text-[#C4402E] font-semibold"> · {q.overdue} overdue from earlier</span>}
          </p>
        </div>
        <button onClick={printAll} disabled={printing} data-testid="print-all-queue"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50">
          <Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print all stickers'}
        </button>
      </div>
      <div className="grid gap-2">
        {q.groups.map(g => (
          <button key={g.run_id} onClick={() => onOpenRun(g.run_id, g.run_name)} data-testid={`queue-run-${g.run_id}`}
            className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-left hover:border-[#e94560]">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {g.run_name}
                {g.is_drip_run && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560]">Drip</span>}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] capitalize">
                {g.piece_type}{g.sequence_name ? ` · ${g.sequence_name}` : ''}
              </p>
            </div>
            <span className="flex items-center gap-2 flex-shrink-0 text-[12px] font-mono">
              {g.overdue > 0 && (
                <span className="inline-flex items-center gap-1 text-[#C4402E] font-semibold" title="Planned on an earlier date and still not posted">
                  <AlertTriangle className="h-3.5 w-3.5" /> {g.overdue}
                </span>
              )}
              <b className="text-[var(--text-primary)]">{g.count}</b>
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-3">
        Print the batch, post them, then open a run and use <b>Verify &amp; post</b> to record what actually went out.
      </p>
    </div>
  );
}
