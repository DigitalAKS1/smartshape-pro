import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { reports } from '../../lib/api';
import { Send, Download, RefreshCw } from 'lucide-react';

// D6: the three roll-ups are the SAME query grouped differently, so the toggle
// changes one parameter and nothing else. "Sent" for post means verified sent —
// a piece the drip queued but nobody posted shows as pending, deliberately.
const MODES = [['school', 'School'], ['contact', 'Contact'], ['sequence', 'Sequence']];
const CHANNELS = [['', 'All channels'], ['whatsapp', 'WhatsApp'], ['email', 'Email'],
                  ['call', 'Call'], ['post', 'Post']];

export default function MarketingSentReport() {
  const [groupBy, setGroupBy] = useState('school');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [channel, setChannel] = useState('');
  const [data, setData] = useState({ rows: [], totals: {} });
  const [loading, setLoading] = useState(true);

  const params = useCallback(
    () => ({ group_by: groupBy, from, to, owner, channel }),
    [groupBy, from, to, owner, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await reports.marketingSent({ group_by: groupBy, from, to, owner, channel });
      setData(r.data || { rows: [], totals: {} });
    } catch { toast.error('Could not load the report'); }
    finally { setLoading(false); }
  }, [groupBy, from, to, owner, channel]);
  useEffect(() => { load(); }, [load]);

  // The owner list comes from the rows on screen: a rep only ever sees her own
  // name here, which is exactly the scoping the server already applied.
  const owners = Array.from(new Set((data.rows || []).map(r => r.owner).filter(Boolean)));

  const exportCsv = async () => {
    try {
      const r = await reports.marketingSentCsv(params());
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `marketing-sent-${groupBy}.csv`; a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);   // must be in the DOM to download in Firefox/Safari
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error('Export failed'); }
  };

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const inp = 'h-9 rounded-lg px-2.5 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const t = data.totals || {};
  const ch = t.sent_by_channel || {};
  const po = t.post || {};

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
              <Send className="h-6 w-6 text-[#e94560]" /> Marketing sent
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Everyone we have actually reached, and by what. A posted piece only counts once
              someone has ticked it in <b>Offline Mail &rarr; To post</b>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={exportCsv} data-testid="ms-export"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-sm font-semibold">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={load} disabled={loading} aria-label="Refresh"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] text-sm font-semibold disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex items-center gap-1">
              {MODES.map(([k, label]) => (
                <button key={k} onClick={() => setGroupBy(k)} data-testid={`ms-tab-${k}`}
                  className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${
                    groupBy === k ? 'bg-[#e94560] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)}
              data-testid="ms-from" aria-label="From" />
            <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)}
              data-testid="ms-to" aria-label="To" />
            <select className={inp} value={owner} onChange={e => setOwner(e.target.value)}
              data-testid="ms-owner" aria-label="Owner">
              <option value="">All owners</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className={inp} value={channel} onChange={e => setChannel(e.target.value)}
              data-testid="ms-channel" aria-label="Channel">
              {CHANNELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap gap-3 mb-4 text-[11px] font-mono text-[var(--text-secondary)]"
            data-testid="ms-totals">
            <span>WhatsApp <b className="text-[var(--text-primary)]">{ch.whatsapp ?? 0}</b></span>
            <span>Email <b className="text-[var(--text-primary)]">{ch.email ?? 0}</b></span>
            <span>Call <b className="text-[var(--text-primary)]">{ch.call ?? 0}</b></span>
            <span>Post <b className="text-[var(--text-primary)]">{ch.post ?? 0}</b>
              {groupBy === 'contact' && t.post_envelopes != null && (
                <span className="text-[var(--text-muted)]">
                  {' '}(from {t.post_envelopes} envelope{t.post_envelopes === 1 ? '' : 's'})
                </span>
              )}
            </span>
            {groupBy === 'contact' ? (
              // Contact mode counts PEOPLE; say how many envelopes that is.
              <span className="text-[#9A6A15]" data-testid="ms-owed">
                people awaiting post <b>{(po.pending ?? 0) + (po.needs_address ?? 0)}</b>
                {' '}({t.pending_envelopes ?? 0} envelope{(t.pending_envelopes ?? 0) === 1 ? '' : 's'})
              </span>
            ) : (
              <span className="text-[#9A6A15]" data-testid="ms-owed">
                still to post <b>{(po.pending ?? 0) + (po.needs_address ?? 0)}</b>
              </span>
            )}
            {(po.closed_unposted ?? 0) > 0 && (
              <span className="text-[var(--text-muted)]" data-testid="ms-closed-unposted">
                closed, never posted <b>{po.closed_unposted}</b>
              </span>
            )}
            <span className="text-[#e94560]">responses <b>{(t.responses || {}).qr_scans ?? 0}</b></span>
          </div>

          {groupBy === 'contact' && (
            <p className="mb-3 text-[11px] text-[var(--text-muted)]" data-testid="ms-envelope-note">
              One envelope goes to a school and lists everyone on it, so here it counts for
              each person named: {t.post_envelopes ?? 0} envelope
              {(t.post_envelopes ?? 0) === 1 ? '' : 's'} reached {ch.post ?? 0} people.
            </p>
          )}
          {(from || to) && (
            <p className="mb-3 text-[11px] text-[var(--text-muted)]" data-testid="ms-window-note">
              Pending counts pieces <b>planned</b> in this window; sent counts pieces actually
              posted in it.
            </p>
          )}

          {t.capped && (
            <p className="mb-3 text-[11px] text-[#9A6A15]" data-testid="ms-cap-note">
              Showing the first {t.shown} of {t.rows} rows — narrow the dates, owner or
              channel. The totals above cover all {t.rows}, and Export gives you every row,
              not just the ones on screen.
            </p>
          )}
          {t.scan_capped && (
            <p className="mb-3 text-[11px] text-[#C4402E]" data-testid="ms-scan-cap-note">
              There were more deliveries than one report can read, so these numbers are a
              floor, not a total. Narrow the report to one sequence — the posted-mail scan
              is narrowed by sequence only, not by dates or owner.
            </p>
          )}

          {loading ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                    <th className="py-2 pr-3">{MODES.find(m => m[0] === groupBy)[1]}</th>
                    <th className="py-2 pr-3">Owner</th><th className="py-2 pr-3">Sequences</th>
                    <th className="py-2 pr-3">WA</th><th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Call</th><th className="py-2 pr-3">Post</th>
                    <th className="py-2 pr-3">Still to post</th>
                    <th className="py-2 pr-3">Last sent</th><th className="py-2 pr-3">Responses</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map(r => {
                    const owed = (r.post?.pending || 0) + (r.post?.needs_address || 0);
                    return (
                      <tr key={r.key} data-testid={`ms-row-${r.key}`}
                        className="border-t border-[var(--border-color)]">
                        <td className="py-2 pr-3 text-[var(--text-primary)] font-medium">{r.name}</td>
                        <td className="py-2 pr-3 text-[11px] text-[var(--text-muted)]">{r.owner || '—'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">
                          {(r.sequences || []).join(', ') || '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.whatsapp ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.email ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.call ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.post ?? 0}</td>
                        <td className="py-2 pr-3 font-mono" style={{ color: owed ? '#9A6A15' : 'inherit' }}>
                          {owed ? `${owed} pending` : '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">
                          {r.last_sent_at || '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[#e94560]">
                          {r.responses?.qr_scans ?? 0}
                          {r.responses?.interest ? ` (${r.responses.interest} interested)` : ''}
                        </td>
                      </tr>
                    );
                  })}
                  {(data.rows || []).length === 0 && (
                    <tr><td colSpan="10" className="py-10 text-center text-[var(--text-muted)]">
                      Nothing has gone out in this window yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
