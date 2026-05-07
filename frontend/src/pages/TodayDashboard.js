import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { todayActions } from '../lib/api';
import { toast } from 'sonner';
import { Phone, MessageSquare, CheckCircle2, Calendar, Flame, Clock, MapPin, User, AlertTriangle, Loader2, X, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import WhatsAppSendDialog from '../components/WhatsAppSendDialog';
import AppShell from '../components/layouts/AppShell';

const STAGE_COLORS = {
  new: 'bg-blue-500/15 text-blue-400',
  contacted: 'bg-cyan-500/15 text-cyan-400',
  followup: 'bg-yellow-500/15 text-yellow-400',
  online_demo: 'bg-indigo-500/15 text-indigo-400',
  visit_plan: 'bg-violet-500/15 text-violet-400',
  visit_done: 'bg-purple-500/15 text-purple-400',
  quotation_sent: 'bg-amber-500/15 text-amber-400',
  negotiation: 'bg-orange-500/15 text-orange-400',
  won: 'bg-green-500/15 text-green-400',
  lost: 'bg-red-500/15 text-red-400',
};

export default function TodayDashboard() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markDoneCard, setMarkDoneCard] = useState(null);
  const [markNote, setMarkNote] = useState('');
  const [markFollowup, setMarkFollowup] = useState('');
  const [markSaving, setMarkSaving] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx] = useState({ module: 'lead', context: {}, title: '' });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await todayActions.get();
      setData(r.data);
    } catch { toast.error('Failed to load today actions'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // WebSocket for real-time badge counts — falls back to 60s polling if WS unavailable
  useEffect(() => {
    const base = (process.env.REACT_APP_BACKEND_URL || '').replace(/^http/, 'ws');
    let ws = null;
    let retries = 0;
    const maxRetries = 3;

    const connect = () => {
      try {
        ws = new WebSocket(`${base}/api/ws/today-actions`);
        ws.onopen = () => { retries = 0; };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'today_actions_update') {
              // Trigger a silent refresh to get fresh action list
              load(true);
            }
          } catch { /* ignore malformed */ }
        };
        ws.onclose = () => {
          if (retries < maxRetries) {
            retries++;
            setTimeout(connect, retries * 2000); // exponential backoff: 2s, 4s, 6s
          } else {
            // Fall back to 60s polling
            const t = setInterval(() => load(true), 60_000);
            return () => clearInterval(t);
          }
        };
        ws.onerror = () => { ws.close(); };
      } catch { /* WS not available — polling fallback below */ }
    };

    connect();
    // Polling fallback always runs as safety net
    const t = setInterval(() => load(true), 90_000);
    return () => { ws?.close(); clearInterval(t); };
  }, [load]);

  const openMarkDone = (card) => {
    setMarkDoneCard(card);
    setMarkNote('');
    setMarkFollowup('');
  };
  const saveMarkDone = async () => {
    if (!markNote.trim()) { toast.error('Activity note is required'); return; }
    const isVisit = (markDoneCard.kind || '').includes('visit');
    if (!isVisit && !markFollowup) { toast.error('Next follow-up date is mandatory'); return; }
    setMarkSaving(true);
    try {
      await todayActions.markDone({
        kind: markDoneCard.kind,
        note: markNote,
        next_followup_date: markFollowup,
        lead_id: markDoneCard.lead_id,
        plan_id: markDoneCard.plan_id,
      });
      toast.success('Marked done');
      setMarkDoneCard(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to mark done'); }
    finally { setMarkSaving(false); }
  };

  const openWa = (card) => {
    setWaCtx({
      module: card.kind.includes('visit') ? 'visit' : 'lead',
      title: `WhatsApp - ${card.contact_name || card.school_name}`,
      context: {
        lead_id: card.lead_id, school_id: card.school_id,
        phone: card.contact_phone, contact_name: card.contact_name,
        school_name: card.school_name,
      },
    });
    setWaOpen(true);
  };

  if (loading) return <AppShell><div className="flex items-center justify-center h-96"><Loader2 className="h-10 w-10 animate-spin text-[#e94560]" /></div></AppShell>;
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
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{new Date(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })} • {total} pending</p>
          </div>
          <button onClick={() => load()} className={`p-2 rounded-full hover:bg-[var(--bg-hover)] ${refreshing ? 'animate-spin' : ''}`} data-testid="today-refresh-btn">
            <RefreshCw className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-2">
          <StatChip count={counts.overdue} label="Overdue" color="bg-red-500/15 text-red-400 border-red-500/30" testid="stat-overdue" />
          <StatChip count={counts.calls_today} label="Calls" color="bg-yellow-500/15 text-yellow-400 border-yellow-500/30" testid="stat-calls" />
          <StatChip count={counts.visits_today} label="Visits" color="bg-blue-500/15 text-blue-400 border-blue-500/30" testid="stat-visits" />
        </div>

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
            {overdue.map((c, i) => <ActionCard key={c.plan_id || c.lead_id} card={c} isOverdue onWa={openWa} onMarkDone={openMarkDone} showSwipeHint={i === 0} onView={() => nav(c.kind.includes('visit') ? '/visit-planning' : `/leads?lead=${c.lead_id}`)} />)}
          </Section>
        )}

        {/* Calls Today */}
        {calls_today.length > 0 && (
          <Section title="Calls Due Today" count={calls_today.length} icon={Phone} accent="text-yellow-400" testid="section-calls">
            {calls_today.map((c, i) => <ActionCard key={c.lead_id} card={c} onWa={openWa} onMarkDone={openMarkDone} showSwipeHint={overdue.length === 0 && i === 0} onView={() => nav(`/leads?lead=${c.lead_id}`)} />)}
          </Section>
        )}

        {/* Visits Today */}
        {visits_today.length > 0 && (
          <Section title="Visits Today" count={visits_today.length} icon={MapPin} accent="text-blue-400" testid="section-visits">
            {visits_today.map((c, i) => <ActionCard key={c.plan_id} card={c} onWa={openWa} onMarkDone={openMarkDone} showSwipeHint={overdue.length === 0 && calls_today.length === 0 && i === 0} onView={() => nav('/visit-planning')} />)}
          </Section>
        )}
      </div>

      {/* Mark Done Dialog */}
      <Dialog open={!!markDoneCard} onOpenChange={(o) => !o && setMarkDoneCard(null)}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] max-w-md" data-testid="mark-done-dialog" aria-describedby="mark-done-desc">
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
                <p className="text-[var(--text-muted)] truncate">{markDoneCard.contact_name} {markDoneCard.contact_phone && ' • ' + markDoneCard.contact_phone}</p>
              </div>
            )}
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">Activity Note * (mandatory)</Label>
              <textarea rows={3} value={markNote} onChange={(e) => setMarkNote(e.target.value)} className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm" placeholder="What happened? Outcome, next steps..." data-testid="mark-done-note" />
            </div>
            {markDoneCard && !markDoneCard.kind?.includes('visit') && (
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Next Follow-up Date * (mandatory)</Label>
                <Input type="date" value={markFollowup} onChange={(e) => setMarkFollowup(e.target.value)} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="mark-done-followup" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkDoneCard(null)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
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

const SWIPE_THRESHOLD = 80; // px needed to trigger action

function ActionCard({ card, isOverdue, onWa, onMarkDone, onView, showSwipeHint = false }) {
  const stageColor = STAGE_COLORS[card.stage] || 'bg-gray-500/15 text-gray-400';
  const stale = (card.days_stale || 0) >= 3;
  const cleanedPhone = String(card.contact_phone || '').replace(/\D/g, '');

  const touchStart = useRef(null);
  const [swipeDx, setSwipeDx] = useState(0);
  const [swiped, setSwiped] = useState(false); // prevent action double-fire

  // Brief swipe hint animation on first card only
  const [hintActive, setHintActive] = useState(showSwipeHint);
  useEffect(() => {
    if (!showSwipeHint) return;
    const t = setTimeout(() => setHintActive(false), 2000);
    return () => clearTimeout(t);
  }, [showSwipeHint]);

  const handleTouchStart = (e) => {
    touchStart.current = e.touches[0].clientX;
    setSwiped(false);
  };

  const handleTouchMove = (e) => {
    if (touchStart.current === null) return;
    const dx = e.touches[0].clientX - touchStart.current;
    // Clamp to ±130px so card doesn't fly off screen
    setSwipeDx(Math.max(-130, Math.min(130, dx)));
  };

  const handleTouchEnd = () => {
    if (!swiped) {
      if (swipeDx >= SWIPE_THRESHOLD) {
        setSwiped(true);
        onMarkDone(card);
      } else if (swipeDx <= -SWIPE_THRESHOLD) {
        setSwiped(true);
        onWa(card);
      }
    }
    setSwipeDx(0);
    touchStart.current = null;
  };

  const absX = Math.abs(swipeDx);
  const revealRight = swipeDx > 20;  // swiping right → Done
  const revealLeft  = swipeDx < -20; // swiping left  → WhatsApp

  return (
    <div className="relative rounded-xl overflow-hidden" data-testid={`action-card-${card.lead_id || card.plan_id}`}>
      {/* Background reveal layers */}
      <div className={`absolute inset-0 flex items-center px-5 transition-opacity duration-150 ${revealRight ? 'opacity-100' : 'opacity-0'} bg-green-600 rounded-xl`}>
        <CheckCircle2 className="h-7 w-7 text-white" />
        <span className="ml-2 text-white font-semibold text-sm">Mark Done</span>
      </div>
      <div className={`absolute inset-0 flex items-center justify-end px-5 transition-opacity duration-150 ${revealLeft ? 'opacity-100' : 'opacity-0'} bg-[#25D366] rounded-xl`}>
        <span className="mr-2 text-white font-semibold text-sm">WhatsApp</span>
        <MessageSquare className="h-7 w-7 text-white" />
      </div>

      {/* Card content — slides on touch */}
      <div
        className={`bg-[var(--bg-card)] border ${isOverdue ? 'border-red-500/40' : stale ? 'border-yellow-500/30' : 'border-[var(--border-color)]'} rounded-xl p-3 select-none`}
        style={{
          transform: `translateX(${swipeDx}px)`,
          transition: swipeDx === 0 ? 'transform 0.25s ease' : 'none',
          willChange: 'transform',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe hint arrows (shown briefly on first card) */}
        {hintActive && (
          <div className="flex justify-between items-center mb-1.5 px-1 animate-pulse pointer-events-none">
            <span className="text-[10px] text-green-400 flex items-center gap-1">← Swipe right: Done</span>
            <span className="text-[10px] text-[#25D366] flex items-center gap-1">WhatsApp: Swipe left →</span>
          </div>
        )}

        {/* Top row */}
        <div className="flex items-start justify-between gap-2 mb-1.5" onClick={onView}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{card.school_name || card.contact_name || 'Untitled'}</h3>
              {card.is_hot && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold"><Flame className="h-2.5 w-2.5" />HOT</span>}
            </div>
            <p className="text-xs text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1"><User className="h-3 w-3" />{card.contact_name || '—'}</p>
          </div>
          {card.stage && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize flex-shrink-0 ${stageColor}`}>{card.stage.replace(/_/g, ' ')}</span>}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mt-1">
          {card.due_date && <span className={`inline-flex items-center gap-1 ${isOverdue ? 'text-red-400 font-medium' : ''}`}>
            <Clock className="h-3 w-3" />
            {isOverdue ? 'Overdue ' : card.visit_time ? card.visit_time + ' ' : ''}
            {card.due_date}
          </span>}
          {stale && card.days_stale !== null && (
            <span className="text-yellow-400">Stale {card.days_stale}d</span>
          )}
          {card.assigned_name && <span className="truncate">{card.assigned_name.split(' ')[0]}</span>}
        </div>

        {/* Quick actions - 44px tap targets */}
        <div className="flex gap-1.5 mt-3">
          {cleanedPhone && (
            <a href={`tel:+${cleanedPhone}`} onClick={(e) => e.stopPropagation()} className="flex-1 h-11 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5" data-testid={`tap-call-${card.lead_id || card.plan_id}`}>
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
          <button onClick={(e) => { e.stopPropagation(); onWa(card); }} className="flex-1 h-11 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5" data-testid={`tap-wa-${card.lead_id || card.plan_id}`}>
            <MessageSquare className="h-4 w-4" /> WhatsApp
          </button>
          <button onClick={(e) => { e.stopPropagation(); onMarkDone(card); }} className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5" data-testid={`tap-done-${card.lead_id || card.plan_id}`}>
            <CheckCircle2 className="h-4 w-4" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
