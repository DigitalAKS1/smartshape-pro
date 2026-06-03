import React from 'react';
import {
  MapPin, CheckCircle2, Square, ArrowRight, Plus,
} from 'lucide-react';

export default function JourneyControls({
  atStop,
  busy,
  nextStopNudge, setNextStopNudge,
  setArriveOpen,
  setDepartOpen,
  setConfirmEndOpen,
}) {
  return (
    <>
      {/* Next-stop nudge */}
      {nextStopNudge && !atStop && (
        <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl bg-purple-500/10 border border-purple-500/25">
          <ArrowRight className="h-4 w-4 text-purple-400 flex-shrink-0" />
          <p className="flex-1 text-xs text-purple-300 font-semibold">Head to next school and tap Arrived</p>
          <button onClick={() => setNextStopNudge(false)} className="text-[var(--text-muted)] p-0.5">
            <Plus className="h-3.5 w-3.5 rotate-45" />
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {!atStop ? (
          <button
            onClick={() => { setNextStopNudge(false); setArriveOpen(true); }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-semibold"
          >
            <MapPin className="h-4 w-4" /> Arrived at School
          </button>
        ) : (
          <button
            onClick={() => setDepartOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/20 text-green-400 border border-green-500/40 text-sm font-semibold"
          >
            <CheckCircle2 className="h-4 w-4" /> Visit Done — Next Stop
          </button>
        )}
        <button
          onClick={() => setConfirmEndOpen(true)}
          disabled={busy}
          className="px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs active:opacity-70"
        >
          <Square className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-muted)] text-center">
        {atStop
          ? 'Press the stop button to end journey without recording return km'
          : 'Tap ■ to end journey and calculate total km'}
      </p>
    </>
  );
}
