import { shouldShowPopup, POPUP_INTERVAL_MS } from '../taskPopupSchedule';

const NOW = 1_000_000_000_000;

test('shows when never shown before', () => {
  expect(shouldShowPopup(null, NOW, false)).toBe(true);
});

test('hidden before an hour has passed', () => {
  expect(shouldShowPopup(NOW - (POPUP_INTERVAL_MS - 1), NOW, false)).toBe(false);
});

test('shows once an hour has passed', () => {
  expect(shouldShowPopup(NOW - POPUP_INTERVAL_MS, NOW, false)).toBe(true);
});

test('never shows when snoozed for the day', () => {
  expect(shouldShowPopup(NOW - 5 * POPUP_INTERVAL_MS, NOW, true)).toBe(false);
  expect(shouldShowPopup(null, NOW, true)).toBe(false);
});
