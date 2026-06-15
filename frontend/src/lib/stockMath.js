// Small pure helpers for stock arithmetic (unit-testable, no React/DOM).

/**
 * Compare a counted physical quantity against the system quantity.
 * @returns {{variance:number, direction:'up'|'down'|'same'}}
 */
export function varianceInfo(systemQty, countedQty) {
  const sys = Number(systemQty || 0);
  const counted = Number(countedQty || 0);
  const variance = counted - sys;
  const direction = variance > 0 ? 'up' : variance < 0 ? 'down' : 'same';
  return { variance, direction };
}

// Movement types that ADD to physical stock (shown as "+ back to stock").
export const STOCK_INCREASE_TYPES = ['stock_in', 'returned_from_sales', 'purchase_in', 'returnable_in'];

/**
 * Signed quantity for a stock movement: positive for increases, negative for
 * decreases. physical_adjustment is an absolute count, so it stays unsigned.
 */
export function signedQty(movementType, qty) {
  const q = Math.abs(Number(qty || 0));
  if (movementType === 'physical_adjustment') return q;
  return STOCK_INCREASE_TYPES.includes(movementType) ? q : -q;
}

/** Display string like "+12" / "−5" for a movement quantity. */
export function signedQtyLabel(movementType, qty) {
  if (movementType === 'physical_adjustment') return String(Math.abs(Number(qty || 0)));
  const s = signedQty(movementType, qty);
  return s > 0 ? `+${s}` : String(s);
}
