import React, { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { processGoogleSession } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processSession = async () => {
      const hash = location.hash;
      if (!hash || !hash.includes('session_id=')) {
        navigate('/login');
        return;
      }

      const sessionId = hash.split('session_id=')[1]?.split('&')[0];
      if (!sessionId) {
        navigate('/login');
        return;
      }

      const result = await processGoogleSession(sessionId);
      if (result.success) {
        navigate('/dashboard', { state: { user: result.user }, replace: true });
      } else {
        navigate('/login', { state: { error: result.error }, replace: true });
      }
    };

    processSession();
  }, [location, navigate, processGoogleSession]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
        <p className="mt-4 text-[var(--text-secondary)]">Authenticating...</p>
      </div>
    </div>
  );
}