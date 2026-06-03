import React from 'react';
import {
  Check, X, Eye, Clock, CheckSquare, ChevronDown, ChevronRight,
  IndianRupee, Package, FileText, Truck, Shield,
  Link2, User,
} from 'lucide-react';

const STAGE_ICONS = {
  crm_confirm: FileText, inventory_check: Package, qc_check: Eye,
  predispatch: CheckSquare, dispatch: Truck, payment_advance: IndianRupee,
  delivery_confirm: Check, payment_final: IndianRupee,
};

const TAT_STYLE = {
  green:   { cls: 'bg-green-500/15 text-green-500 border-green-500/20',   dot: 'bg-green-500',   label: 'On Time' },
  orange:  { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/20',   dot: 'bg-amber-500',   label: 'At Risk' },
  overdue: { cls: 'bg-red-500/15 text-red-500 border-red-500/20',         dot: 'bg-red-500',     label: 'Overdue' },
  red:     { cls: 'bg-red-500/15 text-red-500 border-red-500/20',         dot: 'bg-red-500',     label: 'Late' },
  pending: { cls: 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]', dot: 'bg-slate-400', label: 'Pending' },
  done:    { cls: 'bg-green-500/15 text-green-500 border-green-500/20',   dot: 'bg-green-500',   label: 'Done' },
  waiting: { cls: 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]', dot: 'bg-slate-300', label: 'Waiting' },
  rework:  { cls: 'bg-rose-500/15 text-rose-500 border-rose-500/20',      dot: 'bg-rose-500',    label: 'Rework' },
};

function TatBadge({ status }) {
  const s = TAT_STYLE[status] || TAT_STYLE.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/* ── FlowCard: single flow row with expand/collapse ─────────────────────────── */
export function FlowCard({ flow, expanded, activeFlowData, onToggle, onComplete, onApprove, onReject, onPayment, card, textPri, textSec, textMuted }) {
  const PINK = '#e94560';
  const stages = activeFlowData?.stages || flow.stages || [];
  const activeStage = stages.find(s => s.status === 'active');
  const doneCount = stages.filter(s => s.status === 'done').length;
  const pct = stages.length ? Math.round(doneCount / stages.length * 100) : 0;

  return (
    <div className={`${card} border rounded-xl overflow-hidden`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors text-left">
        <div className="relative w-1 self-stretch rounded-full bg-[var(--bg-primary)] overflow-hidden flex-shrink-0">
          <div className="absolute top-0 left-0 w-full bg-green-500 rounded-full" style={{ height: `${pct}%` }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold ${textPri} truncate`}>{flow.title}</p>
            {flow.reference_id && <span className={`text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-primary)] ${textMuted}`}>{flow.reference_id}</span>}
            {flow.lead_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 flex items-center gap-1"><Link2 className="h-2.5 w-2.5" />CRM</span>}
          </div>
          <div className={`flex items-center gap-4 mt-1 text-xs ${textMuted} flex-wrap`}>
            {flow.customer_name && <span className="flex items-center gap-1"><User className="h-3 w-3" />{flow.customer_name}</span>}
            {flow.amount > 0 && <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3" />₹{flow.amount?.toLocaleString()}</span>}
            {activeStage && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{activeStage.label}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-lg font-black font-mono ${textPri}`}>{pct}%</p>
          <p className={`text-[10px] ${textMuted}`}>{doneCount}/{stages.length} stages</p>
        </div>
        <div className={`${textMuted} flex-shrink-0`}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {expanded && activeFlowData && (
        <div className="border-t border-[var(--border-color)] px-5 py-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => onPayment(flow)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
              <IndianRupee className="h-3.5 w-3.5" /> Payments
            </button>
          </div>

          <div className="relative pl-6 space-y-0">
            <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-[var(--border-color)]" />
            {activeFlowData.stages.map((stage) => {
              const Icon = STAGE_ICONS[stage.key] || Check;
              const isActive = stage.status === 'active';
              const needsApproval = stage.status === 'pending_approval';
              const tatSt = stage.status === 'done' ? 'done' : stage.status === 'active' ? (stage.tat_status || 'pending') : stage.status;
              return (
                <div key={stage.stage_id} className="relative flex items-start gap-3 py-2.5">
                  <div className={`absolute -left-6 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10 ${
                    stage.status === 'done' ? 'bg-green-500' :
                    isActive ? 'bg-amber-500 animate-pulse' :
                    needsApproval ? 'bg-blue-500' :
                    'bg-[var(--bg-hover)] border-2 border-[var(--border-color)]'
                  }`}>
                    {stage.status === 'done' ? <Check className="h-3 w-3 text-white" /> : <Icon className={`h-2.5 w-2.5 ${isActive ? 'text-white' : 'text-[var(--text-muted)]'}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${textPri}`}>{stage.label}</span>
                      <TatBadge status={tatSt} />
                      {stage.score !== null && stage.score !== undefined && (
                        <span className={`text-[10px] font-bold px-1.5 rounded ${stage.score >= 80 ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'}`}>
                          {stage.score}pts
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center gap-4 mt-0.5 text-[10px] ${textMuted} flex-wrap`}>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Plan: {stage.plan_done ? new Date(stage.plan_done).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true }) : '—'}
                      </span>
                      {stage.actual_done && (
                        <span className={`flex items-center gap-1 ${stage.tat_status === 'green' ? 'text-green-500' : 'text-red-500'}`}>
                          <Check className="h-3 w-3" />
                          Done: {new Date(stage.actual_done).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}
                        </span>
                      )}
                      {stage.done_note && <span>· {stage.done_note}</span>}
                    </div>
                    {isActive && (
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => onComplete(stage)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90"
                          style={{ background: '#10b981' }}>
                          <Check className="h-3.5 w-3.5" /> Mark Done
                        </button>
                      </div>
                    )}
                    {needsApproval && (
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => onApprove(stage)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600">
                          <Shield className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button onClick={() => onReject(stage)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-500/30 hover:bg-red-500/10">
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
