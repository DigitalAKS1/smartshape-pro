import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Phone, CheckCircle2, MapPin, AlertTriangle, Loader2, RefreshCw, ClipboardList, ChevronRight, ListChecks } from 'lucide-react';
import AgendaWeekWidget from '../components/delegation/AgendaWeekWidget';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import WhatsAppSendDialog from '../components/WhatsAppSendDialog';
import AppShell from '../components/layouts/AppShell';
import { useTodayDashboard } from '../hooks/useTodayDashboard';
import TodayActionCard from '../components/today/TodayActionCard';
import PunchClock from '../components/PunchClock';

function StatChip({ count, label, color, testid }) {
  return (
    <div className={`border rounded-xl px-3 py-2.5 text-center ${color}`} data-testid={testid}>
      <p className="text-2xl font-bold font-mono">{count}</p>
      <p className="text-[10px] uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Section({ title, count, icon: Icon, accent, children, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <Icon className={`h-4 w-4 ${accent}`} />
        <h2 className={`text-sm font-semibold ${accent} uppercase tracking-wider`}>{title}</h2>
        <span className="text-xs text-[var(--text-muted)]">({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function TodayDashboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isSales = user?.role === 'sales';

  const {
    data, loading, refreshing, delgData,
    markDoneCard, markNote, markFollowup, markSaving,
    waOpen, waCtx,
    load, openMarkDone, saveMarkDone, openWa,
    setMarkDoneCard, setMarkNote, setMarkFollowup, setWaOpen,
  } = useTodayDashboard();

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-10 w-10 animate-spin text-[#e94560]" />
        </div>
      </AppShell>
    );
  }
  if (!data) return <AppShell><div className="p-6 text-[var(--text-muted)]">No data</div></AppShell>;

  const { overdue = [], calls_today = [], visits_today = [], counts, today } = data;
  const total = counts.total || 0;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-3 pt-4 pb-24 space-y-4" data-testid="today-dashboard">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight">Today's Actions</h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {new Date(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })} • {total} pending
            </p>
          </div>
          <button
            onClick={() => load()}
            className={`p-2 rounded-full hover:bg-[var(--bg-hover)] ${refreshing ? 'animate-spin' : ''}`}
            data-testid="today-refresh-btn"
          >
            <RefreshCw className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-2">
          <StatChip count={counts.overdue}      label="Overdue" color="bg-red-500/15 text-red-400 border-red-500/30"       testid="stat-overdue" />
          <StatChip count={counts.calls_today}  label="Calls"   color="bg-yellow-500/15 text-yellow-400 border-yellow-500/30" testid="stat-calls" />
          <StatChip count={counts.visits_today} label="Visits"  color="bg-blue-500/15 text-blue-400 border-blue-500/30"     testid="stat-visits" />
        </div>

        {/* Punch Clock — available to every user, In/Out + hours */}
        <PunchClock />

        {/* Quick tiles: My Tasks + Calendar */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => nav('/delegation?tab=mytasks')}
            className="border rounded-xl p-3 flex items-center gap-2 bg-[var(--bg-card)] border-[var(--border-color)] active:opacity-75">
            <span className="w-9 h-9 rounded-lg bg-pink-400/10 flex items-center justify-center"><ListChecks className="h-4 w-4 text-pink-400" /></span>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">My Tasks</span>
          </button>
          <button onClick={() => nav('/delegation?tab=calendar')}
            className="border rounded-xl p-3 flex items-center gap-2 bg-[var(--bg-card)] border-[var(--border-color)] active:opacity-75">
            <span className="w-9 h-9 rounded-lg bg-[#e94560]/10 flex items-center justify-center"><ClipboardList className="h-4 w-4 text-[#e94560]" /></span>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Calendar</span>
          </button>
        </div>

        {/* This week agenda — follow-ups, visits, tasks */}
        <AgendaWeekWidget
          card="bg-[var(--bg-card)] border-[var(--border-color)]"
          textPri="text-[var(--text-primary)]" textSec="text-[var(--text-secondary)]" textMuted="text-[var(--text-muted)]" />

        {/* Delegation task card — admin only */}
        {delgData && (delgData.overdue > 0 || delgData.today > 0) && (
          <button
            onClick={() => nav('/delegation')}
            className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl bg-[#e94560]/10 border border-[#e94560]/20 hover:bg-[#e94560]/15 active:scale-[0.99] transition-all"
          >
            <div className="w-9 h-9 rounded-xl bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
              <ClipboardList className="h-4.5 w-4.5 text-[#e94560]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Delegation Tasks</p>
              <p className="text-xs text-[var(--text-muted)]">
                {delgData.overdue > 0 && <span className="text-red-400 font-medium">{delgData.overdue} overdue</span>}
                {delgData.overdue > 0 && delgData.today > 0 && ' · '}
                {delgData.today > 0 && `${delgData.today} due today`}
              </p>
            </div>
            {delgData.overdue > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 flex-shrink-0">{delgData.overdue}</span>
            )}
            <ChevronRight className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
          </button>
        )}

        {total === 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-10 text-center" data-testid="today-empty">
            <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-3" />
            <p className="text-[var(--text-primary)] font-medium">All caught up!</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">No pending calls or visits for today. Great work.</p>
          </div>
        )}

        {/* Overdue */}
        {overdue.length > 0 && (
          <Section title="Overdue" count={overdue.length} icon={AlertTriangle} accent="text-red-400" testid="section-overdue">
            {overdue.map((c, i) => (
              <TodayActionCard
                key={c.plan_id || c.lead_id}
                card={c}
                isOverdue
                onWa={openWa}
                onMarkDone={openMarkDone}
                showSwipeHint={i === 0}
                onView={() => nav(c.kind.includes('visit') ? (isSales ? '/sales/visits' : '/visit-planning') : (isSales ? '/sales/leads' : `/leads?lead=${c.lead_id}`))}
              />
            ))}
          </Section>
        )}

        {/* Calls Today */}
        {calls_today.length > 0 && (
          <Section title="Calls Due Today" count={calls_today.length} icon={Phone} accent="text-yellow-400" testid="section-calls">
            {calls_today.map((c, i) => (
              <TodayActionCard
                key={c.lead_id}
                card={c}
                onWa={openWa}
                onMarkDone={openMarkDone}
                showSwipeHint={overdue.length === 0 && i === 0}
                onView={() => nav(isSales ? '/sales/leads' : `/leads?lead=${c.lead_id}`)}
              />
            ))}
          </Section>
        )}

        {/* Visits Today */}
        {visits_today.length > 0 && (
          <Section title="Visits Today" count={visits_today.length} icon={MapPin} accent="text-blue-400" testid="section-visits">
            {visits_today.map((c, i) => (
              <TodayActionCard
                key={c.plan_id}
                card={c}
                onWa={openWa}
                onMarkDone={openMarkDone}
                showSwipeHint={overdue.length === 0 && calls_today.length === 0 && i === 0}
                onView={() => nav(isSales ? '/sales/visits' : '/visit-planning')}
              />
            ))}
          </Section>
        )}
      </div>

      {/* Mark Done Dialog */}
      <Dialog open={!!markDoneCard} onOpenChange={(o) => !o && setMarkDoneCard(null)}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] w-[calc(100vw-1rem)] sm:max-w-md" data-testid="mark-done-dialog" aria-describedby="mark-done-desc">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" /> Mark as Done
            </DialogTitle>
            <p id="mark-done-desc" className="sr-only">Add a mandatory activity note and next follow-up date to complete this task.</p>
          </DialogHeader>
          <div className="space-y-3">
            {markDoneCard && (
              <div className="bg-[var(--bg-primary)] rounded-md p-2.5 text-xs">
                <p className="text-[var(--text-primary)] font-medium truncate">{markDoneCard.school_name}</p>
                <p className="text-[var(--text-muted)] truncate">
                  {markDoneCard.contact_name}{markDoneCard.contact_phone && ' • ' + markDoneCard.contact_phone}
                </p>
              </div>
            )}
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">Activity Note * (mandatory)</Label>
              <textarea
                rows={3}
                value={markNote}
                onChange={(e) => setMarkNote(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm"
                placeholder="What happened? Outcome, next steps..."
                data-testid="mark-done-note"
              />
            </div>
            {markDoneCard && !markDoneCard.kind?.includes('visit') && (
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Next Follow-up Date * (mandatory)</Label>
                <Input
                  type="date"
                  value={markFollowup}
                  onChange={(e) => setMarkFollowup(e.target.value)}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                  data-testid="mark-done-followup"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDoneCard(null)} className="border-[var(--border-color)] text-[var(--text-secondary)]">
              Cancel
            </Button>
            <Button onClick={saveMarkDone} disabled={markSaving} className="bg-green-600 hover:bg-green-700 text-white" data-testid="mark-done-save">
              {markSaving ? 'Saving...' : 'Mark Done'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsAppSendDialog open={waOpen} onOpenChange={setWaOpen} module={waCtx.module} context={waCtx.context} title={waCtx.title} />
    </AppShell>
  );
}
