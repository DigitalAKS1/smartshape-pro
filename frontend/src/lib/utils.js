import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount) {
  const n = Number(amount);
  if (!isFinite(n)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n);
}

export function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Natural sort by die/item code so SSSD-1, SSSD-2 ... SSSD-10 order correctly
// (plain string sort would put SSSD-10 before SSSD-2). Splits each code into
// text/number chunks and compares chunk-by-chunk.
export function compareCodes(a, b) {
  const ca = String(a ?? '').trim().toUpperCase();
  const cb = String(b ?? '').trim().toUpperCase();
  const ra = ca.match(/(\d+|\D+)/g) || [];
  const rb = cb.match(/(\d+|\D+)/g) || [];
  const len = Math.max(ra.length, rb.length);
  for (let i = 0; i < len; i++) {
    const pa = ra[i], pb = rb[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = /^\d+$/.test(pa), nb = /^\d+$/.test(pb);
    if (na && nb) {
      const d = parseInt(pa, 10) - parseInt(pb, 10);
      if (d !== 0) return d;
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1;
    }
  }
  return 0;
}

// Return a new array of items sorted by their `code` field, naturally.
export function sortByCode(items) {
  return [...(items || [])].sort((x, y) => compareCodes(x?.code, y?.code));
}

export function getStatusColor(status) {
  const colors = {
    draft: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    sent: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    confirmed: 'bg-green-500/20 text-green-300 border-green-500/30',
    cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
    planned: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    visited: 'bg-green-500/20 text-green-300 border-green-500/30',
    rescheduled: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    approved: 'bg-green-500/20 text-green-300 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
    submitted: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };
  return colors[status] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';
}