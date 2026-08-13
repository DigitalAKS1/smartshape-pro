import React from 'react';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { activities as activitiesApi } from '../../lib/api';

// Planned Activities (Bulk Activity Planner) on the School 360 — shows each
// activity with who it's assigned to, the due date, and a done/not-done toggle.
export default function SchoolActivitiesCard({ activities = [], onChanged }) {
  if (!activities || activities.length === 0) return null;

  const toggle = async (a) => {
    try {
      await activitiesApi.update(a.activity_id, { status: a.status === 'done' ? 'pending' : 'done' });
      onChanged && onChanged();
    } catch { toast.error('Update failed'); }
  };

  return (
    <div className="lg:col-span-5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-1.5">
        <ClipboardList className="h-3.5 w-3.5 text-[#e94560]" />
        <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)]">Planned Activities</p>
      </div>
      <div className="px-5 divide-y divide-[var(--border-color)]">
        {activities.map(a => (
          <div key={a.activity_id} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-[var(--text-primary)] truncate"><span className="text-[11px] font-semibold text-[#e94560]">{a.activity_type}</span> · {a.title}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{a.assigned_name || a.assigned_to}{a.due_date ? ` · due ${a.due_date}` : ''}</p>
            </div>
            <button onClick={() => toggle(a)} className="text-[11px] font-semibold flex-shrink-0 whitespace-nowrap"
              style={{ color: a.status === 'done' ? '#2E7D5B' : (a.overdue ? '#C4402E' : '#9A6A15') }}>
              {a.status === 'done' ? '✓ done' : (a.overdue ? 'overdue · mark done' : 'pending · mark done')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
