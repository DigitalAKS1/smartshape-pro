import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { LogIn, LogOut, Clock, MapPin, RefreshCw } from 'lucide-react';
import { punchApi } from '../lib/api';

const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDuration = (ms) => {
  if (!ms || ms < 0) return '0h 0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
};

const EFFICIENCY = {
  optimal:        { label: 'Optimal',        cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  good:           { label: 'Good',           cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  moderate:       { label: 'Moderate',       cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  frequent_exits: { label: 'Frequent Exits', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

export default function PunchClock() {
  const [punches,  setPunches]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [punching, setPunching] = useState(false);
  const [tick,     setTick]     = useState(Date.now());

  // Refresh clock every minute
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const loadPunches = useCallback(async () => {
    try {
      const r = await punchApi.todayPunches();
      setPunches(r.data || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadPunches(); }, [loadPunches]);

  const lastPunch  = punches[punches.length - 1];
  const isPunchedIn = lastPunch?.type === 'in';

  const firstIn  = punches.find(p => p.type === 'in');
  const lastOut  = [...punches].reverse().find(p => p.type === 'out');
  const workedMs = firstIn && lastOut
    ? new Date(lastOut.timestamp) - new Date(firstIn.timestamp)
    : firstIn && isPunchedIn
    ? Date.now() - new Date(firstIn.timestamp)
    : 0;

  // Efficiency
  const ins    = punches.filter(p => p.type === 'in').length;
  const outs   = punches.filter(p => p.type === 'out').length;
  const cycles = Math.min(ins, outs);
  const effKey = cycles <= 1 ? 'optimal' : cycles === 2 ? 'good' : cycles === 3 ? 'moderate' : 'frequent_exits';

  const handlePunch = async (type) => {
    setPunching(true);
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
          : rej(new Error('GPS not supported'))
      ).catch(() => null);

      await punchApi.punch({
        type,
        lat: pos?.coords.latitude  ?? null,
        lng: pos?.coords.longitude ?? null,
      });
      toast.success(type === 'in' ? '✅ Punched In' : '👋 Punched Out');
      await loadPunches();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Punch failed');
    }
    setPunching(false);
  };

  if (loading) return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 flex items-center justify-center h-36">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#e94560] border-t-transparent" />
    </div>
  );

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#e94560]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Punch Clock</span>
        </div>
        <div className="flex items-center gap-2">
          {punches.length > 0 && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${EFFICIENCY[effKey].cls}`}>
              {EFFICIENCY[effKey].label}
            </span>
          )}
          <button onClick={loadPunches} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-5">
        {/* Status + big button */}
        <div className="flex items-center gap-4 mb-5">
          {/* Status dot */}
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${isPunchedIn ? 'bg-green-500/20' : 'bg-[var(--bg-primary)]'}`}>
            {isPunchedIn
              ? <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
              : <div className="w-3 h-3 bg-gray-500 rounded-full" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-semibold text-sm">
              {isPunchedIn ? 'Punched In' : punches.length === 0 ? 'Not Punched In' : 'Punched Out'}
            </p>
            {firstIn && (
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                Since {fmt(firstIn.timestamp)} · {fmtDuration(workedMs)} worked
              </p>
            )}
            {!firstIn && <p className="text-[var(--text-muted)] text-xs mt-0.5">Tap to start your day</p>}
          </div>
          {/* Punch button */}
          <button
            onClick={() => handlePunch(isPunchedIn ? 'out' : 'in')}
            disabled={punching}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-60 flex-shrink-0 ${
              isPunchedIn
                ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                : 'bg-[#e94560] text-white hover:bg-[#f05c75]'
            }`}
          >
            {punching
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : isPunchedIn
              ? <LogOut className="h-4 w-4" />
              : <LogIn className="h-4 w-4" />}
            {punching ? '…' : isPunchedIn ? 'Punch Out' : 'Punch In'}
          </button>
        </div>

        {/* Stats row */}
        {punches.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'First In',   value: fmt(firstIn?.timestamp) },
              { label: 'Last Out',   value: fmt(lastOut?.timestamp) },
              { label: 'Hours',      value: fmtDuration(workedMs) },
            ].map(s => (
              <div key={s.label} className="bg-[var(--bg-primary)] rounded-xl p-2.5 text-center">
                <p className="text-[var(--text-primary)] font-semibold text-sm">{s.value}</p>
                <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Punch timeline */}
        {punches.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">
              Today's Punches ({punches.length})
            </p>
            {punches.map((p, i) => (
              <div key={p.punch_id} className="flex items-start gap-2.5 text-xs">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  p.type === 'in' ? 'bg-green-500/20' : 'bg-red-500/20'
                }`}>
                  {p.type === 'in'
                    ? <LogIn  className="h-2.5 w-2.5 text-green-400" />
                    : <LogOut className="h-2.5 w-2.5 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`font-semibold ${p.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>
                    {p.type === 'in' ? 'In' : 'Out'}
                  </span>
                  <span className="text-[var(--text-secondary)] ml-1.5">{fmt(p.timestamp)}</span>
                  {p.source === 'geofence_auto_logout' && (
                    <span className="ml-1.5 text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">auto-logout</span>
                  )}
                  {p.address && (
                    <p className="text-[var(--text-muted)] text-[10px] truncate flex items-center gap-1 mt-0.5">
                      <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                      {p.address.split(',').slice(0, 2).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-[var(--text-muted)] text-[10px] flex-shrink-0">#{i + 1}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
