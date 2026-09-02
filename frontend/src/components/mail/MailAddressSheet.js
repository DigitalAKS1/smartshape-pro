import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailRuns, schools as schoolsApi, settingsApi } from '../../lib/api';
import { X, Printer, Save, AlertTriangle, CheckCircle2, MapPin, Download, SlidersHorizontal, RefreshCw } from 'lucide-react';
import VerifyPostTable from './VerifyPostTable';
import PrintOptionsDialog from './PrintOptionsDialog';

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
  const [mode, setMode] = useState('addresses');   // 'addresses' | 'verify'

  // Print options
  const [showPrint, setShowPrint] = useState(false);
  const [opts, setOpts] = useState({ format: '100x150', orientation: 'portrait', customW: '100', customH: '150', skipIncomplete: true, showLogo: true, endorsement: '', endorsementPt: 0, textScale: 1, showPhone: true });
  const [fromEdit, setFromEdit] = useState(false);
  const [from, setFrom] = useState({ company_name: '', address: '', city: '', state: '', pincode: '', sticker_tagline: '', sticker_contact: '', phone: '' });
  const [logoUrl, setLogoUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingFrom, setSavingFrom] = useState(false);
  useEffect(() => {
    settingsApi.getCompany().then(r => {
      const c = r.data || {};
      setFrom({ company_name: c.company_name || '', address: c.address || '', city: c.city || '', state: c.state || '', pincode: c.pincode || '', sticker_tagline: c.sticker_tagline || '', sticker_contact: c.sticker_contact || '', phone: c.phone || '' });
      setLogoUrl(c.logo_url || '');
      setOpts(o => ({ ...o,
        endorsement: c.sticker_endorsement || '',
        endorsementPt: Number(c.sticker_endorsement_pt || 0),
        textScale: Number(c.sticker_text_scale || 1) }));
    }).catch(() => {});
  }, []);

  const onUploadLogo = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    try {
      const r = await settingsApi.uploadLogo(file);
      setLogoUrl(r.data?.logo_url || '');
      toast.success('Logo uploaded — it will print above the From block on your stickers');
    } catch { toast.error('Logo upload failed'); }
    finally { setUploadingLogo(false); }
  };
  const saveFromAsDefault = async () => {
    setSavingFrom(true);
    try {
      await settingsApi.saveCompany({ company_name: from.company_name, address: from.address, city: from.city, state: from.state, pincode: from.pincode, sticker_tagline: from.sticker_tagline, sticker_contact: from.sticker_contact, phone: from.phone, sticker_endorsement: opts.endorsement, sticker_endorsement_pt: opts.endorsementPt, sticker_text_scale: opts.textScale });
      toast.success('Saved as your company From address');
    } catch { toast.error('Could not save'); }
    finally { setSavingFrom(false); }
  };

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
  const pendingCount = rows.filter(r => (r.verify_status || 'pending') === 'pending').length;

  const edit = (sid, field, val) => {
    setRows(rs => rs.map(r => r.school_id === sid ? { ...r, [field]: val, missing: undefined } : r));
    setDirty(d => ({ ...d, [sid]: true }));
  };

  // Manual sync: push every row's address onto its school record (not just edits).
  const syncAll = async () => {
    setSaving(true);
    try {
      const r = await mailRuns.syncSchools(runId, rows.map(x => ({
        school_id: x.school_id, address: x.address, city: x.city, state: x.state,
        pincode: x.pincode, primary_contact_name: x.primary_contact_name, phone: x.phone,
      })));
      toast.success(`Synced ${r.data.synced} school${r.data.synced === 1 ? '' : 's'} to the database`);
      setDirty({});
      load();
    } catch { toast.error('Sync failed'); }
    finally { setSaving(false); }
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

  const buildPrintParams = () => {
    const p = {};
    if (opts.format === 'a4') {
      p.layout = 'a4';
    } else {
      p.layout = 'label';
      p.orientation = opts.orientation;
      p.size = opts.format === 'custom' ? `${opts.customW}x${opts.customH}` : opts.format;
    }
    if (opts.skipIncomplete) p.skip_incomplete = '1';
    if (!opts.showLogo) p.no_logo = '1';
    if (fromEdit) {
      p.from_name = from.company_name; p.from_address = from.address;
      p.from_city = from.city; p.from_state = from.state; p.from_pincode = from.pincode;
      p.from_tagline = from.sticker_tagline; p.from_contact = from.sticker_contact;
      p.from_phone = from.phone;
    }
    if (opts.endorsement.trim()) p.endorsement = opts.endorsement.trim();
    if (opts.endorsementPt > 0) p.endorsement_pt = opts.endorsementPt;
    if (Number(opts.textScale) !== 1) p.text_scale = opts.textScale;
    if (!opts.showPhone) p.no_phone = '1';
    return p;
  };

  const printStickers = async () => {
    if (missingCount > 0 && !window.confirm(`${missingCount} address(es) are still incomplete and may print blank. Print anyway?`)) return;
    setPrinting(true);
    try {
      const res = await mailRuns.stickers(runId, buildPrintParams());
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, '_blank');
      if (!w) saveBlob(res.data, `stickers-${runId}.pdf`);   // popup blocked → download
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setShowPrint(false);
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
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Fill any blank address, save, then print stickers. Order printed: <b>name → school → address → phone</b>. Blank contact prints "The Principal".</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"><X className="h-5 w-5" /></button>
        </div>

        {/* Addresses (prepare) vs Verify & post (what really went out) */}
        <div className="px-5 pt-3 flex items-center gap-1">
          {[['addresses', 'Addresses'], ['verify', 'Verify & post']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} data-testid={`tab-${k}`}
              className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${mode === k ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
              {label}
              {k === 'verify' && pendingCount > 0 && (
                <span className={`ml-1.5 text-[10px] font-mono ${mode === k ? 'text-white/80' : 'text-[#9A6A15]'}`}>{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Status banner */}
        <div className="px-5 pt-3">
          {mode === 'verify' ? null : missingCount > 0 ? (
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
          ) : mode === 'verify' ? (
            <VerifyPostTable runId={runId} rows={rows} onChanged={load} />
          ) : (
            <table className="w-full text-sm border-separate border-spacing-y-1.5">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                  <th className="pr-2 w-8">#</th>
                  <th className="pr-2 w-[17%]">School</th>
                  <th className="pr-2 w-[15%]" title="Prints as the first line of the To address">Contact name</th>
                  <th className="pr-2 w-[21%]">Address line</th>
                  <th className="pr-2 w-[12%]">City</th>
                  <th className="pr-2 w-[11%]">State</th>
                  <th className="pr-2 w-[9%]">Pincode</th>
                  <th className="pr-2 w-[12%]">Phone</th>
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
                      </td>
                      <td className="pr-2"><input className={cell} value={r.primary_contact_name || ''} placeholder="The Principal" onChange={e => edit(r.school_id, 'primary_contact_name', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.address || ''} placeholder="House/Street, Area" onChange={e => edit(r.school_id, 'address', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.city || ''} placeholder="City" onChange={e => edit(r.school_id, 'city', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.state || ''} placeholder="State" onChange={e => edit(r.school_id, 'state', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.pincode || ''} placeholder="PIN" inputMode="numeric" onChange={e => edit(r.school_id, 'pincode', e.target.value)} /></td>
                      <td className="pr-2"><input className={cell} value={r.phone || ''} placeholder="Phone" inputMode="tel" onChange={e => edit(r.school_id, 'phone', e.target.value)} /></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan="8" className="py-10 text-center text-[var(--text-muted)]">No schools in this run.</td></tr>}
              </tbody>
            </table>
          )}
        </div>


        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-color)]">
          <span className="text-xs text-[var(--text-muted)]">{dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount > 1 ? 's' : ''}` : `${rows.length} schools`}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={btnG} onClick={exportList} disabled={loading || rows.length === 0} data-testid="export-list-btn"><Download className="h-4 w-4" /> Export list</button>
            <button className={btnG} onClick={saveAll} disabled={saving || dirtyCount === 0}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save addresses'}</button>
            <button className={btnG} onClick={syncAll} disabled={saving || rows.length === 0} data-testid="sync-schools-btn" title="Push every address to the school database"><RefreshCw className="h-4 w-4" /> Sync to schools</button>
            <button className={btnG} onClick={() => setShowPrint(true)} data-testid="print-opts-toggle"><SlidersHorizontal className="h-4 w-4" /> Sticker setup</button>
            <button className={btnP} onClick={() => setShowPrint(true)} disabled={printing || loading || rows.length === 0}><Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print stickers'}</button>
          </div>
        </div>
      </div>

      {showPrint && (
        <PrintOptionsDialog
          opts={opts} setOpts={setOpts}
          from={from} setFrom={setFrom}
          fromEdit={fromEdit} setFromEdit={setFromEdit}
          logoUrl={logoUrl} uploadingLogo={uploadingLogo} onUploadLogo={onUploadLogo}
          savingFrom={savingFrom} onSaveDefault={saveFromAsDefault}
          missingCount={missingCount} printing={printing}
          onPrint={printStickers} onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}
