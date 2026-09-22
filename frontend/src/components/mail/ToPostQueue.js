import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Printer, Undo2, MapPinOff, Search } from 'lucide-react';
import { mailRuns } from '../../lib/api';
import { useDataSync } from '../../lib/dataSync';
import { useTheme } from '../../contexts/ThemeContext';
import useBulkSelect from '../../hooks/useBulkSelect';

/**
 * D5: ONE cross-run list of everything owed to the post office, and one tick.
 *
 * A tick here is exactly the same verification path the per-run Verify tab
 * uses (`_do_verify`) — the queue just hands the server the touch ids it chose
 * and the server groups them by the run each one really belongs to, so a
 * selection spanning three runs is still a single request that either applies
 * or doesn't. A mailer that came out of a drip and one from a manual run are
 * the same job to whoever carries the bundle to the counter, so they sit in
 * one list.
 *
 * `needs_address` (D2) rows are pieces with nobody to address them to: they
 * are shown flagged rather than hidden, and the badge opens the school (or the
 * contact) so the gap can be filled — the next executor pass moves the row
 * back to `pending` by itself.
 */
const CHIPS = [
  ['', 'To post'],
  ['pending', 'Pending'],
  ['needs_address', 'Needs address'],
  ['overdue', 'Overdue'],
  ['sent', 'Sent'],
  ['not_sent', 'Not sent'],
];

const today = () => new Date().toISOString().slice(0, 10);

