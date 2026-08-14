import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { schools as schoolsApi, mailRuns } from '../../lib/api';
import { X, Search, Plus, Check, Trash2 } from 'lucide-react';

const PIECES = ['brochure', 'sample', 'newsletter', 'other'];

/**
 * Hand-pick a mail run: search the school directory, add schools one by one,
 * review the list, then create the run. For rich multi-facet targeting
 * (never-touched, strength, tag…) the CRM filter + "Mail Run" button is the path;
 * this is the "I know exactly which schools" builder.
 */
export default function ManualMailRunBuilder({ onClose, onCreated }) {
  const [all, setAll] = useState([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);        // [{school_id, school_name, city}]
  const [form, setForm] = useState({ name: `Manual list — ${new Date().toLocaleDateString()}`, piece_type: 'brochure', send_date: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await schoolsApi.getAll();
      setAll((r.data || []).map(s => ({ school_id: s.school_id, school_name: s.school_name || '(unnamed)', city: s.city || '' })));
    } catch { toast.error('Could not load schools'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pickedIds = useMemo(() => new Set(picked.map(p => p.school_id)), [picked]);
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return all.filter(s => !pickedIds.has(s.school_id) &&
      (s.school_name.toLowerCase().includes(term) || s.city.toLowerCase().includes(term))).slice(0, 25);
  }, [q, all, pickedIds]);

  const add = (s) => { setPicked(p => [...p, s]); setQ(''); };
  const remove = (id) => setPicked(p => p.filter(x => x.school_id !== id));

  const create = async () => {
    if (!picked.length) { toast.error('Add at least one school'); return; }
    setBusy(true);
    try {
      await mailRuns.create({ name: form.name || 'Manual list', piece_type: form.piece_type,
        send_date: form.send_date, school_ids: picked.map(p => p.school_id) });
      toast.success(`Mail run created for ${picked.length} schools`);
      onCreated && onCreated();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to create run'); }
    finally { setBusy(false); }
  };

  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btnP = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Build a mail list manually</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Search and add schools one by one. For filter-based targeting (tag, city, strength, never-touched…), use <b>Leads → filter → Mail Run</b>.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className={inp + ' pl-9'} placeholder={loading ? 'Loading schools…' : 'Type a school name or city…'}
              value={q} onChange={e => setQ(e.target.value)} disabled={loading} data-testid="school-search" autoFocus />
          </div>
          {q.trim() && (
            <div className="mt-1 max-h-52 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] divide-y divide-[var(--border-color)]">
              {matches.length === 0
                ? <div className="px-3 py-3 text-sm text-[var(--text-muted)]">No matches (or already added).</div>
                : matches.map(s => (
                  <button key={s.school_id} onClick={() => add(s)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-card)]" data-testid={`pick-${s.school_id}`}>
                    <span className="text-sm text-[var(--text-primary)] truncate">{s.school_name}{s.city ? <span className="text-[var(--text-muted)]"> · {s.city}</span> : null}</span>
                    <Plus className="h-4 w-4 text-[#e94560] flex-shrink-0" />
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Selected list */}
        <div className="flex-1 overflow-auto px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Your list</span>
            <span className="text-xs font-semibold text-[#e94560]">{picked.length} school{picked.length !== 1 ? 's' : ''}</span>
          </div>
          {picked.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-muted)] border border-dashed border-[var(--border-color)] rounded-lg">Search above and add schools to build your list.</div>
          ) : (
            <div className="grid gap-1.5">
              {picked.map((s, i) => (
                <div key={s.school_id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]" data-testid={`picked-${s.school_id}`}>
                  <span className="text-sm text-[var(--text-primary)] truncate"><span className="text-[var(--text-muted)] mr-1.5">{i + 1}.</span>{s.school_name}{s.city ? <span className="text-[var(--text-muted)]"> · {s.city}</span> : null}</span>
                  <button onClick={() => remove(s.school_id)} className="text-[var(--text-muted)] hover:text-red-400 flex-shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Run details + create */}
        <div className="px-5 py-4 border-t border-[var(--border-color)] grid gap-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <input className={inp + ' sm:col-span-1'} placeholder="Run name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <select className={inp} value={form.piece_type} onChange={e => setForm(p => ({ ...p, piece_type: e.target.value }))}>
              {PIECES.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input className={inp} type="date" value={form.send_date} onChange={e => setForm(p => ({ ...p, send_date: e.target.value }))} />
          </div>
          <button className={btnP} disabled={busy || picked.length === 0} onClick={create} data-testid="create-manual-run">
            <Check className="h-4 w-4" /> {busy ? 'Creating…' : `Create mail run (${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
