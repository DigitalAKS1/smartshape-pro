import React, { useState, useEffect } from 'react';
import AppShell from '../../components/layouts/AppShell';
import {
  contactRoles as contactRolesApi, contacts as contactsApi,
  dripSequences as dripApi, greetingRules as greetingsApi,
  whatsApp as waApi, tags as tagsApi, demo as demoApi,
} from '../../lib/api';
import { toast } from 'sonner';
import {
  BarChart2, Megaphone, FileText, Gift, Zap, PieChart, Mail,
  Wifi, QrCode, Smartphone as PhoneIcon, Target,
} from 'lucide-react';

import { useTk, mapCampaign, mapRule, mapSeq } from '../../lib/marketingUtils';
import { waLinkTarget } from '../../lib/waStatus';
import { useTeam } from '../../hooks/usePermission';
import OverviewTab    from '../../components/marketing/OverviewTab';
import CampaignsTab  from '../../components/marketing/CampaignsTab';
import TemplatesTab  from '../../components/marketing/TemplatesTab';
import GreetingsTab  from '../../components/marketing/GreetingsTab';
import DripsTab      from '../../components/marketing/DripsTab';
import AnalyticsTab  from '../../components/marketing/AnalyticsTab';
import EngagementDashboardTab from '../../components/marketing/EngagementDashboardTab';
import SetupTab      from '../../components/marketing/SetupTab';
import EmailHubTab   from '../../components/marketing/EmailHubTab';

const TABS = [
  { key: 'overview',   label: 'Overview',   Icon: BarChart2 },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone },
  { key: 'templates',  label: 'Templates',  Icon: FileText },
  { key: 'greetings',  label: 'Greetings',  Icon: Gift },
  { key: 'drips',      label: 'Drip',       Icon: Zap },
  { key: 'analytics',  label: 'Analytics',  Icon: PieChart },
  { key: 'engagement', label: 'Engagement', Icon: Target },
  { key: 'setup',      label: 'WhatsApp',   Icon: PhoneIcon },
  { key: 'email',      label: 'Email',      Icon: Mail },
];

export default function MarketingHub() {
  const tk = useTk();
  // Admin test as the backend's (_is_admin: get_team == admin); useTeam mirrors get_team.
  const waLink = waLinkTarget(useTeam() === 'admin');

  const [tab, setTab] = useState('overview');
  const [waConnected, setWaConnected] = useState(false);
  const [evolutionState, setEvolutionState] = useState('close');

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

  // Numbers are linked in Settings → WhatsApp (admins) or My WhatsApp (everyone else) since W1;
  // every "Connect" button goes there.
  const openQrDialog = () => { window.location.assign(waLink.href); };

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
                {waConnected ? 'WhatsApp On' : (waLink.href === '/me/whatsapp' ? waLink.label : 'Scan QR to Connect')}
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
          {tab === 'engagement' && <EngagementDashboardTab />}
          {tab === 'setup'     && <SetupTab      tk={tk} waConnected={waConnected} setWaConnected={setWaConnected} evolutionState={evolutionState} openQrDialog={openQrDialog} connectLabel={waLink.label} />}
          {tab === 'email'     && <EmailHubTab   tk={tk} />}
        </div>
      </div>
    </AppShell>
  );
}
