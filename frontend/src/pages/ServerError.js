import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Home } from 'lucide-react';

export default function ServerError({ error }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="text-8xl font-black text-[#e94560] opacity-20 select-none leading-none mb-2">500</div>
        <div className="text-5xl mb-4">⚡</div>
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Something went wrong</h1>
        <p className="text-sm text-[var(--text-muted)] mb-4 leading-relaxed">
          The server hit an unexpected error. Our team has been notified. Please try again in a moment.
        </p>
        {error && (
          <p className="text-xs font-mono bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-2 mb-6 text-red-400 text-left break-all">
            {String(error).slice(0, 200)}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Retry
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
