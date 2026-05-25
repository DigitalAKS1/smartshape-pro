import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Navigation, MapPin, CheckCircle2, Clock, Flag, ChevronRight,
  Building2, Home, Loader2, Play, Square, Plus, ReceiptText,
} from 'lucide-react';
import { journeyApi, visits as visitsApi, expenses } from '../lib/api';

const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDuration = (fromIso, toIso) => {
  if (!fromIso) return '';
  const ms = (toIso ? new Date(toIso) : new Date()) - new Date(fromIso);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const OUTCOMES = [
  { value: 'interested',          label: 'Interested' },
  { value: 'follow_up',           label: 'Follow Up' },
  { value: 'demo_booked',         label: 'Demo Booked' },
  { value: 'not_interested',      label: 'Not Interested' },
  { value: 'callback_requested',  label: 'Callback Requested' },
  { value: 'already_purchased',   label: 'Already Purchased' },
];

function getGps() {
  return new Promise((res, rej) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 })
      : rej(new Error('GPS not supported'))
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StopDot({ num, active, done }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
      done   ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
      active ? 'bg-[#e94560]/20 text-[#e94560] border border-[#e94560]/40 animate-pulse' :
               'bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]'
    }`}>
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : num}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JourneyTracker({ todayVisits = [] }) {
  const [journey,       setJourney]       = useState(null);   // null = loading, {} = no journey
  const [loaded,        setLoaded]        = useState(false);
  const [busy,          setBusy]          = useState(false);

  // Start-journey UI
  const [startType,     setStartType]     = useState('office');

  // Arrive-at-stop sheet
  const [arriveOpen,    setArriveOpen]    = useState(false);
  const [schoolName,    setSchoolName]    = useState('');
  const [linkedVisit,   setLinkedVisit]   = useState('');

  // Depart-stop sheet
  const [departOpen,    setDepartOpen]    = useState(false);
  const [outcome,       setOutcome]       = useState('');

  // Add-expense prompt after journey end
  const [expensePrompt, setExpensePrompt] = useState(null);   // journey doc when ended

  const tickRef = useRef(null);
  const [tick, setTick] = useState(0);

  const loadJourney = useCallback(async () => {
    try {
      const r = await journeyApi.active();
      setJourney(Object.keys(r.data).length ? r.data : null);
    } catch {
      setJourney(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { loadJourney(); }, [loadJourney]);

  // Tick every minute to refresh time displays while on journey
  useEffect(() => {
    if (!journey) return;
    tickRef.current = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(tickRef.current);
  }, [journey]);

  // ── Actions ──

  const startJourney = async () => {
    setBusy(true);
    try {
      const pos = await getGps();
      const r = await journeyApi.start({
        start_type: startType,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      setJourney(r.data);
      toast.success('Field journey started!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not get GPS. Please allow location access.');
    }
    setBusy(false);
  };

  const arrive = async () => {
    if (!schoolName.trim()) { toast.error('Enter school / destination name'); return; }
    setBusy(true);
    try {
      const pos = await getGps();
      const r = await journeyApi.arrive(journey.journey_id, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        school_name: schoolName.trim(),
        visit_id: linkedVisit || undefined,
      });
      setJourney(prev => ({
        ...prev,
        stops:    [...(prev.stops || []), r.data.stop],
        total_km: r.data.total_km,
      }));
      setArriveOpen(false);
      setSchoolName('');
      setLinkedVisit('');
      toast.success(`Arrived at ${schoolName.trim()} · +${r.data.stop.km_from_prev} km`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'GPS error — try again');
    }
    setBusy(false);
  };

  const depart = async () => {
    setBusy(true);
    try {
      await journeyApi.depart(journey.journey_id, { outcome: outcome || undefined });
      const stops = journey.stops || [];
      const idx   = stops.length - 1;
      const updated = stops.map((s, i) => i === idx
        ? { ...s, departed_at: new Date().toISOString(), status: 'completed', outcome }
        : s
      );
      setJourney(prev => ({ ...prev, stops: updated }));
      setDepartOpen(false);
      setOutcome('');
      toast.success('Visit marked done. Ready for next stop!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error');
    }
    setBusy(false);
  };

  const endJourney = async () => {
    if (!window.confirm('End today\'s field journey?')) return;
    setBusy(true);
    try {
      const pos = await getGps().catch(() => null);
      const r = await journeyApi.end(journey.journey_id, {
        lat: pos?.coords.latitude  ?? null,
        lng: pos?.coords.longitude ?? null,
      });
      setJourney(null);
      setExpensePrompt(r.data);
      toast.success(`Journey complete! Total: ${r.data.total_km} km`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error ending journey');
    }
    setBusy(false);
  };

  const addExpense = async () => {
    if (!expensePrompt) return;
    try {
      await expenses.create({
        expense_type:   'travel',
        category:       'fuel',
        description:    `Field visit — ${expensePrompt.stops?.length || 0} stop(s) on ${expensePrompt.date}`,
        distance_km:    expensePrompt.total_km,
        date:           expensePrompt.date,
        amount:         0,  // backend will calculate from km × rate
        receipt_url:    '',
      });
      toast.success('Travel expense added!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not create expense');
    }
    setExpensePrompt(null);
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  if (!loaded) return null;

  const stops       = journey?.stops || [];
  const lastStop    = stops[stops.length - 1];
  const atStop      = lastStop?.status === 'arrived';   // arrived but not departed
  const unlinkedTodayVisits = todayVisits.filter(v =>
    v.status === 'planned' && !stops.some(s => s.visit_id === (v.visit_id || v.plan_id))
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  // Post-journey expense prompt
  if (expensePrompt) {
    return (
      <div className="bg-[var(--bg-card)] border border-green-500/30 rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <span className="font-semibold text-[var(--text-primary)]">Journey Completed!</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Total KM',   value: `${expensePrompt.total_km} km` },
            { label: 'Stops',      value: expensePrompt.stops?.length || 0 },
            { label: 'Duration',   value: fmtDuration(expensePrompt.start_time, expensePrompt.end_time) },
          ].map(s => (
            <div key={s.label} className="bg-[var(--bg-primary)] rounded-xl p-2.5 text-center">
              <p className="text-[var(--text-primary)] font-bold text-sm">{s.value}</p>
              <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={addExpense}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-semibold">
            <ReceiptText className="h-4 w-4" /> Add as Travel Expense
          </button>
          <button onClick={() => setExpensePrompt(null)}
            className="px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] text-sm">
            Skip
          </button>
        </div>
      </div>
    );
  }

  // No active journey — Start button
  if (!journey) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden mb-4">
        <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-[var(--border-color)]">
          <Navigation className="h-4 w-4 text-[#e94560]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Field Journey</span>
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">Auto-tracks km between visits</span>
        </div>
        <div className="p-5">
          {/* Start from toggle */}
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-2">Starting from</p>
          <div className="flex gap-2 mb-4">
            {[
              { key: 'office', label: 'Office', Icon: Building2 },
              { key: 'home',   label: 'Home',   Icon: Home },
            ].map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setStartType(key)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  startType === key
                    ? 'bg-[#e94560]/15 border-[#e94560]/50 text-[#e94560]'
                    : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                }`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <button onClick={startJourney} disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#e94560] text-white font-semibold text-sm hover:bg-[#f05c75] transition-colors disabled:opacity-60">
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Play className="h-4 w-4" />}
            {busy ? 'Getting GPS…' : 'Start Field Work'}
          </button>
        </div>
      </div>
    );
  }

  // Active journey
  return (
    <>
      <div className="bg-[var(--bg-card)] border border-[#e94560]/30 rounded-2xl overflow-hidden mb-4">
        {/* Header */}
        <div className="px-4 pt-3 pb-2.5 flex items-center gap-2 border-b border-[var(--border-color)] bg-[#e94560]/5">
          <Navigation className="h-4 w-4 text-[#e94560]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Journey Active</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-[#e94560] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e94560] animate-pulse" />
            {journey.total_km} km · {fmtDuration(journey.start_time)}
          </span>
        </div>

        <div className="p-4 space-y-3">
          {/* Journey start row */}
          <div className="flex items-center gap-3 text-xs">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-green-500/20 border border-green-500/40">
              {journey.start_type === 'home'
                ? <Home className="h-3 w-3 text-green-400" />
                : <Building2 className="h-3 w-3 text-green-400" />}
            </div>
            <div className="flex-1">
              <span className="text-[var(--text-secondary)] font-medium">
                {journey.start_type === 'home' ? 'Started from Home' : 'Started from Office'}
              </span>
              <span className="text-[var(--text-muted)] ml-2">{fmt(journey.start_time)}</span>
            </div>
          </div>

          {/* Stops */}
          {stops.map((stop, i) => (
            <div key={i} className="flex items-start gap-3 text-xs">
              <StopDot num={i + 1} active={stop.status === 'arrived'} done={stop.status === 'completed'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-[var(--text-primary)]">{stop.school_name}</span>
                  {stop.km_from_prev > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                      +{stop.km_from_prev} km
                    </span>
                  )}
                  {stop.status === 'arrived' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] animate-pulse">
                      Here now
                    </span>
                  )}
                  {stop.outcome && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                      {OUTCOMES.find(o => o.value === stop.outcome)?.label || stop.outcome}
                    </span>
                  )}
                </div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  In: {fmt(stop.arrived_at)}
                  {stop.departed_at && ` · Out: ${fmt(stop.departed_at)} · ${fmtDuration(stop.arrived_at, stop.departed_at)}`}
                </div>
              </div>
            </div>
          ))}

          {/* In-transit indicator when not at a stop */}
          {!atStop && (
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] pl-1">
              <ChevronRight className="h-3 w-3" />
              {stops.length === 0 ? 'Head to your first visit' : 'In transit to next stop'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {!atStop ? (
              // Not at a stop — show "Arrived" button
              <button onClick={() => setArriveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-semibold">
                <MapPin className="h-4 w-4" /> Arrived at School
              </button>
            ) : (
              // At a stop — show "Visit Done" button
              <button onClick={() => setDepartOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/20 text-green-400 border border-green-500/40 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4" /> Visit Done — Next Stop
              </button>
            )}
            <button onClick={endJourney} disabled={busy}
              className="px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs">
              <Square className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] text-center">
            {atStop ? 'Press the stop button to end journey without recording return km' : 'Tap ■ to end journey and calculate total km'}
          </p>
        </div>
      </div>

      {/* ── Arrive sheet ───────────────────────────────────────────── */}
      {arriveOpen && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setArriveOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full bg-[var(--bg-card)] rounded-t-2xl p-5 pb-8 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[var(--border-color)] rounded-full mx-auto mb-1" />
            <p className="text-base font-semibold text-[var(--text-primary)]">Arrived — where are you?</p>

            {/* Link to planned visit (quick pick) */}
            {unlinkedTodayVisits.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-2">Today's Planned Visits</p>
                <div className="space-y-2">
                  {unlinkedTodayVisits.map(v => (
                    <button key={v.visit_id || v.plan_id}
                      onClick={() => {
                        setSchoolName(v.school_name || v.name || '');
                        setLinkedVisit(v.visit_id || v.plan_id || '');
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left text-sm transition-all ${
                        linkedVisit === (v.visit_id || v.plan_id)
                          ? 'border-[#e94560]/50 bg-[#e94560]/10 text-[var(--text-primary)]'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                      }`}>
                      <MapPin className="h-4 w-4 flex-shrink-0 text-[#e94560]" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{v.school_name || v.name}</p>
                        {v.contact_person && <p className="text-[10px] text-[var(--text-muted)]">{v.contact_person}</p>}
                      </div>
                      {linkedVisit === (v.visit_id || v.plan_id) && (
                        <CheckCircle2 className="h-4 w-4 text-[#e94560] flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manual school name */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                {unlinkedTodayVisits.length > 0 ? 'Or enter manually' : 'School / Destination'}
              </p>
              <input
                value={schoolName}
                onChange={e => { setSchoolName(e.target.value); setLinkedVisit(''); }}
                placeholder="School or destination name"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560]"
              />
            </div>

            <button onClick={arrive} disabled={busy || !schoolName.trim()}
              className="w-full py-3 rounded-xl bg-[#e94560] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {busy ? 'Getting GPS…' : 'Mark Arrived + Calculate KM'}
            </button>
          </div>
        </div>
      )}

      {/* ── Depart sheet ──────────────────────────────────────────── */}
      {departOpen && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setDepartOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full bg-[var(--bg-card)] rounded-t-2xl p-5 pb-8 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[var(--border-color)] rounded-full mx-auto mb-1" />
            <p className="text-base font-semibold text-[var(--text-primary)]">
              Done at {lastStop?.school_name} — how did it go?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map(o => (
                <button key={o.value} onClick={() => setOutcome(o.value)}
                  className={`py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    outcome === o.value
                      ? 'bg-[#e94560]/15 border-[#e94560]/50 text-[#e94560]'
                      : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
            <button onClick={depart} disabled={busy}
              className="w-full py-3 rounded-xl bg-green-500/20 text-green-400 border border-green-500/40 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              {busy ? '…' : outcome ? 'Done — Head to Next' : 'Done (skip outcome)'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
