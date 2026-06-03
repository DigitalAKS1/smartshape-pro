import React, { useState, useRef, useEffect } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Search, Link2, MapPinned, Info, Clipboard, ExternalLink,
  ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { visits as visitsApi, leads as leadsApi, schools as schoolsApi } from '../../lib/api';

const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';

// ── Helpers ────────────────────────────────────────────────
function parseMapsInput(input) {
  if (!input?.trim()) return null;
  const s = input.trim();
  const atMatch  = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch)  return { lat: parseFloat(atMatch[1]),  lng: parseFloat(atMatch[2])  };
  const qMatch   = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch)   return { lat: parseFloat(qMatch[1]),   lng: parseFloat(qMatch[2])   };
  const rawMatch = s.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (rawMatch) return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
  return null;
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'SmartShapePro/1.0' } }
    );
    const d = await r.json();
    return d.display_name || `${lat}, ${lng}`;
  } catch { return `${lat}, ${lng}`; }
}

// ── School search autocomplete ─────────────────────────────
function SchoolSearch({ onSelect }) {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer                 = useRef(null);

  const search = (val) => {
    setQ(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const [lr, sr] = await Promise.all([
          leadsApi.getAll().catch(() => ({ data: [] })),
          schoolsApi.getAll().catch(() => ({ data: [] })),
        ]);
        const vl = val.toLowerCase();
        const fromLeads = (lr.data || [])
          .filter(l => l.company_name?.toLowerCase().includes(vl) || l.contact_name?.toLowerCase().includes(vl))
          .slice(0, 4)
          .map(l => ({ id: l.lead_id, name: l.company_name || l.contact_name, sub: l.contact_name + (l.contact_phone ? ' · ' + l.contact_phone : ''), phone: l.contact_phone, source: 'lead' }));
        const fromSchools = (sr.data || [])
          .filter(s => s.school_name?.toLowerCase().includes(vl))
          .slice(0, 4)
          .map(s => ({ id: s.school_id, name: s.school_name, sub: [s.city, s.state].filter(Boolean).join(', '), lat: s.lat, lng: s.lng, source: 'school' }));
        setResults([...fromSchools, ...fromLeads]);
      } catch { setResults([]); }
      setLoading(false);
    }, 350);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMuted}`} />
        <Input value={q} onChange={e => search(e.target.value)} placeholder="Search school or lead…"
          className={`pl-9 pr-9 bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11 text-sm`} />
        {q && (
          <button onClick={() => { setQ(''); setResults([]); }} className={`absolute right-3 top-1/2 -translate-y-1/2 ${tMuted}`}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {(results.length > 0 || loading) && (
        <div className={`absolute top-full left-0 right-0 z-30 mt-1 ${card} rounded-xl overflow-hidden shadow-2xl`}>
          {loading && <div className={`px-4 py-3 text-sm ${tMuted}`}>Searching…</div>}
          {results.map(r => (
            <button key={r.id} onClick={() => { onSelect(r); setQ(''); setResults([]); }}
              className="w-full text-left px-4 py-3 border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-primary)] active:opacity-70 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${tPri} truncate`}>{r.name}</p>
                  {r.sub && <p className={`text-xs ${tMuted} truncate`}>{r.sub}</p>}
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold shrink-0 ${r.source === 'school' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                  {r.source}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Google Maps guide ──────────────────────────────────────
function MapsGuide() {
  const [open, setOpen] = useState(false);
  const example = 'https://maps.google.com/?q=18.52073,73.85674';
  const steps = [
    { step: '1', text: 'Open Google Maps on your phone' },
    { step: '2', text: 'Search for the school name or navigate to the location' },
    { step: '3', text: 'Long-press on the exact spot to drop a pin' },
    { step: '4', text: 'Tap the address bar at the bottom → tap Share → Copy link' },
    { step: '5', text: 'Paste the copied link in the field below' },
  ];
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl border ${open ? 'border-blue-500/40 bg-blue-500/8' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'} transition-all`}>
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-400 shrink-0" />
          <span className={`text-xs font-semibold ${open ? 'text-blue-400' : tSec}`}>How to get a Google Maps link?</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-blue-400" /> : <ChevronDown className={`h-4 w-4 ${tMuted}`} />}
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden">
          <div className="p-3.5 space-y-2.5">
            {steps.map(s => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">{s.step}</div>
                <p className={`text-xs ${tSec} leading-relaxed`}>{s.text}</p>
              </div>
            ))}
          </div>
          <div className="mx-3.5 mb-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-400 mb-1.5">Example link formats that work:</p>
            <div className="space-y-1.5">
              {['https://maps.google.com/?q=18.52073,73.85674', 'https://maps.app.goo.gl/abc123xyz', '18.52073, 73.85674'].map((ex, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <code className={`text-[10px] ${tMuted} break-all`}>{ex}</code>
                </div>
              ))}
            </div>
            <button type="button"
              onClick={() => { navigator.clipboard?.writeText(example); toast.success('Example copied — now paste in the link field above'); }}
              className="mt-2.5 flex items-center gap-1.5 text-[10px] font-semibold text-blue-400">
              <Clipboard className="h-3 w-3" /> Copy example to try
            </button>
          </div>
          <div className="px-3.5 pb-3.5">
            <a href="https://maps.google.com" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-400">
              <ExternalLink className="h-3 w-3" /> Open Google Maps
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * VisitFormDialog — Body content for the "Plan New Visit" bottom sheet.
 * Submit is triggered via a custom DOM event ('save-visit') dispatched by the
 * sticky footer button in the parent SalesVisits sheet.
 */
export default function VisitFormDialog({ onSaved, onClose, saving, setSaving }) {
  const EMPTY = {
    school_name: '', contact_person: '', contact_phone: '',
    visit_date:  new Date().toISOString().split('T')[0],
    visit_time:  '10:00', purpose: '', planned_address: '',
    lat: null, lng: null,
  };
  const [form, setForm]           = useState(EMPTY);
  const [mapsInput, setMapsInput] = useState('');
  const [parsing, setParsing]     = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locPreview, setLocPreview] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function onSchoolSelected(r) {
    setForm(f => ({
      ...f,
      school_name:    r.name  || f.school_name,
      contact_person: r.sub?.split(' · ')[0] || f.contact_person,
      contact_phone:  r.phone || f.contact_phone,
      lat: r.lat || f.lat,
      lng: r.lng || f.lng,
    }));
    if (r.lat && r.lng) setLocPreview({ lat: r.lat, lng: r.lng, address: r.name });
  }

  async function handleMapsInput(val) {
    setMapsInput(val);
    if (!val.trim()) { setLocPreview(null); return; }
    const coords = parseMapsInput(val);
    if (coords) {
      setParsing(true);
      const address = await reverseGeocode(coords.lat, coords.lng);
      setLocPreview({ ...coords, address });
      setForm(f => ({ ...f, lat: coords.lat, lng: coords.lng, planned_address: address }));
      setParsing(false);
      toast.success('Location extracted from link!');
    }
  }

  async function useGps() {
    setGpsLoading(true);
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
          : rej(new Error('GPS not supported'))
      );
      const { latitude: lat, longitude: lng } = pos.coords;
      const address = await reverseGeocode(lat, lng);
      setLocPreview({ lat, lng, address });
      setForm(f => ({ ...f, lat, lng, planned_address: address }));
      toast.success('Current location set');
    } catch { toast.error('Could not get GPS location'); }
    finally { setGpsLoading(false); }
  }

  async function handleSave() {
    if (!form.school_name.trim()) { toast.error('School name is required'); return; }
    setSaving(true);
    try {
      await visitsApi.create({
        school_name:     form.school_name,
        contact_person:  form.contact_person,
        contact_phone:   form.contact_phone,
        visit_date:      form.visit_date,
        visit_time:      form.visit_time,
        purpose:         form.purpose,
        planned_address: form.planned_address,
        lat:             form.lat,
        lng:             form.lng,
      });
      toast.success('Visit planned!');
      onSaved();
      onClose();
    } catch { toast.error('Failed to save visit'); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    const handler = () => handleSave();
    document.addEventListener('save-visit', handler);
    return () => document.removeEventListener('save-visit', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, saving]);

  return (
    <div className="px-4 pt-3 pb-4 space-y-4">
      {/* School search */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Search School / Lead</Label>
        <SchoolSearch onSelect={onSchoolSelected} />
      </div>

      {/* School name */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>School Name <span className="text-[#e94560]">*</span></Label>
        <Input value={form.school_name} onChange={e => set('school_name', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`}
          placeholder="e.g. Delhi Public School" />
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Contact Person</Label>
          <Input value={form.contact_person} onChange={e => set('contact_person', e.target.value)}
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`} placeholder="Principal…" />
        </div>
        <div>
          <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Phone</Label>
          <Input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)}
            type="tel" className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`} placeholder="+91…" />
        </div>
      </div>

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Visit Date <span className="text-[#e94560]">*</span></Label>
          <Input type="date" value={form.visit_date} onChange={e => set('visit_date', e.target.value)}
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`} />
        </div>
        <div>
          <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Visit Time</Label>
          <Input type="time" value={form.visit_time} onChange={e => set('visit_time', e.target.value)}
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`} />
        </div>
      </div>

      {/* Location */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-2 block`}>
          Location <span className={`text-[10px] font-normal ${tMuted}`}>(optional)</span>
        </Label>

        <MapsGuide />

        <div className={`${card} rounded-xl p-3.5 mb-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="h-3.5 w-3.5 text-[#e94560]" />
            <span className={`text-xs font-semibold ${tSec}`}>Paste Google Maps Link or Coordinates</span>
          </div>
          <div className="relative">
            <Input
              value={mapsInput}
              onChange={e => handleMapsInput(e.target.value)}
              className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10 text-sm pr-8`}
              placeholder="maps.google.com/... or 18.52, 73.85"
            />
            {mapsInput && (
              <button type="button" onClick={() => { setMapsInput(''); setLocPreview(null); }}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${tMuted}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {parsing && (
            <p className={`text-[11px] ${tMuted} mt-1.5 flex items-center gap-1.5`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Fetching address…
            </p>
          )}
          {locPreview && !parsing && (
            <div className="mt-2.5 flex items-start gap-2.5 bg-emerald-500/8 rounded-lg px-3 py-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-emerald-400 font-semibold mb-0.5">Location confirmed</p>
                <p className={`text-[11px] ${tMuted} leading-relaxed line-clamp-2`}>{locPreview.address}</p>
                <p className="text-[10px] text-emerald-400/70 mt-0.5 font-mono">{locPreview.lat?.toFixed(5)}, {locPreview.lng?.toFixed(5)}</p>
              </div>
            </div>
          )}
        </div>

        <Input value={form.planned_address} onChange={e => set('planned_address', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11 mb-2.5`}
          placeholder="Or type address manually…" />

        <button type="button" onClick={useGps} disabled={gpsLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-purple-500/30 text-xs font-semibold text-purple-400 bg-purple-500/5 disabled:opacity-50 active:opacity-70">
          <MapPinned className="h-4 w-4" />
          {gpsLoading ? 'Getting GPS location…' : 'Use My Current GPS Location'}
        </button>
      </div>

      {/* Purpose */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Purpose / Agenda</Label>
        <Input value={form.purpose} onChange={e => set('purpose', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11`}
          placeholder="Product demo, follow-up meeting…" />
      </div>
    </div>
  );
}
