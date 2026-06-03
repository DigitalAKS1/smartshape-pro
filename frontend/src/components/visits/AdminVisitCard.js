import React from 'react';
import { Button } from '../ui/button';
import {
  MapPin, Calendar, AlertTriangle, Navigation,
  CheckCircle, RotateCcw, Trash2, History,
} from 'lucide-react';
import { STATUS_CFG, fmtTime } from '../../lib/visitUtils';

/**
 * Admin visit-plan card with check-in / check-out / reschedule / delete actions.
 *
 * Props:
 *   plan           — visit plan object
 *   tk             — design-token object from useVisitPlanning
 *   isDark         — boolean
 *   today          — ISO date string (YYYY-MM-DD)
 *   onCheckIn      — (plan, workType) => void
 *   onOpenCheckout — (plan) => void
 *   onReschedule   — (plan) => void
 *   onDelete       — (planId) => void
 *   onHistory      — () => void
 */
export default function AdminVisitCard({ plan, tk, isDark, today, onCheckIn, onOpenCheckout, onReschedule, onDelete, onHistory }) {
  const isOverdue = plan.visit_date < today && plan.status === 'planned';
  const statusCfg = STATUS_CFG[plan.status] || STATUS_CFG.planned;

  return (
    <div className={`${tk.card} border rounded-xl p-4 ${isOverdue ? '!border-[#e94560]/40' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">

        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f1f5f9]'
            }`}>
              <MapPin className="h-4 w-4 text-[#e94560]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`font-semibold text-sm ${tk.t1} truncate max-w-[200px] sm:max-w-none`}>
                  {plan.school_name || plan.lead_name || 'Visit'}
                </p>
                <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${statusCfg.cls}`}>
                  {statusCfg.label}
                </span>
                {isOverdue && (
                  <span className="flex items-center gap-1 text-[11px] text-[#e94560] font-medium">
                    <AlertTriangle className="h-3 w-3" />Overdue
                  </span>
                )}
              </div>

              <div className={`flex items-center gap-3 mt-1.5 text-xs ${tk.tm} flex-wrap`}>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {plan.visit_date}
                  {plan.visit_time && <span className="ml-1 font-medium">{fmtTime(plan.visit_time)}</span>}
                </span>
                {plan.assigned_name && <span className="flex items-center gap-1">· {plan.assigned_name}</span>}
                {plan.purpose       && <span className="flex items-center gap-1">· {plan.purpose}</span>}
                {plan.work_type === 'wfh' && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-semibold">WFH</span>
                )}
              </div>

              {plan.planned_address && (
                <div className={`flex items-start gap-1.5 mt-1.5 text-xs ${tk.tm}`}>
                  <MapPin className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span className="break-all leading-snug">{plan.planned_address}</span>
                </div>
              )}

              {plan.visit_notes && (
                <p className={`text-xs ${tk.t2} mt-1.5 italic`}>"{plan.visit_notes}"</p>
              )}
              {plan.outcome && plan.outcome !== plan.visit_notes && (
                <p className="text-xs text-emerald-600 mt-1">Outcome: {plan.outcome}</p>
              )}
              {plan.reschedule_count > 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  Rescheduled {plan.reschedule_count}× · {plan.reschedule_reason || '—'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0">
          {plan.planned_lat && plan.planned_lng && (
            <Button size="sm" variant="ghost"
              onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${plan.planned_lat},${plan.planned_lng}`, '_blank')}
              className={`${tk.tm} h-8 px-2.5 text-xs rounded-lg`}>
              <Navigation className="h-3.5 w-3.5 mr-1" />Nav
            </Button>
          )}

          {plan.status === 'planned' && (
            <>
              <Button size="sm" onClick={() => onCheckIn(plan, 'field')}
                className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-3 text-xs rounded-lg">
                GPS In
              </Button>
              <Button size="sm" variant="outline" onClick={() => onCheckIn(plan, 'wfh')}
                className="border-violet-400/40 text-violet-500 hover:bg-violet-50 h-8 px-3 text-xs rounded-lg">
                WFH
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReschedule(plan)}
                className="border-amber-400/40 text-amber-500 hover:bg-amber-50 h-8 px-2.5 text-xs rounded-lg">
                <RotateCcw className="h-3 w-3 mr-1" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(plan.plan_id)}
                className="text-red-400 hover:text-red-500 hover:bg-red-50 h-8 w-8 p-0 rounded-lg">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {plan.status === 'in_progress' && (
            <>
              <Button size="sm" onClick={() => onOpenCheckout(plan)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3 text-xs rounded-lg">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Check Out
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReschedule(plan)}
                className="border-amber-400/40 text-amber-500 hover:bg-amber-50 h-8 px-2.5 text-xs rounded-lg">
                <RotateCcw className="h-3 w-3 mr-1" />
              </Button>
            </>
          )}

          {plan.reschedule_count > 0 && (
            <Button size="sm" variant="ghost" onClick={onHistory}
              className={`${tk.tm} h-8 px-2.5 text-xs rounded-lg`}>
              <History className="h-3.5 w-3.5 mr-1" />{plan.reschedule_count}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
