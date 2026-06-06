import React, { useState, useEffect } from 'react';
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
        <div className="flex gap-1.5">
          <Input value={value || ''} onChange={e => onChange(e.target.value)} onBlur={persistCustom}
            placeholder="Type product / package name" autoFocus className={inputCls} data-testid="ip-custom" />
          <Button type="button" variant="outline" onClick={() => { setCustomMode(false); onChange(''); }}
            className="border-[var(--border-color)] text-[var(--text-secondary)] whitespace-nowrap" title="Back to list">List</Button>
        </div>
      ) : (
        <select value={value || ''} onChange={e => {
            if (e.target.value === '__custom__') { setCustomMode(true); onChange(''); }
            else onChange(e.target.value);
          }} className={selCls} data-testid="ip-select">
          <option value="">Select…</option>
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
