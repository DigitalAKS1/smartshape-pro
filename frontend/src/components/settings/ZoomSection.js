import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, Video } from 'lucide-react';
import { certsApi, zoomApi, integrationsApi } from '../../lib/api';
import IntegrationStatusChip from './IntegrationStatusChip';

export default function ZoomSection({ configured, onSaved }) {
  const [form, setForm] = useState({ account_id: '', client_id: '', client_secret: '' });
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [lastMeeting, setLastMeeting] = useState(null);

  useEffect(() => {
    certsApi.zoomConfigGet().then(r => setForm(f => ({
      ...f, account_id: r.data.account_id || '', client_id: r.data.client_id || '',
    }))).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try { await certsApi.zoomConfigSave(form); toast.success('Zoom credentials saved'); onSaved && onSaved(); }
    catch { toast.error('Failed to save'); }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await integrationsApi.test('zoom');
      setTestResult(r.data.ok ? 'ok' : 'fail');
      if (!r.data.ok) toast.error(r.data.detail || 'Test failed');
    } catch { setTestResult('fail'); }
    setTesting(false);
  };

  const createTest = async () => {
    setCreating(true); setLastMeeting(null);
    try {
      const start = new Date(Date.now() + 3600 * 1000).toISOString();
      const r = await zoomApi.createMeeting({ topic: 'SmartShape test meeting', start_time: start, duration: 30 });
      setLastMeeting(r.data);
      toast.success('Test meeting created');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create meeting (check the meeting:write scope)');
    }
    setCreating(false);
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-[var(--text-primary)] flex items-center gap-2"><Video className="h-5 w-5" /> Zoom</h2>
        <IntegrationStatusChip configured={configured} testing={testing} onTest={test} testResult={testResult} />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        Server-to-Server OAuth. For meeting creation the Zoom app also needs the <code>meeting:write:admin</code> scope.
      </p>
      <div>
        <Label className="text-[var(--text-secondary)]">Account ID</Label>
        <Input value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">Client ID</Label>
        <Input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">Client Secret</Label>
        <Input type="password" value={form.client_secret} onChange={e => setForm({ ...form, client_secret: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder={configured ? '•••••••• (set)' : ''} />
      </div>
      <div className="flex gap-3">
        <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75]"><Save className="mr-2 h-4 w-4" /> Save Zoom</Button>
        <Button onClick={createTest} disabled={creating || !configured} variant="outline"
          className="border-[var(--border-color)] text-[var(--text-primary)]">{creating ? 'Creating…' : 'Create test meeting'}</Button>
      </div>
      {lastMeeting && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 text-sm">
          <p className="text-[var(--text-secondary)]">Join URL:</p>
          <a href={lastMeeting.join_url} target="_blank" rel="noopener noreferrer" className="text-[#e94560] break-all">{lastMeeting.join_url}</a>
        </div>
      )}
    </div>
  );
}
