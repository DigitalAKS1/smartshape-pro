import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teacherAuth } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Presentation, LogIn } from 'lucide-react';

export default function TeacherLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await teacherAuth.login({ email, password });
      toast.success('Welcome!');
      navigate('/teacher');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid credentials');
    } finally { setLoading(false); }
  };

  const forgotPassword = async () => {
    if (!email) return toast.error('Enter your email first');
    try { await teacherAuth.forgot(email); toast.success('If that email is registered, a reset link has been sent.'); }
    catch { toast.error('Could not send reset link'); }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e94560]/15 mb-4">
            <Presentation className="h-8 w-8 text-[#e94560]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Teacher Portal</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">SmartShape Pro</p>
        </div>
        <form onSubmit={handleLogin} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6 space-y-4">
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="teacher@example.com"
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="teacher-email-input" />
          </div>
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter password"
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" data-testid="teacher-password-input" />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="teacher-login-button">
            {loading ? 'Signing in…' : <><LogIn className="mr-2 h-4 w-4" /> Sign In</>}
          </Button>
          <button type="button" onClick={forgotPassword} className="w-full text-center text-xs text-[var(--text-muted)] hover:text-[#e94560]">
            Forgot password?
          </button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            Not a teacher? <a href="/school/login" className="text-[#e94560] hover:underline">School login</a>
          </p>
        </form>
      </div>
    </div>
  );
}
