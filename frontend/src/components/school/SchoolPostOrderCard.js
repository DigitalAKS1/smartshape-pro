import React from 'react';
import { ClipboardList, ExternalLink } from 'lucide-react';

// Post-Order Implementation flow status on the School 360. Reads the FMS flow(s)
// returned by get_school_profile (profile.fms_flows). Renders an 8-step stepper
// with the current stage highlighted in its SLA colour, so a rep sees exactly
// where a delivered school is in Training → Implementation → Engagement without
// leaving the CRM.

const STAGES = [
  { key: 'delivery_confirmed', label: 'Delivery' },
  { key: 'training_date',      label: 'Train date' },
  { key: 'invite_reg',         label: 'Invite' },
  { key: 'pre_training',       label: 'Readiness' },
  { key: 'training',           label: 'Training' },
  { key: 'evidence',           label: 'Evidence' },
  { key: 'dossier',            label: 'Dossier' },
  { key: 'engagement',         label: 'Engage' },
];

const TAT_COLOR = { green: '#22c55e', orange: '#f59e0b', red: '#ef4444', overdue: '#ef4444', pending: '#94a3b8' };

export default function SchoolPostOrderCard({ flows = [] }) {
  const postorder = (flows || []).filter((f) => f && f.flow_type === 'postorder');
  if (postorder.length === 0) return null;

  return (
    <div className="lg:col-span-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" /> Post-Order Implementation
        </p>
        <a href="/flow-management" className="text-[11px] text-[#e94560] hover:underline inline-flex items-center gap-1">
          Open FMS <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="px-5 py-4 space-y-5">
        {postorder.map((f) => {
          const done = f.status === 'completed';
          const curIdx = STAGES.findIndex((s) => s.key === f.current_stage_key);
          const cur = f.current_stage || {};
          const tat = TAT_COLOR[cur.tat_status] || TAT_COLOR.pending;
          return (
            <div key={f.flow_id}>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{f.title}</span>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ backgroundColor: done ? 'rgba(34,197,94,.14)' : `${tat}22`, color: done ? '#16a34a' : tat }}
                >
                  {done ? 'Completed' : `${cur.label || 'In progress'}${cur.tat_status && cur.tat_status !== 'pending' ? ' · ' + cur.tat_status : ''}`}
                </span>
              </div>
              <div className="flex items-start gap-1">
                {STAGES.map((s, i) => {
                  const state = done || i < curIdx ? 'done' : i === curIdx ? 'active' : 'todo';
                  const color = state === 'done' ? '#22c55e' : state === 'active' ? tat : 'var(--border-color)';
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={s.label}>
                      <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: color }} />
                      <span
                        className="text-[8px] leading-none truncate max-w-full"
                        style={{ color: state === 'todo' ? 'var(--text-muted)' : 'var(--text-secondary)' }}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
