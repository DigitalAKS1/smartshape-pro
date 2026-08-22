import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { mailRuns, schools as schoolsApi, settingsApi } from '../../lib/api';
import { X, Printer, Save, AlertTriangle, CheckCircle2, MapPin, Download, SlidersHorizontal, ImagePlus } from 'lucide-react';

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

  // Print options
  const [showPrint, setShowPrint] = useState(false);
  const [opts, setOpts] = useState({ format: '100x150', orientation: 'portrait', customW: '100', customH: '150', skipIncomplete: true });
  const [fromEdit, setFromEdit] = useState(false);
  const [from, setFrom] = useState({ company_name: '', address: '', city: '', state: '', pincode: '', sticker_tagline: '' });
  const [logoUrl, setLogoUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingFrom, setSavingFrom] = useState(false);
  const logoInputRef = useRef(null);
  useEffect(() => {
    settingsApi.getCompany().then(r => {
      const c = r.data || {};
      setFrom({ company_name: c.company_name || '', address: c.address || '', city: c.city || '', state: c.state || '', pincode: c.pincode || '', sticker_tagline: c.sticker_tagline || '' });
      setLogoUrl(c.logo_url || '');
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
      await settingsApi.saveCompany({ company_name: from.company_name, address: from.address, city: from.city, state: from.state, pincode: from.pincode, sticker_tagline: from.sticker_tagline });
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
    if (fromEdit) {
      p.from_name = from.company_name; p.from_address = from.address;
      p.from_city = from.city; p.from_state = from.state; p.from_pincode = from.pincode;
      p.from_tagline = from.sticker_tagline;
    }
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

        {/* Print options panel */}
        {showPrint && (
          <div className="px-5 py-4 border-t border-[var(--border-color)] bg-[var(--bg-primary)] space-y-3 max-h-[45vh] overflow-auto" data-testid="print-options">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" /> Print options</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Sticker format</label>
                <select className={cell + ' h-10'} value={opts.format} onChange={e => setOpts(o => ({ ...o, format: e.target.value }))} data-testid="sticker-format">
                  <option value="100x150">Godex 100×150 mm (roll — default)</option>
                  <option value="100x100">100×100 mm</option>
                  <option value="75x50">75×50 mm</option>
                  <option value="65x38">65×38 mm</option>
                  <option value="50x25">50×25 mm (small — name + QR only)</option>
                  <option value="a4">A4 sheet — 4 labels per page (normal printer)</option>
                  <option value="custom">Custom size…</option>
                </select>
              </div>
              {opts.format !== 'a4' && (
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Orientation</label>
                  <select className={cell + ' h-10'} value={opts.orientation} onChange={e => setOpts(o => ({ ...o, orientation: e.target.value }))}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              )}
            </div>
            {opts.format === 'custom' && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input className={cell + ' w-20'} value={opts.customW} inputMode="numeric" onChange={e => setOpts(o => ({ ...o, customW: e.target.value }))} /> ×
                <input className={cell + ' w-20'} value={opts.customH} inputMode="numeric" onChange={e => setOpts(o => ({ ...o, customH: e.target.value }))} /> mm (width × height)
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <input type="checkbox" className="accent-[#e94560]" checked={opts.skipIncomplete} onChange={e => setOpts(o => ({ ...o, skipIncomplete: e.target.checked }))} data-testid="skip-incomplete-toggle" />
              Skip incomplete addresses{missingCount > 0 ? ` — ${missingCount} will be skipped` : ''}
            </label>
            {/* Sender (From) + logo */}
            <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Sender (From) &amp; logo</div>
              <div className="flex items-center gap-3 flex-wrap">
                {logoUrl
                  ? <img src={logoUrl} alt="Company logo" className="h-10 max-w-[130px] object-contain bg-white rounded border border-[var(--border-color)] p-0.5" />
                  : <div className="h-10 w-16 grid place-items-center rounded border border-dashed border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">No logo</div>}
                <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className={btnG} data-testid="logo-upload-btn">
                  <ImagePlus className="h-4 w-4" /> {uploadingLogo ? 'Uploading…' : (logoUrl ? 'Change logo' : 'Upload logo')}
                </button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadLogo} data-testid="logo-upload-input" />
                <span className="text-[10px] text-[var(--text-muted)]">Prints above the From block on every sticker.</span>
              </div>
              <div className="grid gap-1.5">
                <input className={cell} placeholder="Company / sender name" value={from.company_name} onChange={e => setFrom(f => ({ ...f, company_name: e.target.value }))} data-testid="from-name" />
                <input className={cell} placeholder="Tagline / branding line (optional — prints above From)" value={from.sticker_tagline} onChange={e => setFrom(f => ({ ...f, sticker_tagline: e.target.value }))} data-testid="from-tagline" />
                <textarea className={cell + ' h-auto py-2 resize-y'} rows={2} placeholder="Address — press Enter for a new line" value={from.address} onChange={e => setFrom(f => ({ ...f, address: e.target.value }))} data-testid="from-address" />
                <div className="grid grid-cols-3 gap-1.5">
                  <input className={cell} placeholder="City" value={from.city} onChange={e => setFrom(f => ({ ...f, city: e.target.value }))} />
                  <input className={cell} placeholder="State" value={from.state} onChange={e => setFrom(f => ({ ...f, state: e.target.value }))} />
                  <input className={cell} placeholder="Pincode" value={from.pincode} onChange={e => setFrom(f => ({ ...f, pincode: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input type="checkbox" className="accent-[#e94560]" checked={fromEdit} onChange={e => setFromEdit(e.target.checked)} data-testid="from-override-toggle" />
                  Use this From for <b>this batch only</b>
                </label>
                <button onClick={saveFromAsDefault} disabled={savingFrom} className={btnG + ' h-8 ml-auto'} data-testid="save-from-default">
                  <Save className="h-3.5 w-3.5" /> {savingFrom ? 'Saving…' : 'Save as default'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-color)]">
          <span className="text-xs text-[var(--text-muted)]">{dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount > 1 ? 's' : ''}` : `${rows.length} schools`}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={btnG} onClick={exportList} disabled={loading || rows.length === 0} data-testid="export-list-btn"><Download className="h-4 w-4" /> Export list</button>
            <button className={btnG} onClick={saveAll} disabled={saving || dirtyCount === 0}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save addresses'}</button>
            <button className={btnG} onClick={() => setShowPrint(s => !s)} data-testid="print-opts-toggle"><SlidersHorizontal className="h-4 w-4" /> Options</button>
            <button className={btnP} onClick={printStickers} disabled={printing || loading || rows.length === 0}><Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print stickers'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
