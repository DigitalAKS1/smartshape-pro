import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="text-8xl font-black text-[#e94560] opacity-20 select-none leading-none mb-2">404</div>
        <div className="text-5xl mb-4">🗺️</div>
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Page Not Found</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8 leading-relaxed">
          The page you're looking for doesn't exist or has been moved. Check the URL or head back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Go Back
          </button>
          <button
            onClick={() => navigate('/today')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#e94560] text-white text-sm font-semibold hover:bg-[#c73652] transition-colors"
          >
            <Home className="h-4 w-4" /> Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
