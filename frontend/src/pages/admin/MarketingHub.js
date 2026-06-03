import React, { useState, useEffect } from 'react';
import AppShell from '../../components/layouts/AppShell';
import {
  contactRoles as contactRolesApi, contacts as contactsApi,
  dripSequences as dripApi, greetingRules as greetingsApi,
  whatsApp as waApi, tags as tagsApi, demo as demoApi,
} from '../../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import {
  BarChart2, Megaphone, FileText, Gift, Zap, PieChart, Mail,
  Wifi, QrCode, RefreshCw, Loader2, Smartphone as PhoneIcon,
} from 'lucide-react';

import { useTk, mapCampaign, mapRule, mapSeq } from '../../lib/marketingUtils';
import OverviewTab    from '../../components/marketing/OverviewTab';
import CampaignsTab  from '../../components/marketing/CampaignsTab';
import TemplatesTab  from '../../components/marketing/TemplatesTab';
import GreetingsTab  from '../../components/marketing/GreetingsTab';
import DripsTab      from '../../components/marketing/DripsTab';
import AnalyticsTab  from '../../components/marketing/AnalyticsTab';
import SetupTab      from '../../components/marketing/SetupTab';
import EmailHubTab   from '../../components/marketing/EmailHubTab';

const TABS = [
  { key: 'overview',   label: 'Overview',   Icon: BarChart2 },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone },
  { key: 'templates',  label: 'Templates',  Icon: FileText },
  { key: 'greetings',  label: 'Greetings',  Icon: Gift },
  { key: 'drips',      label: 'Drip',       Icon: Zap },
  { key: 'analytics',  label: 'Analytics',  Icon: PieChart },
  { key: 'setup',      label: 'WhatsApp',   Icon: PhoneIcon },
  { key: 'email',      label: 'Email',      Icon: Mail },
];

