// CRM utility functions — pure, no side effects, no React state

/**
 * Days elapsed since a date string (ISO or YYYY-MM-DD).
 * Returns null if dateStr is falsy.
 */
export function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/**
 * Tailwind border-color class based on days since last activity and upcoming followup date.
 */
export function ageColor(days, followupDate) {
  if (followupDate) {
    const daysUntil = -daysSince(followupDate + 'T00:00:00');
    if (daysUntil !== null && daysUntil < 0) return 'border-red-500';    // overdue
    if (daysUntil !== null && daysUntil <= 2) return 'border-yellow-500'; // due soon
  }
  if (days === null) return 'border-[var(--border-color)]';
  if (days <= 3)  return 'border-green-500';
  if (days <= 7)  return 'border-yellow-500';
  if (days <= 14) return 'border-orange-500';
  return 'border-red-500';
}

/**
 * Aging chip color class (background + text) for days-since-last-contact.
 */
export function agingChipCls(days) {
  if (days === null) return 'bg-gray-500/15 text-gray-400';
  if (days < 7)  return 'bg-green-500/15 text-green-400';
  if (days < 30) return 'bg-yellow-500/15 text-yellow-400';
  return 'bg-red-500/15 text-red-400';
}

/**
 * Sorts an array of objects by a key + direction.
 */
export function sortData(arr, key, dir) {
  if (!key) return arr;
  return [...arr].sort((a, b) => {
    const av = (a[key] ?? '').toString().toLowerCase();
    const bv = (b[key] ?? '').toString().toLowerCase();
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

/**
 * WhatsApp deep-link from a phone number string.
 */
export function waLink(phone) {
  return `https://wa.me/${(phone || '').replace(/\D/g, '')}`;
}

/**
 * Formats a date string as "12 May 2026".
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

/**
 * Truncates text to maxLen chars, appending "…".
 */
export function truncate(text, maxLen = 60) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
