import React, { useEffect, useState } from 'react';
import { Plane } from 'lucide-react';
import { leaves as leavesApi } from '../../lib/api';

/**
 * Team-availability banner shown to EVERY user on the Today page: lists anyone
 * on approved leave today so the whole team knows who is unavailable. Renders
 * nothing when no one is out.
 */
export default function OnLeaveTodayBanner() {
  const [rows, setRows]     = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    leavesApi.onLeaveToday()
      .then(r => setRows(r.data || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="border rounded-xl p-3"
      style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.30)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Plane className="h-4 w-4 text-amber-500" />
        <p className="text-xs font-semibold text-amber-500">
          On leave today · {rows.length} unavailable
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map(l => (
          <span key={l.user_email || l.user_name}
            className="text-[11px] px-2 py-0.5 rounded-full border text-[var(--text-secondary)]"
            style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.30)' }}>
            {l.user_name || l.user_email}
            {l.half_day ? ' · half day' : ''}
            {l.leave_type ? ` · ${l.leave_type}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
