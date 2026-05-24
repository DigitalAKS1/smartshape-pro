import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useTheme } from '../../contexts/ThemeContext';
import { contactRoles as contactRolesApi, contacts as contactsApi, dripSequences as dripApi, greetingRules as greetingsApi, whatsApp as waApi, demo as demoApi } from '../../lib/api';
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
  Flag, BookOpen, Heart, School, Cake, FileText,
  PieChart, Target, Inbox, X,
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

// ── Campaign API → display format ─────────────────────────────────────────────
function mapCampaign(c) {
  return {
    id: c.campaign_id,
    campaign_id: c.campaign_id,
    name: c.name,
    status: c.status || 'draft',
    audience_label: c.audience_label || 'All Contacts',
    audience_count: c.audience_count || 0,
    template_id: c.template_id || null,
    message: c.message || '',
    audience_filter: c.audience_filter || {},
    stats: {
      sent: c.sent_count || 0,
      delivered: c.delivered_count || 0,
      read: 0,
      failed: c.failed_count || 0,
    },
    created_at: c.created_at
      ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    scheduled_at: c.scheduled_at || null,
  };
}


// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CHIP = {
  completed: 'bg-green-500/15 text-green-500',
  scheduled: 'bg-blue-500/15 text-blue-500',
  running:   'bg-yellow-500/15 text-yellow-600',
  draft:     'bg-gray-500/15 text-gray-400',
  paused:    'bg-orange-500/15 text-orange-400',
};

function pct(num, den) { return den > 0 ? Math.round((num / den) * 100) : null; }

// ── Greeting rule helpers ─────────────────────────────────────────────────────
function computeNext(mmdd) {
  if (!mmdd) return null;
  const [mm, dd] = mmdd.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisYear = new Date(today.getFullYear(), mm - 1, dd);
  const target = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, mm - 1, dd);
  return target.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysTillNext(mmdd) {
  if (!mmdd) return Infinity;
  const [mm, dd] = mmdd.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisYear = new Date(today.getFullYear(), mm - 1, dd);
  const target = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, mm - 1, dd);
  return Math.round((target - today) / 86400000);
}
function mapRule(r) {
  const days = r.fixed_date ? daysTillNext(r.fixed_date) : Infinity;
  const nextLabel = r.trigger === 'birthday' ? 'Daily (each birthday)'
    : r.trigger === 'anniversary' ? 'On school anniversary'
    : days === 0 ? 'Today!' : days === 1 ? 'Tomorrow'
    : days <= 30 ? `In ${days} days` : computeNext(r.fixed_date);
  return {
    id: r.rule_id, rule_id: r.rule_id, name: r.name,
    type: r.type, category: r.category || 'Festival',
    date: r.fixed_date, trigger: r.trigger,
    active: r.is_active, audience: r.audience || 'all_contacts',
    template_body: r.template_body || '',
    sent_total: r.sent_total || 0, sent_this_year: r.sent_this_year || 0,
    is_date_fixed: r.is_date_fixed, days_till: days, next: nextLabel,
  };
}

const CAT_META = {
  National: { col: 'text-orange-500', bg: 'bg-orange-500/15', Icon: Flag },
  Festival:  { col: 'text-amber-500',  bg: 'bg-amber-500/15',  Icon: Gift },
  School:    { col: 'text-blue-500',   bg: 'bg-blue-500/15',   Icon: BookOpen },
  Global:    { col: 'text-green-500',  bg: 'bg-green-500/15',  Icon: Globe },
  Personal:  { col: 'text-pink-500',   bg: 'bg-pink-500/15',   Icon: Heart },
};
function catMeta(cat) { return CAT_META[cat] || CAT_META.Festival; }

// ── API → display shape mapper ────────────────────────────────────────────────
const TRIGGER_LABELS = { lead_created: 'Lead Created', quotation_sent: 'Quotation Sent', manual: 'Manual' };

