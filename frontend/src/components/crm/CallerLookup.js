import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Phone, UserPlus, ArrowRightLeft, Eye, Hand } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { directory } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';

const OWNER_BADGE = {
  mine: { label: 'Yours', cls: 'bg-green-500/15 text-green-600' },
  unassigned: { label: 'Unassigned', cls: 'bg-gray-400/20 text-gray-500' },
  other: { label: 'Owned', cls: 'bg-amber-500/15 text-amber-600' },
};

/**
 * "A call just came in" — search the whole master directory by phone/name and act
 * on the match by its ownership:
 *   - unassigned → claim & create lead
 *   - mine       → create lead
 *   - other      → forward the call (notify the owner) + view the account
 *
 * onPrefillLead(result, { claimed }) opens the New Lead dialog pre-filled.
 */
export default function CallerLookup({ open, onClose, onPrefillLead, card, textPri, textSec, textMuted, inputCls }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const debRef = useRef(null);

  useEffect(() => {
    if (!open) { setQ(''); setRows([]); return; }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debRef.current) clearTimeout(debRef.current);
    if (q.trim().length < 2) { setRows([]); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await directory.search(q.trim());
        setRows(r.data || []);
      } catch { setRows([]); }
      finally { setLoading(false); }
    }, 300);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [q, open]);

  if (!open) return null;

  const claimAndCreate = async (r) => {
    setBusyId(r.ref_id);
    try {
      const body = r.kind === 'contact' && !r.school_id ? { contact_id: r.ref_id } : { school_id: r.school_id || r.ref_id };
      const res = await directory.claim(body);
      const moved = (res.data?.leads || 0) + (res.data?.contacts || 0);
      toast.success(`Claimed${moved ? ` — ${moved} record(s) moved to you` : ''}`);
      onPrefillLead(r, { claimed: true, claimedSchoolId: res.data?.school_id || r.school_id || r.ref_id });
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Claim failed'); }
    finally { setBusyId(''); }
  };

  const forward = async (r) => {
    setBusyId(r.ref_id);
    try {
      await directory.inboundCall({ kind: r.kind, ref_id: r.ref_id, school_id: r.school_id, caller_phone: q.trim() });
      toast.success(`${r.owner_name || 'The owner'} was notified — forward the call to them`);
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to notify owner'); }
    finally { setBusyId(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh]" onClick={onClose}>
      <div className={`${card} border rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" style={{ color: PINK }} />
            <h2 className={`text-base font-semibold ${textPri}`}>Caller Lookup</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Phone number, school, or contact name…"
              className={`w-full pl-10 h-11 text-sm rounded-lg border px-3 focus:outline-none ${inputCls}`} />
          </div>
          <p className={`text-[11px] mt-1.5 ${textMuted}`}>Searches every school, contact & lead — including accounts owned by others.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <p className={`text-sm text-center py-6 ${textMuted}`}>Searching…</p>}
          {!loading && q.trim().length >= 2 && rows.length === 0 && (
            <div className="text-center py-8">
              <p className={`text-sm ${textMuted}`}>No match in the directory.</p>
              <p className={`text-xs ${textMuted} mt-1`}>Create a brand-new lead from the “New Lead” button.</p>
            </div>
          )}
          {rows.map(r => {
            const badge = OWNER_BADGE[r.ownership] || OWNER_BADGE.unassigned;
            const busy = busyId === r.ref_id;
            return (
              <div key={`${r.kind}-${r.ref_id}`} className={`${card} border rounded-xl p-3 flex items-center gap-3`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${textPri} truncate`}>{r.title || '—'}</p>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase ${textMuted} bg-[var(--bg-hover)]`}>{r.kind}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                      {r.ownership === 'other' ? `Owner: ${r.owner_name || 'someone'}` : badge.label}
                    </span>
                  </div>
                  <p className={`text-xs ${textMuted} mt-0.5 truncate`}>
                    {[r.subtitle, r.phone, r.email].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {r.school_id && (
                    <button onClick={() => { navigate(`/school-profile/${r.school_id}`); onClose(); }}
                      title="View account" className={`p-2 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)]`}>
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  {r.ownership === 'other' ? (
                    <button onClick={() => forward(r)} disabled={busy}
                      className="text-xs font-semibold px-3 h-9 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: '#f59e0b' }}>
                      <ArrowRightLeft className="h-3.5 w-3.5" /> {busy ? '…' : 'Forward'}
                    </button>
                  ) : r.ownership === 'unassigned' ? (
                    <button onClick={() => claimAndCreate(r)} disabled={busy}
                      className="text-xs font-semibold px-3 h-9 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: PINK }}>
                      <Hand className="h-3.5 w-3.5" /> {busy ? '…' : 'Claim & lead'}
                    </button>
                  ) : (
                    <button onClick={() => { onPrefillLead(r, { claimed: false }); onClose(); }}
                      className="text-xs font-semibold px-3 h-9 rounded-lg text-white flex items-center gap-1.5" style={{ background: '#10b981' }}>
                      <UserPlus className="h-3.5 w-3.5" /> Create lead
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