export default function MarketingHub() {
  const tk = useTk();

  const [tab, setTab] = useState('overview');
  const [waConnected, setWaConnected] = useState(false);
  const [evolutionState, setEvolutionState] = useState('close');
  const [qrDialog, setQrDialog] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [drips, setDrips] = useState([]);
  const [greetings, setGreetings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [allTags, setAllTags] = useState([]);

  function reload() {
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
    dripApi.getAll().then(r => setDrips((r.data || []).map(mapSeq))).catch(() => {});
    greetingsApi.getAll().then(r => setGreetings((r.data || []).map(mapRule))).catch(() => {});
    waApi.getCampaigns().then(r => setCampaigns((r.data || []).map(mapCampaign))).catch(() => {});
    waApi.getTemplates().then(r => setTemplates(r.data || [])).catch(() => {});
    waApi.getAnalytics().then(r => setAnalytics(r.data)).catch(() => {});
    tagsApi.getAll().then(r => setAllTags(r.data || [])).catch(() => {});
    waApi.instanceStatus().then(r => {
      const state = r.data?.state || 'close';
      setEvolutionState(state);
      setWaConnected(state === 'open');
    }).catch(() => {});
  }

  async function openQrDialog() {
    setQrDialog(true);
    setQrLoading(true);
    setQrData(null);
    try {
      await waApi.instanceConnect().catch(() => {});
      const r = await waApi.instanceQR();
      setQrData(r.data);
    } catch (err) {
      const msg = err?.response?.data?.detail || '';
      if (msg.includes('QR') || msg.includes('502')) {
        toast.error('QR blocked — VPS IP flagged by WhatsApp. Go to Settings → WhatsApp to configure a residential SOCKS5 proxy.');
      } else {
        toast.error('Could not fetch QR — is Evolution API running?');
      }
    }
    finally { setQrLoading(false); }
  }

  async function refreshQr() {
    setQrLoading(true);
    try {
      const r = await waApi.instanceQR();
      setQrData(r.data);
    } catch { toast.error('Failed to refresh QR'); }
    finally { setQrLoading(false); }
  }

  // Poll evolution status every 10s while QR dialog is open
  useEffect(() => {
    if (!qrDialog) return;
    const iv = setInterval(async () => {
      try {
        const r = await waApi.instanceStatus();
        const state = r.data?.state || 'close';
        setEvolutionState(state);
        if (state === 'open') {
          setWaConnected(true);
          setQrDialog(false);
          toast.success('WhatsApp connected! Ready to send campaigns.');
        }
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(iv);
  }, [qrDialog]); // eslint-disable-line

  useEffect(() => { reload(); }, []); // eslint-disable-line

  async function loadDemo() {
    try {
      const res = await demoApi.seedMarketing();
      const d = res.data;
      if (d.already_seeded) { toast.info('Demo data already loaded'); return; }
      toast.success(`Demo loaded! ${d.summary.campaigns} campaigns · ${d.summary.whatsapp_messages} messages queued`);
      reload();
      setTab('analytics');
    } catch { toast.error('Failed to load demo data'); }
  }

  async function clearDemo() {
    try {
      await demoApi.clearMarketing();
      toast.success('Demo data cleared');
      reload();
    } catch { toast.error('Failed to clear demo data'); }
  }

  return (
    <AppShell>
      <div className={`min-h-screen ${tk.page}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

          {/* System status row */}
          <div className="flex items-center gap-2 flex-wrap mb-5 mh-fade mh-fade-1">
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200/80 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span className="text-[11px] font-semibold text-emerald-700 tracking-tight">Automation Live</span>
            </div>
            <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200/80 rounded-full px-3 py-1">
              <Mail className="h-3 w-3 text-sky-600 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-sky-700 tracking-tight">Email Ready</span>
            </div>
            <button onClick={waConnected ? undefined : openQrDialog}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 border transition-colors ${
                waConnected ? 'bg-green-50 border-green-200/80 cursor-default' : 'bg-amber-50 border-amber-200/80 hover:bg-amber-100 cursor-pointer'
              }`}>
              {waConnected
                ? <Wifi className="h-3 w-3 text-green-600 flex-shrink-0" />
                : <QrCode className="h-3 w-3 text-amber-600 flex-shrink-0" />}
              <span className={`text-[11px] font-semibold tracking-tight ${waConnected ? 'text-green-700' : 'text-amber-700'}`}>
                {waConnected ? 'WhatsApp On' : 'Scan QR to Connect'}
              </span>
            </button>
          </div>

          {/* Page title */}
          <div className="mb-6 mh-fade mh-fade-2">
            <h1 className={`text-[22px] font-bold ${tk.t1} tracking-tight leading-tight`}>
              Marketing Command Center
            </h1>
            <p className={`text-sm ${tk.tm} mt-1 font-medium`}>
              Campaigns · Drip sequences · Greetings · Analytics
            </p>
          </div>

          {/* Underline tab bar */}
          <div className={`border-b ${tk.bdr} mb-6 mh-fade mh-fade-3`}>
            <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
              {TABS.map(({ key, label, Icon }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all whitespace-nowrap border-b-2 -mb-px ${
                    tab === key
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : `border-transparent ${tk.tm} hover:text-[var(--text-secondary)] hover:border-[var(--border-color)]`
                  }`}>
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="hidden sm:block">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          {tab === 'overview'  && <OverviewTab   tk={tk} campaigns={campaigns} greetings={greetings} drips={drips} waConnected={waConnected} setTab={setTab} analytics={analytics} loadDemo={loadDemo} clearDemo={clearDemo} />}
          {tab === 'campaigns' && <CampaignsTab  tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} templates={templates} allTags={allTags} waConnected={waConnected} openQrDialog={openQrDialog} />}
          {tab === 'templates' && <TemplatesTab  tk={tk} templates={templates} setTemplates={setTemplates} />}
          {tab === 'greetings' && <GreetingsTab  tk={tk} greetings={greetings} setGreetings={setGreetings} />}
          {tab === 'drips'     && <DripsTab      tk={tk} drips={drips} setDrips={setDrips} />}
          {tab === 'analytics' && <AnalyticsTab  tk={tk} analytics={analytics} campaigns={campaigns} />}
          {tab === 'setup'     && <SetupTab      tk={tk} waConnected={waConnected} setWaConnected={setWaConnected} evolutionState={evolutionState} openQrDialog={openQrDialog} />}
          {tab === 'email'     && <EmailHubTab   tk={tk} />}
        </div>
      </div>

      {/* Evolution API QR Connect Dialog */}
      <Dialog open={qrDialog} onOpenChange={setQrDialog}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${tk.t1}`}>
              <QrCode className="h-5 w-5 text-[var(--accent)]" />
              Connect WhatsApp
            </DialogTitle>
            <DialogDescription className={tk.tm}>
              Open WhatsApp on your phone → Linked Devices → Link a Device → scan QR
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4">
            <div className={`flex items-center justify-center rounded-2xl border-2 border-dashed ${tk.bdr} p-4 min-h-[200px]`}>
              {qrLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-[var(--accent)]" />
                  <p className={`text-xs ${tk.tm}`}>Generating QR code…</p>
                </div>
              ) : qrData?.base64 ? (
                <img src={qrData.base64} alt="WhatsApp QR" className="w-48 h-48 rounded-xl" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center max-w-xs">
                  <PhoneIcon className="h-10 w-10 text-amber-400" />
                  <p className={`text-sm font-semibold ${tk.t1}`}>QR Generation Blocked</p>
                  <p className={`text-[11px] ${tk.tm} leading-relaxed`}>
                    WhatsApp rejects connections from datacenter IPs. Configure a <strong>residential SOCKS5 proxy</strong> to fix this.
                  </p>
                  <a href="/settings" className="text-[11px] px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 transition-colors font-medium">
                    Go to Settings → WhatsApp →
                  </a>
                </div>
              )}
            </div>

            <div className={`flex items-center gap-2 text-xs p-3 rounded-xl ${
              evolutionState === 'open' ? 'bg-green-500/10 text-green-600' :
              evolutionState === 'connecting' ? 'bg-blue-500/10 text-blue-600' :
              'bg-amber-500/10 text-amber-600'
            }`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                evolutionState === 'open' ? 'bg-green-500 animate-pulse' :
                evolutionState === 'connecting' ? 'bg-blue-500 animate-pulse' :
                'bg-amber-500'
              }`} />
              <span className="font-medium">
                {evolutionState === 'open' ? 'Connected — closing dialog…' :
                 evolutionState === 'connecting' ? 'Connecting to WhatsApp…' :
                 'Waiting for QR scan…'}
              </span>
            </div>

            <p className={`text-[11px] ${tk.tm} text-center`}>
              QR expires in ~40 seconds. The dialog closes automatically once connected.
            </p>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refreshQr} disabled={qrLoading}
              className={`border-[var(--border-color)] ${tk.t2} gap-1.5`}>
              <RefreshCw className={`h-3.5 w-3.5 ${qrLoading ? 'animate-spin' : ''}`} /> Refresh QR
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQrDialog(false)}
              className={`border-[var(--border-color)] ${tk.t2}`}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
