import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { schoolAuth } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { GraduationCap, LogIn, Mail } from 'lucide-react';

export default function SchoolLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [methods, setMethods] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const err = params.get('err');
    if (err === 'not_registered') toast.error("This email isn't registered for portal access.");
    if (err === 'google_disabled') toast.error('Google sign-in is not enabled for your account.');
  }, [params]);

  const loadMethods = async () => {
    if (!email) return;
    try { const r = await schoolAuth.methods(email); setMethods(r.data); } catch { setMethods(null); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await schoolAuth.login({ email, password });
      toast.success('Welcome!');
      navigate('/school');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid credentials');
    } finally { setLoading(false); }
  };

  const sendMagic = async () => {
    try { await schoolAuth.requestMagic(email); toast.success('Check your email for a sign-in link.'); }
    catch { toast.error('Could not send link'); }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e94560]/15 mb-4">
            <GraduationCap className="h-8 w-8 text-[#e94560]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">School Portal</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">SmartShape Pro</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6 space-y-4">
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={loadMethods}
              required placeholder="school@example.com" data-testid="school-email-input"
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
          </div>

          {(!methods || methods.email_link) && (
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Password</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password" data-testid="school-password-input"
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white"
                data-testid="school-login-button">
                {loading ? 'Signing in…' : <><LogIn className="mr-2 h-4 w-4" /> Sign In</>}
              </Button>
            </form>
          )}

          {methods?.magic_link && (
            <Button onClick={sendMagic} variant="outline" className="w-full">
              <Mail className="mr-2 h-4 w-4" /> Email me a login link
            </Button>
          )}

          {methods?.google && (
            <Button onClick={() => { window.location.href = schoolAuth.googleStartUrl(); }}
              variant="outline" className="w-full">
              Sign in with Google
            </Button>
          )}

          {methods && !methods.email_link && !methods.magic_link && !methods.google && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-[var(--text-secondary)]">
              Portal access isn’t enabled for your account yet. Please contact SmartShape and we’ll switch it on for you.
            </div>
          )}

          <p className="text-center text-xs text-[var(--text-muted)]">
            Admin? <a href="/login" className="text-[#e94560] hover:underline">Login here</a>
          </p>
          <p className="text-center text-[11px] text-[var(--text-muted)]">
            <a href="/privacy" className="hover:underline">Privacy</a> · <a href="/terms" className="hover:underline">Terms</a>
          </p>
        </div>
      </div>
    </div>
  );
}
