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

/**
 * Aggregate hold rows per die (item-wise total across all schools). Each entry
 * carries a `suggestedQty` to seed the procurement quantity: the die's shortfall
 * if it's over-committed, otherwise the total held quantity.
 * @returns array sorted by short desc, then total qty desc.
 */
export function groupHoldsByItem(holds) {
  const map = new Map();
  for (const h of holds || []) {
    const key = h.die_id;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        die_id: h.die_id, die_name: h.die_name, die_code: h.die_code,
        die_image_url: h.die_image_url,
        totalQty: 0, schools: new Set(), orders: new Set(),
        stock_qty: Number(h.stock_qty || 0), reserved_qty: Number(h.reserved_qty || 0),
      });
    }
    const g = map.get(key);
    g.totalQty += Number(h.quantity || 0);
    if (h.school_name) g.schools.add(h.school_name);
    if (h.order_number) g.orders.add(h.order_number);
  }
  return [...map.values()].map(g => {
    const available = g.stock_qty - g.reserved_qty;
    const short = Math.max(0, g.reserved_qty - g.stock_qty);
    return {
      die_id: g.die_id, die_name: g.die_name, die_code: g.die_code, die_image_url: g.die_image_url,
      totalQty: g.totalQty, schoolCount: g.schools.size, orderCount: g.orders.size,
      stock_qty: g.stock_qty, reserved_qty: g.reserved_qty, available, short,
      suggestedQty: short > 0 ? short : g.totalQty,
    };
  }).sort((a, b) => b.short - a.short || b.totalQty - a.totalQty);
}
