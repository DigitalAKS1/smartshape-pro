import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, Cloud } from 'lucide-react';
import { cloudinaryApi, integrationsApi } from '../../lib/api';
import IntegrationStatusChip from './IntegrationStatusChip';

export default function CloudinarySection({ configured, onSaved }) {
  const [form, setForm] = useState({ cloud_name: '', api_key: '', api_secret: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    cloudinaryApi.get().then(r => setForm(f => ({
      ...f, cloud_name: r.data.cloud_name || '', api_key: r.data.api_key || '',
    }))).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try { await cloudinaryApi.save(form); toast.success('Cloudinary settings saved'); onSaved && onSaved(); }
    catch { toast.error('Failed to save'); }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await integrationsApi.test('cloudinary');
      setTestResult(r.data.ok ? 'ok' : 'fail');
      if (!r.data.ok) toast.error(r.data.detail || 'Test failed');
    } catch { setTestResult('fail'); }
    setTesting(false);
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-[var(--text-primary)] flex items-center gap-2"><Cloud className="h-5 w-5" /> Cloudinary</h2>
        <IntegrationStatusChip configured={configured} testing={testing} onTest={test} testResult={testResult} />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">Primary upload/CDN for images and files. Leave blank to keep using the built-in storage.</p>
      <div>
        <Label className="text-[var(--text-secondary)]">Cloud Name</Label>
        <Input value={form.cloud_name} onChange={e => setForm({ ...form, cloud_name: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder="my-cloud" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">API Key</Label>
        <Input value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder="123456789012345" />
      </div>
      <div>
        <Label className="text-[var(--text-secondary)]">API Secret</Label>
        <Input type="password" value={form.api_secret} onChange={e => setForm({ ...form, api_secret: e.target.value })}
          className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-mono text-sm" placeholder={configured ? '•••••••• (set)' : ''} />
      </div>
      <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75]"><Save className="mr-2 h-4 w-4" /> Save Cloudinary</Button>
    </div>
  );
}
