import React, { useState, useEffect, useRef } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { visits as visitsApi, leads as leadsApi, schools as schoolsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Plus, MapPin, Check, Calendar, Navigation, Clock, X,
  Search, Link2, MapPinned, ChevronDown, ChevronUp,
  Building2, Phone, MessageSquare, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const STATUS_CLS = {
  planned:    'bg-yellow-500/20 text-yellow-400',
  checked_in: 'bg-blue-500/20 text-blue-400',
  completed:  'bg-green-500/20 text-green-400',
  cancelled:  'bg-red-500/20 text-red-400',
};

// ── Parse Google Maps URLs / raw coordinates ───────────────
function parseMapsInput(input) {
  if (!input?.trim()) return null;
  const s = input.trim();
  // @lat,lng in full Maps URL
  const atMatch = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  // q=lat,lng in URL
  const qMatch = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  // Raw "18.52, 73.85" coordinates
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

// ── Bottom Sheet wrapper ───────────────────────────────────
function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--bg-card)] z-10 pt-3 pb-2 px-4 flex items-center justify-between border-b border-[var(--border-color)]">
          <div className="w-10 h-1 bg-[var(--border-color)] rounded-full absolute left-1/2 -translate-x-1/2 top-2" />
          <h3 className={`font-bold text-base ${tPri} mt-2`}>{title}</h3>
          <button onClick={onClose} className={`mt-2 ${tMuted} p-1`}><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── School / Lead search autocomplete ─────────────────────
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
          .slice(0, 5)
          .map(l => ({
            id: l.lead_id, name: l.company_name || l.contact_name,
            sub: l.contact_name + (l.contact_phone ? ' · ' + l.contact_phone : ''),
            phone: l.contact_phone, source: 'lead',
          }));
        const fromSchools = (sr.data || [])
          .filter(s => s.school_name?.toLowerCase().includes(vl))
          .slice(0, 5)
          .map(s => ({
            id: s.school_id, name: s.school_name,
            sub: [s.city, s.state].filter(Boolean).join(', '),
            lat: s.lat, lng: s.lng, source: 'school',
          }));
        setResults([...fromSchools, ...fromLeads]);
      } catch { setResults([]); }
      setLoading(false);
    }, 350);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMuted}`} />
        <Input value={q} onChange={e => search(e.target.value)}
          placeholder="Search school or lead name..."
          className={`pl-9 bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`} />
        {q && (
          <button onClick={() => { setQ(''); setResults([]); }} className={`absolute right-3 top-1/2 -translate-y-1/2 ${tMuted}`}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {(results.length > 0 || loading) && (
        <div className={`absolute top-full left-0 right-0 z-20 mt-1 ${card} rounded-xl overflow-hidden shadow-xl`}>
          {loading && <div className={`px-4 py-3 text-sm ${tMuted}`}>Searching...</div>}
          {results.map(r => (
            <button key={r.id} onClick={() => { onSelect(r); setQ(''); setResults([]); }}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-primary)] active:opacity-70`}>
              <p className={`text-sm font-semibold ${tPri}`}>{r.name}</p>
              {r.sub && <p className={`text-xs ${tMuted}`}>{r.sub}</p>}
              <span className={`text-[9px] ${r.source === 'school' ? 'text-blue-400' : 'text-purple-400'} uppercase font-bold`}>{r.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Plan Visit Form ────────────────────────────────────────
function PlanVisitForm({ onSaved, onClose }) {
  const EMPTY = {
    school_name: '', contact_person: '', contact_phone: '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_time: '10:00', purpose: '', planned_address: '',
    lat: null, lng: null,
  };
  const [form, setForm]           = useState(EMPTY);
  const [mapsInput, setMapsInput] = useState('');
  const [parsing, setParsing]     = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [locPreview, setLocPreview] = useState(null); // { lat, lng, address }

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
      toast.success('Location extracted!');
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
      toast.success('Current location used');
    } catch { toast.error('Could not get GPS location'); }
    finally { setGpsLoading(false); }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.school_name.trim()) { toast.error('School name is required'); return; }
    setSaving(true);
    try {
      await visitsApi.create({
        school_name:    form.school_name,
        contact_person: form.contact_person,
        contact_phone:  form.contact_phone,
        visit_date:     form.visit_date,
        visit_time:     form.visit_time,
        purpose:        form.purpose,
        planned_address: form.planned_address,
        lat:            form.lat,
        lng:            form.lng,
      });
      toast.success('Visit planned!');
      onSaved();
      onClose();
    } catch { toast.error('Failed to save visit'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className="px-4 pb-8 pt-2 space-y-4">

      {/* School search */}
      <div>
        <Label className={`text-xs ${tSec} mb-1.5 block`}>Search School / Lead</Label>
        <SchoolSearch onSelect={onSchoolSelected} />
      </div>

      {/* School name */}
      <div>
        <Label className={`text-xs ${tSec} mb-1.5 block`}>School Name *</Label>
        <Input value={form.school_name} onChange={e => set('school_name', e.target.value)} required
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`}
          placeholder="e.g. DPS School" />
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={`text-xs ${tSec} mb-1.5 block`}>Contact Person</Label>
          <Input value={form.contact_person} onChange={e => set('contact_person', e.target.value)}
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`} placeholder="Principal..." />
        </div>
        <div>
          <Label className={`text-xs ${tSec} mb-1.5 block`}>Phone</Label>
          <Input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)}
            type="tel" className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`} placeholder="+91..." />
        </div>
      </div>

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={`text-xs ${tSec} mb-1.5 block`}>Date *</Label>
          <Input type="date" value={form.visit_date} onChange={e => set('visit_date', e.target.value)} required
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`} />
        </div>
        <div>
          <Label className={`text-xs ${tSec} mb-1.5 block`}>Time *</Label>
          <Input type="time" value={form.visit_time} onChange={e => set('visit_time', e.target.value)} required
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`} />
        </div>
      </div>

      {/* Location section */}
      <div>
        <Label className={`text-xs ${tSec} mb-1.5 block`}>Location</Label>

        {/* Maps link paste */}
        <div className={`${card} rounded-xl p-3 mb-2`}>
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="h-3.5 w-3.5 text-[#e94560]" />
            <span className={`text-xs font-semibold ${tSec}`}>Paste Google Maps Link</span>
          </div>
          <Input
            value={mapsInput}
            onChange={e => handleMapsInput(e.target.value)}
            className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-9 text-sm`}
            placeholder="Paste maps.google.com link or 18.52,73.85..."
          />
          {parsing && <p className={`text-[11px] ${tMuted} mt-1.5`}>Extracting location...</p>}
          {locPreview && (
            <div className="mt-2 flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />
              <div>
                <p className={`text-xs text-green-400 font-medium`}>Location set</p>
                <p className={`text-[11px] ${tMuted} line-clamp-2`}>{locPreview.address}</p>
                <p className={`text-[10px] text-green-400/70`}>{locPreview.lat?.toFixed(5)}, {locPreview.lng?.toFixed(5)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Manual address */}
        <Input value={form.planned_address} onChange={e => set('planned_address', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10 mb-2`}
          placeholder="Or type address manually..." />

        {/* GPS button */}
        <button type="button" onClick={useGps} disabled={gpsLoading}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-color)] text-xs font-semibold ${tSec} bg-[var(--bg-primary)] disabled:opacity-50`}>
          <MapPinned className="h-4 w-4 text-purple-400" />
          {gpsLoading ? 'Getting GPS...' : 'Use My Current Location'}
        </button>
      </div>

      {/* Purpose */}
      <div>
        <Label className={`text-xs ${tSec} mb-1.5 block`}>Purpose / Agenda</Label>
        <Input value={form.purpose} onChange={e => set('purpose', e.target.value)}
          className={`bg-[var(--bg-primary)] border-[var(--border-color)] ${tPri} h-10`}
          placeholder="Product demo, follow-up meeting..." />
      </div>

      <button type="submit" disabled={saving}
        className="w-full py-3.5 rounded-xl bg-[#e94560] text-white font-bold text-sm disabled:opacity-40">
        {saving ? 'Saving...' : 'Plan Visit'}
      </button>
    </form>
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

  const statusCls = STATUS_CLS[visit.status] || 'bg-gray-500/20 text-gray-400';

  return (
    <div className={`${card} rounded-xl overflow-hidden`}>
      {/* Main row */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${tPri} truncate`}>{visit.school_name}</p>
            <p className={`text-[11px] ${tMuted} truncate`}>
              {visit.contact_person}{visit.contact_phone ? ` · ${visit.contact_phone}` : ''}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${statusCls}`}>
            {visit.status}
          </span>
        </div>

        {/* Meta */}
        <div className={`flex items-center gap-3 text-[11px] ${tMuted} mb-3 flex-wrap`}>
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{visit.visit_date}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{visit.visit_time}</span>
          {visit.planned_address && (
            <span className="flex items-center gap-1 truncate max-w-[200px]"><MapPin className="h-3 w-3 flex-shrink-0" />{visit.planned_address}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={navigate}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-500/10 text-purple-400 text-xs font-semibold active:opacity-70">
            <Navigation className="h-3.5 w-3.5" /> Navigate
          </button>
          {visit.status === 'planned' && (
            <button onClick={() => onCheckIn(visit.visit_id)} disabled={checkingIn}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-semibold disabled:opacity-50 active:opacity-70">
              <MapPin className="h-3.5 w-3.5" /> Check In
            </button>
          )}
          {visit.status === 'checked_in' && (
            <button onClick={() => onComplete(visit.visit_id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold active:opacity-70">
              <Check className="h-3.5 w-3.5" /> Complete
            </button>
          )}
          {visit.contact_phone && (
            <a href={`tel:${visit.contact_phone}`}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 flex-shrink-0">
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className={`h-9 w-9 flex items-center justify-center rounded-lg bg-[var(--bg-primary)] ${tMuted} flex-shrink-0`}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className={`px-3.5 pb-3.5 border-t border-[var(--border-color)] pt-3 text-xs space-y-1.5`}>
          {visit.purpose && <p className={tMuted}>Purpose: <span className={tSec}>{visit.purpose}</span></p>}
          {visit.lat && visit.lng && <p className={tMuted}>GPS: <span className={`text-green-400`}>{visit.lat?.toFixed(5)}, {visit.lng?.toFixed(5)}</span></p>}
          {visit.check_in_time && <p className={tMuted}>Checked in: <span className={tSec}>{new Date(visit.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></p>}
          {visit.check_out_time && <p className={tMuted}>Checked out: <span className={tSec}>{new Date(visit.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></p>}
          {visit.notes && <p className={tMuted}>Notes: <span className={tSec}>{visit.notes}</span></p>}
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
  const [filter, setFilter]         = useState('today'); // today | upcoming | past

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

  // Filtered views
  const todayVisits    = visits.filter(v => v.visit_date === today);
  const upcomingVisits = visits.filter(v => v.visit_date > today);
  const pastVisits     = visits.filter(v => v.visit_date < today).slice(0, 20);

  const shown = filter === 'today' ? todayVisits : filter === 'upcoming' ? upcomingVisits : pastVisits;

  // Route planner for today
  const todayWithCoords = todayVisits.filter(v => v.lat && v.lng);
  const openRoute = () => {
    if (!todayWithCoords.length) { toast.error('No GPS coordinates on today\'s visits'); return; }
    const pts = todayWithCoords.map(v => `${v.lat},${v.lng}`).join('/');
    window.open(`https://www.google.com/maps/dir/${pts}`, '_blank');
  };

  if (loading) return (
    <SalesLayout title="Visits" showBack>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Visits" showBack>
      <div className="pb-28">

        {/* Header actions */}
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-bold ${tPri}`}>Field Visits</h2>
          <button onClick={() => setPlanOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#e94560] text-white text-sm font-bold active:opacity-80">
            <Plus className="h-4 w-4" /> Plan Visit
          </button>
        </div>

        {/* Route planner (today only, if 2+ with GPS) */}
        {filter === 'today' && todayWithCoords.length >= 2 && (
          <button onClick={openRoute}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 text-sm font-bold mb-4 active:opacity-70">
            <Navigation className="h-4 w-4" /> Plan My Route ({todayWithCoords.length} stops) in Google Maps
          </button>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-4">
          {[
            { id: 'today',    label: `Today (${todayVisits.length})` },
            { id: 'upcoming', label: `Upcoming (${upcomingVisits.length})` },
            { id: 'past',     label: `Past` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-[11px] px-3 py-1.5 rounded-full font-medium border transition-all ${
                filter === f.id ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} ${tMuted}`
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Visit list */}
        {shown.length === 0 ? (
          <div className={`${card} rounded-xl p-10 text-center`}>
            <MapPin className={`h-10 w-10 ${tMuted} mx-auto mb-2 opacity-40`} />
            <p className={`text-sm ${tMuted} mb-3`}>
              {filter === 'today' ? 'No visits scheduled today' :
               filter === 'upcoming' ? 'No upcoming visits' : 'No past visits'}
            </p>
            {filter !== 'past' && (
              <button onClick={() => setPlanOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#e94560] text-white text-sm font-bold">
                <Plus className="h-4 w-4" /> Plan a Visit
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(v => (
              <VisitCard key={v.visit_id} visit={v} onCheckIn={handleCheckIn} onComplete={handleComplete} checkingIn={checkingIn} />
            ))}
          </div>
        )}

      </div>

      {/* Plan Visit Bottom Sheet */}
      <BottomSheet open={planOpen} onClose={() => setPlanOpen(false)} title="Plan New Visit">
        <PlanVisitForm onSaved={fetchVisits} onClose={() => setPlanOpen(false)} />
      </BottomSheet>
    </SalesLayout>
  );
}
