import React from 'react';
import { MapPin, Plus } from 'lucide-react';
import VisitCard from './VisitCard';

const tPri   = 'text-[var(--text-primary)]';
const tMuted = 'text-[var(--text-muted)]';
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';

export default function VisitList({ shown, filter, onPlanOpen, onCheckIn, onOpenComplete, onAddContact, checkingIn }) {
  if (shown.length === 0) {
    return (
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
          <button onClick={onPlanOpen}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-bold">
            <Plus className="h-4 w-4" /> Plan a Visit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {shown.map(v => (
        <VisitCard
          key={v.visit_id}
          visit={v}
          onCheckIn={onCheckIn}
          onOpenComplete={onOpenComplete}
          onAddContact={onAddContact}
          checkingIn={checkingIn}
        />
      ))}
    </div>
  );
}
