import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LogIn, ArrowRight, Shield, ShieldOff, Monitor, Globe, RefreshCw } from 'lucide-react';
import { getDeviceInfo } from '../utils/deviceService';

export default function Login() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [deviceCode, setDeviceCode] = useState(''); // 'DEVICE_PENDING' | 'DEVICE_REVOKED' | ''

  const hasAccess = user && (user.role === 'admin' || (user.assigned_modules && user.assigned_modules.length > 0));
  if (hasAccess) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDeviceCode('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) {
      navigate('/');
    } else if (result.deviceCode) {
      setDeviceCode(result.deviceCode);
    } else {
      setError(result.error);
    }
  };

  const devInfo = getDeviceInfo();

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">
      {/* Left brand panel */}
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

      {/* Right panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">

          {/* ── Device Pending Screen ─────────────────────────────────────── */}
          {deviceCode === 'DEVICE_PENDING' && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
                <Shield className="h-10 w-10 text-amber-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Device Not Recognized</h2>
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                  This is your first time signing in from this device. Your administrator has been notified and will approve access shortly.
                </p>
              </div>

              {/* Device info card */}
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 text-left space-y-2.5">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-3">This Device</p>
                <div className="flex items-center gap-2.5">
                  <Monitor className="h-4 w-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-white">{devInfo.label}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Globe className="h-4 w-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-secondary)]">{devInfo.timezone}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Shield className="h-4 w-4 text-amber-400" />
                  <span className="text-sm text-amber-400 font-medium">Awaiting admin approval</span>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <p className="text-amber-300 text-xs leading-relaxed">
                  Once your admin approves this device, sign in again with the same email and password. This is a one-time step per device.
                </p>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleSubmit} disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {loading ? 'Checking…' : 'Try Again'}
                </Button>
                <Button variant="outline" onClick={() => { setDeviceCode(''); setPassword(''); }}
                  className="flex-1 border-[var(--border-color)] text-[var(--text-secondary)]">
                  Back
                </Button>
              </div>
            </div>
          )}

          {/* ── Device Revoked Screen ─────────────────────────────────────── */}
          {deviceCode === 'DEVICE_REVOKED' && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
                <ShieldOff className="h-10 w-10 text-red-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Device Access Revoked</h2>
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                  Your administrator has revoked access for this device. Please contact your admin to restore access.
                </p>
              </div>

              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <p className="text-red-300 text-xs">
                  If you believe this is a mistake, contact your administrator and ask them to re-approve this device in Settings → Trusted Devices.
                </p>
              </div>

              <Button variant="outline" onClick={() => setDeviceCode('')}
                className="w-full border-[var(--border-color)] text-[var(--text-secondary)]">
                Back to Sign In
              </Button>
            </div>
          )}

          {/* ── Normal Login Form ─────────────────────────────────────────── */}
          {!deviceCode && (
            <>
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
                    autoComplete="username"
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
                    autoComplete="current-password"
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
                    <>Sign In <ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              </form>

              <p className="text-center text-[var(--text-muted)]">
                Don't have an account?{' '}
                <Link to="/register" className="text-[#e94560] hover:text-[#f05c75] font-medium" data-testid="register-link">
                  Sign up
                </Link>
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
