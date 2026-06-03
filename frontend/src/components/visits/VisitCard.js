import React, { useState } from 'react';
import {
  MapPin, Calendar, Clock, Navigation, Check, Phone, Plus,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const STATUS = {
  planned:    { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25',      label: 'Planned'    },
  checked_in: { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25',         label: 'Checked In' },
  completed:  { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'Completed'  },
  cancelled:  { cls: 'bg-red-500/15 text-red-400 border-red-500/25',            label: 'Cancelled'  },
};
const STATUS_STRIPE = {
  planned: 'bg-amber-400', checked_in: 'bg-blue-400',
  completed: 'bg-emerald-400', cancelled: 'bg-red-400',
};

export default function VisitCard({ visit, onCheckIn, onOpenComplete, onAddContact, checkingIn }) {
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

  const st     = STATUS[visit.status] || STATUS.planned;
  const stripe = STATUS_STRIPE[visit.status] || 'bg-gray-400';

  return (
    <div className={`${card} rounded-2xl overflow-hidden`}>
      {/* Color stripe */}
      <div className={`h-1 w-full ${stripe}`} />

      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className={`text-sm font-bold ${tPri} truncate`}>{visit.school_name}</p>
              {visit.is_admin_assigned && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-bold shrink-0 border border-violet-500/20">
                  Assigned
                </span>
              )}
            </div>
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

        {/* Meta */}
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
            <button onClick={() => onOpenComplete(visit)}
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
          {visit.check_out_lat && visit.check_out_lng && (
            <p className={`text-xs ${tMuted}`}>
              Exit GPS: <span className="text-emerald-400 font-mono text-[11px]">{visit.check_out_lat?.toFixed(5)}, {visit.check_out_lng?.toFixed(5)}</span>
              <a href={`https://www.google.com/maps?q=${visit.check_out_lat},${visit.check_out_lng}`} target="_blank" rel="noreferrer"
                className="ml-2 text-blue-400 inline-flex items-center gap-0.5">
                <ExternalLink className="h-2.5 w-2.5" /> View
              </a>
            </p>
          )}
          {visit.outcome && (
            <p className={`text-xs ${tMuted}`}>Outcome: <span className={tSec}>{visit.outcome}</span></p>
          )}
          {visit.notes && (
            <p className={`text-xs ${tMuted}`}>Notes: <span className={tSec}>{visit.notes}</span></p>
          )}
          {visit.status === 'completed' && onAddContact && (
            <button onClick={() => onAddContact(visit)}
              className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[var(--border-color)] text-xs text-blue-400 hover:border-blue-400/50 hover:bg-blue-500/5 transition-all">
              <Plus className="h-3.5 w-3.5" /> Add Contact from this Visit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
