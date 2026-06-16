import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import {
  Wifi, WifiOff, QrCode, RefreshCw, Loader2, Save, Eye, EyeOff,
  Shield, Smartphone as PhoneIcon, Plus, Trash2, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { whatsApp as waApi } from '../../lib/api';

/**
 * WhatsAppConnectionSection — the Evolution-API connection panel for App Settings.
 *
 * Moved here from the Marketing page so all WhatsApp configuration lives in one
 * place (Settings → WhatsApp). Provides:
 *   1. Live connection status + "Connect WhatsApp" QR dialog (default instance)
 *   2. Residential SOCKS5 proxy config (fixes "VPS IP flagged by WhatsApp")
 *   3. Multiple WhatsApp numbers (Evolution instances) add / connect / delete
 */
export default function WhatsAppConnectionSection() {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  // ── Connection / QR ──────────────────────────────────────────────
  const [state, setState] = useState('close');          // open | connecting | close
  const [qrDialog, setQrDialog] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrInstance, setQrInstance] = useState(null);   // null = primary/default number
  const [qrState, setQrState] = useState('close');      // status of the instance being scanned

  // ── Proxy ────────────────────────────────────────────────────────
  const [proxy, setProxy] = useState({ enabled: true, host: '', port: '', protocol: 'socks5', username: '', password: '' });
  const [proxyConfigured, setProxyConfigured] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [showProxyPwd, setShowProxyPwd] = useState(false);

  // ── Instances ────────────────────────────────────────────────────
  const [instances, setInstances] = useState([]);
  const [newInstName, setNewInstName] = useState('');
  const [addingInst, setAddingInst] = useState(false);

  const connected = state === 'open';

  const refreshStatus = useCallback(async () => {
    try {
      const r = await waApi.instanceStatus();
      setState(r.data?.state || 'close');
    } catch { /* Evolution unreachable */ }
  }, []);

  const loadInstances = useCallback(async () => {
    try { const r = await waApi.listInstances(); setInstances(Array.isArray(r.data) ? r.data : []); }
    catch { setInstances([]); }
  }, []);

  useEffect(() => {
    waApi.getProxyConfig().then(r => {
      const d = r.data || {};
      setProxy({
        enabled:  d.enabled !== false,
        host:     d.host || '',
        port:     String(d.port || ''),
        protocol: d.protocol || 'socks5',
        username: d.username || '',
        password: d.password || '',
      });
      setProxyConfigured(!!d.configured);
    }).catch(() => {});
    refreshStatus();
    loadInstances();
  }, [refreshStatus, loadInstances]);

  // Poll status while the QR dialog is open; auto-close on connect.
  useEffect(() => {
    if (!qrDialog) return;
    const iv = setInterval(async () => {
      try {
        const r = qrInstance ? await waApi.instanceStatusFor(qrInstance) : await waApi.instanceStatus();
        const st = r.data?.state || 'close';
        setQrState(st);
        if (!qrInstance) setState(st);
        if (st === 'open') {
          setQrDialog(false);
          refreshStatus();
          loadInstances();
          toast.success('WhatsApp connected!');
        }
      } catch { /* ignore */ }
    }, 8000);
    return () => clearInterval(iv);
  }, [qrDialog, qrInstance, loadInstances, refreshStatus]);

  // Pass an instance name to link an additional number; omit for the primary number.
  async function openQrDialog(instanceName) {
    const target = typeof instanceName === 'string' && instanceName ? instanceName : null;
    setQrInstance(target);
    setQrState('connecting');
    setQrDialog(true);
    setQrLoading(true);
    setQrData(null);
    try {
      let r;
      if (target) {
        r = await waApi.instanceQRFor(target);          // named instance
      } else {
        await waApi.instanceConnect().catch(() => {});   // ensure default instance exists
        r = await waApi.instanceQR();
      }
      setQrData(r.data);
    } catch (err) {
      const msg = err?.response?.data?.detail || '';
      if (msg.includes('QR') || msg.includes('502')) {
        toast.error('QR blocked — VPS IP flagged. Save a residential SOCKS5 proxy below, then retry.');
      } else {
        toast.error('Could not fetch QR — is Evolution API running?');
      }
    } finally { setQrLoading(false); }
  }

  async function refreshQr() {
    setQrLoading(true);
    try {
      const r = qrInstance ? await waApi.instanceQRFor(qrInstance) : await waApi.instanceQR();
      setQrData(r.data);
    } catch { toast.error('Failed to refresh QR'); }
    finally { setQrLoading(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect the current WhatsApp number? You can then link a different phone.')) return;
    try {
      await waApi.instanceLogout();
      setState('close');
      toast.success('Disconnected. Click “Connect WhatsApp” to link a new number.');
    } catch { toast.error('Disconnect failed'); }
  }

  async function saveProxy() {
    if (proxy.enabled && (!proxy.host || !proxy.port)) {
      toast.error('Proxy host and port are required'); return;
    }
    setProxySaving(true);
    try {
      const r = await waApi.saveProxyConfig(proxy);
      setProxyConfigured(true);
      if (r.data?.applied) toast.success('Proxy saved & applied. You can now scan the QR.');
      else toast.success(r.data?.note || 'Proxy saved.');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save proxy');
    } finally { setProxySaving(false); }
  }

  async function addInstance() {
    const name = newInstName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    setAddingInst(true);
    try {
      await waApi.createInstance(name);
      await loadInstances();
      setNewInstName('');
      toast.success('Instance created — connect it to scan QR');
    } catch { toast.error('Failed to create instance'); }
    finally { setAddingInst(false); }
  }

  async function removeInstance(name) {
    if (!window.confirm(`Delete WhatsApp instance "${name}"?`)) return;
    try {
      await waApi.deleteInstance(name);
      setInstances(p => p.filter(x => (x.name || x.instanceName) !== name));
      toast.success('Instance deleted');
    } catch { toast.error('Failed to delete'); }
  }

  const instName = (inst) => inst.name || inst.instanceName || inst.instance?.instanceName || '—';
  const instState = (inst) => inst.connectionStatus || inst.connectionState || inst.instance?.state || 'close';

  return (
    <div className="space-y-4">
      {/* ── Connection status ─────────────────────────────────────── */}
      <div className={`${card} border ${connected ? '!border-green-500/40' : ''} rounded-md p-5`} data-testid="wa-connection">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${connected ? 'bg-green-500/15' : 'bg-[var(--bg-primary)]'}`}>
            {connected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-gray-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${textPri}`}>
              {connected ? 'WhatsApp Connected' : state === 'connecting' ? 'Connecting…' : 'WhatsApp Not Connected'}
            </p>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {connected
                ? 'Linked and ready to send messages & campaigns'
                : 'Scan the QR with WhatsApp → Linked Devices to connect'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={refreshStatus} className={`border-[var(--border-color)] ${textSec} h-9 w-9 p-0`} title="Refresh status">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {connected && (
              <Button size="sm" variant="outline" onClick={disconnect} className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-9" data-testid="wa-disconnect-btn">
                Disconnect
              </Button>
            )}
            <Button size="sm" onClick={() => openQrDialog()} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9" data-testid="wa-connect-btn">
              <QrCode className="mr-1.5 h-4 w-4" /> {connected ? 'Change Number' : 'Connect WhatsApp'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Residential SOCKS5 proxy ───────────────────────────────── */}
      <div className={`${card} border rounded-md p-5 space-y-4`} data-testid="wa-proxy">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <h2 className={`text-lg font-medium ${textPri}`}>Residential Proxy (SOCKS5)</h2>
          {proxyConfigured && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Saved</span>}
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3 text-sm text-amber-500">
          WhatsApp blocks QR connections from datacenter / VPS IPs. Route Evolution through a
          <strong> residential SOCKS5 proxy</strong>, save it, then scan the QR above.
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm font-medium ${textPri}`}>Enable proxy</p>
            <p className={`text-xs ${textMuted}`}>Applied to the default WhatsApp instance on save</p>
          </div>
          <button type="button" onClick={() => setProxy({ ...proxy, enabled: !proxy.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${proxy.enabled ? 'bg-[#e94560]' : 'bg-[var(--border-color)]'}`}
            data-testid="wa-proxy-toggle">
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${proxy.enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <Label className={`${textSec} text-xs`}>Proxy Host</Label>
            <Input value={proxy.host} onChange={e => setProxy({ ...proxy, host: e.target.value })} className={`${inputCls} font-mono`} placeholder="gate.decodo.com" data-testid="wa-proxy-host" />
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Port</Label>
            <Input value={proxy.port} onChange={e => setProxy({ ...proxy, port: e.target.value })} className={`${inputCls} font-mono`} placeholder="10001" data-testid="wa-proxy-port" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className={`${textSec} text-xs`}>Protocol</Label>
            <select value={proxy.protocol} onChange={e => setProxy({ ...proxy, protocol: e.target.value })} className={`h-10 w-full px-3 rounded-md text-sm ${inputCls}`} data-testid="wa-proxy-protocol">
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
            </select>
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Username</Label>
            <Input value={proxy.username} onChange={e => setProxy({ ...proxy, username: e.target.value })} className={`${inputCls} font-mono`} placeholder="proxy user" data-testid="wa-proxy-user" />
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Password</Label>
            <div className="relative">
              <Input type={showProxyPwd ? 'text' : 'password'} value={proxy.password} onChange={e => setProxy({ ...proxy, password: e.target.value })} className={`${inputCls} pr-10 font-mono`} placeholder="proxy password" data-testid="wa-proxy-pass" />
              <button type="button" onClick={() => setShowProxyPwd(!showProxyPwd)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                {showProxyPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
        <Button onClick={saveProxy} disabled={proxySaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="wa-proxy-save">
          <Save className="mr-1.5 h-4 w-4" /> {proxySaving ? 'Saving…' : 'Save & Apply Proxy'}
        </Button>
      </div>

      {/* ── WhatsApp numbers (Evolution instances) ─────────────────── */}
      <div className={`${card} border rounded-md p-5 space-y-3`} data-testid="wa-instances">
        <div className="flex items-center gap-2">
          <PhoneIcon className={`h-5 w-5 ${textSec}`} />
          <h2 className={`text-lg font-medium ${textPri}`}>WhatsApp Numbers</h2>
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${connected ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
            {connected ? '● Connected' : '● Not linked'}
          </span>
        </div>
        <p className={`text-xs ${textMuted}`}>Each instance is one WhatsApp number. Add separate numbers for teams (Sales, Support, Orders…).</p>

        <div className="space-y-2">
          {instances.length === 0 ? (
            <p className={`text-xs ${textMuted} italic py-2`}>No instances yet — add one below.</p>
          ) : instances.map(inst => {
            const name = instName(inst);
            const st = instState(inst);
            return (
              <div key={inst.id || name} className={`flex items-center gap-3 px-3 py-2 rounded-md border border-[var(--border-color)]`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st === 'open' ? 'bg-green-500' : st === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${textPri} truncate`}>{name}</p>
                  <p className={`text-[11px] ${textMuted}`}>{inst.number || inst.ownerJid || 'Not linked'} · {st}</p>
                </div>
                <button onClick={() => openQrDialog(name)} className="text-[11px] px-2.5 py-1 rounded bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 font-medium" title="Scan QR to link this number">
                  {st === 'open' ? 'Reconnect' : 'Connect'}
                </button>
                <button onClick={() => removeInstance(name)} className="text-red-400 hover:text-red-300 p-1.5" title="Delete instance">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Input className={inputCls} placeholder="e.g. sales, support, orders"
            value={newInstName} onChange={e => setNewInstName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addInstance()} data-testid="wa-new-instance" />
          <Button onClick={addInstance} disabled={addingInst || !newInstName.trim()} className="bg-[#e94560] hover:bg-[#f05c75] text-white flex-shrink-0">
            <Plus className="mr-1 h-4 w-4" /> {addingInst ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>

      {/* ── Webhook URL ────────────────────────────────────────────── */}
      <div className={`${card} border rounded-md p-5`}>
        <div className="flex items-center gap-2 mb-2">
          <Globe className={`h-4 w-4 ${textSec}`} />
          <h3 className={`text-sm font-medium ${textPri}`}>Webhook URL</h3>
        </div>
        <p className={`text-xs ${textMuted} mb-2`}>For Meta / BSP providers — paste into WhatsApp → Configuration → Webhook.</p>
        <div className="flex items-center gap-2">
          <code className={`flex-1 text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 font-mono truncate ${textSec}`}>
            https://app.smartshape.in/api/whatsapp/webhook
          </code>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText('https://app.smartshape.in/api/whatsapp/webhook'); toast.success('Copied'); }}
            className={`border-[var(--border-color)] ${textSec} flex-shrink-0`}>Copy</Button>
        </div>
      </div>

      {/* ── QR dialog ──────────────────────────────────────────────── */}
      <Dialog open={qrDialog} onOpenChange={setQrDialog}>
        <DialogContent className={`${card} border w-[calc(100vw-2rem)] max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${textPri}`}>
              <QrCode className="h-5 w-5 text-[#e94560]" /> {qrInstance ? `Link “${qrInstance}”` : 'Connect WhatsApp'}
            </DialogTitle>
            <DialogDescription className={textMuted}>
              On the phone for this number: WhatsApp → Linked Devices → Link a Device → scan QR
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4">
            <div className={`flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-color)] p-4 min-h-[200px]`}>
              {qrLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-[#e94560]" />
                  <p className={`text-xs ${textMuted}`}>Generating QR code…</p>
                </div>
              ) : qrData?.base64 ? (
                <img src={qrData.base64} alt="WhatsApp QR" className="w-48 h-48 rounded-xl" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center max-w-xs">
                  <PhoneIcon className="h-10 w-10 text-amber-400" />
                  <p className={`text-sm font-semibold ${textPri}`}>QR Generation Blocked</p>
                  <p className={`text-[11px] ${textMuted} leading-relaxed`}>
                    WhatsApp rejects datacenter IPs. Save a <strong>residential SOCKS5 proxy</strong> below, then retry.
                  </p>
                </div>
              )}
            </div>

            <div className={`flex items-center gap-2 text-xs p-3 rounded-xl ${
              qrState === 'open' ? 'bg-green-500/10 text-green-500' :
              qrState === 'connecting' ? 'bg-blue-500/10 text-blue-500' :
              'bg-amber-500/10 text-amber-500'
            }`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                qrState === 'open' ? 'bg-green-500 animate-pulse' :
                qrState === 'connecting' ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'
              }`} />
              <span className="font-medium">
                {qrState === 'open' ? 'Connected — closing…' : qrState === 'connecting' ? 'Connecting to WhatsApp…' : 'Waiting for QR scan…'}
              </span>
            </div>

            <p className={`text-[11px] ${textMuted} text-center`}>QR expires in ~40 seconds. The dialog closes automatically once connected.</p>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refreshQr} disabled={qrLoading} className={`border-[var(--border-color)] ${textSec} gap-1.5`}>
              <RefreshCw className={`h-3.5 w-3.5 ${qrLoading ? 'animate-spin' : ''}`} /> Refresh QR
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQrDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
