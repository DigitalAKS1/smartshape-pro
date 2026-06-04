import React, { useState } from 'react';
import { Check, X, ArrowRightLeft, Inbox } from 'lucide-react';

const PINK = '#e94560';

/**
 * Pending reassignment requests a delegator/boss can act on.
 * decideReassign(requestId, 'approved'|'rejected', note) → hook action.
 */
export default function ApprovalsInbox({
  requests = [], decideReassign,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const [noteFor, setNoteFor] = useState({});   // request_id → note text

  const pending = requests.filter(r => r.status === 'pending');

  if (pending.length === 0) {
    return (
      <div className={`${card} border rounded-xl text-center py-16`}>
        <Inbox className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
        <p className={`text-sm ${textMuted}`}>No pending reassignment requests</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map(r => (
        <div key={r.request_id} className={`${card} border rounded-xl p-4 space-y-3`}>
          <div className="flex items-start gap-2">
            <ArrowRightLeft className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: PINK }} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${textPri}`}>{r.task_title}</p>
              <p className={`text-xs ${textMuted} mt-0.5`}>
                <span className={textSec}>{r.from_emp_name}</span>
                {' → '}
                <span className={textSec}>{r.to_emp_name}</span>
                {'  ·  requested by '}{r.requested_by_name}
              </p>
              <p className={`text-xs ${textSec} mt-1.5 italic`}>“{r.reason}”</p>
            </div>
          </div>

          <input
            value={noteFor[r.request_id] || ''}
            onChange={e => setNoteFor(s => ({ ...s, [r.request_id]: e.target.value }))}
            placeholder="Optional note for your decision…"
            className={`w-full h-8 px-2.5 text-xs rounded border border-[var(--border-color)] ${inputCls}`} />

          <div className="flex gap-2">
            <button
              onClick={() => decideReassign(r.request_id, 'approved', noteFor[r.request_id] || '')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90"
              style={{ background: '#10b981' }}>
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              onClick={() => decideReassign(r.request_id, 'rejected', noteFor[r.request_id] || '')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
