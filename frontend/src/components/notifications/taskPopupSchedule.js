// Pure scheduling logic for the hourly task reminder popup.
// Kept separate from the React component so it can be unit-tested without a DOM.

export const POPUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Decide whether the task popup should be shown now.
 * @param {number|null} lastShownTs  epoch ms of the last time the popup was shown (null = never)
 * @param {number} nowTs             epoch ms for "now"
 * @param {boolean} snoozedForDay    true when the user chose "snooze for today"
 * @returns {boolean}
 */
export function shouldShowPopup(lastShownTs, nowTs, snoozedForDay) {
  if (snoozedForDay) return false;
  if (!lastShownTs) return true;
  return nowTs - lastShownTs >= POPUP_INTERVAL_MS;
}
