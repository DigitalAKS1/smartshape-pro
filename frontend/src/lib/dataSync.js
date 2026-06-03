/**
 * Lightweight real-time data sync.
 * - emitChange(domain): call after any mutation (done automatically via api.js interceptor)
 * - useDataSync(domain, fetchFn): refetch when same domain changes (same tab or cross-tab)
 * - useAutoRefresh(fetchFn, ms): background polling + refetch on tab focus
 */
import { useEffect, useCallback } from 'react';

const CHANNEL = 'ssp_data';

// ── Emit a domain change (pure JS — safe to call from api.js) ───────────────
export function emitChange(domain = 'all') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ssp:change', { detail: { domain } }));
  // Cross-tab via BroadcastChannel
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ domain });
    ch.close();
  } catch (_) { /* unsupported in some envs */ }
}

// ── React hook: listen for domain changes and refetch ───────────────────────
export function useDataSync(domain, onRefresh) {
  useEffect(() => {
    const matches = (d) => d === 'all' || d === domain || domain === 'all';

    const onEvent = (e) => { if (matches(e.detail?.domain)) onRefresh(); };
    window.addEventListener('ssp:change', onEvent);

    let ch = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (e) => { if (matches(e.data?.domain)) onRefresh(); };
    } catch (_) {}

    const onVisible = () => { if (!document.hidden) onRefresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('ssp:change', onEvent);
      document.removeEventListener('visibilitychange', onVisible);
      try { ch?.close(); } catch (_) {}
    };
  }, [domain, onRefresh]);
}

// ── React hook: background polling + tab-focus refetch ──────────────────────
export function useAutoRefresh(fetchFn, intervalMs = 60000) {
  useEffect(() => {
    const id = setInterval(fetchFn, intervalMs);
    const onVisible = () => { if (!document.hidden) fetchFn(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchFn, intervalMs]);
}
