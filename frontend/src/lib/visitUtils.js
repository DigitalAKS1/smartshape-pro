// ── Visit Planning — pure utilities ──────────────────────────────────────────

export const STATUS_CFG = {
  planned:     { label: 'Planned',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-50 text-red-600 border-red-200' },
};

export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export function fmtTime(t) {
  if (!t) return '';
  try {
    const [h, m] = t.split(':');
    const hh = parseInt(h);
    return `${hh % 12 || 12}:${m} ${hh >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}

/** Detect short-URL patterns that need backend resolution */
export function isShortMapsUrl(s) {
  return /share\.google|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(s);
}

/** Extract lat/lng from a Google Maps URL or a raw "lat,lng" string */
export function parseCoordsFromUrl(s) {
  const atMatch  = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch)  return { lat: parseFloat(atMatch[1]),  lng: parseFloat(atMatch[2]) };
  const qMatch   = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch)   return { lat: parseFloat(qMatch[1]),   lng: parseFloat(qMatch[2]) };
  const rawMatch = s.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (rawMatch) return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
  return null;
}

/** Bucket visit plans into labelled groups for display */
export function groupVisits(plans) {
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], completed: [], cancelled: [] };
  for (const p of plans) {
    if (p.status === 'completed')                             { groups.completed.push(p); continue; }
    if (p.status === 'cancelled')                             { groups.cancelled.push(p); continue; }
    if (p.visit_date < today && p.status !== 'in_progress')  { groups.overdue.push(p);   continue; }
    if (p.visit_date === today || p.status === 'in_progress') { groups.today.push(p);     continue; }
    if (p.visit_date === tomorrow)                            { groups.tomorrow.push(p);  continue; }
    groups.upcoming.push(p);
  }
  groups.today.sort((a, b) => (a.visit_time || '').localeCompare(b.visit_time || ''));
  groups.upcoming.sort((a, b) => a.visit_date.localeCompare(b.visit_date));
  groups.completed.sort((a, b) => b.visit_date.localeCompare(a.visit_date));
  return groups;
}
