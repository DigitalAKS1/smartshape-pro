import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { schoolAuth } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { GraduationCap } from 'lucide-react';

export default function SchoolActivate() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [emailMasked, setEmailMasked] = useState('');
  const [valid, setValid] = useState(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) { setValid(false); return; }
    schoolAuth.activateVerify(token)
      .then(r => { setEmailMasked(r.data.email_masked || ''); setValid(true); })
      .catch(() => setValid(false));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error('Password must be at least 6 characters');
    if (pw !== pw2) return toast.error('Passwords do not match');
    setBusy(true);
    try {
      await schoolAuth.setPassword(token, pw);
      toast.success('Password set!');
      navigate('/school');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'This link is invalid or expired');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e94560]/15 mb-4">
            <GraduationCap className="h-8 w-8 text-[#e94560]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Activate Your Portal</h1>
        </div>
        {valid === false && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6 text-center space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">This activation link is invalid or has expired.</p>
            <a href="/school/login" className="text-[#e94560] hover:underline text-sm">Go to login</a>
          </div>
        )}
        {valid && (
          <form onSubmit={submit} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6 space-y-4">
            <p className="text-xs text-[var(--text-muted)]">Setting password for <b>{emailMasked}</b></p>
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">New password</Label>
              <Input type="password" value={pw} onChange={e => setPw(e.target.value)} required
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">Confirm password</Label>
              <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white">
              {busy ? 'Saving…' : 'Set Password & Enter'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
