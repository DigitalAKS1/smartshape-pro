import { useState, useCallback } from 'react';

// Drop-in replacement for useState that survives the component unmounting —
// e.g. navigating away to a school profile or quotation and coming back.
// Backed by sessionStorage, so it resets when the browser tab closes but not
// on a mid-session back/forward navigation. Used to keep CRM filters/tabs/
// pagination exactly as the user left them when they retrace their journey.
export default function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setPersistedState = useCallback((value) => {
    setState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      try {
        window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // sessionStorage unavailable (private mode, quota, etc.) — state
        // still works for this render, it just won't survive a remount.
      }
      return next;
    });
  }, [key]);

  return [state, setPersistedState];
}
