import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, Phone, Copy, RefreshCw, AlertTriangle } from 'lucide-react';
import { telephonyApi, integrationsApi } from '../../lib/api';
import IntegrationStatusChip from './IntegrationStatusChip';

export default function CallingSection({ configured, onSaved }) {
  const [cfg, setCfg] = useState({
    enabled: false, username: '', caller_id_did: '',
    password_set: false, webhook_url: '', webhook_secret: '',
  });
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = () => telephonyApi.getConfig()
    .then(r => setCfg(c => ({ ...c, ...r.data }))).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        enabled: cfg.enabled,
        username: cfg.username,
        caller_id_did: cfg.caller_id_did,
      };
      if (password.trim()) body.password = password.trim();
      await telephonyApi.saveConfig(body);
      toast.success('Calling settings saved');
      setPassword('');
      await load();
      onSaved && onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save');
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await integrationsApi.test('telephony');
      setTestResult(r.data.ok ? 'ok' : 'fail');
      if (!r.data.ok) toast.error(r.data.detail || 'Test failed');
    } catch { setTestResult('fail'); }
    setTesting(false);
  };

  const rotate = async () => {
    try {
      const r = await telephonyApi.rotateSecret();
      setCfg(c => ({ ...c, webhook_secret: r.data.webhook_secret, webhook_url: r.data.webhook_url }));
      toast.success('Webhook secret rotated — update it in your Bonvoice dashboard');
    } catch { toast.error('Could not rotate secret'); }
  };

  const copyWebhook = () => {
    if (!cfg.webhook_url) return;
    navigator.clipboard?.writeText(cfg.webhook_url);
    toast.success('Webhook URL copied');
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-[var(--text-primary)] flex items-center gap-2">
          <Phone className="h-5 w-5" /> Calling (Bonvoice)
        </h2>
        <IntegrationStatusChip configured={configured} testing={testing} onTest={test} testResult={testResult} />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        Click-to-call from any lead, contact or school. Bonvoice rings the rep&apos;s phone first, then dials the
        customer and bridges the call. The result &amp; recording are logged automatically to the CRM timeline.
        Each rep also needs a <span className="font-medium">Calling number</span> set in User Management.
      </p>

      {!cfg.enabled && (
        <div className="flex items-start gap-3 p-4 rounded-md border border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-amber-500">Calling is off.</span> The 📞 Call buttons stay hidden
            until you enter the Bonvoice credentials below, turn this on, and save.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
        <div className="pr-4">
          <p className="text-[var(--text-primary)] font-medium">Enable calling</p>
          <p className="text-sm text-[var(--text-muted)]">Turn on click-to-call for the sales team.</p>
        </div>
        <input type="checkbox" checked={!!cfg.enabled}
          onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}
          className="w-5 h-5 rounded border-[var(--border-color)] bg-[var(--bg-primary)] flex-shrink-0" />
      </div>

      <div>
        <Label className="text-[var(--text-secondary)]">Bonvoice Username</Label>
        <Input value={cfg.username} onChange={e => setCfg({ ...cfg, username: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">
          Bonvoice Password{cfg.password_set && <span className="text-[var(--text-muted)]"> (set — leave blank to keep)</span>}
        </Label>
        <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
          placeholder={cfg.password_set ? '•••••••• (set)' : ''} />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">Caller ID / DID (shown to the customer)</Label>
        <Input value={cfg.caller_id_did} onChange={e => setCfg({ ...cfg, caller_id_did: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm"
          placeholder="e.g. 01141XXXXXX" />
      </div>

      <div className="space-y-2 pt-1 border-t border-[var(--border-color)]">
        <Label className="text-[var(--text-secondary)] pt-3 block">Webhook URL (paste into Bonvoice → Call Notification + Hangup callbacks)</Label>
        <div className="flex gap-2">
          <Input readOnly value={cfg.webhook_url || 'Save credentials to generate the webhook URL'}
            className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-xs" />
          <Button type="button" variant="outline" onClick={copyWebhook} disabled={!cfg.webhook_url}
            className="border-[var(--border-color)] text-[var(--text-primary)] flex-shrink-0">
            <Copy className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" onClick={rotate} disabled={!cfg.webhook_secret}
            className="border-[var(--border-color)] text-[var(--text-primary)] flex-shrink-0" title="Rotate secret">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">The secret in this URL authenticates Bonvoice&apos;s callbacks. Rotate it if it leaks.</p>
      </div>

      <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75]">
        <Save className="mr-2 h-4 w-4" /> Save Calling
      </Button>
    </div>
  );
}
