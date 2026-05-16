import React, { useState, useEffect, useRef } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { visits as visitsApi, leads as leadsApi, schools as schoolsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Plus, MapPin, Check, Calendar, Navigation, Clock, X,
  Search, Link2, MapPinned, ChevronDown, ChevronUp,
  Phone, Info, Clipboard, ExternalLink, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const STATUS = {
  planned:    { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25',  label: 'Planned' },
  checked_in: { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25',    label: 'Checked In' },
  completed:  { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'Completed' },
  cancelled:  { cls: 'bg-red-500/15 text-red-400 border-red-500/25',       label: 'Cancelled' },
};
const STATUS_STRIPE = {
  planned: 'bg-amber-400', checked_in: 'bg-blue-400',
  completed: 'bg-emerald-400', cancelled: 'bg-red-400',
};

// ── Helpers ────────────────────────────────────────────────
function parseMapsInput(input) {
  if (!input?.trim()) return null;
  const s = input.trim();
  const atMatch = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  const qMatch = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
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

// ── Bottom Sheet (flex layout — header top, footer bottom, middle scrolls) ──
function BottomSheet({ open, onClose, title, children, footer }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-t-2xl flex flex-col max-h-[92dvh]">
        {/* Drag handle + header */}
        <div className="shrink-0 pt-2 pb-3 px-4 flex items-center justify-between border-b border-[var(--border-color)]">
          <div className="w-10 h-1 bg-[var(--border-color)] rounded-full absolute left-1/2 -translate-x-1/2 top-2" />
          <h3 className={`font-bold text-base ${tPri} mt-3`}>{title}</h3>
          <button onClick={onClose} className={`mt-3 ${tMuted} p-1.5 rounded-lg hover:bg-[var(--bg-primary)]`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">{children}</div>
        {/* Sticky footer (always visible) */}
        {footer && (
          <div className="shrink-0 px-4 pt-3 pb-6 bg-[var(--bg-card)] border-t border-[var(--border-color)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── School search autocomplete ─────────────────────────────
function SchoolSearch({ onSelect }) {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer                = useRef(null);

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
              className={`w-full text-left px-4 py-3 border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-primary)] active:opacity-70 transition-colors`}>
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
  const steps = [
    { step: '1', text: 'Open Google Maps on your phone' },
    { step: '2', text: 'Search for the school name or navigate to the location' },
    { step: '3', text: 'Long-press on the exact spot to drop a pin' },
    { step: '4', text: 'Tap the address bar at the bottom → tap Share → Copy link' },
    { step: '5', text: 'Paste the copied link in the field below' },
  ];
  const example = 'https://maps.google.com/?q=18.52073,73.85674';
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
        <div className={`mt-1 rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden`}>
          {/* Steps */}
          <div className="p-3.5 space-y-2.5">
            {steps.map(s => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  {s.step}
                </div>
                <p className={`text-xs ${tSec} leading-relaxed`}>{s.text}</p>
              </div>
            ))}
          </div>

          {/* Example */}
          <div className="mx-3.5 mb-3.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] p-3">
            <p className={`text-[10px] font-bold uppercase tracking-wide text-blue-400 mb-1.5`}>Example link formats that work:</p>
            <div className="space-y-1.5">
              {[
                'https://maps.google.com/?q=18.52073,73.85674',
                'https://maps.app.goo.gl/abc123xyz',
                '18.52073, 73.85674',
              ].map((ex, i) => (
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

// ── Plan Visit Form ────────────────────────────────────────
function PlanVisitForm({ onSaved, onClose, saving, setSaving }) {
  const EMPTY = {
    school_name: '', contact_person: '', contact_phone: '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_time: '10:00', purpose: '', planned_address: '',
    lat: null, lng: null,
  };
  const [form, setForm]         = useState(EMPTY);
  const [mapsInput, setMapsInput] = useState('');
  const [parsing, setParsing]   = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locPreview, setLocPreview] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function onSchoolSelected(r) {
    setForm(f => ({
      ...f,
      school_name:    r.name || f.school_name,
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
        <Label className={`text-xs font-semibold ${tSec} mb-2 block`}>Location <span className={`text-[10px] font-normal ${tMuted}`}>(optional)</span></Label>

        {/* Guide */}
        <MapsGuide />

        {/* Maps link input */}
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
          {parsing && <p className={`text-[11px] ${tMuted} mt-1.5 flex items-center gap-1`}><span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />Fetching address…</p>}
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

        {/* Manual address OR GPS */}
        <Input value={form.planned_address} onChange={e => set('planned_address', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-11 mb-2.5`}
          placeholder="Or type address manually…" />

        <button type="button" onClick={useGps} disabled={gpsLoading}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-purple-500/30 text-xs font-semibold text-purple-400 bg-purple-500/5 disabled:opacity-50 active:opacity-70 transition-all`}>
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

// ── Visit Card ─────────────────────────────────────────────
function VisitCard({ visit, onCheckIn, onComplete, checkingIn }) {
  const [expanded, setExpanded] = useState(false);

  function navigate() {
    if (visit.lat && visit.lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${visit.lat},${visit.lng}`, '_blank');
    } else if (visit.planned_address) {
      window.open(`https://www.google.com/maps/search/${encodeURIComponent(visit.planned_address)}`, '_blank');
    } else if (visit.school_name) {
      window.open(`https://www.google.com/maps/search/${encodeURIComponent(visit.school_name)}`, '_blank');
    }
  }

  const st = STATUS[visit.status] || STATUS.planned;
  const stripe = STATUS_STRIPE[visit.status] || 'bg-gray-400';

  return (
    <div className={`${card} rounded-2xl overflow-hidden`}>
      {/* Color stripe */}
      <div className={`h-1 w-full ${stripe}`} />

      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${tPri} truncate`}>{visit.school_name}</p>
            {visit.contact_person && (
              <p className={`text-xs ${tMuted} truncate`}>
                {visit.contact_person}{visit.contact_phone ? ` · ${visit.contact_phone}` : ''}
              </p>
            )}
          </div>
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border shrink-0 ${st.cls}`}>
            {st.label}
          </span>
        </div>

        {/* Meta info */}
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${tMuted} mb-3.5`}>
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{visit.visit_date}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{visit.visit_time}</span>
          {visit.planned_address && (
            <span className="flex items-center gap-1 max-w-[200px] truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{visit.planned_address}</span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={navigate}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-purple-500/10 text-purple-400 text-xs font-semibold active:opacity-70 transition-opacity">
            <Navigation className="h-3.5 w-3.5" /> Navigate
          </button>
          {visit.status === 'planned' && (
            <button onClick={() => onCheckIn(visit.visit_id)} disabled={checkingIn}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-500/10 text-blue-400 text-xs font-semibold disabled:opacity-50 active:opacity-70 transition-opacity">
              <MapPin className="h-3.5 w-3.5" /> Check In
            </button>
          )}
          {visit.status === 'checked_in' && (
            <button onClick={() => onComplete(visit.visit_id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-semibold active:opacity-70 transition-opacity">
              <Check className="h-3.5 w-3.5" /> Complete
            </button>
          )}
          {visit.contact_phone && (
            <a href={`tel:${visit.contact_phone}`}
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--bg-primary)] text-blue-400 shrink-0 border border-[var(--border-color)]">
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className={`h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--bg-primary)] ${tMuted} shrink-0 border border-[var(--border-color)]`}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3 space-y-1.5">
          {visit.purpose && (
            <p className={`text-xs ${tMuted}`}>Purpose: <span className={tSec}>{visit.purpose}</span></p>
          )}
          {visit.lat && visit.lng && (
            <p className={`text-xs ${tMuted}`}>
              GPS: <span className="text-emerald-400 font-mono text-[11px]">{visit.lat?.toFixed(5)}, {visit.lng?.toFixed(5)}</span>
              <a href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`} target="_blank" rel="noreferrer"
                className="ml-2 text-blue-400 inline-flex items-center gap-0.5">
                <ExternalLink className="h-2.5 w-2.5" /> View
              </a>
            </p>
          )}
          {visit.check_in_time && (
            <p className={`text-xs ${tMuted}`}>Checked in: <span className={tSec}>{new Date(visit.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></p>
          )}
          {visit.check_out_time && (
            <p className={`text-xs ${tMuted}`}>Checked out: <span className={tSec}>{new Date(visit.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></p>
          )}
          {visit.notes && (
            <p className={`text-xs ${tMuted}`}>Notes: <span className={tSec}>{visit.notes}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function SalesVisits() {
  const today = new Date().toISOString().split('T')[0];

  const [visits, setVisits]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [planOpen, setPlanOpen]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [filter, setFilter]         = useState('today');

  useEffect(() => { fetchVisits(); }, []);

  const fetchVisits = async () => {
    try {
      const res = await visitsApi.getAll();
      setVisits(res.data || []);
    } catch { toast.error('Failed to load visits'); }
    finally { setLoading(false); }
  };

  const handleCheckIn = async (visitId) => {
    setCheckingIn(true);
    try {
      const pos = await new Promise((res) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000 })
          : res(null)
      );
      await visitsApi.checkIn(visitId, pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
      toast.success('Checked in!');
      fetchVisits();
    } catch { toast.error('Check-in failed'); }
    finally { setCheckingIn(false); }
  };

  const handleComplete = async (visitId) => {
    try {
      await visitsApi.update(visitId, { status: 'completed' });
      toast.success('Visit marked complete!');
      fetchVisits();
    } catch { toast.error('Failed to mark complete'); }
  };

  const todayVisits    = visits.filter(v => v.visit_date === today);
  const upcomingVisits = visits.filter(v => v.visit_date > today);
  const pastVisits     = visits.filter(v => v.visit_date < today).slice(0, 30);
  const shown = filter === 'today' ? todayVisits : filter === 'upcoming' ? upcomingVisits : pastVisits;

  const todayWithCoords = todayVisits.filter(v => v.lat && v.lng);
  const openRoute = () => {
    if (!todayWithCoords.length) { toast.error("No GPS coordinates on today's visits"); return; }
    const pts = todayWithCoords.map(v => `${v.lat},${v.lng}`).join('/');
    window.open(`https://www.google.com/maps/dir/${pts}`, '_blank');
  };

  const tabs = [
    { id: 'today',    label: 'Today',    count: todayVisits.length },
    { id: 'upcoming', label: 'Upcoming', count: upcomingVisits.length },
    { id: 'past',     label: 'Past',     count: null },
  ];

  if (loading) return (
    <SalesLayout title="Visits" showBack>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Visits" showBack>
      <div className="pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${tPri}`}>Field Visits</h2>
            <p className={`text-xs ${tMuted}`}>{todayVisits.length} today · {upcomingVisits.length} upcoming</p>
          </div>
          <button onClick={() => setPlanOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-bold shadow-lg shadow-[#e94560]/20 active:opacity-80">
            <Plus className="h-4 w-4" /> Plan Visit
          </button>
        </div>

        {/* Route planner (today, 2+ GPS stops) */}
        {filter === 'today' && todayWithCoords.length >= 2 && (
          <button onClick={openRoute}
            className="w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 text-purple-400 font-bold text-sm active:opacity-70">
            <div className="flex items-center gap-2">
              <Navigation className="h-4 w-4" />
              <span>Plan My Route in Google Maps</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-purple-500/20 px-2 py-0.5 rounded-full">{todayWithCoords.length} stops</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </button>
        )}

        {/* Filter tabs */}
        <div className={`${card} rounded-xl p-1 flex gap-1`}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                filter === t.id
                  ? 'bg-[#e94560] text-white shadow-sm'
                  : `${tMuted} hover:bg-[var(--bg-primary)]`
              }`}>
              {t.label}
              {t.count !== null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${filter === t.id ? 'bg-white/20 text-white' : 'bg-[var(--bg-primary)]'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Visit list */}
        {shown.length === 0 ? (
          <div className={`${card} rounded-2xl p-10 text-center`}>
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-primary)] flex items-center justify-center mx-auto mb-3">
              <MapPin className={`h-8 w-8 ${tMuted} opacity-40`} />
            </div>
            <p className={`text-sm font-semibold ${tPri} mb-1`}>
              {filter === 'today' ? 'No visits today' : filter === 'upcoming' ? 'No upcoming visits' : 'No past visits'}
            </p>
            <p className={`text-xs ${tMuted} mb-4`}>
              {filter === 'past' ? 'Completed visits will appear here' : 'Plan a school visit to get started'}
            </p>
            {filter !== 'past' && (
              <button onClick={() => setPlanOpen(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-bold">
                <Plus className="h-4 w-4" /> Plan a Visit
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(v => (
              <VisitCard key={v.visit_id} visit={v}
                onCheckIn={handleCheckIn} onComplete={handleComplete} checkingIn={checkingIn} />
            ))}
          </div>
        )}

      </div>

      {/* Plan Visit Bottom Sheet with sticky submit */}
      <BottomSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Plan New Visit"
        footer={
          <button
            onClick={async () => {
              if (saving) return;
              const formEl = document.querySelector('[data-visit-form]');
              formEl?.dispatchEvent(new Event('save-visit', { bubbles: true }));
            }}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-[#e94560] text-white font-bold text-sm shadow-lg shadow-[#e94560]/25 disabled:opacity-40 active:opacity-80 transition-opacity">
            {saving ? 'Saving…' : 'Plan Visit'}
          </button>
        }
      >
        <PlanVisitFormConnected onSaved={fetchVisits} onClose={() => setPlanOpen(false)} saving={saving} setSaving={setSaving} />
      </BottomSheet>
    </SalesLayout>
  );
}

// Wrapper to handle save trigger from sticky footer button
function PlanVisitFormConnected({ onSaved, onClose, saving, setSaving }) {
  const EMPTY = {
    school_name: '', contact_person: '', contact_phone: '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_time: '10:00', purpose: '', planned_address: '',
    lat: null, lng: null,
  };
  const [form, setForm]         = useState(EMPTY);
  const [mapsInput, setMapsInput] = useState('');
  const [parsing, setParsing]   = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locPreview, setLocPreview] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function onSchoolSelected(r) {
    setForm(f => ({
      ...f,
      school_name:    r.name || f.school_name,
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
  });

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
