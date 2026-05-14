import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

export default function CustomerLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  // If already logged in, redirect to portal
  useEffect(() => {
    fetch(`${BACKEND}/api/customer/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.catalogue_token) navigate(`/my-quote/${d.catalogue_token}`, { replace: true });
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/customer/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Invalid email or password');
        return;
      }
      navigate(`/my-quote/${data.catalogue_token}`, { replace: true });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e94560] mb-4">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">SmartShape Pro</h1>
          <p className="text-[#6b6b80] text-sm mt-1">School Customer Portal</p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1a2e] rounded-2xl border border-[#2d2d44] p-8">
          <h2 className="text-lg font-semibold text-white mb-1">Sign in to your portal</h2>
          <p className="text-[#6b6b80] text-xs mb-6">Track your order, training sessions, and more</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#a0a0b0] mb-1.5">Email address</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="principal@yourschool.in"
                className="w-full h-11 px-4 rounded-xl border border-[#2d2d44] bg-[#0f0f1a] text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560] focus:ring-1 focus:ring-[#e94560] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#a0a0b0] mb-1.5">Password</label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full h-11 px-4 rounded-xl border border-[#2d2d44] bg-[#0f0f1a] text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560] focus:ring-1 focus:ring-[#e94560] transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <svg className="h-4 w-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-[#e94560] hover:bg-[#f05c75] disabled:opacity-60 text-white font-semibold rounded-xl transition-colors text-sm mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Help text */}
        <p className="text-center text-[#3d3d55] text-xs mt-6">
          Login credentials are provided by your SmartShape sales executive.
        </p>
      </div>
    </div>
  );
}
