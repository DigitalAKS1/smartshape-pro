import React, { useState, useEffect } from 'react';
import {
  Check, X, Eye, Clock, CheckSquare, ChevronDown, ChevronRight,
  IndianRupee, Package, FileText, Truck, Shield,
  Link2, User, PauseCircle, PlayCircle, ScrollText,
} from 'lucide-react';

const STAGE_ICONS = {
  crm_confirm: FileText, inventory_check: Package, qc_check: Eye,
  predispatch: CheckSquare, dispatch: Truck, payment_advance: IndianRupee,
  delivery_confirm: Check, payment_final: IndianRupee,
};

/* Accessible TAT badge — color + icon glyph + text label (not color alone). */
const TAT_STYLE = {
  green:   { cls: 'bg-green-500/15 text-green-500 border-green-500/20',   dot: 'bg-green-500',   icon: '✓', label: 'On Track' },
  orange:  { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/20',   dot: 'bg-amber-500',   icon: '▲', label: 'Due Soon' },
  overdue: { cls: 'bg-red-500/15 text-red-500 border-red-500/20',         dot: 'bg-red-500',     icon: '✕', label: 'Overdue'  },
  red:     { cls: 'bg-red-500/15 text-red-500 border-red-500/20',         dot: 'bg-red-500',     icon: '▲', label: 'At Risk'  },
  pending: { cls: 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]', dot: 'bg-slate-400', icon: '•', label: 'Pending' },
  done:    { cls: 'bg-green-500/15 text-green-500 border-green-500/20',   dot: 'bg-green-500',   icon: '✓', label: 'Done'    },
  paused:  { cls: 'bg-sky-500/15 text-sky-500 border-sky-500/20',         dot: 'bg-sky-500',     icon: '⏸', label: 'Paused'  },
  waiting: { cls: 'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border-color)]', dot: 'bg-slate-300', icon: '…', label: 'Waiting' },
  rework:  { cls: 'bg-rose-500/15 text-rose-500 border-rose-500/20',      dot: 'bg-rose-500',    icon: '↺', label: 'Rework'  },
};

function TatBadge({ status }) {
  const s = TAT_STYLE[status] || TAT_STYLE.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}
      aria-label={s.label}
    >
      <span aria-hidden="true" className="font-mono leading-none">{s.icon}</span>
      {s.label}
    </span>
  );
}

/* ── FlowCard: single flow row with expand/collapse ─────────────────────────── */
export function FlowCard({ flow, expanded, activeFlowData, onToggle, onComplete, onApprove, onReject, onPause, onResume, fetchLogs, onPayment, card, textPri, textSec, textMuted }) {
  const PINK = '#e94560';
  const stages = activeFlowData?.stages || flow.stages || [];
  const activeStage = stages.find(s => s.status === 'active');
  const doneCount = stages.filter(s => s.status === 'done').length;
  const pct = stages.length ? Math.round(doneCount / stages.length * 100) : 0;

  /* Audit log — local state, fetched once per expand */
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);

  useEffect(() => {
    if (!expanded) { setShowLogs(false); setLogsLoaded(false); setLogs([]); }
  }, [expanded]);

  const handleShowLogs = async () => {
    if (!logsLoaded && fetchLogs) {
      const data = await fetchLogs(flow.flow_id);
      setLogs(data);
      setLogsLoaded(true);
    }
    setShowLogs(v => !v);
  };

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
            <button onClick={handleShowLogs}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
              <ScrollText className="h-3.5 w-3.5" /> {showLogs ? 'Hide Log' : 'Audit Log'}
            </button>
          </div>

          {/* Audit log timeline */}
          {showLogs && (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 space-y-2">
              <p className={`text-xs font-semibold ${textSec} mb-1`}>Audit Log</p>
              {logs.length === 0 ? (
                <p className={`text-[10px] ${textMuted}`}>No log entries yet.</p>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} className={`flex items-start gap-2 text-[10px] ${textMuted} border-l-2 border-[var(--border-color)] pl-2`}>
                    <span className="flex-shrink-0 font-mono">
                      {entry.at ? new Date(entry.at).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true }) : '—'}
                    </span>
                    <span className="flex-shrink-0 font-semibold capitalize" style={{ color: '#e94560' }}>{entry.action}</span>
                    {entry.stage_label && <span className="flex-shrink-0">{entry.stage_label}</span>}
                    <span className={`flex-shrink-0 ${textMuted}`}>by {entry.by || 'system'}</span>
                    {entry.note && <span className="truncate">· {entry.note}</span>}
                  </div>
                ))
              )}
            </div>
          )}

          <div className="relative pl-6 space-y-0">
            <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-[var(--border-color)]" />
            {activeFlowData.stages.map((stage) => {
              const Icon = STAGE_ICONS[stage.key] || Check;
              const isActive = stage.status === 'active';
              const isPaused = stage.status === 'paused';
              const needsApproval = stage.status === 'pending_approval';
              const tatSt = stage.status === 'done' ? 'done'
                : isPaused ? 'paused'
                : isActive ? (stage.tat_status || 'pending')
                : stage.status;
              return (
                <div key={stage.stage_id} className="relative flex items-start gap-3 py-2.5">
                  <div className={`absolute -left-6 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10 ${
                    stage.status === 'done' ? 'bg-green-500' :
                    isActive ? 'bg-amber-500 animate-pulse' :
                    isPaused ? 'bg-sky-500' :
                    needsApproval ? 'bg-blue-500' :
                    'bg-[var(--bg-hover)] border-2 border-[var(--border-color)]'
                  }`}>
                    {stage.status === 'done' ? <Check className="h-3 w-3 text-white" /> : <Icon className={`h-2.5 w-2.5 ${(isActive || isPaused) ? 'text-white' : 'text-[var(--text-muted)]'}`} />}
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
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <button onClick={() => onComplete(stage)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90"
                          style={{ background: '#10b981' }}>
                          <Check className="h-3.5 w-3.5" /> Mark Done
                        </button>
                        {onPause && (
                          <button onClick={() => onPause(stage)}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-sky-500/30 text-sky-500 hover:bg-sky-500/10`}>
                            <PauseCircle className="h-3.5 w-3.5" /> Pause
                          </button>
                        )}
                      </div>
                    )}
                    {isPaused && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className={`flex items-center gap-1 text-[10px] text-sky-500`}>
                          <PauseCircle className="h-3.5 w-3.5" /> Stage is paused
                        </span>
                        {onResume && (
                          <button onClick={() => onResume(stage)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-500 hover:bg-sky-600">
                            <PlayCircle className="h-3.5 w-3.5" /> Resume
                          </button>
                        )}
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
