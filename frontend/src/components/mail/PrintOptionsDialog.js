import React, { useRef } from 'react';
import { X, Printer, Save, ImagePlus, SlidersHorizontal, MapPin, Stamp } from 'lucide-react';

const cell = 'h-10 w-full rounded-lg px-3 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
const btnP = 'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50';
const btnG = 'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-sm font-semibold disabled:opacity-50';

const ENDORSEMENTS = ['Book Post', 'Open Post', 'Printed Matter', 'Book Packet'];

/** +/- stepper. `hint` replaces the number when set (e.g. "auto"). */
function Stepper({ label, value, suffix, min, max, step, onChange, hint, testId }) {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const b = 'h-9 w-9 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-lg leading-none font-semibold disabled:opacity-40';
  return (
    <div>
      <label className="block text-[12px] text-[var(--text-muted)] mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <button type="button" className={b} disabled={value <= min} onClick={() => onChange(clamp(value - step))} data-testid={`${testId}-dec`}>&minus;</button>
        <span className="min-w-[4rem] text-center text-[14px] font-mono font-semibold text-[var(--text-primary)]" data-testid={`${testId}-val`}>
          {hint || `${value}${suffix}`}
        </span>
        <button type="button" className={b} disabled={value >= max} onClick={() => onChange(clamp(value + step))} data-testid={`${testId}-inc`}>+</button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-primary)] flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-[#e94560]" /> {title}
        </span>
        {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Everything you set before printing, in one roomy popup instead of a cramped
 * strip you had to scroll: label size, the postal endorsement, and the sender
 * block with its logo. Set it once, save it as the default, print.
 */
export default function PrintOptionsDialog({
  opts, setOpts, from, setFrom, fromEdit, setFromEdit,
  logoUrl, uploadingLogo, onUploadLogo, savingFrom, onSaveDefault,
  missingCount, printing, onPrint, onClose,
}) {
  const logoInputRef = useRef(null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()} data-testid="print-options-dialog">

        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#e94560]" /> Sticker setup
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Set the label size, the postal endorsement and your sender block — then save it as the default so you never type it again.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">

          <Section icon={Printer} title="Label format">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1.5">Sticker size</label>
                <select className={cell} value={opts.format} onChange={e => setOpts(o => ({ ...o, format: e.target.value }))} data-testid="sticker-format">
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
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1.5">Orientation</label>
                  <select className={cell} value={opts.orientation} onChange={e => setOpts(o => ({ ...o, orientation: e.target.value }))}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              )}
            </div>
            {opts.format === 'custom' && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mt-3">
                <input className={cell + ' w-24'} value={opts.customW} inputMode="numeric" onChange={e => setOpts(o => ({ ...o, customW: e.target.value }))} /> ×
                <input className={cell + ' w-24'} value={opts.customH} inputMode="numeric" onChange={e => setOpts(o => ({ ...o, customH: e.target.value }))} /> mm (width × height)
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4 mt-3">
              <Stepper label="Text size (whole label)" value={Math.round(opts.textScale * 100)} suffix="%" min={80} max={130} step={5}
                onChange={v => setOpts(o => ({ ...o, textScale: v / 100 }))} testId="text-scale" />
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <input type="checkbox" className="accent-[#e94560]" checked={opts.skipIncomplete} onChange={e => setOpts(o => ({ ...o, skipIncomplete: e.target.checked }))} data-testid="skip-incomplete-toggle" />
                  Skip incomplete addresses{missingCount > 0 ? ` — ${missingCount} will be skipped` : ''}
                </label>
                <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <input type="checkbox" className="accent-[#e94560]" checked={opts.showPhone} onChange={e => setOpts(o => ({ ...o, showPhone: e.target.checked }))} data-testid="show-phone-toggle" />
                  Print phone numbers on the label
                </label>
              </div>
            </div>
          </Section>

          <Section icon={Stamp} title="Postal endorsement" hint="what you used to write by hand">
            <div className="flex flex-wrap gap-2 mb-3">
              {ENDORSEMENTS.map(x => (
                <button key={x} type="button" onClick={() => setOpts(o => ({ ...o, endorsement: o.endorsement === x ? '' : x }))}
                  className={`h-9 px-3.5 rounded-full text-[12px] font-semibold border transition-colors ${opts.endorsement === x ? 'bg-[#e94560] text-white border-[#e94560]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#e94560]'}`}
                  data-testid={`endorse-${x.replace(/\s/g, '-').toLowerCase()}`}>{x}</button>
              ))}
            </div>
            <input className={cell} placeholder="Or type your own (leave blank for none)" value={opts.endorsement}
              onChange={e => setOpts(o => ({ ...o, endorsement: e.target.value }))} data-testid="endorsement-input" />
            <div className="mt-3 max-w-[16rem]">
              <Stepper label="Endorsement size" value={opts.endorsementPt} suffix="pt" min={0} max={40} step={1}
                hint={opts.endorsementPt === 0 ? 'auto' : null}
                onChange={v => setOpts(o => ({ ...o, endorsementPt: v }))} testId="endorsement-pt" />
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">Prints bold in the top-right of the label, where the counter clerk looks.</p>
          </Section>

          <Section icon={MapPin} title="Sender (From) & logo" hint="name → company → address → phone">
            <div className="flex items-center gap-4 flex-wrap mb-3">
              {logoUrl
                ? <img src={logoUrl} alt="Company logo" className="h-16 max-w-[180px] object-contain bg-white rounded-lg border border-[var(--border-color)] p-1" />
                : <div className="h-16 w-28 grid place-items-center rounded-lg border border-dashed border-[var(--border-color)] text-[11px] text-[var(--text-muted)]">No logo</div>}
              <div className="flex flex-col gap-2">
                <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className={btnG} data-testid="logo-upload-btn">
                  <ImagePlus className="h-4 w-4" /> {uploadingLogo ? 'Uploading…' : (logoUrl ? 'Change logo' : 'Upload logo')}
                </button>
                <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input type="checkbox" className="accent-[#e94560]" checked={opts.showLogo} onChange={e => setOpts(o => ({ ...o, showLogo: e.target.checked }))} data-testid="show-logo-toggle" />
                  Show logo on stickers
                </label>
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadLogo} data-testid="logo-upload-input" />
            </div>

            <div className="grid gap-2.5">
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">Contact name <span className="text-[var(--text-muted)]">(prints first, above the company)</span></label>
                <input className={cell} placeholder="e.g. Vikaas Garodiaa" value={from.sticker_contact} onChange={e => setFrom(f => ({ ...f, sticker_contact: e.target.value }))} data-testid="from-contact" />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">Company / sender name</label>
                <input className={cell} placeholder="Company name" value={from.company_name} onChange={e => setFrom(f => ({ ...f, company_name: e.target.value }))} data-testid="from-name" />
              </div>
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">Address <span className="text-[var(--text-muted)]">(press Enter for a new line)</span></label>
                <textarea className={cell + ' h-auto py-2 resize-y'} rows={3} placeholder="1st Floor, Plot 601, Sector 16A" value={from.address} onChange={e => setFrom(f => ({ ...f, address: e.target.value }))} data-testid="from-address" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input className={cell} placeholder="City" value={from.city} onChange={e => setFrom(f => ({ ...f, city: e.target.value }))} />
                <input className={cell} placeholder="State" value={from.state} onChange={e => setFrom(f => ({ ...f, state: e.target.value }))} />
                <input className={cell} placeholder="Pincode" value={from.pincode} onChange={e => setFrom(f => ({ ...f, pincode: e.target.value }))} />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1">Phone <span className="text-[var(--text-muted)]">(prints last)</span></label>
                  <input className={cell} placeholder="e.g. 0129-4001234" value={from.phone} onChange={e => setFrom(f => ({ ...f, phone: e.target.value }))} data-testid="from-phone" />
                </div>
                <div>
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1">Tagline <span className="text-[var(--text-muted)]">(optional)</span></label>
                  <input className={cell} placeholder="Branding line above From" value={from.sticker_tagline} onChange={e => setFrom(f => ({ ...f, sticker_tagline: e.target.value }))} data-testid="from-tagline" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)] mt-1">
                <input type="checkbox" className="accent-[#e94560]" checked={fromEdit} onChange={e => setFromEdit(e.target.checked)} data-testid="from-override-toggle" />
                Use this From for <b>this batch only</b> <span className="text-[var(--text-muted)]">(otherwise save it as your default below)</span>
              </label>
            </div>
          </Section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-color)]">
          <button onClick={onSaveDefault} disabled={savingFrom} className={btnG} data-testid="save-from-default">
            <Save className="h-4 w-4" /> {savingFrom ? 'Saving…' : 'Save as default'}
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className={btnG}>Close</button>
            <button onClick={onPrint} disabled={printing} className={btnP} data-testid="dialog-print-btn">
              <Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Save & print stickers'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
