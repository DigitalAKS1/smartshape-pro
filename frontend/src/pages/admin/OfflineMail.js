import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { mailAreas, mailRuns } from '../../lib/api';
import { MapPin, Mail, Plus, RefreshCw, Trash2, X } from 'lucide-react';

const PIECES = ['brochure', 'sample', 'newsletter', 'other'];
const STATUS_COLOR = { planned: '#9A6A15', posted: '#1E5AA8', closed: '#2E7D5B' };

export default function OfflineMail() {
  const [areas, setAreas] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArea, setShowArea] = useState(false);
  const [areaForm, setAreaForm] = useState({ name: '', kind: 'pincode', pincode: '', city: '' });
  const [runForm, setRunForm] = useState(null); // null | {area_id, piece_type, courier, tracking_no, send_date, count}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([mailAreas.getAll(), mailRuns.getAll()]);
      setAreas(a.data || []);
      setRuns(r.data || []);
    } catch { toast.error('Failed to load offline mail'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addArea = async () => {
    const f = areaForm;
    if (!f.name || (f.kind === 'pincode' ? !f.pincode : !f.city)) {
      toast.error(f.kind === 'pincode' ? 'Name and pincode required' : 'Name and city required');
      return;
    }
    setBusy(true);
    try {
      const res = await mailAreas.create(f);
      await mailAreas.autoAssign(res.data.area_id); // count schools now
      toast.success('Area added');
      setShowArea(false);
      setAreaForm({ name: '', kind: 'pincode', pincode: '', city: '' });
      load();
    } catch { toast.error('Failed to add area'); }
    finally { setBusy(false); }
  };

  const recount = async (a) => {
    try { const r = await mailAreas.autoAssign(a.area_id); toast.success(`${r.data.school_count} schools`); load(); }
    catch { toast.error('Recount failed'); }
  };
  const delArea = async (a) => {
    if (!window.confirm(`Delete area "${a.name}"?`)) return;
    try { await mailAreas.delete(a.area_id); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  };

  const openRun = async (area) => {
    // Pull the area's schools so the run covers them
    try {
      const s = await mailAreas.schools(area.area_id);
      setRunForm({
        area_id: area.area_id, area_name: area.name,
        school_ids: (s.data || []).map(x => x.school_id),
        count: (s.data || []).length,
        name: `${area.name} — ${new Date().toLocaleDateString()}`,
        piece_type: 'brochure', courier: '', tracking_no: '', send_date: '',
      });
    } catch { toast.error('Could not load area schools'); }
  };

  const createRun = async () => {
    if (!runForm.count) { toast.error('This area has no schools — recount it first'); return; }
    setBusy(true);
    try {
      await mailRuns.create({
        name: runForm.name, area_id: runForm.area_id, piece_type: runForm.piece_type,
        school_ids: runForm.school_ids, courier: runForm.courier,
        tracking_no: runForm.tracking_no, send_date: runForm.send_date,
      });
      toast.success(`Mail run created for ${runForm.count} schools`);
      setRunForm(null);
      load();
    } catch { toast.error('Failed to create run'); }
    finally { setBusy(false); }
  };

  const setStatus = async (run, status) => {
    try { await mailRuns.updateStatus(run.run_id, status); load(); }
    catch { toast.error('Update failed'); }
  };

  const areaName = (id) => areas.find(a => a.area_id === id)?.name || '—';

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const btnP = 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold';
  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Mail className="h-6 w-6 text-[#e94560]" /> Offline Mail
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Define areas, post physical pieces to schools, and track each run. Follow-ups appear in Today's Actions.</p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-[var(--text-muted)]">Loading…</div>
        ) : (
          <div className="grid gap-6">
            {/* AREAS */}
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2"><MapPin className="h-4 w-4 text-[#e94560]" /> Areas</h2>
                <button className={btnP} onClick={() => setShowArea(v => !v)} data-testid="add-area-btn"><Plus className="h-3.5 w-3.5" /> Add Area</button>
              </div>

              {showArea && (
                <div className="mb-4 p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] grid gap-3 sm:grid-cols-2">
                  <input className={inp} placeholder="Area name (e.g. Rohini)" value={areaForm.name} onChange={e => setAreaForm(p => ({ ...p, name: e.target.value }))} />
                  <select className={inp} value={areaForm.kind} onChange={e => setAreaForm(p => ({ ...p, kind: e.target.value }))}>
                    <option value="pincode">By pincode</option>
                    <option value="city">By city</option>
                  </select>
                  {areaForm.kind === 'pincode'
                    ? <input className={inp} placeholder="Pincode (e.g. 110085)" value={areaForm.pincode} onChange={e => setAreaForm(p => ({ ...p, pincode: e.target.value }))} />
                    : <input className={inp} placeholder="City (e.g. Delhi)" value={areaForm.city} onChange={e => setAreaForm(p => ({ ...p, city: e.target.value }))} />}
                  <button className={btnP} disabled={busy} onClick={addArea} data-testid="save-area-btn">{busy ? '…' : 'Create area'}</button>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                {areas.map(a => (
                  <div key={a.area_id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]" data-testid={`area-${a.area_id}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.name}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{a.kind === 'city' ? a.city : a.pincode} · <b className="text-[var(--text-secondary)]">{a.school_count}</b> schools</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button title="Recount schools" className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[#e94560]" onClick={() => recount(a)}><RefreshCw className="h-3.5 w-3.5" /></button>
                      <button className="h-8 px-2.5 rounded-lg text-[11px] font-semibold border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560]" onClick={() => openRun(a)} data-testid={`new-run-${a.area_id}`}>New run</button>
                      <button title="Delete" className="h-8 w-8 flex items-center justify-center rounded-lg text-red-400" onClick={() => delArea(a)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
                {areas.length === 0 && <p className="text-sm text-[var(--text-muted)] py-6 text-center sm:col-span-2">No areas yet. Add one by pincode or city to start.</p>}
              </div>
            </div>

            {/* MAIL RUNS */}
            <div className={`${card} p-5`}>
              <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2 mb-4"><Mail className="h-4 w-4 text-[#e94560]" /> Mail Runs</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                      <th className="py-2 pr-3">Run</th><th className="py-2 pr-3">Area</th><th className="py-2 pr-3">Piece</th>
                      <th className="py-2 pr-3">Sent</th><th className="py-2 pr-3">Courier</th><th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(r => (
                      <tr key={r.run_id} className="border-t border-[var(--border-color)]" data-testid={`run-${r.run_id}`}>
                        <td className="py-2.5 pr-3 text-[var(--text-primary)] font-medium">{r.name}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{areaName(r.area_id)}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-secondary)] capitalize">{r.piece_type}</td>
                        <td className="py-2.5 pr-3 font-mono">{r.counts?.sent ?? 0}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{r.courier || '—'}{r.tracking_no ? ` · ${r.tracking_no}` : ''}</td>
                        <td className="py-2.5 pr-3">
                          <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                            className="text-[11px] font-semibold rounded-full px-2 py-1 bg-transparent border"
                            style={{ color: STATUS_COLOR[r.status], borderColor: STATUS_COLOR[r.status] }}>
                            <option value="planned">planned</option>
                            <option value="posted">posted</option>
                            <option value="closed">closed</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    {runs.length === 0 && <tr><td colSpan="6" className="py-6 text-center text-[var(--text-muted)]">No mail runs yet. Open an area above and click "New run".</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NEW RUN MODAL */}
      {runForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setRunForm(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">New Mail Run</h3>
              <button onClick={() => setRunForm(null)} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">Area <b className="text-[var(--text-secondary)]">{runForm.area_name}</b> · <b className="text-[var(--text-secondary)]">{runForm.count}</b> schools will be mailed and tagged as Direct-Mail leads.</p>
            <div className="grid gap-3">
              <input className={inp} placeholder="Run name" value={runForm.name} onChange={e => setRunForm(p => ({ ...p, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <select className={inp} value={runForm.piece_type} onChange={e => setRunForm(p => ({ ...p, piece_type: e.target.value }))}>
                  {PIECES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <input className={inp} type="date" value={runForm.send_date} onChange={e => setRunForm(p => ({ ...p, send_date: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className={inp} placeholder="Courier (e.g. DTDC)" value={runForm.courier} onChange={e => setRunForm(p => ({ ...p, courier: e.target.value }))} />
                <input className={inp} placeholder="Tracking no." value={runForm.tracking_no} onChange={e => setRunForm(p => ({ ...p, tracking_no: e.target.value }))} />
              </div>
              <button className={btnP + ' justify-center'} disabled={busy} onClick={createRun} data-testid="create-run-btn">{busy ? 'Creating…' : `Create run (${runForm.count} schools)`}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
