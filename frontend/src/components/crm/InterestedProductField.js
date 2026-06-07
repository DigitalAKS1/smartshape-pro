import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { packages as packagesApi, interestedProducts as interestedProductsApi } from '../../lib/api';

/**
 * Reusable "Interested Product" field: a dropdown of our Packages + previously-saved
 * custom entries, plus an "Individual / Other…" option that captures a one-off.
 * A new custom value is auto-saved to the interested-products master (on blur), so it
 * appears in the dropdown next time. Controlled via `value` / `onChange(value)`.
 */
export default function InterestedProductField({ value, onChange, label = 'Interested Product', labelClass = 'text-[var(--text-secondary)] text-xs' }) {
  const [packagesList, setPackagesList] = useState([]);
  const [customProducts, setCustomProducts] = useState([]);
  const [customMode, setCustomMode] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const selCls = `w-full h-10 px-3 rounded-md text-sm ${inputCls}`;
  const pkgName = (p) => p.display_name || p.name;

  // Is the current value already represented by a package/custom option?
  const known = [...packagesList.map(pkgName), ...customProducts.map(c => c.name)];
  const valueUnlisted = value && value !== '__custom__' && !known.includes(value);

  const loadCustoms = () => interestedProductsApi.getAll().then(r => setCustomProducts(r.data || [])).catch(() => {});
  useEffect(() => {
    packagesApi.getAll().then(r => setPackagesList((r.data || []).filter(p => p.is_active !== false))).catch(() => {});
    loadCustoms();
  }, []);

  // Persist a brand-new individual product so it appears in the dropdown next time.
  const persistCustom = async () => {
    const n = (value || '').trim();
    if (!n) return;
    const known = [...packagesList.map(pkgName), ...customProducts.map(c => c.name)].map(s => (s || '').toLowerCase());
    if (known.includes(n.toLowerCase())) return;
    try { await interestedProductsApi.create({ name: n }); loadCustoms(); } catch { /* non-blocking */ }
  };

  return (
    <div>
      <Label className={labelClass}>{label}</Label>
      {customMode ? (
        <div>
          <div className="flex gap-1.5">
            <Input value={value || ''} onChange={e => onChange(e.target.value)} onBlur={persistCustom}
              placeholder="Type a one-off product name" autoFocus className={inputCls} data-testid="ip-custom" />
            <Button type="button" variant="outline" onClick={() => { setCustomMode(false); onChange(''); }}
              className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560]/40 px-2.5 shrink-0"
              title="Back to package list" aria-label="Back to package list" data-testid="ip-back">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Saved to your product list for next time.</p>
        </div>
      ) : (
        <select value={value || ''} onChange={e => {
            if (e.target.value === '__custom__') { setCustomMode(true); onChange(''); }
            else onChange(e.target.value);
          }} className={selCls} data-testid="ip-select">
          <option value="">Select a package…</option>
          {valueUnlisted && (
            <optgroup label="Current">
              <option value={value}>{value}</option>
            </optgroup>
          )}
          {packagesList.length > 0 && (
            <optgroup label="Our Packages">
              {packagesList.map(p => <option key={p.package_id} value={pkgName(p)}>{pkgName(p)}</option>)}
            </optgroup>
          )}
          {customProducts.length > 0 && (
            <optgroup label="Other / Individual">
              {customProducts.map(ip => <option key={ip.product_id} value={ip.name}>{ip.name}</option>)}
            </optgroup>
          )}
          <option value="__custom__">➕ Individual / Other…</option>
        </select>
      )}
    </div>
  );
}
