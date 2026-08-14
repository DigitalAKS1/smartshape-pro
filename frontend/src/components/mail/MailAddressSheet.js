import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailRuns, schools as schoolsApi } from '../../lib/api';
import { X, Printer, Save, AlertTriangle, CheckCircle2, MapPin, Download } from 'lucide-react';

/**
 * Address-review sheet for a mail run.
 * Fill blank postal addresses (saved back to each school), then print the
 * Godex-500 stickers (100x150mm, Indian-style To/From + scannable QR).
 */
export default function MailAddressSheet({ runId, runName, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState({});      // { school_id: true }
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mailRuns.addresses(runId);
      setRows(res.data.rows || []);
      setDirty({});
    } catch { toast.error('Could not load addresses'); }
    finally { setLoading(false); }
  }, [runId]);
  useEffect(() => { load(); }, [load]);

  const isMissing = (r) => !(String(r.pincode || '').trim() && String(r.address || '').trim() && String(r.city || '').trim());
  const missingCount = rows.filter(isMissing).length;

  const edit = (sid, field, val) => {
    setRows(rs => rs.map(r => r.school_id === sid ? { ...r, [field]: val, missing: undefined } : r));
    setDirty(d => ({ ...d, [sid]: true }));
  };

  const saveAll = async () => {
    const ids = Object.keys(dirty);
    if (!ids.length) { toast('Nothing changed'); return; }
    setSaving(true);
    let ok = 0;
    for (const sid of ids) {
      const r = rows.find(x => x.school_id === sid);
      if (!r) continue;
      try {
        await schoolsApi.update(sid, {
          address: r.address || '', city: r.city || '', state: r.state || '',
          pincode: r.pincode || '', primary_contact_name: r.primary_contact_name || '',
          phone: r.phone || '',
        });
        ok++;
      } catch { /* keep going */ }
    }
    setSaving(false);
    if (ok) { toast.success(`Saved ${ok} address${ok > 1 ? 'es' : ''}`); load(); }
    else toast.error('Save failed');
  };

  // Programmatic download must attach the anchor to the DOM or several browsers
  // silently ignore the .click() (Firefox/Safari, and Chrome for blob: URLs).
  const saveBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const printStickers = async () => {
    if (missingCount > 0 && !window.confirm(`${missingCount} address(es) are still incomplete and may print blank. Print anyway?`)) return;
    setPrinting(true);
    try {
      const res = await mailRuns.stickers(runId);
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, '_blank');
      if (!w) saveBlob(res.data, `stickers-${runId}.pdf`);   // popup blocked → download
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('Could not generate stickers'); }
    finally { setPrinting(false); }
  };

  const exportList = async () => {
    try {
      const res = await mailRuns.exportCsv(runId);
      saveBlob(res.data, `mail-run-${runName || runId}.csv`);
    } catch { toast.error('Could not export the list'); }
  };

  const cell = 'h-9 w-full rounded-md px-2 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btnP = 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50';
  const btnG = 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] text-sm font-semibold disabled:opacity-50';
  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2 truncate">
              <MapPin className="h-4 w-4 text-[#e94560]" /> Postal Addresses — {runName}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Fill any blank address, save, then print stickers. To = <b>The Principal, School</b> · From = your company (default).</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"><X className="h-5 w-5" /></button>
        </div>

        {/* Status banner */}
        <div className="px-5 pt-3">
          {missingCount > 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-[#9A6A15] bg-[#9A6A15]/10 border border-[#9A6A15]/30 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span><b>{missingCount}</b> of {rows.length} addresses are incomplete (need street + city + pincode). Fill them below before printing.</span>
            </div>
          ) : rows.length > 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-[#2E7D5B] bg-[#2E7D5B]/10 border border-[#2E7D5B]/30 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> All {rows.length} addresses look complete. Ready to print.
            </div>
          ) : null}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <div className="py-16 text-center text-[var(--text-muted)]">Loading addresses…</div>
          ) : (
            <table className="w-full text-sm border-separate border-spacing-y-1.5">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                  <th className="pr-2 w-8">#</th>
                  <th className="pr-2">School (To: The Principal)</th>
                  <th className="pr-2 w-[26%]">Address line</th>
                  <th className="pr-2 w-[14%]">City</th>
                  <th className="pr-2 w-[13%]">State</th>
                  <th className="pr-2 w-[11%]">Pincode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const bad = isMissing(r);
                  return (
                    <tr key={r.school_id} className={bad ? 'bg-[#9A6A15]/5' : ''}>
                      <td className="pr-2 text-[var(--text-muted)] text-xs align-middle">
                        {bad ? <AlertTriangle className="h-3.5 w-3.5 text-[#9A6A15]" /> : (i + 1)}
                      </td>
                      <td className="pr-2 align-middle">
                        <div className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">{r.school_name || '(unnamed)'}</div>
                        {r.phone ? <div className="text-[11px] text-[var(--text-muted)]">{r.phone}</div> : null}
                      </td>
                      <td className="pr-2"><input className={cell} value={r.address || ''} placeholder="House/Street, Area" onChange={e => edit(r.school_id, 'address', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.city || ''} placeholder="City" onChange={e => edit(r.school_id, 'city', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.state || ''} placeholder="State" onChange={e => edit(r.school_id, 'state', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.pincode || ''} placeholder="PIN" inputMode="numeric" onChange={e => edit(r.school_id, 'pincode', e.target.value)} /></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan="6" className="py-10 text-center text-[var(--text-muted)]">No schools in this run.</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-color)]">
          <span className="text-xs text-[var(--text-muted)]">{dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount > 1 ? 's' : ''}` : `${rows.length} schools`}</span>
          <div className="flex items-center gap-2">
            <button className={btnG} onClick={exportList} disabled={loading || rows.length === 0} data-testid="export-list-btn"><Download className="h-4 w-4" /> Export list</button>
            <button className={btnG} onClick={saveAll} disabled={saving || dirtyCount === 0}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save addresses'}</button>
            <button className={btnP} onClick={printStickers} disabled={printing || loading || rows.length === 0}><Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print stickers'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
