import React from 'react';
import { Label } from '../ui/label';
import {
  MapPin, ExternalLink, Loader2, Check,
  ThumbsUp, ThumbsDown, RotateCcw, ShoppingCart, Calendar, Phone,
} from 'lucide-react';

const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const OUTCOMES = [
  { value: 'interested',         label: 'Interested',     icon: ThumbsUp,     bg: 'bg-emerald-500/15', border: 'border-emerald-500/35', text: 'text-emerald-400' },
  { value: 'demo_booked',        label: 'Demo Booked',    icon: Calendar,     bg: 'bg-purple-500/15',  border: 'border-purple-500/35',  text: 'text-purple-400' },
  { value: 'follow_up',          label: 'Follow Up',      icon: RotateCcw,    bg: 'bg-blue-500/15',    border: 'border-blue-500/35',    text: 'text-blue-400'   },
  { value: 'callback_requested', label: 'Callback',       icon: Phone,        bg: 'bg-amber-500/15',   border: 'border-amber-500/35',   text: 'text-amber-400'  },
  { value: 'not_interested',     label: 'Not Interested', icon: ThumbsDown,   bg: 'bg-red-500/15',     border: 'border-red-500/35',     text: 'text-red-400'    },
  { value: 'already_purchased',  label: 'Purchased',      icon: ShoppingCart, bg: 'bg-slate-500/15',   border: 'border-slate-500/35',   text: 'text-slate-400'  },
];

/**
 * VisitOutcomeForm — Body content for the "Complete Visit" bottom sheet.
 * Renders GPS status panel, outcome pill grid, and notes textarea.
 */
export default function VisitOutcomeForm({
  gpsState, completeVisit,
  completeForm, setCompleteForm,
  distanceBetween,
}) {
  return (
    <div className="px-4 pt-3 pb-4 space-y-4">
      {/* GPS Status */}
      <div className={`rounded-2xl border p-4 space-y-2 ${
        gpsState.error   ? 'border-red-500/30 bg-red-500/5'     :
        gpsState.loading ? 'border-amber-500/30 bg-amber-500/5' :
        'border-emerald-500/30 bg-emerald-500/5'
      }`}>
        <div className="flex items-center gap-2">
          {gpsState.loading ? (
            <><Loader2 className="h-4 w-4 animate-spin text-amber-400" /><span className="text-xs font-semibold text-amber-400">Getting your location…</span></>
          ) : gpsState.error ? (
            <><MapPin className="h-4 w-4 text-red-400" /><span className="text-xs font-semibold text-red-400">GPS unavailable</span></>
          ) : (
            <><MapPin className="h-4 w-4 text-emerald-400" /><span className="text-xs font-semibold text-emerald-400">Location captured</span></>
          )}
        </div>

        {gpsState.lat && gpsState.lng && (
          <>
            <p className={`text-[11px] ${tMuted} font-mono`}>{gpsState.lat.toFixed(6)}, {gpsState.lng.toFixed(6)}</p>
            {gpsState.address && <p className={`text-[11px] ${tSec} leading-snug`}>{gpsState.address}</p>}
            <a href={`https://www.google.com/maps?q=${gpsState.lat},${gpsState.lng}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-blue-400 font-semibold">
              <ExternalLink className="h-3 w-3" /> Verify on Maps
            </a>
            {/* Distance from check-in if available */}
            {completeVisit?.lat && completeVisit?.lng && gpsState.lat && (() => {
              const d = distanceBetween(completeVisit.lat, completeVisit.lng, gpsState.lat, gpsState.lng);
              return (
                <p className={`text-[11px] ${d > 500 ? 'text-amber-400' : tMuted}`}>
                  {d > 500 ? '⚠ ' : ''}{d}m from planned location
                </p>
              );
            })()}
          </>
        )}

        {gpsState.error && (
          <p className="text-[11px] text-red-400">{gpsState.error} — visit will be saved without GPS.</p>
        )}
      </div>

      {/* Outcome grid */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-2.5 block`}>Visit Outcome</Label>
        <div className="grid grid-cols-3 gap-2.5">
          {OUTCOMES.map(o => {
            const OIcon = o.icon;
            const sel   = completeForm.outcome === o.value;
            return (
              <button key={o.value} type="button"
                onClick={() => setCompleteForm(f => ({ ...f, outcome: sel ? '' : o.value }))}
                className={`flex flex-col items-center justify-center gap-2.5 py-4 rounded-2xl border-2 transition-all active:scale-95 ${
                  sel ? `${o.bg} ${o.border}` : 'bg-[var(--bg-primary)] border-[var(--border-color)]'
                }`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${sel ? o.bg : 'bg-[var(--bg-card)]'}`}>
                  <OIcon className={`${sel ? o.text : tSec}`} style={{ width: '18px', height: '18px' }} />
                </div>
                <span className={`text-[10px] font-bold text-center leading-tight px-0.5 ${sel ? o.text : tSec}`}>{o.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <Label className={`text-xs font-semibold ${tSec} mb-1.5 block`}>Visit Notes</Label>
        <textarea
          value={completeForm.notes}
          onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))}
          rows={3}
          className={`w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm resize-none`}
          placeholder="What happened? Any key points discussed…"
        />
      </div>
    </div>
  );
}