function mapSeq(s) {
  const tLabel = TRIGGER_LABELS[s.trigger] || s.trigger;
  const fLabel = s.filter_designation ? ` · ${s.filter_designation}` : '';
  return {
    id: s.sequence_id,
    name: s.name,
    description: s.description || '',
    trigger: `${tLabel}${fLabel}`,
    filter_designation: s.filter_designation || '',
    sequence_id: s.sequence_id,
    steps: (s.steps || []).map(st => ({
      n: st.step_number,
      delay: st.delay_days === 0 ? 'Immediately' : `Day ${st.delay_days}`,
      label: st.message_template
        ? st.message_template.substring(0, 80) + (st.message_template.length > 80 ? '…' : '')
        : `Step ${st.step_number}`,
      delay_days: st.delay_days,
      message_template: st.message_template,
      message_type: st.message_type,
    })),
    enrolled: s.enrollment_count || 0,
    completed: s.completed_count || 0,
    active: s.is_active,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Overview
// ══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ tk, campaigns, greetings, drips, waConnected, setTab, analytics, loadDemo, clearDemo }) {
  const [demoLoading, setDemoLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const hasDemo = campaigns.some(c => c.name?.includes('[DEMO]'));

  async function handleLoadDemo() {
    setDemoLoading(true);
    try { await loadDemo(); } finally { setDemoLoading(false); }
  }
  async function handleClearDemo() {
    setClearLoading(true);
    try { await clearDemo(); } finally { setClearLoading(false); }
  }

  const msgSent      = analytics?.messages?.sent  ?? campaigns.filter(c => c.status === 'completed').reduce((s, c) => s + c.stats.sent, 0);
  const msgPending   = analytics?.messages?.pending ?? 0;
  const dripActive   = analytics?.drips?.active   ?? drips.filter(d => d.active).length;
  const greetSent    = analytics?.greetings?.total_sent ?? 0;

  const kpis = [
    { label: 'Campaigns',         value: campaigns.length,                                       icon: Megaphone,  col: 'text-purple-500',  bg: 'bg-purple-500/10' },
    { label: 'Messages Sent',     value: msgSent ? msgSent.toLocaleString('en-IN') : '—',        icon: Send,       col: 'text-blue-500',    bg: 'bg-blue-500/10' },
    { label: 'Messages Pending',  value: msgPending || '—',                                      icon: Inbox,      col: 'text-orange-500',  bg: 'bg-orange-500/10' },
    { label: 'Active Drips',      value: dripActive,                                             icon: Zap,        col: 'text-yellow-500',  bg: 'bg-yellow-500/10' },
    { label: 'Greetings Sent',    value: greetSent ? greetSent.toLocaleString('en-IN') : greetings.filter(g => g.active).length + ' active', icon: Gift, col: 'text-pink-500', bg: 'bg-pink-500/10' },
    { label: 'WhatsApp',          value: waConnected ? 'Connected' : 'Not Set Up',               icon: waConnected ? Wifi : WifiOff, col: waConnected ? 'text-green-500' : 'text-red-500', bg: waConnected ? 'bg-green-500/10' : 'bg-red-500/10' },
  ];

  return (
    <div className="space-y-5">

      {/* ── Demo banner ────────────────────────────────────────────────────── */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
            <Zap className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tk.t1}`}>Try the Demo</p>
            <p className={`text-xs ${tk.tm} mt-0.5 leading-relaxed`}>
              Load 5 sample school contacts (Ramesh · Priya · Rajesh · Anita · Suresh), 3 campaigns
              (Diwali completed · New Year queued · Year-End draft), drip enrollments &amp; greeting logs —
              to see every tab populated with realistic data.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasDemo && (
              <Button size="sm" variant="outline"
                className={`h-8 gap-1 text-xs border-red-400/40 text-red-400 hover:bg-red-400/10`}
                disabled={clearLoading} onClick={handleClearDemo}>
                {clearLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Clear Demo
              </Button>
            )}
            <Button size="sm"
              className="h-8 gap-1 text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              disabled={demoLoading} onClick={handleLoadDemo}>
              {demoLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {hasDemo ? 'Re-seed Demo' : 'Load Demo Data'}
            </Button>
          </div>
        </div>

        {/* Step-by-step story */}
        {hasDemo && (
          <div className={`mt-4 pt-4 border-t ${tk.bdr}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${tk.tm} mb-3`}>Demo Story — What was seeded</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                {
                  step: '1. Contacts added',
                  detail: '5 school personas: Ramesh (Principal, DPS), Priya (Teacher, St. Mary\'s), Rajesh (Purchase, Navyug), Anita (Principal, Ryan), Suresh (Teacher, DAV)',
                  col: 'text-blue-500', bg: 'bg-blue-500/10',
                },
                {
                  step: '2. Campaigns created',
                  detail: 'Diwali Offer (completed, 5 sent) · New Academic Year (queued, 2 pending to principals) · Year End Clearance (draft — click Launch to send!)',
                  col: 'text-purple-500', bg: 'bg-purple-500/10',
                },
                {
                  step: '3. Drip sequence flow',
                  detail: 'Ramesh got Day-0 intro + Day-3 catalogue (sent). Day-7 offer is PENDING. Priya got Day-0 intro (sent). Day-3 showcase is PENDING.',
                  col: 'text-yellow-500', bg: 'bg-yellow-500/10',
                },
                {
                  step: '4. Auto-greetings sent',
                  detail: 'Teachers\' Day sent to Ramesh & Priya (Sep 5, 2025). New Year sent to Ramesh, Anita & Suresh (Jan 1, 2026). Check Analytics tab!',
                  col: 'text-pink-500', bg: 'bg-pink-500/10',
                },
              ].map(s => (
                <div key={s.step} className={`${s.bg} rounded-xl p-3`}>
                  <p className={`text-[11px] font-bold ${s.col} mb-1`}>{s.step}</p>
                  <p className={`text-[10px] ${tk.tm} leading-relaxed`}>{s.detail}</p>
                </div>
              ))}
            </div>
            <div className={`mt-3 flex flex-wrap gap-2`}>
              {[
                { label: '→ Campaigns tab', tab: 'campaigns', hint: 'See 3 campaigns · Launch the draft!' },
                { label: '→ Analytics tab', tab: 'analytics', hint: 'See message breakdown chart' },
                { label: '→ Templates tab', tab: 'templates', hint: 'Browse 15 expert templates' },
                { label: '→ Greetings tab', tab: 'greetings', hint: 'See 54 rules · toggle active' },
              ].map(l => (
                <button key={l.tab} onClick={() => setTab(l.tab)}
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border ${tk.bdr} ${tk.hov} ${tk.t2} transition-colors`}>
                  <span>{l.label}</span>
                  <span className={`${tk.tm}`}>— {l.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

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
const TMPL_CAT_LABELS = { intro: 'Intro', catalogue: 'Catalogue', offer: 'Offer', followup: 'Follow-up', reengagement: 'Re-engagement', seasonal: 'Seasonal' };

function CampaignsTab({ tk, campaigns, setCampaigns, roles, contacts, templates }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewTmpl, setPreviewTmpl] = useState(null);
  const [form, setForm] = useState({ name: '', audience: 'all', role_id: '', template_id: '', message: '', schedule: 'draft', schedule_at: '' });

  const audienceCount = (() => {
    if (form.audience === 'all') return contacts.length;
    if (form.audience === 'role' && form.role_id) {
      const rName = (roles.find(r => r.role_id === form.role_id)?.name || '').toLowerCase();
      return contacts.filter(c =>
        c.contact_role_id === form.role_id ||
        (rName && (c.designation || '').toLowerCase() === rName)
      ).length;
    }
    return 0;
  })();

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'scheduled', label: 'Scheduled', count: campaigns.filter(c => c.status === 'scheduled').length },
    { key: 'queued',    label: 'Queued',    count: campaigns.filter(c => c.status === 'queued').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  function closeCreate() {
    setShowCreate(false); setStep(1);
    setForm({ name: '', audience: 'all', role_id: '', template_id: '', message: '', schedule: 'draft', schedule_at: '' });
  }

  function pickTemplate(tmpl) {
    setForm(p => ({ ...p, template_id: tmpl.template_id, message: tmpl.body }));
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return; }
    setSaving(true);
    try {
      const roleLabel = form.audience === 'role' && form.role_id
        ? roles.find(r => r.role_id === form.role_id)?.name || 'By Role'
        : 'All Contacts';
      const audience_filter = form.audience === 'role' && form.role_id
        ? { roles: [roles.find(r => r.role_id === form.role_id)?.name].filter(Boolean) }
        : {};
      const payload = {
        name: form.name.trim(),
        template_id: form.template_id || null,
        message: form.message.trim(),
        audience_filter,
        audience_label: roleLabel,
        scheduled_at: form.schedule === 'schedule' ? form.schedule_at : null,
      };
      const res = await waApi.createCampaign(payload);
      setCampaigns(prev => [mapCampaign(res.data), ...prev]);
      closeCreate();
      toast.success('Campaign created as draft');
    } catch { toast.error('Failed to create campaign'); }
    finally { setSaving(false); }
  }

  async function launch(camp) {
    setLaunching(camp.id);
    try {
      const res = await waApi.launchCampaign(camp.campaign_id);
      const { queued, status } = res.data;
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status, stats: { ...c.stats, sent: queued } } : c));
      toast.success(`${queued} messages queued for ${camp.name}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to launch campaign');
    } finally { setLaunching(null); }
  }

  const AUDIENCE_OPTS = [
    { key: 'all',  label: 'All Contacts',   desc: `${contacts.length} contacts in your database` },
    { key: 'role', label: 'By Designation', desc: 'Principal, Teacher, Purchase Head, etc.' },
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
                      <Button size="sm" variant="outline"
                        className={`h-7 gap-1 text-xs border-green-500/40 text-green-600 hover:bg-green-500/10`}
                        disabled={launching === c.id}
                        onClick={() => launch(c)}>
                        {launching === c.id
                          ? <RefreshCw className="h-3 w-3 animate-spin" />
                          : <Play className="h-3 w-3" />}
                        {launching === c.id ? 'Launching…' : 'Launch'}
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
                              const rLow = r.name.toLowerCase();
                              const cnt = contacts.filter(c =>
                                c.contact_role_id === r.role_id ||
                                (c.designation || '').toLowerCase() === rLow
                              ).length;
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

            {/* Step 2 — Template selection */}
            {step === 2 && (
              <div className="space-y-3">
                <div>
                  <Label className={`${tk.t2} text-xs mb-1 block`}>Select a Template</Label>
                  <p className={`text-[11px] ${tk.tm} mb-2`}>Pick a SmartShape message template or write your own below</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {templates.filter(t => t.is_active).map(t => (
                      <button key={t.template_id} onClick={() => pickTemplate(t)}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                          form.template_id === t.template_id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          form.template_id === t.template_id ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                        }`}>
                          {form.template_id === t.template_id && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-semibold ${tk.t1}`}>{t.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium capitalize`}>
                              {TMPL_CAT_LABELS[t.category] || t.category}
                            </span>
                          </div>
                          <p className={`text-[11px] ${tk.tm} mt-0.5 line-clamp-2`}>{t.body}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className={`${tk.t2} text-xs mb-1 block`}>
                    Message Preview / Edit
                    <span className={`${tk.tm} font-normal ml-1`}>(personalise before sending)</span>
                  </Label>
                  <textarea rows={5} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                    placeholder="Write your message… Use {name} and {school_name} as variables."
                    value={form.message}
                    onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
                  <p className={`text-[11px] ${tk.tm} mt-0.5`}>{form.message.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> + <span className="font-mono text-[var(--accent)]">{'{school_name}'}</span> are auto-filled</p>
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
                    { label: 'Template',  value: form.template_id ? (templates.find(t => t.template_id === form.template_id)?.name || 'Custom') : (form.message ? 'Custom message' : 'Not selected') },
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
                  disabled={saving} onClick={createCampaign}>
                  {saving ? 'Saving…' : 'Create Campaign'}
                </Button>
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
const GREET_CATS = ['All', 'National', 'Festival', 'School', 'Global', 'Personal'];
const GREET_AUDIENCES = [
  { k: 'all_contacts',   l: 'All Contacts' },
  { k: 'role:Teacher',   l: 'Teachers Only' },
  { k: 'role:Principal', l: 'Principals Only' },
  { k: 'birthday_person', l: 'Birthday Person' },
];
const BLANK_GREET = { name: '', type: 'festival', category: 'Festival', trigger: 'fixed_date', fixed_date: '', audience: 'all_contacts', template_body: '' };

function GreetingsTab({ tk, greetings, setGreetings }) {
  const [filterCat, setFilterCat] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_GREET);
  const [saving, setSaving] = useState(false);

  async function toggle(g) {
    try {
      await greetingsApi.update(g.rule_id, { is_active: !g.active });
      setGreetings(prev => prev.map(x => x.id === g.id ? { ...x, active: !x.active } : x));
    } catch { toast.error('Failed to update rule'); }
  }

  async function create() {
    if (!form.name.trim()) { toast.error('Rule name is required'); return; }
    if (form.trigger === 'fixed_date' && !form.fixed_date.trim()) { toast.error('Date (MM-DD) is required'); return; }
    if (!form.template_body.trim()) { toast.error('Message template is required'); return; }
    setSaving(true);
    try {
      const res = await greetingsApi.create({ ...form, is_active: true });
      setGreetings(prev => [mapRule(res.data), ...prev]);
      setShowCreate(false);
      setForm(BLANK_GREET);
      toast.success('Greeting rule created');
    } catch { toast.error('Failed to create rule'); }
    finally { setSaving(false); }
  }

  const upcoming = [...greetings]
    .filter(g => g.active && g.trigger === 'fixed_date' && g.days_till < 60)
    .sort((a, b) => a.days_till - b.days_till)
    .slice(0, 4);

  const filtered = filterCat === 'All' ? greetings
    : greetings.filter(g => g.category === filterCat);

  return (
    <div className="space-y-4">

      {/* ── Upcoming strip ─────────────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className={`h-4 w-4 ${tk.tm}`} />
            <span className={`text-sm font-semibold ${tk.t1}`}>Upcoming Auto-Greetings</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-medium">{upcoming.length} soon</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {upcoming.map(g => {
              const m = catMeta(g.category);
              const Icon = m.Icon;
              const urgent = g.days_till <= 3;
              return (
                <div key={g.id} className={`bg-[var(--bg-primary)] rounded-xl p-3 ${urgent ? 'ring-1 ring-[var(--accent)]/40' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg ${m.bg} flex items-center justify-center mb-2`}>
                    <Icon className={`h-4 w-4 ${m.col}`} />
                  </div>
                  <p className={`text-xs font-semibold ${tk.t1} leading-tight mb-0.5`}>{g.name}</p>
                  <p className={`text-[10px] font-medium ${urgent ? 'text-[var(--accent)]' : tk.tm}`}>{g.next}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Header + category filter ──────────────────────────────────────── */}
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Greeting Rules
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>
              {greetings.filter(g => g.active).length} active · {greetings.filter(g => !g.active).length} paused
            </span>
          </h3>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> Add Rule
        </Button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {GREET_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c
                ? 'bg-[var(--accent)] text-white'
                : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {c}
          </button>
        ))}
      </div>

      {/* ── Rules list ───────────────────────────────────────────────────── */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl divide-y divide-[var(--border-color)]`}>
        {filtered.length === 0 && (
          <div className={`px-4 py-8 text-center text-sm ${tk.tm}`}>No rules in this category</div>
        )}
        {filtered.map(g => {
          const m = catMeta(g.category);
          const Icon = m.Icon;
          return (
            <div key={g.id} className="flex items-center gap-3 px-4 py-3.5">
              <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${m.col}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={`text-sm font-semibold ${tk.t1}`}>{g.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium`}>{g.category}</span>
                  {!g.is_date_fixed && g.trigger === 'fixed_date' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 font-medium">Date varies</span>
                  )}
                </div>
                <div className={`text-[11px] ${tk.tm} mt-0.5 flex items-center gap-2 flex-wrap`}>
                  <span>{g.next}</span>
                  {g.sent_total > 0 && <span>· {g.sent_total.toLocaleString('en-IN')} sent total</span>}
                  {g.sent_this_year > 0 && <span className="text-green-500">· {g.sent_this_year} this year</span>}
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:block ${
                  g.active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'
                }`}>{g.active ? 'Active' : 'Paused'}</span>
                <Switch checked={g.active} onCheckedChange={() => toggle(g)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Create dialog ─────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Greeting Rule</DialogTitle>
            <DialogDescription className={tk.tm}>Auto-send personalised WhatsApp greetings on special days</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto py-1 pr-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Rule Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali 2026 Greetings"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Type</Label>
                <div className="flex flex-col gap-1.5">
                  {[{ k: 'fixed_date', l: 'Festival / Event' }, { k: 'birthday', l: 'Birthday' }].map(t => (
                    <button key={t.k} onClick={() => setForm(p => ({ ...p, trigger: t.k, type: t.k === 'birthday' ? 'birthday' : 'festival' }))}
                      className={`py-2 rounded-lg text-xs font-medium border-2 transition-colors ${
                        form.trigger === t.k ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {form.trigger === 'fixed_date' && (
                  <div>
                    <Label className={`${tk.t2} text-xs mb-1.5 block`}>Date (MM-DD)</Label>
                    <Input className={`h-10 ${tk.inp}`} placeholder="e.g. 10-20"
                      value={form.fixed_date} onChange={e => setForm(p => ({ ...p, fixed_date: e.target.value }))} />
                    <p className={`text-[10px] ${tk.tm} mt-1`}>Oct 20 → 10-20</p>
                  </div>
                )}
                <div>
                  <Label className={`${tk.t2} text-xs mb-1.5 block`}>Audience</Label>
                  <select className={`w-full h-10 rounded-lg border px-3 text-xs ${tk.inp}`}
                    value={form.audience} onChange={e => setForm(p => ({ ...p, audience: e.target.value }))}>
                    {GREET_AUDIENCES.map(a => <option key={a.k} value={a.k}>{a.l}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Message Template</Label>
              <textarea rows={5}
                className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                placeholder="Write your WhatsApp message. Use {name} for the contact's first name."
                value={form.template_body}
                onChange={e => setForm(p => ({ ...p, template_body: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>
                {form.template_body.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> = contact's first name
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create Rule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 4 — Drip Sequences
// ══════════════════════════════════════════════════════════════════════════════
const BLANK_FORM = { name: '', description: '', trigger: 'lead_created', filter_designation: '', steps: [{ message_template: '', delay_days: 0 }] };

function DripsTab({ tk, drips, setDrips }) {
  const [expanded, setExpanded] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  async function toggle(d) {
    try {
      await dripApi.update(d.sequence_id, { is_active: !d.active });
      setDrips(prev => prev.map(x => x.id === d.id ? { ...x, active: !x.active } : x));
    } catch {
      toast.error('Failed to update sequence');
    }
  }

  function addStep() {
    const nextDay = form.steps.length === 0 ? 0 : form.steps[form.steps.length - 1].delay_days + 3;
    setForm(p => ({ ...p, steps: [...p.steps, { message_template: '', delay_days: nextDay }] }));
  }

  function removeStep(i) {
    setForm(p => ({ ...p, steps: p.steps.filter((_, ii) => ii !== i) }));
  }

  async function create() {
    if (!form.name.trim()) { toast.error('Sequence name is required'); return; }
    if (form.steps.length === 0) { toast.error('Add at least one step'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        trigger: form.trigger,
        filter_designation: form.filter_designation.trim() || null,
        is_active: true,
        steps: form.steps.map((s, i) => ({
          step_number: i + 1,
          delay_days: parseInt(s.delay_days) || 0,
          message_type: 'whatsapp',
          message_template: s.message_template.trim() || `Step ${i + 1}`,
        })),
      };
      const res = await dripApi.create(payload);
      setDrips(prev => [mapSeq(res.data), ...prev]);
      setShowCreate(false);
      setForm(BLANK_FORM);
      toast.success('Drip sequence created');
    } catch {
      toast.error('Failed to create sequence');
    } finally {
      setSaving(false);
    }
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
                <Switch checked={d.active} onCheckedChange={() => toggle(d)} />
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
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Teacher Welcome Series"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Trigger</Label>
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
            {form.trigger === 'lead_created' && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Filter by Designation <span className={`${tk.tm} font-normal`}>(optional)</span></Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Teacher, Principal — leave blank for all"
                  value={form.filter_designation}
                  onChange={e => setForm(p => ({ ...p, filter_designation: e.target.value }))} />
                <p className={`text-[11px] ${tk.tm} mt-1`}>Only enroll leads whose designation matches (case-insensitive)</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className={`${tk.t2} text-xs`}>Steps ({form.steps.length})</Label>
                <button onClick={addStep} className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add step
                </button>
              </div>
              <div className="space-y-3">
                {form.steps.map((s, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[var(--accent)]">{i + 1}</span>
                      </div>
                      <span className={`text-xs ${tk.t2} flex-1`}>
                        {i === 0 ? 'Send immediately (Day 0)' : (
                          <span className="flex items-center gap-1.5">
                            Send on day
                            <input type="number" min="1" className={`h-6 w-14 rounded-md border px-2 text-xs ${tk.inp}`}
                              value={s.delay_days}
                              onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, delay_days: e.target.value } : ss) }))} />
                            after enrollment
                          </span>
                        )}
                      </span>
                      {i > 0 && (
                        <button onClick={() => removeStep(i)}
                          className={`h-6 w-6 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                          <Trash2 className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                    </div>
                    <Input className={`h-8 text-xs ${tk.inp}`} placeholder="WhatsApp message template text…"
                      value={s.message_template}
                      onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, message_template: e.target.value } : ss) }))} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create Sequence'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 5 — Message Templates
// ══════════════════════════════════════════════════════════════════════════════
const TMPL_CATS = ['All', 'intro', 'catalogue', 'offer', 'followup', 'reengagement', 'seasonal'];
const TMPL_CAT_META = {
  intro:        { label: 'Intro',          col: 'text-blue-500',   bg: 'bg-blue-500/15' },
  catalogue:    { label: 'Catalogue',      col: 'text-purple-500', bg: 'bg-purple-500/15' },
  offer:        { label: 'Offer',          col: 'text-green-500',  bg: 'bg-green-500/15' },
  followup:     { label: 'Follow-up',      col: 'text-orange-500', bg: 'bg-orange-500/15' },
  reengagement: { label: 'Re-engagement',  col: 'text-red-400',    bg: 'bg-red-400/15' },
  seasonal:     { label: 'Seasonal',       col: 'text-cyan-500',   bg: 'bg-cyan-500/15' },
};
const BLANK_TMPL = { name: '', category: 'intro', body: '' };

function TemplatesTab({ tk, templates, setTemplates }) {
  const [filterCat, setFilterCat] = useState('All');
  const [preview, setPreview] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_TMPL);
  const [saving, setSaving] = useState(false);

  const filtered = filterCat === 'All' ? templates : templates.filter(t => t.category === filterCat);

  async function create() {
    if (!form.name.trim()) { toast.error('Template name is required'); return; }
    if (!form.body.trim()) { toast.error('Message body is required'); return; }
    setSaving(true);
    try {
      const vars = [];
      if (form.body.includes('{name}')) vars.push('name');
      if (form.body.includes('{school_name}')) vars.push('school_name');
      const res = await waApi.createTemplate({ ...form, variables: vars });
      setTemplates(prev => [...prev, res.data]);
      setShowCreate(false);
      setForm(BLANK_TMPL);
      toast.success('Template saved');
    } catch { toast.error('Failed to save template'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Message Templates
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>{templates.length} total</span>
          </h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Reusable WhatsApp messages — select when creating campaigns or drip steps</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Template
        </Button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TMPL_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c
                ? 'bg-[var(--accent)] text-white'
                : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {TMPL_CAT_META[c]?.label || c}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(t => {
          const m = TMPL_CAT_META[t.category] || { label: t.category, col: 'text-gray-400', bg: 'bg-gray-400/15' };
          return (
            <div key={t.template_id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex flex-col gap-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} leading-tight`}>{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium mt-1 inline-block`}>
                    {m.label}
                  </span>
                </div>
                <button onClick={() => setPreview(t)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                  <Eye className={`h-3.5 w-3.5 ${tk.tm}`} />
                </button>
              </div>
              <p className={`text-[11px] ${tk.tm} leading-relaxed line-clamp-3`}>{t.body}</p>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1.5">
                  {(t.variables || []).map(v => (
                    <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)]">
                      {'{' + v + '}'}
                    </span>
                  ))}
                </div>
                {t.usage_count > 0 && (
                  <span className={`text-[10px] ${tk.tm}`}>Used {t.usage_count}×</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview dialog */}
      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className={tk.t1}>{preview.name}</DialogTitle>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TMPL_CAT_META[preview.category]?.bg} ${TMPL_CAT_META[preview.category]?.col} font-medium`}>
                  {TMPL_CAT_META[preview.category]?.label || preview.category}
                </span>
              </div>
            </DialogHeader>
            {/* WhatsApp bubble mock */}
            <div className="bg-[#0f1117] rounded-xl p-4 my-2">
              <div className="bg-[#1f5c37] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%]">
                <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">
                  {preview.body
                    .replace('{name}', 'Ramesh')
                    .replace('{school_name}', 'Delhi Public School')}
                </p>
                <p className="text-white/50 text-[10px] text-right mt-1.5">12:34 PM ✓✓</p>
              </div>
            </div>
            <p className={`text-[11px] ${tk.tm}`}>Variables auto-filled with sample data for preview</p>
            <DialogFooter>
              <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
                onClick={() => setPreview(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Message Template</DialogTitle>
            <DialogDescription className={tk.tm}>Reusable WhatsApp message for campaigns and drip sequences</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Template Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali Special Offer"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Category</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TMPL_CAT_META).map(([k, m]) => (
                  <button key={k} onClick={() => setForm(p => ({ ...p, category: k }))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border-2 transition-all ${
                      form.category === k
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                        : `border-[var(--border-color)] ${tk.t2}`
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Message Body</Label>
              <textarea rows={6} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                placeholder="Write your WhatsApp message. Use {name} for contact's name, {school_name} for school."
                value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>
                {form.body.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> + <span className="font-mono text-[var(--accent)]">{'{school_name}'}</span>
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Save Template'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 6 — Analytics
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ tk, analytics, campaigns }) {
  if (!analytics) {
    return (
      <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
        <RefreshCw className={`h-8 w-8 ${tk.tm} mx-auto mb-3 animate-spin`} />
        <p className={`text-sm ${tk.t2}`}>Loading analytics…</p>
      </div>
    );
  }

  const { messages, drips, greetings, by_type = {} } = analytics;
  const totalByType = Object.values(by_type).reduce((s, v) => s + v, 0);

  const TYPE_META = {
    campaign:   { label: 'Campaigns',  col: 'bg-purple-500', pct_col: 'text-purple-500' },
    drip:       { label: 'Drip Steps', col: 'bg-blue-500',   pct_col: 'text-blue-500' },
    greeting:   { label: 'Greetings',  col: 'bg-pink-500',   pct_col: 'text-pink-500' },
    other:      { label: 'Other',      col: 'bg-gray-400',   pct_col: 'text-gray-400' },
  };

  const kpis = [
    { label: 'Total Queued',        value: messages.total,   icon: Inbox,      col: 'text-blue-500',   bg: 'bg-blue-500/10' },
    { label: 'Messages Sent',       value: messages.sent,    icon: Send,       col: 'text-green-500',  bg: 'bg-green-500/10' },
    { label: 'Pending / In Queue',  value: messages.pending, icon: Clock,      col: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Failed',              value: messages.failed,  icon: AlertCircle,col: 'text-red-400',    bg: 'bg-red-400/10' },
    { label: 'Active Drip Leads',   value: drips.active,     icon: Zap,        col: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: 'Greetings Sent',      value: greetings.total_sent, icon: Gift,   col: 'text-pink-500',   bg: 'bg-pink-500/10' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4 w-4 ${k.col}`} />
              </div>
              <p className={`text-xl font-bold ${tk.t1} leading-none`}>{(k.value || 0).toLocaleString('en-IN')}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{k.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Message breakdown by type */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <PieChart className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Messages by Channel</h3>
          </div>
          {totalByType === 0 ? (
            <p className={`text-xs ${tk.tm} py-4 text-center`}>No messages queued yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(by_type).map(([type, count]) => {
                const m = TYPE_META[type] || { label: type, col: 'bg-gray-400', pct_col: 'text-gray-400' };
                const pctVal = Math.round((count / totalByType) * 100);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${tk.t2}`}>{m.label}</span>
                      <span className={`text-xs font-bold ${m.pct_col}`}>{count.toLocaleString('en-IN')} · {pctVal}%</span>
                    </div>
                    <div className={`h-2 rounded-full bg-[var(--bg-primary)]`}>
                      <div className={`h-2 rounded-full ${m.col} transition-all`} style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Campaign performance */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center gap-2 px-4 py-3 border-b ${tk.bdr}`}>
            <Target className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Campaign Performance</h3>
          </div>
          {campaigns.length === 0 ? (
            <p className={`text-xs ${tk.tm} p-4 text-center`}>No campaigns yet</p>
          ) : (
            <div className={`divide-y divide-[var(--border-color)]`}>
              {campaigns.slice(0, 6).map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${tk.t1} truncate`}>{c.name}</p>
                    <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_count} contacts · {c.created_at}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                      {c.status}
                    </span>
                    {c.stats.sent > 0 && (
                      <span className={`text-[10px] ${tk.tm}`}>{c.stats.sent} sent</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drip funnel */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-4">
          <Zap className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Drip Sequence Funnel</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Enrollments',   value: drips.active,     col: 'text-blue-500',   bg: 'bg-blue-500/10' },
            { label: 'Completed',            value: drips.completed,  col: 'text-green-500',  bg: 'bg-green-500/10' },
            { label: 'Greetings Sent',       value: greetings.total_sent, col: 'text-pink-500', bg: 'bg-pink-500/10' },
            { label: 'Total WA Messages',    value: messages.total,   col: 'text-purple-500', bg: 'bg-purple-500/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3.5 text-center`}>
              <p className={`text-2xl font-bold ${s.col}`}>{(s.value || 0).toLocaleString('en-IN')}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 7 — WhatsApp Setup
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

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { key: 'overview',   label: 'Overview',   Icon: BarChart2 },
  { key: 'campaigns',  label: 'Campaigns',  Icon: Megaphone },
  { key: 'templates',  label: 'Templates',  Icon: FileText },
  { key: 'greetings',  label: 'Greetings',  Icon: Gift },
  { key: 'drips',      label: 'Drip',       Icon: Zap },
  { key: 'analytics',  label: 'Analytics',  Icon: PieChart },
  { key: 'setup',      label: 'WhatsApp',   Icon: Smartphone },
];

export default function MarketingHub() {
  const { isDark } = useTheme();
  const tk = useTk(isDark);

  const [tab, setTab] = useState('overview');
  const [waConnected, setWaConnected] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [drips, setDrips] = useState([]);
  const [greetings, setGreetings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  function reload() {
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
    dripApi.getAll().then(r => setDrips((r.data || []).map(mapSeq))).catch(() => {});
    greetingsApi.getAll().then(r => setGreetings((r.data || []).map(mapRule))).catch(() => {});
    waApi.getCampaigns().then(r => setCampaigns((r.data || []).map(mapCampaign))).catch(() => {});
    waApi.getTemplates().then(r => setTemplates(r.data || [])).catch(() => {});
    waApi.getAnalytics().then(r => setAnalytics(r.data)).catch(() => {});
  }

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
          {tab === 'overview'  && <OverviewTab   tk={tk} campaigns={campaigns} greetings={greetings} drips={drips} waConnected={waConnected} setTab={setTab} analytics={analytics} loadDemo={loadDemo} clearDemo={clearDemo} />}
          {tab === 'campaigns' && <CampaignsTab  tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} templates={templates} />}
          {tab === 'templates' && <TemplatesTab  tk={tk} templates={templates} setTemplates={setTemplates} />}
          {tab === 'greetings' && <GreetingsTab  tk={tk} greetings={greetings} setGreetings={setGreetings} />}
          {tab === 'drips'     && <DripsTab      tk={tk} drips={drips} setDrips={setDrips} />}
          {tab === 'analytics' && <AnalyticsTab  tk={tk} analytics={analytics} campaigns={campaigns} />}
          {tab === 'setup'     && <WhatsAppSetupTab tk={tk} waConnected={waConnected} setWaConnected={setWaConnected} />}
        </div>
      </div>
    </AdminLayout>
  );
}
