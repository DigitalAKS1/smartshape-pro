import React from 'react';
import {
  Navigation, CheckCircle2, Building2, Home,
  Loader2, Square, Flag, ReceiptText,
  ThumbsUp, ThumbsDown, RotateCcw, CalendarDays, ShoppingCart, Phone,
} from 'lucide-react';
import useJourneyTracker from '../hooks/useJourneyTracker';
import JourneyStartForm from './journey/JourneyStartForm';
import JourneyStopCard from './journey/JourneyStopCard';
import JourneyControls from './journey/JourneyControls';
import JourneyArriveSheet from './journey/JourneyArriveSheet';
import JourneyExpenseDialog from './journey/JourneyExpenseDialog';

// ── Utilities ────────────────────────────────────────────────────────────────
const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDuration = (fromIso, toIso) => {
  if (!fromIso) return '';
  const ms = (toIso ? new Date(toIso) : new Date()) - new Date(fromIso);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const OUTCOMES = [
  { value: 'interested',         label: 'Interested',     icon: ThumbsUp,     bg: 'bg-emerald-500/15', border: 'border-emerald-500/35', text: 'text-emerald-400' },
  { value: 'follow_up',          label: 'Follow Up',      icon: RotateCcw,    bg: 'bg-blue-500/15',    border: 'border-blue-500/35',    text: 'text-blue-400'   },
  { value: 'demo_booked',        label: 'Demo Booked',    icon: CalendarDays, bg: 'bg-purple-500/15',  border: 'border-purple-500/35',  text: 'text-purple-400' },
  { value: 'not_interested',     label: 'Not Interested', icon: ThumbsDown,   bg: 'bg-red-500/15',     border: 'border-red-500/35',     text: 'text-red-400'    },
  { value: 'callback_requested', label: 'Callback',       icon: Phone,        bg: 'bg-amber-500/15',   border: 'border-amber-500/35',   text: 'text-amber-400'  },
  { value: 'already_purchased',  label: 'Purchased',      icon: ShoppingCart, bg: 'bg-slate-500/15',   border: 'border-slate-500/35',   text: 'text-slate-400'  },
];

export default function JourneyTracker({ todayVisits = [] }) {
  const h = useJourneyTracker();

  if (!h.loaded) return null;

  const stops    = h.journey?.stops || [];
  const lastStop = stops[stops.length - 1];
  const atStop   = lastStop?.status === 'arrived';
  const unlinkedTodayVisits = todayVisits.filter(v =>
    v.status === 'planned' && !stops.some(s => s.visit_id === (v.visit_id || v.plan_id))
  );

  // ── Post-journey expense prompt ──────────────────────────────────────────
  if (h.expensePrompt) {
    return (
      <>
        <div className="bg-[var(--bg-card)] border border-green-500/30 rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
            <span className="font-semibold text-[var(--text-primary)]">Journey Completed!</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Total KM', value: `${h.expensePrompt.total_km} km` },
              { label: 'Stops',    value: h.expensePrompt.stops?.length || 0 },
              { label: 'Duration', value: fmtDuration(h.expensePrompt.start_time, h.expensePrompt.end_time) },
            ].map(s => (
              <div key={s.label} className="bg-[var(--bg-primary)] rounded-xl p-2.5 text-center">
                <p className="text-[var(--text-primary)] font-bold text-sm">{s.value}</p>
                <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={h.openExpenseDialog}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e94560] text-white text-sm font-semibold"
            >
              <ReceiptText className="h-4 w-4" /> Add Expense
            </button>
            <button
              onClick={() => h.setExpensePrompt(null)}
              className="px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] text-sm"
            >
              Skip
            </button>
          </div>
        </div>

        {h.expenseDialog && (
          <JourneyExpenseDialog
            expensePrompt={h.expensePrompt}
            expType={h.expType} setExpType={h.setExpType}
            vehicle={h.vehicle} setVehicle={h.setVehicle}
            expAmt={h.expAmt} setExpAmt={h.setExpAmt}
            expNote={h.expNote} setExpNote={h.setExpNote}
            expBusy={h.expBusy}
            submitExpense={h.submitExpense}
            setExpenseDialog={h.setExpenseDialog}
          />
        )}
      </>
    );
  }

  // ── No active journey — start button ────────────────────────────────────
  if (!h.journey) {
    return (
      <JourneyStartForm
        startType={h.startType}
        setStartType={h.setStartType}
        busy={h.busy}
        startJourney={h.startJourney}
      />
    );
  }

  // ── Active journey ───────────────────────────────────────────────────────
  return (
    <>
      <div className="bg-[var(--bg-card)] border border-[#e94560]/30 rounded-2xl overflow-hidden mb-4">
        {/* Header */}
        <div className="px-4 pt-3 pb-2.5 flex items-center gap-2 border-b border-[var(--border-color)] bg-[#e94560]/5">
          <Navigation className="h-4 w-4 text-[#e94560]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Journey Active</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-[#e94560] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e94560] animate-pulse" />
            {h.journey.total_km} km · {fmtDuration(h.journey.start_time)}
          </span>
        </div>

        <div className="p-4 space-y-3">
          {/* Start row */}
          <div className="flex items-center gap-3 text-xs">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-green-500/20 border border-green-500/40">
              {h.journey.start_type === 'home'
                ? <Home className="h-3 w-3 text-green-400" />
                : <Building2 className="h-3 w-3 text-green-400" />}
            </div>
            <div className="flex-1">
              <span className="text-[var(--text-secondary)] font-medium">
                {h.journey.start_type === 'home' ? 'Started from Home' : 'Started from Office'}
              </span>
              <span className="text-[var(--text-muted)] ml-2">{fmt(h.journey.start_time)}</span>
            </div>
          </div>

          {/* Stop cards */}
          {stops.map((stop, i) => (
            <JourneyStopCard key={i} stop={stop} index={i} />
          ))}

          {/* In-transit indicator */}
          {!atStop && (
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] pl-1">
              <span>›</span>
              {stops.length === 0 ? 'Head to your first visit' : 'In transit to next stop'}
            </div>
          )}

          {/* Controls */}
          <JourneyControls
            atStop={atStop}
            busy={h.busy}
            nextStopNudge={h.nextStopNudge}
            setNextStopNudge={h.setNextStopNudge}
            setArriveOpen={h.setArriveOpen}
            setDepartOpen={h.setDepartOpen}
            setConfirmEndOpen={h.setConfirmEndOpen}
          />
        </div>
      </div>

      {/* Arrive sheet */}
      {h.arriveOpen && (
        <JourneyArriveSheet
          busy={h.busy}
          dbLoaded={h.dbLoaded}
          schoolName={h.schoolName} setSchoolName={h.setSchoolName}
          schoolSearch={h.schoolSearch} setSchoolSearch={h.setSchoolSearch}
          selectedSchool={h.selectedSchool} setSelectedSchool={h.setSelectedSchool}
          showSchoolDrop={h.showSchoolDrop} setShowSchoolDrop={h.setShowSchoolDrop}
          schoolResults={h.schoolResults}
          selectSchool={h.selectSchool} clearSchool={h.clearSchool}
          schoolContacts={h.schoolContacts}
          contactName={h.contactName} setContactName={h.setContactName}
          contactDesignation={h.contactDesignation} setContactDesignation={h.setContactDesignation}
          contactPhone={h.contactPhone} setContactPhone={h.setContactPhone}
          contactId={h.contactId} setContactId={h.setContactId}
          selectContact={h.selectContact}
          linkedVisit={h.linkedVisit} setLinkedVisit={h.setLinkedVisit}
          unlinkedTodayVisits={unlinkedTodayVisits}
          arrive={h.arrive}
          resetArriveForm={h.resetArriveForm}
        />
      )}

      {/* Depart sheet */}
      {h.departOpen && (
        <div className="fixed inset-0 z-[200] flex items-end" onClick={() => !h.busy && h.setDepartOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full bg-[var(--bg-card)] rounded-t-3xl flex flex-col"
            style={{ maxHeight: '88dvh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
              <div className="w-10 h-1.5 bg-[var(--border-color)] rounded-full" />
            </div>
            <div className="flex-shrink-0 px-5 pt-2 pb-4 border-b border-[var(--border-color)]">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-0.5">Done at</p>
              <p className="text-xl font-bold text-[var(--text-primary)] leading-tight truncate">{lastStop?.school_name}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">How did the visit go?</p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <div className="grid grid-cols-3 gap-3">
                {OUTCOMES.map(o => {
                  const OIcon = o.icon;
                  const sel = h.outcome === o.value;
                  return (
                    <button
                      key={o.value}
                      onClick={() => h.setOutcome(sel ? '' : o.value)}
                      className={`flex flex-col items-center justify-center gap-2.5 py-5 rounded-2xl border-2 transition-all active:scale-95 ${
                        sel ? `${o.bg} ${o.border}` : 'bg-[var(--bg-primary)] border-[var(--border-color)]'
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${sel ? o.bg : 'bg-[var(--bg-card)]'}`}>
                        <OIcon className={`h-5 w-5 ${sel ? o.text : 'text-[var(--text-secondary)]'}`} />
                      </div>
                      <span className={`text-[10px] font-bold text-center leading-tight px-0.5 ${sel ? o.text : 'text-[var(--text-secondary)]'}`}>
                        {o.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="flex-shrink-0 px-4 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-card)]"
              style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            >
              {h.outcome ? (
                <button
                  onClick={h.depart}
                  disabled={h.busy}
                  className="w-full py-4 rounded-2xl bg-[#e94560] text-white font-bold text-sm shadow-xl shadow-[#e94560]/30 disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                >
                  {h.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                  {h.busy ? 'Saving…' : `Done — ${OUTCOMES.find(o2 => o2.value === h.outcome)?.label}`}
                </button>
              ) : (
                <button
                  onClick={h.depart}
                  disabled={h.busy}
                  className="w-full py-4 rounded-2xl border-2 border-dashed border-[var(--border-color)] text-[var(--text-muted)] font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:opacity-70"
                >
                  <Flag className="h-4 w-4" />
                  Skip &amp; Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expense dialog */}
      {h.expenseDialog && h.expensePrompt && (
        <JourneyExpenseDialog
          expensePrompt={h.expensePrompt}
          expType={h.expType} setExpType={h.setExpType}
          vehicle={h.vehicle} setVehicle={h.setVehicle}
          expAmt={h.expAmt} setExpAmt={h.setExpAmt}
          expNote={h.expNote} setExpNote={h.setExpNote}
          expBusy={h.expBusy}
          submitExpense={h.submitExpense}
          setExpenseDialog={h.setExpenseDialog}
        />
      )}

      {/* End journey confirmation */}
      {h.confirmEndOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !h.busy && h.setConfirmEndOpen(false)} />
          <div className="relative bg-[var(--bg-card)] rounded-3xl p-6 w-full max-w-xs shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-[#e94560]/10 flex items-center justify-center mx-auto mb-4">
              <Square className="h-6 w-6 text-[#e94560]" />
            </div>
            <h3 className="text-base font-bold text-[var(--text-primary)] text-center mb-1.5">End Field Journey?</h3>
            <p className="text-sm text-[var(--text-muted)] text-center mb-6 leading-relaxed">
              Your total KM will be recorded and today's journey will close.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => h.setConfirmEndOpen(false)}
                className="flex-1 py-3 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] text-sm font-semibold active:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={async () => { h.setConfirmEndOpen(false); await h.endJourney(); }}
                disabled={h.busy}
                className="flex-1 py-3 rounded-xl bg-[#e94560] text-white text-sm font-bold disabled:opacity-60 active:opacity-80 flex items-center justify-center gap-1.5"
              >
                {h.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                End Journey
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
