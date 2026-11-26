import { convertQuote, recalcLine } from '../currency';

const q = { lines: [recalcLine({ qty: 2, unit_price: 8400, gst_pct: 18 })], freight_amount: 840 };

test('INR → USD divides by rate and remembers INR', () => {
  const out = convertQuote(q, 'INR', 1, 'USD', 84, recalcLine);
  expect(out.lines[0].unit_price).toBe(100);
  expect(out.lines[0].inr_unit_price).toBe(8400);
  expect(out.lines[0].line_subtotal).toBe(200);
  expect(out.freight_amount).toBe(10);
});

test('USD → QAR → INR never compounds', () => {
  const usd = convertQuote(q, 'INR', 1, 'USD', 84, recalcLine);
  const qar = convertQuote({ ...q, ...usd }, 'USD', 84, 'QAR', 23, recalcLine);
  expect(qar.lines[0].unit_price).toBe(365.22);
  const inr = convertQuote({ ...q, ...qar }, 'QAR', 23, 'INR', 1, recalcLine);
  expect(inr.lines[0].unit_price).toBe(8400);
  expect(inr.freight_amount).toBe(840);
});

test('hand-edited foreign price is re-based, not overwritten', () => {
  const usd = convertQuote(q, 'INR', 1, 'USD', 84, recalcLine);
  const edited = { ...usd, lines: [{ ...usd.lines[0], unit_price: 120 }] };   // rep typed $120
  const back = convertQuote(edited, 'USD', 84, 'INR', 1, recalcLine);
  expect(back.lines[0].unit_price).toBe(10080);                               // 120 × 84
});

test('0% GST line stays 0%', () => {
  expect(recalcLine({ qty: 1, unit_price: 100, gst_pct: 0 }).line_gst).toBe(0);
});
