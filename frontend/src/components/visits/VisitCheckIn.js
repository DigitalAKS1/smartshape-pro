import React from 'react';
import { MapPin, ScanLine, Plus, Navigation, ArrowRight } from 'lucide-react';

const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';

/**
 * VisitCheckIn — Header action bar (Scan Card + Plan Visit buttons),
 * filter tabs, and route planner button. Not a dialog — these are the
 * inline controls at the top of the visits page.
 */
export default function VisitCheckIn({
  filter, setFilter, tabs,
  todayWithCoords, openRoute,
  onPlanOpen, onScanOpen,
  todayVisits, upcomingVisits,
}) {
  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-lg font-bold ${tPri}`}>Field Visits</h2>
          <p className={`text-xs ${tMuted}`}>{todayVisits.length} today · {upcomingVisits.length} upcoming</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onScanOpen}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-400 text-sm font-bold active:opacity-80">
            <ScanLine className="h-4 w-4" /><span className="hidden xs:inline">Scan Card</span>
          </button>
          <button
            onClick={onPlanOpen}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-bold shadow-lg shadow-[#e94560]/20 active:opacity-80">
            <Plus className="h-4 w-4" /> Plan Visit
          </button>
        </div>
      </div>

      {/* Route planner (today, 2+ GPS stops) */}
      {filter === 'today' && todayWithCoords.length >= 2 && (
        <button
          onClick={openRoute}
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
    </>
  );
}
