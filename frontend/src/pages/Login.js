import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LogIn, ArrowRight, Shield, ShieldOff, Monitor, Globe, RefreshCw, Sun, Moon, Eye, EyeOff, Smartphone } from 'lucide-react';
import { getDeviceInfo } from '../utils/deviceService';

export default function Login() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [deviceCode, setDeviceCode] = useState('');

  const hasAccess = user && (user.role === 'admin' || (user.assigned_modules && user.assigned_modules.length > 0));
  if (hasAccess) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError(''); setDeviceCode(''); setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) navigate('/');
    else if (result.deviceCode) setDeviceCode(result.deviceCode);
    else setError(result.error);
  };

  const devInfo = getDeviceInfo();

  // Shared class helpers
  const surface = isDark
    ? 'bg-[#13131f] border-[#2a2a3d]'
    : 'bg-white border-[#e2e8f0]';
  const textPri  = isDark ? 'text-white'     : 'text-[#0f172a]';
  const textSec  = isDark ? 'text-[#94a3b8]' : 'text-[#475569]';
  const textMuted= isDark ? 'text-[#64748b]' : 'text-[#94a3b8]';
  const inputCls = isDark
    ? 'bg-[#0f0f1a] border-[#2a2a3d] text-white placeholder:text-[#475569] focus:border-[#e94560]'
    : 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#e94560]';

  return (
    <div className={`min-h-screen flex ${isDark ? 'bg-[#0a0a12]' : 'bg-[#f1f5f9]'}`}>

      {/* ── Left brand panel (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(145deg, #0a0a14 0%, #1a0820 50%, #0e0a1a 100%)' }}>
        {/* Background glow blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #e94560 0%, transparent 70%)' }} />
          <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full opacity-15"
            style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
        </div>
        <div className="relative z-10 p-14 text-center max-w-md">
          {/* Logo */}
          <div className="w-20 h-20 rounded-2xl bg-[#e94560] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-[#e94560]/30">
            <span className="text-white text-4xl font-black tracking-tighter">S</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">SmartShape</h1>
          <p className="text-[#e94560] font-semibold text-lg mb-2">Pro</p>
          <p className="text-[#64748b] text-sm mb-10">Select Your Shapes, Seal the Deal</p>

          {/* Feature chips */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['CRM', 'Leads & Schools'],
              ['Sales', 'Quotations'],
              ['Field', 'GPS Visits'],
            ].map(([t, s]) => (
              <div key={t} className="rounded-xl p-3.5 border border-white/10 bg-white/5 backdrop-blur-sm">
                <p className="text-white font-semibold text-sm">{t}</p>
                <p className="text-[#475569] text-[11px] mt-1 leading-tight">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between px-5 py-4 lg:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#e94560] flex items-center justify-center shadow-lg shadow-[#e94560]/30">
              <span className="text-white text-sm font-black">S</span>
            </div>
            <div>
              <p className={`text-sm font-bold ${textPri} leading-none`}>SmartShape</p>
              <p className="text-[10px] text-[#e94560] font-semibold leading-none mt-0.5">Pro</p>
            </div>
          </div>
          <button onClick={toggleTheme}
            className={`p-2 rounded-lg border ${surface} ${textSec} active:opacity-70`}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-6">
          <div className="w-full max-w-sm">

            {/* ── Device Pending ── */}
            {deviceCode === 'DEVICE_PENDING' && (
              <div className="space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
                  <Shield className="h-8 w-8 text-amber-400" />
                </div>
                <div className="text-center">
                  <h2 className={`text-2xl font-bold ${textPri} mb-2`}>Device Not Recognized</h2>
                  <p className={`${textSec} text-sm leading-relaxed`}>
                    First sign-in from this device. Your admin has been notified and will approve access shortly.
                  </p>
                </div>
                <div className={`${surface} border rounded-xl p-4 space-y-3`}>
                  <p className={`text-[10px] ${textMuted} uppercase tracking-widest font-semibold`}>This Device</p>
                  {[
                    [Monitor, devInfo.label, textPri],
                    [Globe, devInfo.timezone, textSec],
                    [Shield, 'Awaiting admin approval', 'text-amber-500'],
                  ].map(([Icon, text, cls], i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <Icon className={`h-4 w-4 ${i === 2 ? 'text-amber-400' : textMuted} flex-shrink-0`} />
                      <span className={`text-sm ${cls}`}>{text}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <p className="text-amber-600 dark:text-amber-300 text-xs leading-relaxed">
                    Once approved, sign in again with the same credentials. One-time step per device.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button onClick={handleSubmit} disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold h-11">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {loading ? 'Checking…' : 'Try Again'}
                  </Button>
                  <Button variant="outline" onClick={() => { setDeviceCode(''); setPassword(''); }}
                    className={`flex-1 border h-11 ${surface} ${textSec}`}>
                    Back
                  </Button>
                </div>
              </div>
            )}

            {/* ── Device Revoked ── */}
            {deviceCode === 'DEVICE_REVOKED' && (
              <div className="space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
                  <ShieldOff className="h-8 w-8 text-red-400" />
                </div>
                <div className="text-center">
                  <h2 className={`text-2xl font-bold ${textPri} mb-2`}>Device Access Revoked</h2>
                  <p className={`${textSec} text-sm leading-relaxed`}>
                    Your administrator has revoked access for this device.
                  </p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <p className="text-red-500 text-xs leading-relaxed">
                    Contact your admin to re-approve this device in Settings → Trusted Devices.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setDeviceCode('')}
                  className={`w-full h-11 border ${surface} ${textSec}`}>
                  Back to Sign In
                </Button>
              </div>
            )}

            {/* ── Normal Login Form ── */}
            {!deviceCode && (
              <div className="space-y-6">
                {/* Heading */}
                <div>
                  <h2 className={`text-3xl sm:text-4xl font-bold ${textPri} mb-1.5`} data-testid="login-title">
                    Welcome Back
                  </h2>
                  <p className={`${textSec} text-sm`}>Sign in to your SmartShape Pro account</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
                  {/* Error */}
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-xl text-sm" data-testid="login-error">
                      {error}
                    </div>
                  )}

                  {/* Email */}
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className={`${textSec} text-xs font-semibold uppercase tracking-wide`}>
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      className={`h-12 text-base rounded-xl ${inputCls}`}
                      placeholder="you@company.com"
                      data-testid="login-email-input"
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className={`${textSec} text-xs font-semibold uppercase tracking-wide`}>
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        className={`h-12 text-base rounded-xl pr-12 ${inputCls}`}
                        placeholder="••••••••"
                        data-testid="login-password-input"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(v => !v)}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 ${textMuted} active:opacity-70`}
                        tabIndex={-1}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Submit */}
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] active:bg-[#d63050] text-white font-semibold text-base rounded-xl shadow-lg shadow-[#e94560]/25 transition-all"
                    data-testid="login-submit-button"
                  >
                    {loading
                      ? <span className="flex items-center gap-2"><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in…</span>
                      : <span className="flex items-center gap-2">Sign In <ArrowRight className="h-4 w-4" /></span>
                    }
                  </Button>
                </form>

                {/* Footer */}
                <div className="space-y-3">
                  {/* Download the mobile app */}
                  <a
                    href="/get-app"
                    className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-[#e94560]/40 text-[#e94560] font-semibold text-sm hover:bg-[#e94560]/10 transition-colors"
                    data-testid="login-get-app"
                  >
                    <Smartphone className="h-4 w-4" />
                    Download the mobile app
                  </a>
                  <p className={`text-center text-xs ${textMuted}`}>
                    Contact your administrator to get access.
                  </p>
                  {/* Desktop theme toggle */}
                  <div className="hidden lg:flex justify-center">
                    <button onClick={toggleTheme}
                      className={`flex items-center gap-1.5 text-xs ${textMuted} hover:${textSec} transition-colors px-3 py-1.5 rounded-lg hover:bg-[var(--bg-hover)]`}>
                      {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                      {isDark ? 'Light mode' : 'Dark mode'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

    </div>
  );
}
