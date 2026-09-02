import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { mailRuns } from '../../lib/api';
import { Check, X, Undo2, CalendarClock } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);

const PILL = {
  sent:     { label: 'Sent',     cls: 'bg-[#2E7D5B]/10 text-[#2E7D5B] border-[#2E7D5B]/30' },
  not_sent: { label: 'Not sent', cls: 'bg-[#C4402E]/10 text-[#C4402E] border-[#C4402E]/30' },
  skipped:  { label: 'Skipped',  cls: 'bg-[var(--bg-primary)] text-[var(--text-muted)] border-[var(--border-color)]' },
  pending:  { label: 'Pending',  cls: 'bg-[#9A6A15]/10 text-[#9A6A15] border-[#9A6A15]/30' },
};

/**
 * End-of-day truth: which of these pieces actually went into the post.
 * Anything still unresolved can be moved to a new date in one action — the drip
 * sequence behind it keeps its own schedule either way.
 */
export default function VerifyPostTable({ runId, rows, onChanged }) {
  const [sel, setSel] = useState({});           // { touch_id: true }
  const [reasons, setReasons] = useState({});   // { touch_id: string }
  const [date, setDate] = useState(today());
  const [moveDate, setMoveDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => rows.filter(r => r.verify_status === 'pending'), [rows]);
  const sentCount = rows.filter(r => r.verify_status === 'sent').length;
  const selected = Object.keys(sel).filter(k => sel[k]);
  const allPendingSelected = pending.length > 0 && pending.every(r => sel[r.touch_id]);

  const toggle = (id) => setSel(s => ({ ...s, [id]: !s[id] }));
  const selectAllPending = () => setSel(allPendingSelected ? {} : Object.fromEntries(pending.map(r => [r.touch_id, true])));

  const mark = async (status) => {
    if (!selected.length) { toast('Select the rows first'); return; }
    setBusy(true);
    try {
      await mailRuns.verify(runId, {
        posted_date: date,
        rows: selected.map(id => ({ touch_id: id, verify_status: status, reason: reasons[id] || '' })),
      });
      toast.success(`${selected.length} marked ${status === 'sent' ? 'sent' : 'not sent'}`);
      setSel({});
      onChanged();
    } catch { toast.error('Could not save'); }
    finally { setBusy(false); }
  };

  const undo = async (touchId) => {
    setBusy(true);
    try { await mailRuns.undoVerify(runId, [touchId]); onChanged(); }
    catch { toast.error('Undo failed'); }
    finally { setBusy(false); }
  };

  const moveRemaining = async () => {
    if (!pending.length) { toast('Nothing left to move'); return; }
    if (!window.confirm(`Move ${pending.length} unposted piece(s) to ${moveDate}?`)) return;
    setBusy(true);
    try {
      const r = await mailRuns.replan(runId, { select_pending: true, new_date: moveDate });
      toast.success(`${r.data.moved} moved to ${moveDate}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not re-plan'); }
    finally { setBusy(false); }
  };

  const cell = 'h-8 rounded-md px-2 text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-color)] text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] disabled:opacity-50';

  return (
    <div data-testid="verify-post-table">
      <table className="w-full text-sm border-separate border-spacing-y-1.5">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
            <th className="pr-2 w-8">
              <input type="checkbox" className="accent-[#e94560]" checked={allPendingSelected}
                onChange={selectAllPending} title="Select all pending" data-testid="select-all-pending" />
            </th>
            <th className="pr-2">School</th>
            <th className="pr-2 w-[12%]">Planned</th>
            <th className="pr-2 w-[12%]">Posted</th>
            <th className="pr-2 w-[14%]">Status</th>
            <th className="pr-2 w-[24%]">If not sent — why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const p = PILL[r.verify_status] || PILL.pending;
            const isPending = r.verify_status === 'pending';
            return (
              <tr key={r.touch_id} data-testid={`verify-row-${r.touch_id}`}>
                <td className="pr-2 align-middle">
                  <input type="checkbox" className="accent-[#e94560]" checked={!!sel[r.touch_id]}
                    onChange={() => toggle(r.touch_id)} disabled={!isPending} />
                </td>
                <td className="pr-2 align-middle">
                  <div className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">{r.school_name}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {r.printed_at ? 'sticker printed' : 'not printed yet'}
                    {r.replan_count > 0 ? ` · moved ${r.replan_count}×` : ''}
                  </div>
                </td>
                <td className="pr-2 align-middle text-[12px] font-mono text-[var(--text-secondary)]">{r.planned_date || '—'}</td>
                <td className="pr-2 align-middle text-[12px] font-mono text-[var(--text-secondary)]">{(r.posted_at || '').slice(0, 10) || '—'}</td>
                <td className="pr-2 align-middle">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${p.cls}`}>{p.label}</span>
                  {!isPending && (
                    <button onClick={() => undo(r.touch_id)} disabled={busy} title="Undo this"
                      className="ml-1.5 text-[var(--text-muted)] hover:text-[#e94560] align-middle">
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
                <td className="pr-2 align-middle">
                  {isPending ? (
                    <input className={cell + ' w-full'} placeholder="e.g. address missing, no stock"
                      value={reasons[r.touch_id] || ''}
                      onChange={e => setReasons(x => ({ ...x, [r.touch_id]: e.target.value }))} />
                  ) : (
                    <span className="text-[12px] text-[var(--text-muted)]">{r.reason || '—'}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan="6" className="py-10 text-center text-[var(--text-muted)]">No schools in this run.</td></tr>}
        </tbody>
      </table>

      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-card)]">
        <span className="text-xs text-[var(--text-muted)] mr-auto" data-testid="verify-summary">
          <b className="text-[var(--text-primary)]">{sentCount}</b> of {rows.length} verified sent
          {pending.length > 0 ? ` · ${pending.length} pending` : ''}
          {selected.length > 0 ? ` · ${selected.length} selected` : ''}
        </span>
        <label className="text-[11px] text-[var(--text-muted)]">Posted on</label>
        <input type="date" className={cell} value={date} onChange={e => setDate(e.target.value)} data-testid="posted-date" />
        <button className={btn} disabled={busy || !selected.length} onClick={() => mark('sent')} data-testid="mark-sent">
          <Check className="h-3.5 w-3.5" /> Mark selected sent
        </button>
        <button className={btn} disabled={busy || !selected.length} onClick={() => mark('not_sent')} data-testid="mark-not-sent">
          <X className="h-3.5 w-3.5" /> Not sent
        </button>
        <span className="w-px h-6 bg-[var(--border-color)] mx-1" />
        <input type="date" className={cell} value={moveDate} onChange={e => setMoveDate(e.target.value)} data-testid="move-date" />
        <button className={btn} disabled={busy || !pending.length} onClick={moveRemaining} data-testid="move-remaining">
          <CalendarClock className="h-3.5 w-3.5" /> Move remaining ({pending.length})
        </button>
      </div>
    </div>
  );
}
