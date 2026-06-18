import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { delegation as delApi } from '../../lib/api';

const toMin = (hhmm) => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const overlaps = (s1, e1, s2, e2) => toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1);

/**
 * Soft availability warning. Fetches busy windows for the given teammates on `date`
 * and, if the proposed `start`–`end` overlaps one, shows a banner. It NEVER blocks —
 * the caller keeps its save/assign button enabled (override by design).
 *
 * props: empIds[], date, start, end, nameOf(emp_id)->string, textMuted
 */
export default function AvailabilityHint({ empIds = [], date, start, end, nameOf, textMuted }) {
  const ids = (empIds || []).filter(Boolean);
  const idKey = ids.join(',');
  const [busy, setBusy] = useState({});

  useEffect(() => {
    if (!idKey || !date) { setBusy({}); return; }
    let alive = true;
    delApi.availability(idKey, date)
      .then(r => { if (alive) setBusy(r?.data || {}); })
      .catch(() => { if (alive) setBusy({}); });
    return () => { alive = false; };
  }, [idKey, date]);

  if (!start || !end) return null;
  const conflicts = [];
  for (const id of ids) {
    for (const w of (busy[id] || [])) {
      if (overlaps(start, end, w.start, w.end)) conflicts.push({ id, ...w });
    }
  }
  if (!conflicts.length) return null;

  return (
    <div className="rounded-lg px-3 py-2 text-xs flex items-start gap-2" style={{ background: '#f59e0b18', color: '#b45309' }}>
      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {conflicts.map((c, i) => (
          <div key={i}><b>{nameOf ? nameOf(c.id) : 'Teammate'}</b> is blocked {c.start}–{c.end} ({c.label}).</div>
        ))}
        <div className={textMuted}>Pick another time, or assign anyway.</div>
      </div>
    </div>
  );
}
