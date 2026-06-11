import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, GraduationCap } from 'lucide-react';
import { schoolPortalSettings } from '../../lib/api';
import IntegrationStatusChip from './IntegrationStatusChip';

const METHODS = [
  { key: 'email_link_enabled', label: 'Email link + password',
    desc: 'School gets an activation link, sets their own password, then logs in with email + password.' },
  { key: 'magic_link_enabled', label: 'Magic link (no password)',
    desc: 'A one-click sign-in link is emailed on demand (valid 15 minutes). No password needed.' },
  { key: 'google_enabled', label: 'Sign in with Google',
    desc: 'School signs in with their Google account. Only works if the quoted email is a Google account.' },
];

export default function SchoolPortalSection({ configured, onSaved }) {
  const [cfg, setCfg] = useState({
    email_link_enabled: true, magic_link_enabled: false, google_enabled: false,
    google_client_id: '', google_client_secret_set: false,
  });
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    schoolPortalSettings.get().then(r => setCfg(c => ({ ...c, ...r.data }))).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        email_link_enabled: cfg.email_link_enabled,
        magic_link_enabled: cfg.magic_link_enabled,
        google_enabled: cfg.google_enabled,
        google_client_id: cfg.google_client_id,
      };
      if (secret.trim()) body.google_client_secret = secret.trim();
      await schoolPortalSettings.save(body);
      toast.success('School portal settings saved');
      setSecret('');
      const r = await schoolPortalSettings.get();
      setCfg(c => ({ ...c, ...r.data }));
      onSaved && onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    }
    setSaving(false);
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-[var(--text-primary)] flex items-center gap-2">
          <GraduationCap className="h-5 w-5" /> School Portal Login
        </h2>
        <IntegrationStatusChip configured={configured} />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        Choose which login methods schools can use to access their portal. These are the global defaults —
        you can override them per quote on the Create Quotation screen.
      </p>

      <div className="space-y-4">
        {METHODS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
            <div className="pr-4">
              <p className="text-[var(--text-primary)] font-medium">{label}</p>
              <p className="text-sm text-[var(--text-muted)]">{desc}</p>
            </div>
            <input type="checkbox" checked={!!cfg[key]}
              onChange={e => setCfg({ ...cfg, [key]: e.target.checked })}
              className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)] flex-shrink-0" />
          </div>
        ))}
      </div>

      {cfg.google_enabled && (
        <div className="space-y-3 pt-1 border-t border-[var(--border-color)]">
          <p className="text-sm text-[var(--text-secondary)] pt-3">Google OAuth credentials (from Google Cloud Console).</p>
          <div>
            <Label className="text-[var(--text-secondary)]">Google Client ID</Label>
            <Input value={cfg.google_client_id}
              onChange={e => setCfg({ ...cfg, google_client_id: e.target.value })}
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
              placeholder="xxxxx.apps.googleusercontent.com" />
          </div>
          <div>
            <Label className="text-[var(--text-secondary)]">
              Google Client Secret{cfg.google_client_secret_set && <span className="text-[var(--text-muted)]"> (set — leave blank to keep)</span>}
            </Label>
            <Input type="password" value={secret} onChange={e => setSecret(e.target.value)}
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
              placeholder={cfg.google_client_secret_set ? '•••••••• (set)' : ''} />
          </div>
        </div>
      )}

      <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75]">
        <Save className="mr-2 h-4 w-4" /> Save School Portal
      </Button>
    </div>
  );
}
