import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Drop-in replacement for a hardcoded `navigate('/some-list')` on a "Back"
// button. Retraces the user's actual click journey (browser history) instead
// of always dropping them on one fixed page. Falls back to `fallbackPath`
// only when there's no real history to go back to (e.g. the page was opened
// via a direct link or a page refresh).
export default function useGoBack(fallbackPath) {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    if (location.key && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  }, [navigate, location.key, fallbackPath]);
}
