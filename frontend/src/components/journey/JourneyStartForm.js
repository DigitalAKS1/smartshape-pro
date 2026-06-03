import React from 'react';
import { Navigation, Building2, Home, Loader2, Play } from 'lucide-react';
import { saveStartType } from '../../hooks/useJourneyTracker';

export default function JourneyStartForm({ startType, setStartType, busy, startJourney }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden mb-4">
      <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-[var(--border-color)]">
        <Navigation className="h-4 w-4 text-[#e94560]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Field Journey</span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">Auto-tracks km between visits</span>
      </div>
      <div className="p-5">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-2">Starting from</p>
        <div className="flex gap-2 mb-4">
          {[
            { key: 'office', label: 'Office', Icon: Building2 },
            { key: 'home',   label: 'Home',   Icon: Home },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => { setStartType(key); saveStartType(key); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                startType === key
                  ? 'bg-[#e94560]/15 border-[#e94560]/50 text-[#e94560]'
                  : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={startJourney}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#e94560] text-white font-semibold text-sm hover:bg-[#f05c75] transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? 'Getting GPS…' : 'Start Field Work'}
        </button>
      </div>
    </div>
  );
}
