// Pure helpers for the Hold Monitor (unit-testable, no React).

/**
 * Group hold rows by school, with per-school totals.
 * @returns array of {school_name, items[], totalQty, shortCount} sorted by totalQty desc.
 */
export function groupHoldsBySchool(holds) {
  const map = new Map();
  for (const h of holds || []) {
    const key = h.school_name || '—';
    if (!map.has(key)) map.set(key, { school_name: key, items: [], totalQty: 0, shortCount: 0 });
    const g = map.get(key);
    g.items.push(h);
    g.totalQty += Number(h.quantity || 0);
    if ((h.short || 0) > 0) g.shortCount += 1;
  }
  return [...map.values()].sort((a, b) => b.totalQty - a.totalQty);
}
