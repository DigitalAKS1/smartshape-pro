import React, { useRef, useState, useEffect } from 'react';
import { Phone, MessageSquare, CheckCircle2, Clock, MapPin, User, Flame } from 'lucide-react';

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

const SWIPE_THRESHOLD = 80; // px needed to trigger action

/**
 * Individual action/task card with swipe-to-act, call, WhatsApp, and mark-done buttons.
 * Props: card, isOverdue, onWa, onMarkDone, onView, showSwipeHint
 */
export default function TodayActionCard({ card, isOverdue, onWa, onMarkDone, onView, showSwipeHint = false }) {
  const stageColor   = STAGE_COLORS[card.stage] || 'bg-gray-500/15 text-gray-400';
  const stale        = (card.days_stale || 0) >= 3;
  const cleanedPhone = String(card.contact_phone || '').replace(/\D/g, '');

  const touchStart = useRef(null);
  const [swipeDx, setSwipeDx] = useState(0);
  const [swiped, setSwiped]   = useState(false);

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
    setSwipeDx(Math.max(-130, Math.min(130, dx)));
  };

  const handleTouchEnd = () => {
    if (!swiped) {
      if (swipeDx >= SWIPE_THRESHOLD) { setSwiped(true); onMarkDone(card); }
      else if (swipeDx <= -SWIPE_THRESHOLD) { setSwiped(true); onWa(card); }
    }
    setSwipeDx(0);
    touchStart.current = null;
  };

  const revealRight = swipeDx > 20;
  const revealLeft  = swipeDx < -20;

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

      {/* Card content */}
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
        {/* Swipe hint */}
        {hintActive && (
          <div className="flex justify-between items-center mb-1.5 px-1 animate-pulse pointer-events-none">
            <span className="text-[10px] text-green-400 flex items-center gap-1">→ Swipe right: Done</span>
            <span className="text-[10px] text-[#25D366] flex items-center gap-1">WhatsApp: Swipe left ←</span>
          </div>
        )}

        {/* Top row */}
        <div className="flex items-start justify-between gap-2 mb-1.5" onClick={onView}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{card.school_name || card.contact_name || 'Untitled'}</h3>
              {card.is_hot && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold">
                  <Flame className="h-2.5 w-2.5" />HOT
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1">
              <User className="h-3 w-3" />{card.contact_name || '—'}
            </p>
          </div>
          {card.stage && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize flex-shrink-0 ${stageColor}`}>
              {card.stage.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mt-1">
          {card.due_date && (
            <span className={`inline-flex items-center gap-1 ${isOverdue ? 'text-red-400 font-medium' : ''}`}>
              <Clock className="h-3 w-3" />
              {isOverdue ? 'Overdue ' : card.visit_time ? card.visit_time + ' ' : ''}
              {card.due_date}
            </span>
          )}
          {stale && card.days_stale !== null && (
            <span className="text-yellow-400">Stale {card.days_stale}d</span>
          )}
          {card.assigned_name && <span className="truncate">{card.assigned_name.split(' ')[0]}</span>}
        </div>

        {/* Quick actions */}
        <div className="flex gap-1.5 mt-3">
          {cleanedPhone && (
            <a
              href={`tel:+${cleanedPhone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 h-11 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
              data-testid={`tap-call-${card.lead_id || card.plan_id}`}
            >
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onWa(card); }}
            className="flex-1 h-11 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
            data-testid={`tap-wa-${card.lead_id || card.plan_id}`}
          >
            <MessageSquare className="h-4 w-4" /> WhatsApp
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMarkDone(card); }}
            className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5"
            data-testid={`tap-done-${card.lead_id || card.plan_id}`}
          >
            <CheckCircle2 className="h-4 w-4" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