export default function ToPostQueue({ onOpenSchool }) {
  const { isDark } = useTheme();
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [owner, setOwner] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [postedDate, setPostedDate] = useState(today());
  const [reason, setReason] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mailRuns.toPost({
        status, sequence_id: sequenceId, owner, from, to, q: debouncedQ,
      });
      setRows(r.data?.rows || []);
      setTotals(r.data?.totals || {});
    } catch { toast.error('Could not load the posting queue'); }
    finally { setLoading(false); }
  }, [status, sequenceId, owner, from, to, debouncedQ]);
  useEffect(() => { load(); }, [load]);
  useDataSync('mail', load);

  const sel = useBulkSelect(rows, (r) => r.touch_id, rows);

  // Every distinct sequence / owner currently in the queue, for the filters.
  // A filter that is already applied keeps its own option, so choosing
  // "Principal Pitch" can't empty the very list the option came from.
  const sequences = useMemo(() => {
    const m = new Map();
    rows.forEach(r => { if (r.sequence_id) m.set(r.sequence_id, r.sequence_name || r.sequence_id); });
    if (sequenceId && !m.has(sequenceId)) m.set(sequenceId, sequenceId);
    return Array.from(m, ([v, label]) => ({ v, label }));
  }, [rows, sequenceId]);
  const owners = useMemo(() => {
    const s = new Set(rows.map(r => r.owner).filter(Boolean));
    if (owner) s.add(owner);
    return Array.from(s);
  }, [rows, owner]);

  const apply = async (verify_status) => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the envelopes you posted first'); return; }
    setBusy(true);
    try {
      // ONE call: the server groups these by run and walks _do_verify per run.
      await mailRuns.verifyTouches(ids.map(touch_id => ({
        touch_id, verify_status,
        ...(verify_status === 'not_sent' ? { reason: reason.trim() } : {}),
      })), postedDate);
      toast.success(`${ids.length} piece${ids.length === 1 ? '' : 's'} marked `
        + (verify_status === 'sent' ? 'posted' : 'not posted'));
      sel.clear();
      setReason('');
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not record that'); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the rows to undo first'); return; }
    setBusy(true);
    try {
      await mailRuns.undoTouches(ids);
      toast.success('Reverted to pending');
      sel.clear();
      await load();
    } catch { toast.error('Undo failed'); }
    finally { setBusy(false); }
  };

  const printStickers = async () => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the envelopes to print first'); return; }
    try {
      // One print for the whole selection, across runs — and never a label for
      // a piece with no address on it.
      const r = await mailRuns.queueStickers({ touch_ids: ids.join(','), skip_incomplete: '1' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `stickers-${today()}.pdf`; a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);   // must be in the DOM to download in Firefox/Safari
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error('Could not print stickers'); }
  };

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const inp = `h-9 rounded-lg px-2.5 text-[13px] ${inputCls}`;
  const actBtn = `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border border-[var(--border-color)] ${textSec} hover:text-[#e94560] hover:border-[#e94560] disabled:opacity-50`;

  const recipients = (r) => (r.recipient_names || []).join(', ')
    || (r.school_name ? 'The Principal' : '—');

  // `prefix` keeps the mobile card's copy of the badge from colliding with the
  // table's on the same data-testid (both layouts render every row).
  const needsAddressBadge = (r, prefix = 'to-post-needs-address') => (
    <button onClick={() => onOpenSchool && onOpenSchool(r.school_id, r.contact_ids)}
      data-testid={`${prefix}-${r.touch_id}`}
      title="No address yet — open the school or contact and add one"
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#9A6A15]/15 text-[#9A6A15]">
      <MapPinOff className="h-3 w-3" /> Needs address
    </button>
  );

  return (
    <div className={`${card} border rounded-xl p-5`} data-testid="to-post-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className={`text-lg font-medium ${textPri}`}>To post</h2>
        <span className={`text-[11px] font-mono ${textMuted}`} data-testid="to-post-summary">
          {totals.overdue ? `${totals.overdue} overdue · ` : ''}{totals.shown ?? 0} shown
          {totals.capped ? ' (capped at 2,000 — narrow the filters)' : ''}
        </span>
      </div>
      <p className={`text-xs ${textMuted} mb-3`}>
        Everything owed to the post office, across every run and every drip. One tick covers one
        envelope — if several people at a school are in the same plan, they share it.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {CHIPS.map(([v, label]) => (
          <button key={v || 'all'} onClick={() => setStatus(v)} data-testid={`to-post-chip-${v || 'all'}`}
            className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${
              status === v ? 'bg-[#e94560] text-white border-[#e94560]'
                : `border-[var(--border-color)] ${textSec} hover:text-[#e94560]`}`}>
            {label}{v && totals[v] != null ? ` · ${totals[v]}` : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className={inp} value={sequenceId} onChange={e => setSequenceId(e.target.value)}
          data-testid="to-post-filter-sequence" aria-label="Sequence">
          <option value="">All sequences</option>
          {sequences.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select className={inp} value={owner} onChange={e => setOwner(e.target.value)}
          data-testid="to-post-filter-owner" aria-label="Owner">
          <option value="">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)}
          data-testid="to-post-from" aria-label="Due from" />
        <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)}
          data-testid="to-post-to" aria-label="Due to" />
        <div className="relative flex-1 min-w-[160px]">
          <Search className={`h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${textMuted}`} />
          <input className={`${inp} w-full pl-8`} placeholder="School, person, item…"
            value={q} onChange={e => setQ(e.target.value)} data-testid="to-post-search"
            aria-label="Search the posting queue" />
        </div>
      </div>

      {sel.count > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 p-2.5 mb-2 rounded-lg bg-[var(--bg-primary)] border border-[#e94560]/40"
          data-testid="to-post-bar">
          <span className={`text-[12px] font-semibold ${textPri}`} data-testid="to-post-count">
            {sel.count} selected{sel.hiddenCount ? ` (${sel.hiddenCount} hidden by filter)` : ''}
          </span>
          <button className={`text-[11px] ${textMuted} hover:text-[#e94560]`} onClick={sel.clear}
            data-testid="to-post-clear">Clear</button>
          <input type="date" className={inp} value={postedDate} data-testid="to-post-posted-date"
            onChange={e => setPostedDate(e.target.value)} aria-label="Posted on" />
          <button className={actBtn} disabled={busy} onClick={() => apply('sent')}
            data-testid="to-post-mark-posted">Mark posted</button>
          <input className={`${inp} w-44`} placeholder="Reason (if not posted)" value={reason}
            onChange={e => setReason(e.target.value)} data-testid="to-post-reason"
            aria-label="Reason it was not posted" />
          <button className={actBtn} disabled={busy} onClick={() => apply('not_sent')}
            data-testid="to-post-not-posted">Not posted</button>
          <button className={actBtn} disabled={busy} onClick={undo} data-testid="to-post-undo">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button className={actBtn} onClick={printStickers} data-testid="to-post-print-stickers">
            <Printer className="h-3.5 w-3.5" /> Print stickers for selected
          </button>
        </div>
      )}

      {loading ? (
        <p className={`py-10 text-center text-sm ${textMuted}`} data-testid="to-post-loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className={`py-10 text-center text-sm ${textMuted}`} data-testid="to-post-empty">
          Nothing is waiting for the post office.
        </p>
      ) : (
        <>
          {/* Mobile: the same checkbox, as cards */}
          <div className="sm:hidden grid gap-2">
            {rows.map(r => (
              <div key={r.touch_id} data-testid={`to-post-card-${r.touch_id}`}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 accent-[#e94560]" checked={sel.isSelected(r.touch_id)}
                    onChange={() => sel.toggle(r.touch_id)}
                    data-testid={`to-post-mcheck-${r.touch_id}`}
                    aria-label={`Select ${r.school_name || recipients(r)}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${textPri} truncate`}>
                      {r.school_name || recipients(r)}
                    </p>
                    <p className={`text-[11px] ${textSec} truncate`}>{recipients(r)}</p>
                    <p className={`text-[11px] ${textMuted}`}>
                      {r.item_name} · {r.sequence_name || r.run_name} · due {r.planned_date || '—'}
                      {r.overdue_days ? ` · ${r.overdue_days}d late` : ''}
                    </p>
                    {r.verify_status === 'needs_address' && (
                      <div className="mt-1">{needsAddressBadge(r, 'to-post-mneeds-address')}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wide ${textMuted} text-left`}>
                  <th className="py-2 pr-2 w-8">
                    <input type="checkbox" className="accent-[#e94560]" checked={sel.allSelected}
                      onChange={sel.toggleAll} data-testid="to-post-check-all" aria-label="Select all" />
                  </th>
                  <th className="py-2 pr-3">School</th><th className="py-2 pr-3">Recipients</th>
                  <th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Sequence</th>
                  <th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.touch_id} data-testid={`to-post-row-${r.touch_id}`}
                    className="border-t border-[var(--border-color)]">
                    <td className="py-2 pr-2">
                      <input type="checkbox" className="accent-[#e94560]" checked={sel.isSelected(r.touch_id)}
                        onChange={(e) => sel.toggle(r.touch_id, { shift: e.nativeEvent?.shiftKey })}
                        data-testid={`to-post-check-${r.touch_id}`}
                        aria-label={`Select ${r.school_name || recipients(r)}`} />
                    </td>
                    <td className={`py-2 pr-3 ${textPri} font-medium`}>
                      {r.school_id ? (
                        <button onClick={() => onOpenSchool && onOpenSchool(r.school_id)}
                          className="hover:text-[#e94560] hover:underline text-left"
                          data-testid={`to-post-school-${r.touch_id}`}>
                          {r.school_name || r.school_id}
                        </button>
                      ) : <span className={textMuted}>(no school)</span>}
                      {!r.address_ok && r.school_id && (
                        <span className="ml-1.5 text-[10px] text-[#9A6A15]">no address</span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${textSec}`}>{recipients(r)}</td>
                    <td className={`py-2 pr-3 ${textSec}`}>{r.item_name}</td>
                    <td className={`py-2 pr-3 ${textSec}`}>{r.sequence_name || r.run_name}</td>
                    <td className={`py-2 pr-3 font-mono ${textSec}`}>
                      {r.planned_date || '—'}
                      {r.overdue_days ? <span className="text-[#C4402E]"> +{r.overdue_days}d</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {r.verify_status === 'needs_address' ? needsAddressBadge(r) : (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-[#e94560]/10 ${textSec} capitalize`}>
                          {(r.verify_status || '').replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${textMuted} text-[11px]`}>{r.owner || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
