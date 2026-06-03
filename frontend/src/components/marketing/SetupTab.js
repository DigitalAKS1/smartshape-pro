import React, { useState, useEffect } from 'react';
import {
  Wifi, WifiOff, Key, Globe, Copy, Target, Users, MessageSquare,
  FileText, Gift, RefreshCw, Loader2, Smartphone as PhoneIcon, QrCode,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import { whatsApp as waApi } from '../../lib/api';

export default function SetupTab({ tk, waConnected, setWaConnected, evolutionState, openQrDialog }) {
  const PROVIDER_OPTS = [
    { value: 'none',      label: 'Not Connected',      desc: 'Campaigns queue but are not sent' },
    { value: 'meta',      label: 'Meta Cloud API',      desc: 'Official WABA — requires Facebook Business approval' },
    { value: '360dialog', label: '360dialog',           desc: 'Popular WABA BSP — fast approval, INR billing available' },
    { value: 'gupshup',   label: 'Gupshup',            desc: 'India\'s largest BSP — easy onboarding' },
  ];

  const [form, setForm] = useState({ provider: 'none', api_key: '', from_number: '', phone_number_id: '', app_name: 'SmartShape' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState([]);
  const [newInstName, setNewInstName] = useState('');
  const [addingInst, setAddingInst] = useState(false);

  useEffect(() => {
    waApi.getProvider().then(r => {
      const d = r.data || {};
      setForm({ provider: d.provider || 'none', api_key: '', from_number: d.from_number || '', phone_number_id: d.phone_number_id || '', app_name: d.app_name || 'SmartShape' });
      setWaConnected(d.connected || false);
    }).catch(() => {}).finally(() => setLoading(false));
    waApi.listInstances().then(r => setInstances(r.data || [])).catch(() => {});
  }, []); // eslint-disable-line

  async function addInstance() {
    if (!newInstName.trim()) return;
    setAddingInst(true);
    try {
      await waApi.createInstance(newInstName.trim().toLowerCase().replace(/\s+/g, '-'));
      const r = await waApi.listInstances();
      setInstances(r.data || []);
      setNewInstName('');
      toast.success('Instance created — scan QR to connect');
    } catch { toast.error('Failed to create instance'); }
    finally { setAddingInst(false); }
  }

  async function removeInstance(name) {
    if (!window.confirm(`Delete WhatsApp instance "${name}"?`)) return;
    try {
      await waApi.deleteInstance(name);
      setInstances(p => p.filter(x => x.name !== name));
      toast.success('Instance deleted');
    } catch { toast.error('Failed to delete'); }
  }

  async function save() {
    if (form.provider !== 'none' && !form.api_key) { toast.error('API key is required'); return; }
    setSaving(true);
    try {
      const r = await waApi.saveProvider(form);
      setWaConnected(r.data?.connected || false);
      toast.success(form.provider === 'none' ? 'Provider cleared' : 'WhatsApp provider saved!');
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  }

  const WEBHOOK = 'https://app.smartshape.in/api/whatsapp/webhook';
  function copyWebhook() { navigator.clipboard.writeText(WEBHOOK); toast.success('Webhook URL copied'); }

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className={`${tk.card} border ${waConnected ? 'border-green-500/30' : 'border-[var(--border-color)]'} rounded-xl p-4`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${waConnected ? 'bg-green-500/15' : 'bg-[var(--bg-primary)]'}`}>
            {waConnected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-gray-400" />}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${tk.t1}`}>{waConnected ? 'WhatsApp Business Connected' : 'WhatsApp Not Connected'}</p>
            <p className={`text-xs ${tk.tm} mt-0.5`}>{waConnected ? 'Your WABA is active and ready to send campaigns' : 'Connect your Meta WhatsApp Business API to enable all marketing features'}</p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${waConnected ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'}`}>
            {waConnected ? '● Connected' : '● Disconnected'}
          </span>
        </div>
      </div>

      {loading && <p className={`text-sm ${tk.tm} text-center py-4`}>Loading provider config…</p>}
      {!loading && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Credentials form */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4 space-y-4`}>
          <div className="flex items-center gap-2">
            <Key className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Provider & Credentials</h3>
          </div>

          <div>
            <Label className={`${tk.t2} text-xs mb-1.5 block`}>WhatsApp Provider</Label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_OPTS.map(opt => (
                <button key={opt.value} onClick={() => setForm(p => ({ ...p, provider: opt.value }))}
                  className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${
                    form.provider === opt.value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : `${tk.bdr} ${tk.hov} ${tk.t2}`
                  }`}>
                  <p className="font-semibold">{opt.label}</p>
                  <p className={`text-[10px] mt-0.5 ${form.provider === opt.value ? 'text-[var(--accent)]/70' : tk.tm}`}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {form.provider !== 'none' && <>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>API Key / Access Token</Label>
              <Input type="password" className={`h-10 ${tk.inp}`} placeholder="Paste your API key here"
                value={form.api_key} onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>
                {form.provider === 'meta' && 'Meta system user token from Meta Business Manager → Tokens'}
                {form.provider === '360dialog' && '360dialog API key from your 360dialog partner hub'}
                {form.provider === 'gupshup' && 'Gupshup API key from your Gupshup account'}
              </p>
            </div>
            {form.provider === 'meta' && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Phone Number ID</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="From Meta Business Manager → API Setup"
                  value={form.phone_number_id} onChange={e => setForm(p => ({ ...p, phone_number_id: e.target.value }))} />
              </div>
            )}
            {(form.provider === 'gupshup' || form.provider === '360dialog') && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>From Phone Number (with country code)</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="+919876543210"
                  value={form.from_number} onChange={e => setForm(p => ({ ...p, from_number: e.target.value }))} />
              </div>
            )}
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Sender Name / App Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="SmartShape"
                value={form.app_name} onChange={e => setForm(p => ({ ...p, app_name: e.target.value }))} />
            </div>
          </>}

          <Button className="w-full h-10 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
            onClick={save} disabled={saving}>
            {saving ? 'Saving…' : form.provider === 'none' ? 'Save (Disconnect)' : waConnected ? 'Update Provider' : 'Save & Connect'}
          </Button>
        </div>

        <div className="space-y-4">
          {/* Webhook URL */}
          <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <Globe className={`h-4 w-4 ${tk.tm}`} />
              <h3 className={`text-sm font-semibold ${tk.t1}`}>Webhook URL</h3>
            </div>
            <p className={`text-[11px] ${tk.tm} mb-2`}>Paste this into Meta Business Manager → WhatsApp → Configuration → Webhook</p>
            <div className="flex items-center gap-2">
              <code className={`flex-1 text-[11px] bg-[var(--bg-primary)] border ${tk.bdr} rounded-lg px-3 py-2 font-mono truncate ${tk.t2}`}>
                {WEBHOOK}
              </code>
              <button onClick={copyWebhook}
                className={`h-9 w-9 rounded-lg border ${tk.bdr} ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                <Copy className={`h-3.5 w-3.5 ${tk.tm}`} />
              </button>
            </div>
          </div>

          {/* How to guide */}
          <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
            <h3 className={`text-sm font-semibold ${tk.t1} mb-3`}>Setup Guide</h3>
            <ol className="space-y-2.5">
              {[
                'Get a new SIM (Jio/Airtel) not registered on WhatsApp',
                'Go to Meta Business Manager → Create App → Business',
                'Add WhatsApp product → API Setup',
                'Create a System User with full marketing permissions',
                'Copy Phone Number ID and generate Access Token',
                'Paste credentials above and click Connect',
                'Add webhook URL in Meta → WhatsApp → Configuration',
              ].map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className={`text-xs ${tk.t2} leading-relaxed`}>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>}

      {/* Evolution API: Multiple Instances */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <PhoneIcon className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>WhatsApp Numbers (Evolution API)</h3>
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${evolutionState === 'open' ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'}`}>
            {evolutionState === 'open' ? '● Connected' : '● Not linked'}
          </span>
        </div>
        <p className={`text-[11px] ${tk.tm} mb-3`}>Each instance is one WhatsApp number. Add numbers for different teams (Sales, Support, etc.).</p>

        <div className="space-y-2 mb-3">
          {instances.length === 0
            ? <p className={`text-[11px] ${tk.tm} italic`}>No instances yet — add one below</p>
            : instances.map(inst => (
              <div key={inst.id || inst.name} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${tk.bdr} ${tk.hov}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${inst.connectionStatus === 'open' ? 'bg-green-500' : inst.connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${tk.t1}`}>{inst.name}</p>
                  <p className={`text-[10px] ${tk.tm}`}>{inst.number || 'Not linked'} · {inst.connectionStatus || 'close'}</p>
                </div>
                <button onClick={() => openQrDialog && openQrDialog(inst.name)}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20">
                  {inst.connectionStatus === 'open' ? 'Reconnect' : 'Connect'}
                </button>
                <button onClick={() => removeInstance(inst.name)}
                  className={`text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20`}>
                  Delete
                </button>
              </div>
            ))
          }
        </div>

        <div className="flex gap-2">
          <Input className={`h-9 flex-1 text-xs ${tk.inp}`} placeholder="e.g. sales, support, orders"
            value={newInstName} onChange={e => setNewInstName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addInstance()} />
          <Button className="h-9 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs px-4"
            onClick={addInstance} disabled={addingInst || !newInstName.trim()}>
            {addingInst ? 'Adding…' : '+ Add'}
          </Button>
        </div>
      </div>

      {/* Expert marketing plan summary */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-4">
          <Target className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>WhatsApp Marketing Blueprint</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { stage: '1. Awareness',      action: 'First-touch intro messages to new leads',           icon: Users,       col: 'text-blue-500',   bg: 'bg-blue-500/10',   link: 'Drip Sequences (lead_created)' },
            { stage: '2. Interest',        action: 'Catalogue share + product showcase campaigns',      icon: MessageSquare, col: 'text-purple-500', bg: 'bg-purple-500/10', link: 'Campaigns → Catalogue templates' },
            { stage: '3. Consideration',   action: 'Quotation follow-up sequence (2→5→10→14 days)',    icon: FileText,    col: 'text-orange-500', bg: 'bg-orange-500/10', link: 'Drip Sequences (quotation_sent)' },
            { stage: '4. Decision',        action: 'Bulk order discount + urgency offer',              icon: Target,      col: 'text-green-500',  bg: 'bg-green-500/10',  link: 'Campaigns → Offer templates' },
            { stage: '5. Retention',       action: 'Festival greetings + reorder reminders',           icon: Gift,        col: 'text-pink-500',   bg: 'bg-pink-500/10',   link: 'Greetings + Seasonal campaigns' },
            { stage: '6. Re-engagement',   action: 'Cold lead revival after 30 days of silence',      icon: RefreshCw,   col: 'text-red-400',    bg: 'bg-red-400/10',    link: 'Drip Sequences (manual)' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.stage} className={`${s.bg} rounded-xl p-3.5`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${s.col}`} />
                  <span className={`text-xs font-bold ${s.col}`}>{s.stage}</span>
                </div>
                <p className={`text-xs ${tk.t2} leading-relaxed mb-1.5`}>{s.action}</p>
                <p className={`text-[10px] ${tk.tm} font-medium`}>→ {s.link}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
