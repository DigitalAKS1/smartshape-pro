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
