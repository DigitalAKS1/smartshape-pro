import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LogIn, ArrowRight } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in AND has modules
  const hasAccess = user && (user.role === 'admin' || (user.assigned_modules && user.assigned_modules.length > 0));
  if (hasAccess) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      // Smart redirect based on role/modules
      navigate('/');
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">
      {/* Left side - Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0a0a12 0%, #1a0a1a 50%, #0a0a12 100%)' }}>
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #e94560 0%, transparent 60%), radial-gradient(circle at 70% 20%, #7c3aed 0%, transparent 50%)' }} />
        <div className="relative z-10 p-12 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#e94560] flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <span className="text-white text-3xl font-black">S</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">SmartShape Pro</h1>
          <p className="text-xl text-[var(--text-secondary)]">Select Your Shapes, Seal the Deal</p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            {[['CRM', 'Leads & Schools'], ['Sales', 'Quotations & Orders'], ['Field', 'GPS Attendance']].map(([t, s]) => (
              <div key={t} className="bg-white/5 rounded-xl p-4 border border-white/10">
                <p className="text-white font-semibold text-sm">{t}</p>
                <p className="text-[var(--text-muted)] text-xs mt-1">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-white mb-2" data-testid="login-title">Welcome Back</h2>
            <p className="text-[var(--text-secondary)]">Sign in to your SmartShape Pro account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6" data-testid="login-form">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-md" data-testid="login-error">
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="email" className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-white focus:ring-[#e94560] focus:border-[#e94560]"
                placeholder="you@company.com"
                data-testid="login-email-input"
              />
            </div>

            <div>
              <Label htmlFor="password" className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-white focus:ring-[#e94560] focus:border-[#e94560]"
                placeholder="••••••••"
                data-testid="login-password-input"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white font-medium"
              data-testid="login-submit-button"
            >
              {loading ? 'Signing in...' : (
                <>
                  Sign In <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

          </form>

          <p className="text-center text-[var(--text-muted)]">
            Don't have an account?{' '}
            <Link to="/register" className="text-[#e94560] hover:text-[#f05c75] font-medium" data-testid="register-link">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}