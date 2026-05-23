import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useTheme } from '../../contexts/ThemeContext';
import { contactRoles as contactRolesApi, contacts as contactsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Megaphone, MessageSquare, Zap, CalendarDays, Smartphone,
  Send, Users, Plus, TrendingUp, CheckCircle, Clock,
  AlertCircle, WifiOff, BarChart2, Star, Gift,
  RefreshCw, MoreVertical, ArrowRight, Activity,
  ChevronRight, ChevronDown, Trash2, Play, Eye,
  Check, Wifi, Calendar, Key, Globe, Copy,
} from 'lucide-react';

// ── Design tokens ─────────────────────────────────────────────────────────────
function useTk() {
  return {
    page:  'bg-[var(--bg-primary)]',
    card:  'bg-[var(--bg-card)]',
    bdr:   'border-[var(--border-color)]',
    t1:    'text-[var(--text-primary)]',
    t2:    'text-[var(--text-secondary)]',
    tm:    'text-[var(--text-muted)]',
    inp:   'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
    hov:   'hover:bg-[var(--bg-hover)]',
  };
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const INIT_CAMPAIGNS = [
  {
    id: '1', name: 'Diwali Special Offer 2025', status: 'completed',
    audience_label: 'All Contacts', audience_count: 342,
    stats: { sent: 338, delivered: 315, read: 267, failed: 4 },
    created_at: '20 Oct 2025', scheduled_at: null,
  },
  {
    id: '2', name: 'New Flower Die Collection Launch', status: 'scheduled',
    audience_label: 'School Principals', audience_count: 186,
    stats: { sent: 0, delivered: 0, read: 0, failed: 0 },
    created_at: '1 Nov 2025', scheduled_at: '10 Nov 2025 · 10:00 AM',
  },
  {
    id: '3', name: 'Year End Clearance Sale', status: 'draft',
    audience_label: 'All Contacts', audience_count: 412,
    stats: { sent: 0, delivered: 0, read: 0, failed: 0 },
    created_at: '5 Nov 2025', scheduled_at: null,
  },
];

const INIT_GREETINGS = [
  { id: '1', name: 'Birthday Greetings',  type: 'birthday', date: null,     active: true,  template: 'birthday_wish',   sent_total: 89,  next: 'Daily' },
  { id: '2', name: 'New Year 2026',       type: 'festival', date: 'Jan 1',  active: true,  template: 'new_year_wish',   sent_total: 0,   next: 'Jan 1, 2026' },
  { id: '3', name: 'Republic Day',        type: 'festival', date: 'Jan 26', active: false, template: 'republic_day',    sent_total: 0,   next: 'Jan 26, 2026' },
  { id: '4', name: 'Holi Wishes',         type: 'festival', date: 'Mar 14', active: true,  template: 'holi_wish',       sent_total: 0,   next: 'Mar 14, 2026' },
  { id: '5', name: "Teacher's Day",       type: 'festival', date: 'Sep 5',  active: true,  template: 'teachers_day',    sent_total: 0,   next: 'Sep 5, 2026' },
  { id: '6', name: 'Diwali 2026',         type: 'festival', date: 'Oct 20', active: true,  template: 'diwali_wish',     sent_total: 0,   next: 'Oct 20, 2026' },
  { id: '7', name: 'Christmas',           type: 'festival', date: 'Dec 25', active: true,  template: 'christmas_wish',  sent_total: 0,   next: 'Dec 25, 2026' },
];

const INIT_DRIPS = [
  {
    id: '1', name: 'New Lead Welcome Series', trigger: 'Lead Created',
    steps: [
      { n: 1, delay: 'Immediately', label: 'Welcome + Who we are' },
      { n: 2, delay: 'Day 3',       label: 'Product catalogue link' },
      { n: 3, delay: 'Day 7',       label: 'Special introductory offer' },
      { n: 4, delay: 'Day 14',      label: 'Book a visit / call CTA' },
    ],
    enrolled: 34, completed: 12, active: true,
  },
  {
    id: '2', name: 'Quotation Follow-up', trigger: 'Quotation Sent',
    steps: [
      { n: 1, delay: 'Day 2', label: 'Did you review our quotation?' },
      { n: 2, delay: 'Day 5', label: 'Last reminder + extra discount' },
    ],
    enrolled: 18, completed: 7, active: true,
  },
  {
    id: '3', name: 'Re-engagement (30-day cold)', trigger: 'Manual',
    steps: [
      { n: 1, delay: 'Immediately', label: "We miss you! Check new arrivals" },
      { n: 2, delay: 'Day 5',       label: 'Exclusive comeback offer' },
    ],
    enrolled: 7, completed: 3, active: false,
  },
];

const MOCK_TEMPLATES = [
  { name: 'welcome_new_lead',  category: 'MARKETING', status: 'APPROVED', lang: 'English' },
  { name: 'birthday_wish',     category: 'MARKETING', status: 'APPROVED', lang: 'English' },
  { name: 'diwali_wish',       category: 'MARKETING', status: 'APPROVED', lang: 'Hindi' },
  { name: 'catalogue_share',   category: 'UTILITY',   status: 'APPROVED', lang: 'English' },
  { name: 'order_confirm',     category: 'UTILITY',   status: 'APPROVED', lang: 'English' },
  { name: 'new_year_wish',     category: 'MARKETING', status: 'PENDING',  lang: 'English' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CHIP = {
  completed: 'bg-green-500/15 text-green-500',
  scheduled: 'bg-blue-500/15 text-blue-500',
  running:   'bg-yellow-500/15 text-yellow-600',
  draft:     'bg-gray-500/15 text-gray-400',
  paused:    'bg-orange-500/15 text-orange-400',
};

function pct(num, den) { return den > 0 ? Math.round((num / den) * 100) : null; }

// ══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Overview
// ══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ tk, campaigns, greetings, drips, waConnected, setTab }) {
  const done  = campaigns.filter(c => c.status === 'completed');
  const totalSent = done.reduce((s, c) => s + c.stats.sent, 0);
  const totalRead = done.reduce((s, c) => s + c.stats.read, 0);
  const avgRead   = pct(totalRead, totalSent);

  const kpis = [
    { label: 'Campaigns',       value: campaigns.length,                                  icon: Megaphone,  col: 'text-purple-500',  bg: 'bg-purple-500/10' },
    { label: 'Messages Sent',   value: totalSent ? totalSent.toLocaleString('en-IN') : '—', icon: Send,     col: 'text-blue-500',    bg: 'bg-blue-500/10' },
    { label: 'Avg Read Rate',   value: avgRead !== null ? `${avgRead}%` : '—',             icon: Eye,        col: 'text-green-500',   bg: 'bg-green-500/10' },
    { label: 'Active Drips',    value: drips.filter(d => d.active).length,                 icon: Zap,        col: 'text-yellow-500',  bg: 'bg-yellow-500/10' },
    { label: 'Auto Greetings',  value: greetings.filter(g => g.active).length,             icon: Gift,       col: 'text-pink-500',    bg: 'bg-pink-500/10' },
    { label: 'WhatsApp',        value: waConnected ? 'Connected' : 'Not Set Up',           icon: waConnected ? Wifi : WifiOff, col: waConnected ? 'text-green-500' : 'text-red-500', bg: waConnected ? 'bg-green-500/10' : 'bg-red-500/10' },
  ];

  return (
    <div className="space-y-5">
      {/* Not-connected banner */}
      {!waConnected && (
        <div className={`${tk.card} border border-yellow-500/30 rounded-xl p-4 flex items-start sm:items-center gap-3`}>
          <div className="w-9 h-9 rounded-lg bg-yellow-500/15 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
            <AlertCircle className="h-4.5 w-4.5 text-yellow-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tk.t1}`}>WhatsApp not connected</p>
            <p className={`text-xs ${tk.tm} mt-0.5`}>Connect your WhatsApp Business API to send campaigns, greetings and drip messages</p>
          </div>
          <Button size="sm" variant="outline"
            className="border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/10 flex-shrink-0 h-8 text-xs"
            onClick={() => setTab('setup')}>
            Connect Now
          </Button>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4 w-4 ${k.col}`} />
              </div>
              <p className={`text-xl font-bold ${tk.t1} leading-none`}>{k.value}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{k.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Campaigns */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
            <div className="flex items-center gap-2">
              <Megaphone className={`h-4 w-4 ${tk.tm}`} />
              <span className={`text-sm font-semibold ${tk.t1}`}>Recent Campaigns</span>
            </div>
            <button onClick={() => setTab('campaigns')}
              className={`text-[11px] ${tk.tm} hover:text-[var(--accent)] flex items-center gap-0.5 transition-colors`}>
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className={`divide-y divide-[var(--border-color)]`}>
            {campaigns.slice(0, 3).map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${tk.t1} truncate`}>{c.name}</p>
                  <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_label} · {c.audience_count} contacts</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status]}`}>
                    {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                  </span>
                  {c.status === 'completed' && (
                    <span className={`text-[10px] ${tk.tm}`}>{pct(c.stats.read, c.stats.sent)}% read</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Greetings */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
            <div className="flex items-center gap-2">
              <Gift className={`h-4 w-4 ${tk.tm}`} />
              <span className={`text-sm font-semibold ${tk.t1}`}>Auto Greetings</span>
            </div>
            <button onClick={() => setTab('greetings')}
              className={`text-[11px] ${tk.tm} hover:text-[var(--accent)] flex items-center gap-0.5 transition-colors`}>
              Manage <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className={`divide-y divide-[var(--border-color)]`}>
            {greetings.filter(g => g.active).slice(0, 5).map(g => (
              <div key={g.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  g.type === 'birthday' ? 'bg-pink-500/15' : 'bg-amber-500/15'
                }`}>
                  {g.type === 'birthday'
                    ? <Star className="h-3.5 w-3.5 text-pink-500" />
                    : <Calendar className="h-3.5 w-3.5 text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${tk.t1} truncate`}>{g.name}</p>
                  <p className={`text-[11px] ${tk.tm}`}>Next: {g.next}</p>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Drips */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
          <div className="flex items-center gap-2">
            <Zap className={`h-4 w-4 ${tk.tm}`} />
            <span className={`text-sm font-semibold ${tk.t1}`}>Active Drip Sequences</span>
          </div>
          <button onClick={() => setTab('drips')}
            className={`text-[11px] ${tk.tm} hover:text-[var(--accent)] flex items-center gap-0.5 transition-colors`}>
            View all <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-color)]">
          {drips.filter(d => d.active).map(d => (
            <div key={d.id} className="px-4 py-4">
              <p className={`text-sm font-semibold ${tk.t1} truncate`}>{d.name}</p>
              <p className={`text-[11px] ${tk.tm} mt-0.5`}>{d.steps.length} steps · on {d.trigger}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs ${tk.t2}`}>{d.enrolled} enrolled</span>
                <span className={`text-[11px] ${tk.tm}`}>{d.completed} completed</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 2 — Campaigns
// ══════════════════════════════════════════════════════════════════════════════
function CampaignsTab({ tk, campaigns, setCampaigns, roles, contacts }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', audience: 'all', role_id: '', template: '', schedule: 'draft', schedule_at: '' });

  // Live audience count based on selection
  const audienceCount = (() => {
    if (form.audience === 'all') return contacts.length;
    if (form.audience === 'role' && form.role_id) {
      return contacts.filter(c => c.contact_role_id === form.role_id).length;
    }
    return 0;
  })();

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'scheduled', label: 'Scheduled', count: campaigns.filter(c => c.status === 'scheduled').length },
    { key: 'running',   label: 'Running',   count: campaigns.filter(c => c.status === 'running').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  function closeCreate() { setShowCreate(false); setStep(1); setForm({ name: '', audience: 'all', role_id: '', template: '', schedule: 'draft', schedule_at: '' }); }

  function createCampaign() {
    const roleLabel = form.audience === 'role' && form.role_id
      ? roles.find(r => r.role_id === form.role_id)?.name || 'By Role'
      : form.audience === 'all' ? 'All Contacts' : form.audience;
    setCampaigns(prev => [{
      id: Date.now().toString(),
      name: form.name || 'Untitled Campaign',
      status: form.schedule === 'schedule' ? 'scheduled' : 'draft',
      audience_label: roleLabel,
      audience_count: audienceCount,
      stats: { sent: 0, delivered: 0, read: 0, failed: 0 },
      created_at: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      scheduled_at: form.schedule_at || null,
    }, ...prev]);
    closeCreate();
    toast.success('Campaign saved as draft');
  }

  const AUDIENCE_OPTS = [
    { key: 'all',  label: 'All Contacts',      desc: `${contacts.length} contacts in your database` },
    { key: 'role', label: 'By Designation',    desc: 'Principal, Teacher, Purchase Head, etc.' },
    { key: 'city', label: 'By City',           desc: 'Target contacts in specific cities' },
    { key: 'board',label: 'By School Board',   desc: 'CBSE, ICSE, State Board, etc.' },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className={`flex items-center gap-0.5 p-1 bg-[var(--bg-primary)] border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar flex-shrink-0`}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                filter === f.key
                  ? `${tk.card} ${tk.t1} shadow-sm`
                  : `${tk.tm} ${tk.hov}`
              }`}>
              {f.label}
              <span className={`text-[10px] min-w-[16px] text-center px-1 rounded-full ${
                filter === f.key ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--border-color)]'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <Button size="sm" className="h-9 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
            onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
          <Megaphone className={`h-10 w-10 ${tk.tm} mx-auto mb-3 opacity-40`} />
          <p className={`text-sm font-medium ${tk.t2}`}>No {filter !== 'all' ? filter : ''} campaigns</p>
          <p className={`text-xs ${tk.tm} mt-1`}>Create a campaign to start reaching your contacts via WhatsApp</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const dr = pct(c.stats.delivered, c.stats.sent);
            const rr = pct(c.stats.read, c.stats.sent);
            return (
              <div key={c.id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                    <Megaphone className="h-4 w-4 text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${tk.t1}`}>{c.name}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status]}`}>
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    </div>
                    <p className={`text-xs ${tk.tm} mt-0.5`}>
                      {c.audience_label} · {c.audience_count} contacts
                      {c.scheduled_at && ` · ${c.scheduled_at}`}
                      {!c.scheduled_at && ` · Created ${c.created_at}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {c.status === 'draft' && (
                      <Button size="sm" variant="outline" className={`h-7 gap-1 text-xs border-[var(--border-color)] ${tk.t2}`}
                        onClick={() => toast.info('Backend integration needed to launch')}>
                        <Play className="h-3 w-3" /> Launch
                      </Button>
                    )}
                    <button className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`}>
                      <MoreVertical className={`h-4 w-4 ${tk.tm}`} />
                    </button>
                  </div>
                </div>

                {c.status === 'completed' && (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {[
                      { label: 'Sent',      v: c.stats.sent,      p: null,  col: tk.t1 },
                      { label: 'Delivered', v: c.stats.delivered, p: dr,    col: 'text-blue-500' },
                      { label: 'Read',      v: c.stats.read,      p: rr,    col: 'text-green-500' },
                      { label: 'Failed',    v: c.stats.failed,    p: null,  col: 'text-red-400' },
                    ].map(s => (
                      <div key={s.label} className="bg-[var(--bg-primary)] rounded-xl p-2.5 text-center">
                        <p className={`text-lg font-bold ${s.col}`}>{s.v}</p>
                        {s.p !== null && <p className={`text-[10px] font-semibold ${s.col}`}>{s.p}%</p>}
                        <p className={`text-[10px] ${tk.tm}`}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={showCreate} onOpenChange={v => { if (!v) closeCreate(); else setShowCreate(true); }}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New WhatsApp Campaign</DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-0 my-1">
            {['Audience', 'Message', 'Schedule'].map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1.5 ${i + 1 <= step ? 'text-[var(--accent)]' : tk.tm}`}>
                  <div className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center border-2 transition-all ${
                    i + 1 < step  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : i + 1 === step ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-[var(--border-color)] text-[var(--text-muted)]'
                  }`}>
                    {i + 1 < step ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className="text-xs font-medium hidden sm:block">{s}</span>
                </div>
                {i < 2 && <div className={`flex-1 h-px mx-2 transition-colors ${i + 1 < step ? 'bg-[var(--accent)]' : 'bg-[var(--border-color)]'}`} />}
              </React.Fragment>
            ))}
          </div>

          <div className="space-y-4 py-2">
            {/* Step 1 */}
            {step === 1 && (
              <>
                <div>
                  <Label className={`${tk.t2} text-xs mb-1.5 block`}>Campaign Name</Label>
                  <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali Special Offer"
                    value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className={`${tk.t2} text-xs`}>Who do you want to reach?</Label>
                    {audienceCount > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">
                        ~{audienceCount} contacts
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {AUDIENCE_OPTS.map(opt => (
                      <div key={opt.key}>
                        <button onClick={() => setForm(p => ({ ...p, audience: opt.key, role_id: '' }))}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                            form.audience === opt.key
                              ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                              : `border-[var(--border-color)] ${tk.hov}`
                          }`}>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            form.audience === opt.key ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                          }`}>
                            {form.audience === opt.key && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${tk.t1}`}>{opt.label}</p>
                            <p className={`text-[11px] ${tk.tm}`}>{opt.desc}</p>
                          </div>
                        </button>
                        {/* Role sub-selector */}
                        {opt.key === 'role' && form.audience === 'role' && roles.length > 0 && (
                          <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                            {roles.map(r => {
                              const cnt = contacts.filter(c => c.contact_role_id === r.role_id).length;
                              if (cnt === 0) return null;
                              return (
                                <button key={r.role_id}
                                  onClick={() => setForm(p => ({ ...p, role_id: r.role_id }))}
                                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                                    form.role_id === r.role_id
                                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                                      : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                  }`}>
                                  {r.name}
                                  <span className={`font-bold text-[10px] ${form.role_id === r.role_id ? 'text-white/80' : tk.tm}`}>
                                    {cnt}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1 block`}>WhatsApp Template</Label>
                <p className={`text-[11px] ${tk.tm} mb-3`}>Only Meta-approved templates can be used for bulk campaigns</p>
                <div className="space-y-2">
                  {MOCK_TEMPLATES.filter(t => t.status === 'APPROVED').map(t => (
                    <button key={t.name} onClick={() => setForm(p => ({ ...p, template: t.name }))}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                        form.template === t.name
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : `border-[var(--border-color)] ${tk.hov}`
                      }`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        form.template === t.name ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                      }`}>
                        {form.template === t.name && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${tk.t1} font-mono`}>{t.name}</p>
                        <p className={`text-[11px] ${tk.tm}`}>{t.category} · {t.lang}</p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 font-medium">APPROVED</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <>
                <div>
                  <Label className={`${tk.t2} text-xs mb-2 block`}>When to send?</Label>
                  <div className="space-y-2">
                    {[
                      { key: 'draft',    label: 'Save as Draft',      desc: 'Launch manually when ready' },
                      { key: 'schedule', label: 'Schedule for Later',  desc: 'Pick a specific date and time' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => setForm(p => ({ ...p, schedule: opt.key }))}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                          form.schedule === opt.key
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          form.schedule === opt.key ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                        }`}>
                          {form.schedule === opt.key && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${tk.t1}`}>{opt.label}</p>
                          <p className={`text-[11px] ${tk.tm}`}>{opt.desc}</p>
                        </div>
                      </button>
                    ))}
                    {form.schedule === 'schedule' && (
                      <Input type="datetime-local" className={`h-10 ${tk.inp}`}
                        value={form.schedule_at} onChange={e => setForm(p => ({ ...p, schedule_at: e.target.value }))} />
                    )}
                  </div>
                </div>

                {/* Review */}
                <div className="bg-[var(--bg-primary)] rounded-xl p-3.5 space-y-2">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${tk.tm} mb-2`}>Review</p>
                  {[
                    { label: 'Campaign',  value: form.name || 'Untitled' },
                    { label: 'Audience',  value: `${AUDIENCE_OPTS.find(a => a.key === form.audience)?.label || form.audience}${form.audience === 'role' && form.role_id ? ` — ${roles.find(r => r.role_id === form.role_id)?.name || ''}` : ''} (~${audienceCount})` },
                    { label: 'Template',  value: form.template || 'Not selected' },
                    { label: 'Schedule',  value: form.schedule === 'draft' ? 'Save as Draft' : (form.schedule_at || 'Not set') },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className={`text-xs ${tk.tm}`}>{r.label}</span>
                      <span className={`text-xs font-medium ${tk.t2}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={step > 1 ? () => setStep(s => s - 1) : closeCreate}>
              {step > 1 ? 'Back' : 'Cancel'}
            </Button>
            {step < 3
              ? <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                  onClick={() => setStep(s => s + 1)}>Continue</Button>
              : <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                  onClick={createCampaign}>Create Campaign</Button>
            }
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 3 — Greetings
// ══════════════════════════════════════════════════════════════════════════════
function GreetingsTab({ tk, greetings, setGreetings }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'festival', date: '', template: '' });

  function toggle(id) {
    setGreetings(prev => prev.map(g => g.id === id ? { ...g, active: !g.active } : g));
  }

  function create() {
    setGreetings(prev => [...prev, {
      id: Date.now().toString(), ...form,
      active: true, sent_total: 0, next: form.date || 'Daily',
    }]);
    setShowCreate(false);
    setForm({ name: '', type: 'festival', date: '', template: '' });
    toast.success('Greeting rule created');
  }

  const upcomingFestivals = greetings.filter(g => g.active && g.type === 'festival').slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Upcoming strip */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className={`h-4 w-4 ${tk.tm}`} />
          <span className={`text-sm font-semibold ${tk.t1}`}>Upcoming Auto-Greetings</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {upcomingFestivals.map(g => (
            <div key={g.id} className="bg-[var(--bg-primary)] rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-400/20 flex items-center justify-center flex-shrink-0">
                <Calendar className="h-5 w-5 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${tk.t1} truncate`}>{g.name}</p>
                <p className={`text-[11px] ${tk.tm}`}>{g.next}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rules list */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Greeting Rules</h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>{greetings.filter(g => g.active).length} active · {greetings.filter(g => !g.active).length} paused</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> Add Rule
        </Button>
      </div>

      <div className={`${tk.card} border ${tk.bdr} rounded-xl divide-y divide-[var(--border-color)]`}>
        {greetings.map(g => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-3.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              g.type === 'birthday' ? 'bg-pink-500/15' : 'bg-amber-500/15'
            }`}>
              {g.type === 'birthday'
                ? <Star className="h-4 w-4 text-pink-500" />
                : <Gift className="h-4 w-4 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-sm font-medium ${tk.t1} truncate`}>{g.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  g.type === 'birthday' ? 'bg-pink-500/10 text-pink-500' : 'bg-amber-500/10 text-amber-600'
                }`}>{g.type}</span>
              </div>
              <p className={`text-[11px] ${tk.tm} mt-0.5`}>
                Template: <span className="font-mono">{g.template}</span>
                {g.date && ` · ${g.date}`}
                {g.sent_total > 0 && ` · Sent to ${g.sent_total}`}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:block ${
                g.active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'
              }`}>
                {g.active ? 'Active' : 'Paused'}
              </span>
              <Switch checked={g.active} onCheckedChange={() => toggle(g.id)} />
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Greeting Rule</DialogTitle>
            <DialogDescription className={tk.tm}>Auto-send greetings on special occasions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Rule Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali Greetings"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Type</Label>
              <div className="flex gap-2">
                {[{ k: 'festival', l: 'Festival / Event' }, { k: 'birthday', l: 'Birthday' }].map(t => (
                  <button key={t.k} onClick={() => setForm(p => ({ ...p, type: t.k }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border-2 transition-colors ${
                      form.type === t.k ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                    }`}>
                    {t.l}
                  </button>
                ))}
              </div>
            </div>
            {form.type === 'festival' && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Festival Date (e.g. 10-20 for Oct 20)</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="MM-DD"
                  value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
            )}
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>WhatsApp Template Name</Label>
              <Input className={`h-10 ${tk.inp} font-mono`} placeholder="e.g. diwali_wish_2026"
                value={form.template} onChange={e => setForm(p => ({ ...p, template: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>Must be an APPROVED template in Meta Business Manager</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create}>Create Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 4 — Drip Sequences
// ══════════════════════════════════════════════════════════════════════════════
function DripsTab({ tk, drips, setDrips }) {
  const [expanded, setExpanded] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', trigger: 'lead_created', steps: [{ label: '', delay: 'Immediately' }] });

  function toggle(id) { setDrips(prev => prev.map(d => d.id === id ? { ...d, active: !d.active } : d)); }

  function addStep() {
    setForm(p => ({ ...p, steps: [...p.steps, { label: '', delay: `Day ${p.steps.length + 1}` }] }));
  }

  function removeStep(i) {
    setForm(p => ({ ...p, steps: p.steps.filter((_, ii) => ii !== i) }));
  }

  function create() {
    setDrips(prev => [{
      id: Date.now().toString(),
      name: form.name || 'Untitled Sequence',
      trigger: { lead_created: 'Lead Created', quotation_sent: 'Quotation Sent', manual: 'Manual' }[form.trigger],
      steps: form.steps.map((s, i) => ({ n: i + 1, delay: s.delay, label: s.label || `Step ${i + 1}` })),
      enrolled: 0, completed: 0, active: true,
    }, ...prev]);
    setShowCreate(false);
    setForm({ name: '', trigger: 'lead_created', steps: [{ label: '', delay: 'Immediately' }] });
    toast.success('Drip sequence created');
  }

  const TRIGGERS = [
    { k: 'lead_created',   l: 'Lead Created',    d: 'Auto-enroll every new lead' },
    { k: 'quotation_sent', l: 'Quotation Sent',   d: 'Follow up after sending a quote' },
    { k: 'manual',         l: 'Manual Only',      d: 'Enroll contacts manually' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Drip Sequences</h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Automated message series triggered by lead actions</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Sequence
        </Button>
      </div>

      <div className="space-y-3">
        {drips.map(d => (
          <div key={d.id} className={`${tk.card} border ${tk.bdr} rounded-xl overflow-hidden`}>
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                <Zap className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold ${tk.t1} truncate`}>{d.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    d.active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'
                  }`}>{d.active ? 'Active' : 'Paused'}</span>
                </div>
                <p className={`text-xs ${tk.tm} mt-0.5`}>
                  {d.steps.length} steps · Trigger: {d.trigger}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right hidden sm:block">
                  <p className={`text-xs font-semibold ${tk.t1}`}>{d.enrolled}</p>
                  <p className={`text-[10px] ${tk.tm}`}>enrolled</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className={`text-xs font-semibold ${tk.t1}`}>{d.completed}</p>
                  <p className={`text-[10px] ${tk.tm}`}>done</p>
                </div>
                <Switch checked={d.active} onCheckedChange={() => toggle(d.id)} />
                <button onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`}>
                  <ChevronDown className={`h-4 w-4 ${tk.tm} transition-transform duration-200 ${expanded === d.id ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {expanded === d.id && (
              <div className={`border-t ${tk.bdr} bg-[var(--bg-primary)] px-4 py-4`}>
                <div className="space-y-0">
                  {d.steps.map((s, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-7 h-7 rounded-full bg-[var(--accent)]/15 border-2 border-[var(--accent)]/30 flex items-center justify-center flex-shrink-0 z-10">
                          <span className="text-[10px] font-bold text-[var(--accent)]">{s.n}</span>
                        </div>
                        {i < d.steps.length - 1 && (
                          <div className="w-px flex-1 bg-[var(--border-color)] my-0.5" style={{ minHeight: 16 }} />
                        )}
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${tk.t1}`}>{s.label}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]`}>{s.delay}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Drip Sequence</DialogTitle>
            <DialogDescription className={tk.tm}>Build an automated message series triggered by lead activity</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto py-1 pr-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Sequence Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. New Lead Welcome Series"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-2 block`}>Trigger</Label>
              <div className="space-y-2">
                {TRIGGERS.map(t => (
                  <button key={t.k} onClick={() => setForm(p => ({ ...p, trigger: t.k }))}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border-2 text-left transition-colors ${
                      form.trigger === t.k ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                    }`}>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      form.trigger === t.k ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                    }`}>
                      {form.trigger === t.k && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${tk.t1}`}>{t.l}</p>
                      <p className={`text-[11px] ${tk.tm}`}>{t.d}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className={`${tk.t2} text-xs`}>Steps ({form.steps.length})</Label>
                <button onClick={addStep} className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add step
                </button>
              </div>
              <div className="space-y-2">
                {form.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-[var(--accent)]">{i + 1}</span>
                    </div>
                    <Input className={`h-8 flex-1 text-xs ${tk.inp}`} placeholder="Message description"
                      value={s.label}
                      onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, label: e.target.value } : ss) }))} />
                    <Input className={`h-8 w-24 text-xs ${tk.inp}`} placeholder="Delay"
                      value={s.delay}
                      onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, delay: e.target.value } : ss) }))} />
                    {i > 0 && (
                      <button onClick={() => removeStep(i)}
                        className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create}>Create Sequence</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 5 — WhatsApp Setup
// ══════════════════════════════════════════════════════════════════════════════
function WhatsAppSetupTab({ tk, waConnected, setWaConnected }) {
  const [form, setForm] = useState({ phone_id: '', token: '', verify_token: '' });
  const [saving, setSaving] = useState(false);
  const WEBHOOK = 'https://app.smartshape.in/api/whatsapp/webhook';

  async function connect() {
    if (!form.phone_id || !form.token) { toast.error('Phone Number ID and Access Token are required'); return; }
    setSaving(true);
    await new Promise(r => setTimeout(r, 1200));
    setWaConnected(true);
    setSaving(false);
    toast.success('WhatsApp connected! (Backend integration pending)');
  }

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Credentials form */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4 space-y-4`}>
          <div className="flex items-center gap-2">
            <Key className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>API Credentials</h3>
          </div>
          <div>
            <Label className={`${tk.t2} text-xs mb-1.5 block`}>Phone Number ID</Label>
            <Input className={`h-10 ${tk.inp}`} placeholder="From Meta Business Manager"
              value={form.phone_id} onChange={e => setForm(p => ({ ...p, phone_id: e.target.value }))} />
            <p className={`text-[11px] ${tk.tm} mt-1`}>WhatsApp → API Setup → Phone Number ID</p>
          </div>
          <div>
            <Label className={`${tk.t2} text-xs mb-1.5 block`}>Access Token</Label>
            <Input type="password" className={`h-10 ${tk.inp}`} placeholder="Meta system user access token"
              value={form.token} onChange={e => setForm(p => ({ ...p, token: e.target.value }))} />
            <p className={`text-[11px] ${tk.tm} mt-1`}>Create a system user in Meta Business Manager → Tokens</p>
          </div>
          <div>
            <Label className={`${tk.t2} text-xs mb-1.5 block`}>Webhook Verify Token</Label>
            <Input className={`h-10 ${tk.inp}`} placeholder="Any secret string you choose"
              value={form.verify_token} onChange={e => setForm(p => ({ ...p, verify_token: e.target.value }))} />
            <p className={`text-[11px] ${tk.tm} mt-1`}>Paste the same string in Meta Webhook verification</p>
          </div>
          <Button className="w-full h-10 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
            onClick={connect} disabled={saving}>
            {saving ? 'Connecting...' : waConnected ? 'Update Credentials' : 'Connect WhatsApp'}
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
      </div>

      {/* Templates list */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
          <div className="flex items-center gap-2">
            <MessageSquare className={`h-4 w-4 ${tk.tm}`} />
            <span className={`text-sm font-semibold ${tk.t1}`}>Message Templates</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 font-medium">
              {MOCK_TEMPLATES.filter(t => t.status === 'APPROVED').length} approved
            </span>
          </div>
          <Button size="sm" variant="outline" className={`h-7 gap-1 text-xs border-[var(--border-color)] ${tk.t2}`}
            onClick={() => toast.info('Sync requires WABA connection')}>
            <RefreshCw className="h-3 w-3" /> Sync from Meta
          </Button>
        </div>
        <div className={`divide-y divide-[var(--border-color)]`}>
          {MOCK_TEMPLATES.map(t => (
            <div key={t.name} className="flex items-center gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="h-3.5 w-3.5 text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${tk.t1} font-mono`}>{t.name}</p>
                <p className={`text-[11px] ${tk.tm}`}>{t.category} · {t.lang}</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                t.status === 'APPROVED' ? 'bg-green-500/15 text-green-500'
                : t.status === 'PENDING' ? 'bg-yellow-500/15 text-yellow-600'
                : 'bg-red-500/15 text-red-400'
              }`}>{t.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { key: 'overview',   label: 'Overview',   Icon: BarChart2 },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone },
  { key: 'greetings',  label: 'Greetings',  Icon: Gift },
  { key: 'drips',      label: 'Drip',       Icon: Zap },
  { key: 'setup',      label: 'WhatsApp',   Icon: Smartphone },
];

export default function MarketingHub() {
  const { isDark } = useTheme();
  const tk = useTk(isDark);

  const [tab, setTab] = useState('overview');
  const [waConnected, setWaConnected] = useState(false);
  const [campaigns, setCampaigns] = useState(INIT_CAMPAIGNS);
  const [greetings, setGreetings] = useState(INIT_GREETINGS);
  const [drips, setDrips] = useState(INIT_DRIPS);
  const [roles, setRoles] = useState([]);
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
  }, []);

  return (
    <AdminLayout>
      <div className={`min-h-screen ${tk.page}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

          {/* Header */}
          <div className="flex items-start sm:items-center justify-between gap-3 mb-6">
            <div>
              <h1 className={`text-xl font-bold ${tk.t1}`}>Marketing & WhatsApp</h1>
              <p className={`text-sm ${tk.tm} mt-0.5`}>Campaigns, auto-greetings, and lead nurturing</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium flex-shrink-0 ${
              waConnected ? 'bg-green-500/15 text-green-500' : 'bg-yellow-500/15 text-yellow-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${waConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
              {waConnected ? 'WhatsApp Connected' : 'Setup Required'}
            </span>
          </div>

          {/* Tab bar */}
          <div className={`flex items-center gap-0.5 p-1 ${tk.card} border ${tk.bdr} rounded-xl mb-6 overflow-x-auto no-scrollbar`}>
            {TABS.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  tab === key
                    ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                    : `${tk.tm} ${tk.hov} hover:text-[var(--text-secondary)]`
                }`}>
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden sm:block">{label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          {tab === 'overview'  && <OverviewTab  tk={tk} campaigns={campaigns} greetings={greetings} drips={drips} waConnected={waConnected} setTab={setTab} />}
          {tab === 'campaigns' && <CampaignsTab tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} />}
          {tab === 'greetings' && <GreetingsTab tk={tk} greetings={greetings} setGreetings={setGreetings} />}
          {tab === 'drips'     && <DripsTab     tk={tk} drips={drips} setDrips={setDrips} />}
          {tab === 'setup'     && <WhatsAppSetupTab tk={tk} waConnected={waConnected} setWaConnected={setWaConnected} />}
        </div>
      </div>
    </AdminLayout>
  );
}
