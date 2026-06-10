import React, { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { INDIAN_STATES } from '../../lib/crmConstants';

/**
 * India address block: PIN Code drives City + State.
 * Enter a 6-digit PIN → looks it up via India Post (free, no key) and
 * auto-selects the State + turns City into a dropdown of the localities under
 * that PIN. City has a "type manually" fallback; State stays overridable.
 *
 * Controlled: pass { pincode, city, state } and onChange(next) returns the full
 * patched object. Designed to slot into the existing 3-up grid of CRM forms.
 */
const normState = (s) => (s || '').toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ').trim();

export default function AddressFields({
  pincode = '', city = '', state = '', onChange,
  labelClass = 'text-[var(--text-secondary)] text-xs',
  inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
}) {
  const [areas, setAreas] = useState([]);
  const [status, setStatus] = useState('');     // '' | 'loading' | 'ok' | 'notfound' | 'error'
  const [cityManual, setCityManual] = useState(false);
  const lastLookup = useRef('');
  const initialPin = useRef(String(pincode || '').trim());
  const selCls = `w-full h-10 px-3 rounded-md text-sm ${inputCls}`;

  const set = (patch) => onChange({ pincode, city, state, ...patch });

  useEffect(() => {
    const pin = String(pincode || '').trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) { setAreas([]); setStatus(''); lastLookup.current = ''; return; }
    if (lastLookup.current === pin) return;
    const aggressive = pin !== initialPin.current;   // user changed the PIN → auto-fill over existing values
    const t = setTimeout(async () => {
      lastLookup.current = pin;
      setStatus('loading'); setAreas([]);
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        const rec = (await res.json())?.[0];
        if (rec?.Status === 'Success' && rec.PostOffice?.length) {
          const pos = rec.PostOffice;
          const names = [...new Set(pos.map((p) => p.Name).filter(Boolean))];
          setAreas(names); setStatus('ok'); setCityManual(false);
          const district = pos[0].District || '';
          const matched = INDIAN_STATES.find((s) => normState(s) === normState(pos[0].State)) || state;
          const nextState = (aggressive || !state) ? matched : state;
          const nextCity = (city && names.includes(city)) ? city : ((aggressive || !city) ? district : city);
          if (nextState !== state || nextCity !== city) set({ city: nextCity, state: nextState });
        } else { setStatus('notfound'); }
      } catch { setStatus('error'); }
    }, 400);
    return () => clearTimeout(t);
  }, [pincode]); // eslint-disable-line react-hooks/exhaustive-deps

  const cityOptions = [...new Set([...(city ? [city] : []), ...areas])];
  const showCityDropdown = areas.length > 0 && !cityManual;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <Label className={labelClass}>Pin Code</Label>
        <Input value={pincode || ''} inputMode="numeric" maxLength={6}
          onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          placeholder="6 digits" className={inputCls} data-testid="addr-pincode" />
        <p className="text-[10px] mt-0.5 h-3 leading-3"
           style={{ color: (status === 'error' || status === 'notfound') ? '#ef4444' : 'var(--text-muted)' }}>
          {status === 'loading' ? 'Looking up…' : status === 'ok' ? '✓ Auto-filled from PIN'
            : status === 'notfound' ? 'PIN not found' : status === 'error' ? 'Lookup unavailable — type manually' : ''}
        </p>
      </div>
      <div>
        <Label className={labelClass}>City / Area</Label>
        {showCityDropdown ? (
          <select value={cityOptions.includes(city) ? city : ''}
            onChange={(e) => { e.target.value === '__manual__' ? setCityManual(true) : set({ city: e.target.value }); }}
            className={selCls} data-testid="addr-city">
            <option value="">Select area…</option>
            {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__manual__">✎ Type manually…</option>
          </select>
        ) : (
          <Input value={city || ''} onChange={(e) => set({ city: e.target.value })}
            placeholder="City / area" className={inputCls} data-testid="addr-city" />
        )}
      </div>
      <div>
        <Label className={labelClass}>State</Label>
        <select value={state || ''} onChange={(e) => set({ state: e.target.value })} className={selCls} data-testid="addr-state">
          <option value="">Select state</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}
