import React from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import JourneyTracker from '../../components/JourneyTracker';
import { Label } from '../../components/ui/label';
import { Check, Loader2, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import useSalesVisits from '../../hooks/useSalesVisits';
import VisitList from '../../components/visits/VisitList';
import VisitCheckIn from '../../components/visits/VisitCheckIn';
import VisitFormDialog from '../../components/visits/VisitFormDialog';
import VisitOutcomeForm from '../../components/visits/VisitOutcomeForm';
import BusinessCardScanner from '../../components/visits/BusinessCardScanner';

const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';

// ── Bottom Sheet (flex layout) ─────────────────────────────
function BottomSheet({ open, onClose, title, children, footer }) {
  React.useEffect(() => {
    document.body.style.overflow    = open ? 'hidden' : '';
    document.body.style.touchAction = open ? 'none'   : '';
    return () => { document.body.style.overflow = ''; document.body.style.touchAction = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-t-2xl flex flex-col" style={{ maxHeight: '88dvh' }}>
        <div className="shrink-0 pt-2 pb-3 px-4 flex items-center justify-between border-b border-[var(--border-color)]">
          <div className="w-10 h-1.5 bg-[var(--border-color)] rounded-full absolute left-1/2 -translate-x-1/2 top-2" />
          <h3 className={`font-bold text-base ${tPri} mt-3`}>{title}</h3>
          <button onClick={onClose} className={`mt-3 ${tMuted} p-1.5 rounded-lg hover:bg-[var(--bg-primary)]`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="shrink-0 px-4 pt-3 bg-[var(--bg-card)] border-t border-[var(--border-color)]"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SalesVisits() {
  const s = useSalesVisits();

  if (s.loading) return (
    <SalesLayout title="Visits" showBack>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Visits" showBack>
      <div className="pb-28 space-y-4">

        {/* Journey Tracker */}
        <JourneyTracker todayVisits={s.todayVisits} />

        {/* Monthly Target Progress */}
        {s.targetProgress && s.targetProgress.visits_target > 0 && (() => {
          const pct = Math.min(100, Math.round((s.targetProgress.visits_done / s.targetProgress.visits_target) * 100));
          const barColor = pct >= 100 ? 'bg-emerald-400' : pct >= 60 ? 'bg-blue-400' : 'bg-amber-400';
          return (
            <div className={`${card} rounded-2xl p-3.5`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-[#e94560]" />
                  <span className={`text-xs font-semibold ${tSec}`}>Monthly Target — {s.targetProgress.month_year}</span>
                </div>
                <span className={`text-xs font-bold ${pct >= 100 ? 'text-emerald-400' : tPri}`}>
                  {s.targetProgress.visits_done}/{s.targetProgress.visits_target} visits · {pct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              {s.targetProgress.demos_target > 0 && (
                <div className={`flex items-center justify-between mt-2 text-[11px] ${tMuted}`}>
                  <span>Demos: {s.targetProgress.demos_done}/{s.targetProgress.demos_target}</span>
                  {s.targetProgress.leads_target > 0 && <span>Leads: {s.targetProgress.leads_converted}/{s.targetProgress.leads_target}</span>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Header + route planner + filter tabs */}
        <VisitCheckIn
          filter={s.filter} setFilter={s.setFilter} tabs={s.tabs}
          todayWithCoords={s.todayWithCoords} openRoute={s.openRoute}
          onPlanOpen={() => s.setPlanOpen(true)}
          onScanOpen={() => { s.setScanOpen(true); s.setScanPreview(null); s.setScanResult(null); s.setScanError(null); }}
          todayVisits={s.todayVisits} upcomingVisits={s.upcomingVisits}
        />

        {/* Visit list */}
        <VisitList
          shown={s.shown} filter={s.filter}
          onPlanOpen={() => s.setPlanOpen(true)}
          onCheckIn={s.handleCheckIn}
          onOpenComplete={s.openCompleteSheet}
          onAddContact={s.openAddContact}
          checkingIn={s.checkingIn}
        />

      </div>

      {/* ── Business Card Scanner Sheet ── */}
      <BottomSheet
        open={s.scanOpen}
        onClose={() => s.setScanOpen(false)}
        title="Scan Business Card"
        footer={s.scanResult ? (
          <button onClick={s.applyScanResult}
            className="w-full py-3.5 rounded-xl bg-[#e94560] text-white text-sm font-bold">
            Use These Details
          </button>
        ) : null}
      >
        <BusinessCardScanner
          scanPreview={s.scanPreview} setScanPreview={s.setScanPreview}
          scanLoading={s.scanLoading}
          scanResult={s.scanResult} setScanResult={s.setScanResult}
          scanError={s.scanError} setScanError={s.setScanError}
          scanFileRef={s.scanFileRef} scanGalleryRef={s.scanGalleryRef}
          handleScanImage={s.handleScanImage}
        />
      </BottomSheet>

      {/* ── Add Contact Sheet ── */}
      <BottomSheet
        open={!!s.addContactVisit}
        onClose={() => s.setAddContactVisit(null)}
        title="Add Contact"
        footer={
          <button onClick={s.submitAddContact} disabled={s.savingContact}
            className="w-full py-3.5 rounded-xl bg-[#e94560] text-white text-sm font-bold disabled:opacity-50">
            {s.savingContact ? 'Saving…' : 'Save Contact'}
          </button>
        }
      >
        <div className="px-4 py-4 space-y-3.5">
          <div>
            <label className={`text-xs font-semibold ${tMuted} uppercase tracking-wide`}>School / Organisation</label>
            <input value={s.contactForm.company} onChange={e => s.setContactForm(f => ({ ...f, company: e.target.value }))}
              className={`mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm focus:outline-none focus:ring-2 focus:ring-[#e94560]/40`}
              placeholder="School name" />
          </div>
          <div>
            <label className={`text-xs font-semibold ${tMuted} uppercase tracking-wide`}>Name <span className="text-[#e94560]">*</span></label>
            <input value={s.contactForm.name} onChange={e => s.setContactForm(f => ({ ...f, name: e.target.value }))}
              className={`mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm focus:outline-none focus:ring-2 focus:ring-[#e94560]/40`}
              placeholder="Contact person name" />
          </div>
          <div>
            <label className={`text-xs font-semibold ${tMuted} uppercase tracking-wide`}>Phone <span className="text-[#e94560]">*</span></label>
            <input value={s.contactForm.phone} onChange={e => s.setContactForm(f => ({ ...f, phone: e.target.value }))}
              type="tel" className={`mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm focus:outline-none focus:ring-2 focus:ring-[#e94560]/40`}
              placeholder="+91 98765 43210" />
          </div>
          <div>
            <label className={`text-xs font-semibold ${tMuted} uppercase tracking-wide`}>Email</label>
            <input value={s.contactForm.email} onChange={e => s.setContactForm(f => ({ ...f, email: e.target.value }))}
              type="email" className={`mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm focus:outline-none focus:ring-2 focus:ring-[#e94560]/40`}
              placeholder="email@school.in" />
          </div>
          <div>
            <label className={`text-xs font-semibold ${tMuted} uppercase tracking-wide`}>Designation</label>
            <select value={s.contactForm.designation} onChange={e => s.setContactForm(f => ({ ...f, designation: e.target.value }))}
              className={`mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] ${tPri} text-sm focus:outline-none focus:ring-2 focus:ring-[#e94560]/40`}>
              {['Principal', 'Vice Principal', 'Director', 'Coordinator', 'Admin', 'Teacher', 'Purchase Manager'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </BottomSheet>

      {/* ── Complete Visit Sheet ── */}
      <BottomSheet
        open={!!s.completeVisit}
        onClose={() => !s.completing && s.setCompleteVisit(null)}
        title="Complete Visit"
        footer={
          <button onClick={s.submitComplete} disabled={s.completing}
            className={`w-full py-4 rounded-2xl font-bold text-sm disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
              s.completeForm.outcome
                ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/30'
                : 'bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] text-[var(--text-muted)]'
            }`}>
            {s.completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {s.completing ? 'Saving…' : s.completeForm.outcome ? 'Mark Complete & Save' : 'Save without Outcome'}
          </button>
        }
      >
        <VisitOutcomeForm
          gpsState={s.gpsState}
          completeVisit={s.completeVisit}
          completeForm={s.completeForm}
          setCompleteForm={s.setCompleteForm}
          distanceBetween={s.distanceBetween}
        />
      </BottomSheet>

      {/* ── Plan Visit Sheet ── */}
      <BottomSheet
        open={s.planOpen}
        onClose={() => s.setPlanOpen(false)}
        title="Plan New Visit"
        footer={
          <button
            onClick={() => { if (s.saving) return; document.dispatchEvent(new Event('save-visit')); }}
            disabled={s.saving}
            className="w-full py-3.5 rounded-xl bg-[#e94560] text-white font-bold text-sm shadow-lg shadow-[#e94560]/25 disabled:opacity-40 active:opacity-80 transition-opacity">
            {s.saving ? 'Saving…' : 'Plan Visit'}
          </button>
        }
      >
        <VisitFormDialog
          onSaved={s.fetchVisits}
          onClose={() => s.setPlanOpen(false)}
          saving={s.saving}
          setSaving={s.setSaving}
        />
      </BottomSheet>
    </SalesLayout>
  );
}
