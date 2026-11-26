// Quotation currency conversion. Prices are authored in INR (package master);
// a foreign-currency quote shows them divided by the rate (₹ per 1 unit).
// Each line remembers its INR price (`inr_unit_price`), so switching currency or
// rate any number of times never compounds rounding.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const inrOf = (amount, currency, rate) =>
  (String(currency || 'INR').toUpperCase() === 'INR' ? Number(amount) || 0 : (Number(amount) || 0) * (Number(rate) || 1));

/** Re-price lines + freight from (fromCur, fromRate) into (toCur, toRate). */
export function convertQuote({ lines = [], freight_amount = 0, freight_inr }, fromCur, fromRate, toCur, toRate, recalcLine) {
  const toInr = String(toCur || 'INR').toUpperCase() === 'INR';
  const r = Number(toRate) || 1;
  const conv = (inr) => (toInr ? round2(inr) : round2(inr / r));
  const fromInr = String(fromCur || 'INR').toUpperCase() === 'INR';
  const fr = Number(fromRate) || 1;
  const newLines = lines.map((l) => {
    // Trust the remembered INR price only if the line still shows exactly that
    // price converted — if someone edited the price by hand, derive INR afresh.
    const remembered = l.inr_unit_price != null
      && round2(fromInr ? l.inr_unit_price : l.inr_unit_price / fr) === round2(l.unit_price);
    const base = remembered ? Number(l.inr_unit_price) : inrOf(l.unit_price, fromCur, fromRate);
    const next = { ...l, inr_unit_price: round2(base), unit_price: conv(base) };
    return recalcLine ? recalcLine(next) : next;
  });
  const fInr = freight_inr != null ? Number(freight_inr) : inrOf(freight_amount, fromCur, fromRate);
  return { lines: newLines, freight_amount: conv(fInr), freight_inr: round2(fInr) };
}

/** Same line maths as the quotation hooks (0% GST stays 0%). */
export function recalcLine(line) {
  const sub = (Number(line.qty) || 0) * (Number(line.unit_price) || 0);
  const pct = line.gst_pct ?? 18;
  const gst = sub * (Number(pct) / 100);
  return { ...line, line_subtotal: sub, line_gst: gst, line_total: sub + gst };
}
