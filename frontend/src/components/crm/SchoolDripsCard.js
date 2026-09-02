import React, { useState, useEffect, useCallback } from 'react';
import { dripSequences } from '../../lib/api';
import { Zap, AlertTriangle } from 'lucide-react';

const CH = {
  whatsapp: { label: 'WhatsApp', fg: '#2E7D5B' },
  mail: { label: 'Post', fg: '#C4402E' },
  call: { label: 'Call', fg: '#9A6A15' },
  email: { label: 'Email', fg: '#1E5AA8' },
};

const STATUS = {
  active: { label: 'Running', fg: '#2E7D5B', bg: 'rgba(46,125,91,0.10)' },
  paused: { label: 'Paused', fg: '#C4402E', bg: 'rgba(196,64,46,0.10)' },
  completed: { label: 'Finished', fg: 'var(--text-muted)', bg: 'var(--bg-primary)' },
  cancelled: { label: 'Cancelled', fg: 'var(--text-muted)', bg: 'var(--bg-primary)' },
};

/**
 * "What marketing is this school already getting?" — the question a rep asks right
 * before picking up the phone, which until now had no answer anywhere in the app.
 */
export default function SchoolDripsCard({ schoolId }) {
  const [data, setData] = useState({ rows: [], active: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try { const r = await dripSequences.forSchool(schoolId); setData(r.data); }
    catch { /* non-fatal panel */ }
    finally { setLoading(false); }
  }, [schoolId]);
  useEffect(() => { load(); }, [load]);

  if (loading || data.total === 0) return null;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5"
      data-testid="school-drips">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)] flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#e94560]" /> Marketing sequences
        </h3>
        <span className="text-[11px] text-[var(--text-muted)]">
          {data.active} running of {data.total}
        </span>
      </div>

      <div className="grid gap-2">
        {data.rows.map(r => {
          const st = STATUS[r.status] || STATUS.completed;
          const ch = CH[r.next_channel];
          return (
            <div key={r.enrollment_id} data-testid={`drip-${r.enrollment_id}`}
              className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                  {r.sequence_name}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Step {r.step} of {r.total_steps}
                  {r.next_channel && ch ? (
                    <> · next: <b style={{ color: ch.fg }}>{ch.label}</b>
                      {r.next_item ? ` (${r.next_item})` : ''}
                      {r.next_due ? ` on ${r.next_due}` : ''}
                    </>
                  ) : null}
                </p>
                {r.status === 'paused' && r.paused_reason ? (
                  <p className="text-[11px] mt-1 flex items-start gap-1" style={{ color: '#C4402E' }}>
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" /> {r.paused_reason}
                  </p>
                ) : null}
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ color: st.fg, background: st.bg }}>
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
