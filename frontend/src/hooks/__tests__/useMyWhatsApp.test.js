// The pure helpers behind My WhatsApp: warm-up wording, phone formatting and the QR data URL.
import { warmupText, warmupProgress, formatPhone, qrSrc, QR_POLL_MS, CONNECTED_POLL_MS } from '../useMyWhatsApp';

jest.mock('../../lib/api', () => ({ waNumbers: {} }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

test('poll intervals are 20 s for the QR and 60 s once connected', () => {
  expect(QR_POLL_MS).toBe(20000);
  expect(CONNECTED_POLL_MS).toBe(60000);
});

test('warmupText reads the flat fields first', () => {
  expect(warmupText({ warmup_day: 4, sent_today: 40, cap_today: 60 })).toBe('Day 4 of 14 — today 40 of 60');
  expect(warmupText({ warmup_day: 14, sent_today: 0, cap_today: 160 })).toBe('Day 14 of 14 — today 0 of 160');
  expect(warmupText({ warmup_day: 15, sent_today: 3, cap_today: 200 })).toBe('Warmed up — today 3 of 200');
});

test('warmupText falls back to the nested warm-up object', () => {
  expect(warmupText({ warmup: { day: 2, of: 14, today_sent: 5, today_cap: 20 } })).toBe('Day 2 of 14 — today 5 of 20');
  expect(warmupText({ day: 3, of: 14, today_sent: 1, today_cap: 20 })).toBe('Day 3 of 14 — today 1 of 20');
});

test('warmupText is empty without data', () => {
  expect(warmupText(null)).toBe('');
  expect(warmupText({})).toBe('');
});

test('warmupProgress is 0..1', () => {
  expect(warmupProgress({ warmup_day: 7 })).toBeCloseTo(0.5);
  expect(warmupProgress({ warmup_day: 30 })).toBe(1);
  expect(warmupProgress(null)).toBe(0);
});

test('formatPhone groups Indian numbers and keeps others as +digits', () => {
  expect(formatPhone('919811111111')).toBe('+91 98111 11111');
  expect(formatPhone('+91 98111-11111')).toBe('+91 98111 11111');
  expect(formatPhone('447700900123')).toBe('+447700900123');
  expect(formatPhone('')).toBe('');
  expect(formatPhone(null)).toBe('');
});

test('qrSrc keeps a data URL and prefixes bare base64', () => {
  expect(qrSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  expect(qrSrc('AAA')).toBe('data:image/png;base64,AAA');
  expect(qrSrc('')).toBe('');
});
