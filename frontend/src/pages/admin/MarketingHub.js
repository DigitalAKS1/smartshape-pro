import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import RichMessageEditor from '../../components/RichMessageEditor';
import { useTheme } from '../../contexts/ThemeContext';
import { contactRoles as contactRolesApi, contacts as contactsApi, dripSequences as dripApi, greetingRules as greetingsApi, whatsApp as waApi, email as emailApi, demo as demoApi, tags as tagsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Megaphone, MessageSquare, Zap, CalendarDays,
  Send, Users, Plus, TrendingUp, CheckCircle, Clock,
  AlertCircle, WifiOff, BarChart2, Star, Gift,
  RefreshCw, MoreVertical, ArrowRight, Activity,
  ChevronRight, ChevronDown, Trash2, Play, Eye,
  Check, Wifi, Calendar, Key, Globe, Copy,
  Flag, BookOpen, Heart, School, Cake, FileText,
  PieChart, Target, Inbox, X, Mail, AtSign,
  Paperclip, Brain, Upload, Smartphone as PhoneIcon, QrCode, Loader2,
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
    subject: c.subject || '',
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

// ── Campaign preview helper — personalize message with sample contact ──────────
function personalize(text, contact) {
  if (!text || !contact) return text || '';
  const name = (contact.first_name || (contact.name || '').split(' ')[0] || 'Ramesh');
  const school = contact.company || 'Your School';
  return text.replace(/\{name\}/g, name).replace(/\{school_name\}/g, school);
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
    steps: (s.steps || []).map(st => {
      const plain = st.message_template
        ? st.message_template.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
      return {
        n: st.step_number,
        delay: st.delay_days === 0 ? 'Immediately' : `Day ${st.delay_days}`,
        label: plain ? plain.substring(0, 80) + (plain.length > 80 ? '…' : '') : `Step ${st.step_number}`,
        delay_days: st.delay_days,
        message_template: st.message_template,
        message_type: st.message_type,
      };
    }),
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
  const [demoExpanded, setDemoExpanded] = useState(false);
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

  const activeGreets = greetings.filter(g => g.active).length;
  const kpis = [
    { label: 'Campaigns',        value: campaigns.length,                                 icon: Megaphone,                   col: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: 'Messages Sent',    value: msgSent ? msgSent.toLocaleString('en-IN') : '—', icon: Send,                        col: 'text-blue-500',   bg: 'bg-blue-500/10' },
    { label: 'Messages Pending', value: msgPending || '—',                               icon: Inbox,                       col: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Active Drips',     value: dripActive,                                      icon: Zap,                         col: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: 'Greetings',        value: greetSent || activeGreets,                       sub: greetSent ? 'total sent' : 'active rules', icon: Gift, col: 'text-pink-500', bg: 'bg-pink-500/10' },
    { label: 'WhatsApp',         value: waConnected ? 'On' : 'Off',                      sub: waConnected ? 'Connected' : 'Not set up', icon: waConnected ? Wifi : WifiOff, col: waConnected ? 'text-green-500' : 'text-red-500', bg: waConnected ? 'bg-green-500/10' : 'bg-red-500/10' },
  ];

  return (
    <div className="space-y-5">

      {/* ── Demo banner (collapsible) ──────────────────────────────────────── */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl overflow-hidden`}>
        <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
          onClick={() => setDemoExpanded(p => !p)}>
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
            <Zap className="h-3.5 w-3.5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tk.t1}`}>Try the Demo</p>
            {!demoExpanded && <p className={`text-[11px] ${tk.tm}`}>Load sample data to explore all features</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {hasDemo && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs border-red-400/40 text-red-400 hover:bg-red-400/10"
                disabled={clearLoading} onClick={handleClearDemo}>
                {clearLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Clear
              </Button>
            )}
            <Button size="sm"
              className="h-7 gap-1 text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              disabled={demoLoading} onClick={handleLoadDemo}>
              {demoLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {hasDemo ? 'Re-seed' : 'Demo'}
            </Button>
            <ChevronDown className={`h-4 w-4 ${tk.tm} transition-transform flex-shrink-0 ${demoExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {demoExpanded && (
          <div className={`border-t ${tk.bdr} px-4 pb-4 pt-3`}>
            <p className={`text-xs ${tk.tm} leading-relaxed mb-4`}>
              Load 5 sample school contacts (Ramesh · Priya · Rajesh · Anita · Suresh), 3 campaigns
              (Diwali completed · New Year queued · Year-End draft), drip enrollments &amp; greeting logs —
              to see every tab populated with realistic data.
            </p>
            {hasDemo && (
              <>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${tk.tm} mb-3`}>Demo Story — What was seeded</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {[
                    { step: '1. Contacts added', detail: '5 school personas: Ramesh (Principal, DPS), Priya (Teacher, St. Mary\'s), Rajesh (Purchase, Navyug), Anita (Principal, Ryan), Suresh (Teacher, DAV)', col: 'text-blue-500', bg: 'bg-blue-500/10' },
                    { step: '2. Campaigns created', detail: 'Diwali Offer (completed, 5 sent) · New Academic Year (queued, 2 pending to principals) · Year End Clearance (draft — click Launch to send!)', col: 'text-purple-500', bg: 'bg-purple-500/10' },
                    { step: '3. Drip sequence flow', detail: 'Ramesh got Day-0 intro + Day-3 catalogue (sent). Day-7 offer is PENDING. Priya got Day-0 intro (sent). Day-3 showcase is PENDING.', col: 'text-yellow-500', bg: 'bg-yellow-500/10' },
                    { step: '4. Auto-greetings sent', detail: 'Teachers\' Day sent to Ramesh & Priya (Sep 5, 2025). New Year sent to Ramesh, Anita & Suresh (Jan 1, 2026). Check Analytics tab!', col: 'text-pink-500', bg: 'bg-pink-500/10' },
                  ].map(s => (
                    <div key={s.step} className={`${s.bg} rounded-xl p-3`}>
                      <p className={`text-[11px] font-bold ${s.col} mb-1`}>{s.step}</p>
                      <p className={`text-[10px] ${tk.tm} leading-relaxed`}>{s.detail}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
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
              </>
            )}
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
        {kpis.map((k, i) => {
          const KIcon = k.icon;
          return (
            <div key={k.label}
              className={`${tk.card} border ${tk.bdr} rounded-2xl p-4 relative overflow-hidden mh-card-lift mh-fade mh-fade-${Math.min(i + 1, 6)}`}>
              <div className={`absolute top-3 right-3 w-8 h-8 rounded-xl ${k.bg} flex items-center justify-center`}>
                <KIcon className={`h-4 w-4 ${k.col}`} />
              </div>
              <p className={`text-[11px] font-semibold uppercase tracking-widest ${tk.tm} mb-2`}>{k.label}</p>
              <p className={`font-bold ${tk.t1} leading-none tracking-tight ${
                String(k.value).length > 7 ? 'text-base' : String(k.value).length > 4 ? 'text-xl' : 'text-2xl'
              }`}>{k.value}</p>
              {k.sub && <p className={`text-[10px] ${tk.tm} mt-1.5`}>{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mh-fade mh-fade-5">
        {/* Recent Campaigns */}
        <div className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Megaphone className="h-3.5 w-3.5 text-purple-500" />
              </div>
              <span className={`text-sm font-bold ${tk.t1}`}>Recent Campaigns</span>
            </div>
            <button onClick={() => setTab('campaigns')}
              className="text-[11px] text-[var(--accent)] hover:text-[var(--accent)]/80 flex items-center gap-0.5 font-semibold transition-colors">
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className={`divide-y divide-[var(--border-color)]/60`}>
            {campaigns.slice(0, 3).map(c => (
              <div key={c.id} className={`px-4 py-3 flex items-center gap-3 ${tk.hov} transition-colors`}>
                <div className={`w-1 h-8 rounded-full flex-shrink-0 ${
                  c.status === 'completed' ? 'bg-emerald-500' :
                  c.status === 'queued'    ? 'bg-indigo-500'  : 'bg-slate-200'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} truncate`}>{c.name}</p>
                  <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_label} · {c.audience_count} contacts</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg ${STATUS_CHIP[c.status]}`}>
                    {c.status}
                  </span>
                  {c.status === 'completed' && pct(c.stats.read, c.stats.sent) !== null && (
                    <span className="text-[10px] text-emerald-600 font-semibold">{pct(c.stats.read, c.stats.sent)}% read</span>
                  )}
                </div>
              </div>
            ))}
            {campaigns.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className={`text-xs ${tk.tm}`}>No campaigns yet — create one above</p>
              </div>
            )}
          </div>
        </div>

        {/* Auto Greetings */}
        <div className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Gift className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <span className={`text-sm font-bold ${tk.t1}`}>Auto Greetings</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">
                {greetings.filter(g => g.active).length} active
              </span>
            </div>
            <button onClick={() => setTab('greetings')}
              className="text-[11px] text-[var(--accent)] hover:text-[var(--accent)]/80 flex items-center gap-0.5 font-semibold transition-colors">
              Manage <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className={`divide-y divide-[var(--border-color)]/60`}>
            {greetings.filter(g => g.active).slice(0, 5).map(g => (
              <div key={g.id} className={`px-4 py-3 flex items-center gap-3 ${tk.hov} transition-colors`}>
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  g.type === 'birthday' ? 'bg-pink-500/12' : 'bg-amber-500/12'
                }`}>
                  {g.type === 'birthday'
                    ? <Star className="h-3.5 w-3.5 text-pink-500" />
                    : <Calendar className="h-3.5 w-3.5 text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} truncate`}>{g.name}</p>
                  <p className={`text-[11px] ${tk.tm}`}>{g.next}</p>
                </div>
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Drip Sequences */}
      <div className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden mh-fade mh-fade-6`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${tk.bdr}`}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-yellow-500" />
            </div>
            <span className={`text-sm font-bold ${tk.t1}`}>Active Drip Sequences</span>
          </div>
          <button onClick={() => setTab('drips')}
            className="text-[11px] text-[var(--accent)] hover:text-[var(--accent)]/80 flex items-center gap-0.5 font-semibold transition-colors">
            View all <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-color)]/60">
          {drips.filter(d => d.active).length === 0 ? (
            <div className="px-4 py-8 text-center col-span-3">
              <p className={`text-xs ${tk.tm}`}>No active drip sequences — activate one in the Drip tab</p>
            </div>
          ) : drips.filter(d => d.active).map(d => (
            <div key={d.id} className={`px-4 py-4 ${tk.hov} transition-colors`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse flex-shrink-0" />
                <p className={`text-sm font-bold ${tk.t1} truncate`}>{d.name}</p>
              </div>
              <p className={`text-[11px] ${tk.tm}`}>{d.steps.length} steps · {d.trigger}</p>
              <div className="flex items-center gap-3 mt-2.5">
                <div className="text-center">
                  <p className={`text-lg font-bold ${tk.t1} leading-none`}>{d.enrolled}</p>
                  <p className={`text-[10px] ${tk.tm} mt-0.5`}>enrolled</p>
                </div>
                <div className="w-px h-8 bg-[var(--border-color)]" />
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-600 leading-none">{d.completed}</p>
                  <p className={`text-[10px] ${tk.tm} mt-0.5`}>completed</p>
                </div>
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

function CampaignsTab({ tk, campaigns, setCampaigns, roles, contacts, templates, allTags, waConnected, openQrDialog }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState(null);
  // Attachment state
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewTmpl, setPreviewTmpl] = useState(null);
  const [previewCamp, setPreviewCamp] = useState(null);
  const [previewContact, setPreviewContact] = useState(0);
  const [form, setForm] = useState({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', template_id: '', message: '', schedule: 'draft', schedule_at: '', ai_personalization: true, attachment_id: null });

  // Load attachments once
  useEffect(() => {
    waApi.listAttachments().then(r => setAttachments(r.data || [])).catch(() => {});
  }, []); // eslint-disable-line

  async function handleAttachFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const r = await waApi.uploadAttachment(file);
      const att = r.data;
      setAttachments(prev => [att, ...prev]);
      setForm(p => ({ ...p, attachment_id: att.attachment_id }));
      toast.success(`"${file.name}" uploaded`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed');
    } finally { setUploadingFile(false); e.target.value = ''; }
  }

  const PIPELINE_STAGES = [
    { id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' },
    { id: 'demo', label: 'Demo' }, { id: 'negotiation', label: 'Negotiation' },
    { id: 'quoted', label: 'Quoted' }, { id: 'follow_up', label: 'Follow Up' },
    { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
  ];

  const audienceCount = (() => {
    if (form.audience === 'all') return contacts.length;
    if (form.audience === 'role' && form.role_id) {
      const rName = (roles.find(r => r.role_id === form.role_id)?.name || '').toLowerCase();
      return contacts.filter(c =>
        c.contact_role_id === form.role_id ||
        (rName && (c.designation || '').toLowerCase() === rName)
      ).length;
    }
    if (form.audience === 'tags' && form.tag_ids.length > 0) {
      return contacts.filter(c => form.tag_ids.some(tid => (c.tag_ids || []).includes(tid))).length;
    }
    // lead_stage and school_attrs counts are server-side — show '?' until launched
    return null;
  })();

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'scheduled', label: 'Scheduled', count: campaigns.filter(c => c.status === 'scheduled').length },
    { key: 'queued',    label: 'Queued',    count: campaigns.filter(c => c.status === 'queued').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  // Sample contacts for preview
  const sampleContacts = contacts.filter(c => c.phone).slice(0, 5);
  const previewSample = sampleContacts[previewContact] || { name: 'Ramesh Kumar', first_name: 'Ramesh', company: 'Delhi Public School' };

  function closeCreate() {
    setShowCreate(false); setStep(1);
    setForm({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', template_id: '', message: '', schedule: 'draft', schedule_at: '', ai_personalization: true, attachment_id: null });
  }

  function pickTemplate(tmpl) {
    setForm(p => ({ ...p, template_id: tmpl.template_id, message: tmpl.body }));
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return; }
    setSaving(true);
    try {
      let audience_filter = {};
      let audienceLabel = 'All Contacts';
      if (form.audience === 'role' && form.role_id) {
        const rName = roles.find(r => r.role_id === form.role_id)?.name;
        audience_filter = { roles: [rName].filter(Boolean) };
        audienceLabel = rName || 'By Role';
      } else if (form.audience === 'tags' && form.tag_ids.length > 0) {
        audience_filter = { tags: form.tag_ids };
        audienceLabel = form.tag_ids.map(id => allTags.find(t => t.tag_id === id)?.name || id).join(', ');
      } else if (form.audience === 'lead_stage' && form.lead_stages.length > 0) {
        audience_filter = { lead_stages: form.lead_stages };
        audienceLabel = `Lead Stage: ${form.lead_stages.join(', ')}`;
      } else if (form.audience === 'school_attrs') {
        audience_filter = {};
        const labels = [];
        if (form.school_types.length > 0) { audience_filter.school_types = form.school_types; labels.push(form.school_types.join('/')); }
        if (form.min_strength) { audience_filter.min_strength = parseInt(form.min_strength); labels.push(`${form.min_strength}+ students`); }
        if (form.school_cities.trim()) { audience_filter.school_cities = form.school_cities.split(',').map(s => s.trim()).filter(Boolean); labels.push(form.school_cities); }
        audienceLabel = labels.length > 0 ? `School: ${labels.join(' · ')}` : 'By School Attributes';
      }
      const res = await waApi.createCampaign({
        name: form.name.trim(),
        template_id: form.template_id || null,
        message: form.message.trim(),
        audience_filter,
        audience_label: audienceLabel,
        scheduled_at: form.schedule === 'schedule' ? form.schedule_at : null,
        ai_personalization: form.ai_personalization,
        attachment_id: form.attachment_id || null,
      });
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
    { key: 'all',         label: 'All Contacts',        desc: `${contacts.length} contacts in your database` },
    { key: 'role',        label: 'By Designation',      desc: 'Principal, Teacher, Purchase Head, etc.' },
    { key: 'tags',        label: 'By Tags',             desc: 'Hot Lead, Demo Done, Budget Approved, etc.' },
    { key: 'lead_stage',  label: 'By Lead Stage',       desc: 'Demo, Negotiation, Quoted — contacts with active leads' },
    { key: 'school_attrs',label: 'By School Attributes',desc: 'Filter by board type, city, or minimum student strength' },
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
        <div className="sm:ml-auto flex items-center gap-2">
          {/* Evolution connection badge */}
          <button onClick={waConnected ? undefined : openQrDialog}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              waConnected
                ? 'border-green-500/30 bg-green-500/10 text-green-600 cursor-default'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 cursor-pointer'
            }`}>
            {waConnected ? <Wifi className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
            {waConnected ? 'WA Connected' : 'Connect WA'}
          </button>
          <Button size="sm" className="h-9 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
            onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Not-connected notice */}
      {!waConnected && (
        <div className={`${tk.card} border border-amber-500/20 rounded-xl p-3 flex items-center gap-3 mb-1`}>
          <QrCode className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className={`text-xs font-semibold ${tk.t1}`}>WhatsApp not connected — campaigns will queue but not send</p>
            <p className={`text-[11px] ${tk.tm}`}>Scan the QR code to link your phone via Evolution API. Messages send at 3-second intervals to avoid bans.</p>
          </div>
          <Button size="sm" variant="outline" onClick={openQrDialog}
            className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10 text-xs gap-1.5 flex-shrink-0">
            <QrCode className="h-3.5 w-3.5" /> Scan QR
          </Button>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
          <Megaphone className={`h-10 w-10 ${tk.tm} mx-auto mb-3 opacity-40`} />
          <p className={`text-sm font-medium ${tk.t2}`}>No {filter !== 'all' ? filter : ''} campaigns</p>
          <p className={`text-xs ${tk.tm} mt-1`}>Create a campaign to start reaching your contacts via WhatsApp</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(c => {
            const dr = pct(c.stats.delivered, c.stats.sent);
            const rr = pct(c.stats.read, c.stats.sent);
            const barColor =
              c.status === 'completed' ? 'bg-emerald-500' :
              c.status === 'scheduled' ? 'bg-blue-500'    :
              c.status === 'queued'    ? 'bg-indigo-500'  :
              c.status === 'running'   ? 'bg-yellow-500'  : 'bg-slate-300';
            return (
              <div key={c.id}
                className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden mh-card-lift group`}>
                <div className="flex">
                  {/* Left status accent bar */}
                  <div className={`w-1 flex-shrink-0 ${barColor}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] uppercase tracking-widest font-bold ${STATUS_CHIP[c.status]} rounded-md px-1.5 py-0.5`}>
                            {c.status}
                          </span>
                          <span className={`text-[10px] ${tk.tm} font-medium`}>
                            WA · {c.audience_count} contacts
                          </span>
                        </div>
                        <p className={`text-sm font-bold ${tk.t1} leading-snug`}>{c.name}</p>
                        <p className={`text-[11px] ${tk.tm} mt-0.5`}>
                          {c.audience_label}
                          {c.scheduled_at ? ` · Scheduled ${c.scheduled_at}` : c.created_at ? ` · ${c.created_at}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                        {c.status === 'draft' && (
                          <Button size="sm"
                            className="h-7 gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
                            disabled={launching === c.id} onClick={() => launch(c)}>
                            {launching === c.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <Play className="h-3 w-3" />}
                            {launching === c.id ? '…' : 'Launch'}
                          </Button>
                        )}
                        <button onClick={() => { setPreviewCamp(c); setPreviewContact(0); }}
                          className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`} title="Preview">
                          <Eye className={`h-3.5 w-3.5 ${tk.tm} group-hover:text-indigo-500 transition-colors`} />
                        </button>
                      </div>
                    </div>

                    {(c.status === 'completed' || c.status === 'queued') && (
                      <div className="mt-3 pt-3 border-t border-[var(--border-color)]/60">
                        <div className="flex items-center gap-4 text-xs mb-2">
                          <span>
                            <span className={`font-bold ${tk.t1}`}>{c.stats.sent}</span>
                            <span className={`ml-1 ${tk.tm}`}>sent</span>
                          </span>
                          {c.stats.delivered > 0 && <span>
                            <span className="font-bold text-emerald-600">{c.stats.delivered}</span>
                            <span className={`ml-1 ${tk.tm}`}>delivered</span>
                          </span>}
                          {c.stats.read > 0 && <span>
                            <span className="font-bold text-blue-500">{c.stats.read}</span>
                            <span className={`ml-1 ${tk.tm}`}>read</span>
                          </span>}
                          {c.stats.failed > 0 && <span>
                            <span className="font-bold text-red-500">{c.stats.failed}</span>
                            <span className={`ml-1 ${tk.tm}`}>failed</span>
                          </span>}
                          {dr !== null && <span className={`ml-auto font-semibold text-emerald-600`}>{dr}% delivery</span>}
                        </div>
                        <div className="w-full bg-[var(--bg-primary)] rounded-full h-1.5">
                          <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-700"
                            style={{ width: `${dr || 0}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
                    {(audienceCount !== null && audienceCount > 0) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">
                        ~{audienceCount} contacts
                      </span>
                    )}
                    {audienceCount === null && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tk.bdr} ${tk.tm}`}>
                        resolved on launch
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
                        {/* Tags sub-selector */}
                        {opt.key === 'tags' && form.audience === 'tags' && allTags.length > 0 && (
                          <div className="mt-2 ml-7">
                            <p className={`text-[10px] ${tk.tm} mb-1.5`}>Select tags — contacts matching ANY selected tag will receive the campaign</p>
                            <div className="flex flex-wrap gap-1.5">
                              {allTags.map(tag => {
                                const selected = form.tag_ids.includes(tag.tag_id);
                                const cnt = contacts.filter(c => (c.tag_ids || []).includes(tag.tag_id)).length;
                                return (
                                  <button key={tag.tag_id}
                                    onClick={() => setForm(p => ({
                                      ...p,
                                      tag_ids: selected
                                        ? p.tag_ids.filter(id => id !== tag.tag_id)
                                        : [...p.tag_ids, tag.tag_id]
                                    }))}
                                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                      selected ? 'text-white border-transparent' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                    }`}
                                    style={selected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected ? 'white' : tag.color }} />
                                    {tag.name}
                                    <span className={`font-bold text-[10px] ${selected ? 'text-white/80' : tk.tm}`}>{cnt}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Lead Stage sub-selector */}
                        {opt.key === 'lead_stage' && form.audience === 'lead_stage' && (
                          <div className="mt-2 ml-7">
                            <p className={`text-[10px] ${tk.tm} mb-1.5`}>Target contacts whose linked lead is currently in these stages</p>
                            <div className="flex flex-wrap gap-1.5">
                              {PIPELINE_STAGES.map(s => {
                                const sel = form.lead_stages.includes(s.id);
                                return (
                                  <button key={s.id}
                                    onClick={() => setForm(p => ({
                                      ...p,
                                      lead_stages: sel ? p.lead_stages.filter(x => x !== s.id) : [...p.lead_stages, s.id]
                                    }))}
                                    className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                      sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                    }`}>
                                    {s.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* School Attributes sub-selector */}
                        {opt.key === 'school_attrs' && form.audience === 'school_attrs' && (
                          <div className="mt-2 ml-7 space-y-2">
                            <div>
                              <p className={`text-[10px] ${tk.tm} mb-1.5`}>Board type (select any)</p>
                              <div className="flex flex-wrap gap-1.5">
                                {['CBSE', 'ICSE', 'IB', 'State Board', 'Montessori'].map(bt => {
                                  const sel = form.school_types.includes(bt);
                                  return (
                                    <button key={bt}
                                      onClick={() => setForm(p => ({
                                        ...p,
                                        school_types: sel ? p.school_types.filter(x => x !== bt) : [...p.school_types, bt]
                                      }))}
                                      className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                        sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                      }`}>
                                      {bt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <p className={`text-[10px] ${tk.tm} mb-1`}>Min. strength</p>
                                <input type="number" min="0" placeholder="e.g. 500"
                                  value={form.min_strength}
                                  onChange={e => setForm(p => ({ ...p, min_strength: e.target.value }))}
                                  className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                              </div>
                              <div className="flex-1">
                                <p className={`text-[10px] ${tk.tm} mb-1`}>Cities (comma-sep.)</p>
                                <input type="text" placeholder="Delhi, Mumbai"
                                  value={form.school_cities}
                                  onChange={e => setForm(p => ({ ...p, school_cities: e.target.value }))}
                                  className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                              </div>
                            </div>
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
                    Message / Template Base
                    <span className={`${tk.tm} font-normal ml-1`}>(Claude AI will personalise per recipient)</span>
                  </Label>
                  <textarea rows={5} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                    placeholder="Write your message… Use {name} and {school_name} as variables."
                    value={form.message}
                    onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
                  <p className={`text-[11px] ${tk.tm} mt-0.5`}>{form.message.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> + <span className="font-mono text-[var(--accent)]">{'{school_name}'}</span> are auto-filled</p>
                </div>

                {/* ── AI Personalisation toggle ── */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${tk.bdr} bg-[var(--bg-primary)]`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${form.ai_personalization ? 'bg-violet-500/15' : 'bg-gray-500/10'}`}>
                      <Brain className={`h-4 w-4 ${form.ai_personalization ? 'text-violet-500' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${tk.t1}`}>Claude AI Personalisation</p>
                      <p className={`text-[10px] ${tk.tm}`}>
                        {form.ai_personalization
                          ? 'Unique message per contact (name, school, stage-aware)'
                          : 'Simple {name} substitution only'}
                      </p>
                    </div>
                  </div>
                  <Switch checked={form.ai_personalization}
                    onCheckedChange={v => setForm(p => ({ ...p, ai_personalization: v }))} />
                </div>

                {/* ── Attachment picker ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className={`${tk.t2} text-xs`}>Attachment (optional)</Label>
                    <label className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border ${tk.bdr} ${tk.t2} cursor-pointer hover:bg-[var(--bg-primary)] transition-colors`}>
                      {uploadingFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {uploadingFile ? 'Uploading…' : 'Upload File'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov" className="hidden" onChange={handleAttachFile} disabled={uploadingFile} />
                    </label>
                  </div>
                  {attachments.length > 0 ? (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {/* None option */}
                      <button onClick={() => setForm(p => ({ ...p, attachment_id: null }))}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                          !form.attachment_id ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <X className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className={`text-xs ${tk.t2}`}>No attachment — text only</span>
                      </button>
                      {attachments.map(att => (
                        <button key={att.attachment_id}
                          onClick={() => setForm(p => ({ ...p, attachment_id: att.attachment_id }))}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                            form.attachment_id === att.attachment_id ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                          }`}>
                          <Paperclip className={`h-3.5 w-3.5 flex-shrink-0 ${att.attachment_type === 'image' ? 'text-blue-400' : att.attachment_type === 'video' ? 'text-purple-400' : 'text-red-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${tk.t1} truncate`}>{att.filename}</p>
                            <p className={`text-[10px] ${tk.tm}`}>{att.attachment_type} · {Math.round(att.size_bytes / 1024)} KB</p>
                          </div>
                          {form.attachment_id === att.attachment_id && <Check className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-[11px] ${tk.tm} text-center py-3`}>No attachments yet — upload a PDF, image, or video above</p>
                  )}
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
                    { label: 'Campaign',     value: form.name || 'Untitled' },
                    { label: 'Audience',     value: `${AUDIENCE_OPTS.find(a => a.key === form.audience)?.label || form.audience}${form.audience === 'role' && form.role_id ? ` — ${roles.find(r => r.role_id === form.role_id)?.name || ''}` : ''}${audienceCount !== null ? ` (~${audienceCount})` : ''}` },
                    { label: 'Template',     value: form.template_id ? (templates.find(t => t.template_id === form.template_id)?.name || 'Custom') : (form.message ? 'Custom message' : 'Not selected') },
                    { label: 'AI Personalise', value: form.ai_personalization ? '✓ Claude Haiku (unique per contact)' : '✗ Template substitution only' },
                    { label: 'Attachment',   value: form.attachment_id ? (attachments.find(a => a.attachment_id === form.attachment_id)?.filename || 'Attached') : 'None' },
                    { label: 'Schedule',     value: form.schedule === 'draft' ? 'Save as Draft' : (form.schedule_at || 'Not set') },
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

      {/* WhatsApp Campaign Preview Dialog */}
      {previewCamp && (
        <Dialog open={!!previewCamp} onOpenChange={() => setPreviewCamp(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
            <DialogHeader>
              <DialogTitle className={`${tk.t1} flex items-center gap-2`}>
                <MessageSquare className="h-4 w-4 text-green-500" />
                WhatsApp Preview
              </DialogTitle>
              <DialogDescription className={tk.tm}>{previewCamp.name}</DialogDescription>
            </DialogHeader>

            {/* Preview-as selector */}
            {sampleContacts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>Preview as:</span>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {sampleContacts.map((c, i) => (
                    <button key={c.contact_id || i} onClick={() => setPreviewContact(i)}
                      className={`text-[10px] px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0 border transition-all ${
                        previewContact === i ? 'bg-green-500 border-green-500 text-white' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {(c.first_name || c.name?.split(' ')[0] || 'Contact')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* WhatsApp phone mock */}
            <div className="bg-[#0b141a] rounded-2xl p-4 relative overflow-hidden">
              {/* Status bar */}
              <div className="flex items-center justify-between mb-3 opacity-60">
                <span className="text-white text-[10px] font-medium">9:41 AM</span>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-1.5 rounded-sm bg-white" /><div className="w-1 h-1 rounded-full bg-white" />
                </div>
              </div>
              {/* Chat header */}
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <div className="w-8 h-8 rounded-full bg-green-500/30 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">SmartShape Team</p>
                  <p className="text-white/50 text-[10px]">Online</p>
                </div>
              </div>
              {/* Message bubble */}
              <div className="flex justify-end">
                <div className="bg-[#005c4b] rounded-2xl rounded-tr-sm px-3 py-2.5 max-w-[85%]">
                  <p className="text-white text-[11px] leading-relaxed whitespace-pre-wrap">
                    {personalize(previewCamp.message, previewSample)}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    <span className="text-white/50 text-[9px]">Now</span>
                    <svg className="w-3 h-3 text-[#53bdeb]" viewBox="0 0 16 11" fill="currentColor">
                      <path d="M11.071.653a.75.75 0 0 1 1.06 1.06L5.243 8.6 3.12 6.477A.75.75 0 0 0 2.06 7.536l2.652 2.652a.75.75 0 0 0 1.06 0L12.132 3.8l.707-.707-.707-.707L11.07.653zM7.593 8.6 5.47 6.477a.75.75 0 0 0-1.06 1.06l2.652 2.652a.75.75 0 0 0 1.06 0L14.571 3.24l-1.06-1.06L7.593 8.6z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-between text-[11px] ${tk.tm}`}>
              <span>{previewCamp.audience_label} · {previewCamp.audience_count} contacts</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CHIP[previewCamp.status] || 'bg-gray-500/15 text-gray-400'}`}>
                {previewCamp.status}
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
                onClick={() => setPreviewCamp(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
        steps: form.steps.map((s, i) => {
          const plain = s.message_template
            ? s.message_template.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : '';
          return {
            step_number: i + 1,
            delay_days: parseInt(s.delay_days) || 0,
            message_type: 'whatsapp',
            message_template: s.message_template || `Step ${i + 1}`,
            message_plain: plain,
          };
        }),
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
                    <RichMessageEditor
                      value={s.message_template}
                      onChange={html => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, message_template: html } : ss) }))}
                      placeholder="Write your drip message — paste from ChatGPT, Claude, or type directly…"
                    />
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
              <RichMessageEditor
                value={form.body}
                onChange={html => setForm(p => ({ ...p, body: html }))}
                placeholder="Write your WhatsApp message. Paste from ChatGPT or Claude — bold, emojis and formatting preserved."
              />
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
function WhatsAppSetupTab({ tk, waConnected, setWaConnected, evolutionState, openQrDialog }) {
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

          {/* Provider selector */}
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

      {/* ── Evolution API: Multiple Instances ── */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <PhoneIcon className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>WhatsApp Numbers (Evolution API)</h3>
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${evolutionState === 'open' ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'}`}>
            {evolutionState === 'open' ? '● Connected' : '● Not linked'}
          </span>
        </div>
        <p className={`text-[11px] ${tk.tm} mb-3`}>Each instance is one WhatsApp number. Add numbers for different teams (Sales, Support, etc.).</p>

        {/* Existing instances */}
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

        {/* Add new instance */}
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

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// Tab 8 — Email Hub (Campaigns · Templates · Analytics · Setup)
// ══════════════════════════════════════════════════════════════════════════════
const BLANK_EMAIL_TMPL = { name: '', category: 'intro', subject: '', body: '' };

function EmailCampaignsSubTab({ tk, campaigns, setCampaigns, roles, contacts, templates, allTags }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewTmpl, setPreviewTmpl] = useState(null);
  const [previewCamp, setPreviewCamp] = useState(null);
  const [previewContact, setPreviewContact] = useState(0);
  const [form, setForm] = useState({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', template_id: '', subject: '', message: '', schedule: 'draft', schedule_at: '' });

  const E_PIPELINE_STAGES = [
    { id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' },
    { id: 'demo', label: 'Demo' }, { id: 'negotiation', label: 'Negotiation' },
    { id: 'quoted', label: 'Quoted' }, { id: 'follow_up', label: 'Follow Up' },
    { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
  ];

  const audienceCount = (() => {
    if (form.audience === 'all') return contacts.length;
    if (form.audience === 'role' && form.role_id) {
      const rName = (roles.find(r => r.role_id === form.role_id)?.name || '').toLowerCase();
      return contacts.filter(c =>
        c.contact_role_id === form.role_id ||
        (rName && (c.designation || '').toLowerCase() === rName)
      ).length;
    }
    if (form.audience === 'tags' && form.tag_ids.length > 0) {
      return contacts.filter(c => form.tag_ids.some(tid => (c.tag_ids || []).includes(tid))).length;
    }
    return null;
  })();

  const E_AUDIENCE_OPTS = [
    { key: 'all',         label: 'All Contacts',        desc: `${contacts.length} contacts in your database` },
    { key: 'role',        label: 'By Designation',      desc: 'Principal, Teacher, Purchase Head, etc.' },
    { key: 'tags',        label: 'By Tags',             desc: 'Hot Lead, Demo Done, Budget Approved, etc.' },
    { key: 'lead_stage',  label: 'By Lead Stage',       desc: 'Demo, Negotiation, Quoted — contacts with active leads' },
    { key: 'school_attrs',label: 'By School Attributes',desc: 'Filter by board type, city, or minimum student strength' },
  ];

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'queued',    label: 'Queued',    count: campaigns.filter(c => c.status === 'queued').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];
  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  const sampleContacts = contacts.filter(c => c.email).slice(0, 5);
  const previewSampleE = sampleContacts[previewContact] || { name: 'Ramesh Kumar', first_name: 'Ramesh', company: 'Delhi Public School', email: 'ramesh@dpsdwarka.edu.in' };

  function closeCreate() {
    setShowCreate(false); setStep(1);
    setForm({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', template_id: '', subject: '', message: '', schedule: 'draft', schedule_at: '' });
  }

  function pickTemplate(tmpl) {
    setForm(p => ({ ...p, template_id: tmpl.template_id, subject: tmpl.subject || '', message: tmpl.body }));
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return; }
    setSaving(true);
    try {
      let audience_filter = {};
      let audienceLabel = 'All Contacts';
      if (form.audience === 'role' && form.role_id) {
        const rName = roles.find(r => r.role_id === form.role_id)?.name;
        audience_filter = { roles: [rName].filter(Boolean) };
        audienceLabel = rName || 'By Role';
      } else if (form.audience === 'tags' && form.tag_ids.length > 0) {
        audience_filter = { tags: form.tag_ids };
        audienceLabel = form.tag_ids.map(id => (allTags || []).find(t => t.tag_id === id)?.name || id).join(', ');
      } else if (form.audience === 'lead_stage' && form.lead_stages.length > 0) {
        audience_filter = { lead_stages: form.lead_stages };
        audienceLabel = `Lead Stage: ${form.lead_stages.join(', ')}`;
      } else if (form.audience === 'school_attrs') {
        audience_filter = {};
        const labels = [];
        if (form.school_types.length > 0) { audience_filter.school_types = form.school_types; labels.push(form.school_types.join('/')); }
        if (form.min_strength) { audience_filter.min_strength = parseInt(form.min_strength); labels.push(`${form.min_strength}+ students`); }
        if (form.school_cities.trim()) { audience_filter.school_cities = form.school_cities.split(',').map(s => s.trim()).filter(Boolean); labels.push(form.school_cities); }
        audienceLabel = labels.length > 0 ? `School: ${labels.join(' · ')}` : 'By School Attributes';
      }
      const res = await emailApi.createCampaign({
        name: form.name.trim(),
        template_id: form.template_id || null,
        subject: form.subject.trim(),
        message: form.message.trim(),
        audience_filter,
        audience_label: audienceLabel,
        scheduled_at: form.schedule === 'schedule' ? form.schedule_at : null,
      });
      setCampaigns(prev => [mapCampaign(res.data), ...prev]);
      closeCreate();
      toast.success('Email campaign created as draft');
    } catch { toast.error('Failed to create campaign'); }
    finally { setSaving(false); }
  }

  async function launch(camp) {
    setLaunching(camp.id);
    try {
      const res = await emailApi.launchCampaign(camp.campaign_id);
      const { queued, status } = res.data;
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status, stats: { ...c.stats, sent: queued } } : c));
      toast.success(`${queued} emails queued for ${camp.name}`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to launch campaign'); }
    finally { setLaunching(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className={`flex items-center gap-0.5 p-1 bg-[var(--bg-primary)] border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar flex-shrink-0`}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                filter === f.key ? `${tk.card} ${tk.t1} shadow-sm` : `${tk.tm} ${tk.hov}`
              }`}>
              {f.label}
              <span className={`text-[10px] min-w-[16px] text-center px-1 rounded-full ${
                filter === f.key ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--border-color)]'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Email Campaign
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
          <Mail className={`h-10 w-10 ${tk.tm} mx-auto mb-3`} />
          <p className={`text-sm font-medium ${tk.t2}`}>No email campaigns yet</p>
          <p className={`text-xs ${tk.tm} mt-1`}>Create your first email campaign to start reaching school contacts</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(c => (
            <div key={c.id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  c.status === 'completed' ? 'bg-green-500/15' : c.status === 'queued' ? 'bg-blue-500/15' : 'bg-gray-500/15'
                }`}>
                  <Mail className={`h-4 w-4 ${c.status === 'completed' ? 'text-green-500' : c.status === 'queued' ? 'text-blue-500' : tk.tm}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${tk.t1}`}>{c.name}</p>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className={`flex items-center gap-3 mt-1 text-[11px] ${tk.tm} flex-wrap`}>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.audience_label} ({c.audience_count})</span>
                    {c.stats.sent > 0 && <span className="flex items-center gap-1"><Send className="h-3 w-3" />{c.stats.sent} sent</span>}
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{c.created_at}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.status === 'draft' && (
                    <Button size="sm" variant="outline"
                      className={`h-8 gap-1 text-xs border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10`}
                      disabled={!!launching} onClick={() => launch(c)}>
                      {launching === c.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Launch
                    </Button>
                  )}
                  <button onClick={() => { setPreviewCamp(c); setPreviewContact(0); }}
                    className={`h-8 w-8 rounded-lg ${tk.hov} flex items-center justify-center`} title="Preview email">
                    <Eye className={`h-4 w-4 ${tk.tm}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Email Campaign Preview Dialog */}
      {previewCamp && (
        <Dialog open={!!previewCamp} onOpenChange={() => setPreviewCamp(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto`}>
            <DialogHeader>
              <DialogTitle className={`${tk.t1} flex items-center gap-2`}>
                <Mail className="h-4 w-4 text-blue-500" />
                Email Preview
              </DialogTitle>
              <DialogDescription className={tk.tm}>{previewCamp.name}</DialogDescription>
            </DialogHeader>

            {/* Preview-as selector */}
            {sampleContacts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>Preview as:</span>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {sampleContacts.map((c, i) => (
                    <button key={c.contact_id || i} onClick={() => setPreviewContact(i)}
                      className={`text-[10px] px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0 border transition-all ${
                        previewContact === i ? 'bg-blue-500 border-blue-500 text-white' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {(c.first_name || c.name?.split(' ')[0] || 'Contact')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Email client mock */}
            <div className={`border ${tk.bdr} rounded-xl overflow-hidden`}>
              {/* Browser chrome */}
              <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-3 py-2 flex items-center gap-2">
                <div className="flex gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-400" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-400" /><div className="w-2.5 h-2.5 rounded-full bg-green-400" /></div>
                <span className={`text-[10px] ${tk.tm} flex-1 text-center`}>Gmail</span>
              </div>
              {/* Email header */}
              <div className="bg-white/3 border-b border-[var(--border-color)] px-4 py-3 space-y-1.5">
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>From</span>
                  <span className={`text-xs ${tk.t2}`}>SmartShape Team &lt;noreply@smartshape.in&gt;</span>
                </div>
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>To</span>
                  <span className={`text-xs ${tk.t2}`}>
                    {previewSampleE.name || `${previewSampleE.first_name} ${previewSampleE.last_name || ''}`} &lt;{previewSampleE.email || 'contact@school.edu.in'}&gt;
                  </span>
                </div>
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>Subject</span>
                  <span className={`text-xs font-semibold ${tk.t1} leading-tight`}>
                    {personalize(previewCamp.subject, previewSampleE) || '(No subject)'}
                  </span>
                </div>
              </div>
              {/* Email body */}
              <div className="p-4 min-h-[80px]">
                <p className={`text-[11px] ${tk.t2} whitespace-pre-wrap leading-relaxed`}>
                  {personalize(previewCamp.message, previewSampleE) || '(No body content)'}
                </p>
              </div>
            </div>

            <div className={`flex items-center justify-between text-[11px] ${tk.tm}`}>
              <span>{previewCamp.audience_label} · {previewCamp.audience_count} contacts</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CHIP[previewCamp.status] || 'bg-gray-500/15 text-gray-400'}`}>
                {previewCamp.status}
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
                onClick={() => setPreviewCamp(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create dialog — 2-step */}
      <Dialog open={showCreate} onOpenChange={closeCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Email Campaign</DialogTitle>
            <DialogDescription className={tk.tm}>Step {step} of 2 — {step === 1 ? 'Audience & Content' : 'Preview & Schedule'}</DialogDescription>
          </DialogHeader>
          {step === 1 ? (
            <div className="space-y-4 py-1">
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Campaign Name *</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Annual Day ROI Pitch"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className={`${tk.t2} text-xs`}>Who do you want to reach?</Label>
                  {audienceCount !== null && audienceCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">~{audienceCount} contacts</span>
                  )}
                  {audienceCount === null && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tk.bdr} ${tk.tm}`}>resolved on launch</span>
                  )}
                </div>
                <div className="space-y-2">
                  {E_AUDIENCE_OPTS.map(opt => (
                    <div key={opt.key}>
                      <button onClick={() => setForm(p => ({ ...p, audience: opt.key, role_id: '' }))}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                          form.audience === opt.key ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
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
                      {opt.key === 'role' && form.audience === 'role' && roles.length > 0 && (
                        <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                          {roles.map(r => {
                            const rLow = r.name.toLowerCase();
                            const cnt = contacts.filter(c => c.contact_role_id === r.role_id || (c.designation || '').toLowerCase() === rLow).length;
                            if (cnt === 0) return null;
                            return (
                              <button key={r.role_id} onClick={() => setForm(p => ({ ...p, role_id: r.role_id }))}
                                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                                  form.role_id === r.role_id ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                }`}>
                                {r.name}
                                <span className={`font-bold text-[10px] ${form.role_id === r.role_id ? 'text-white/80' : tk.tm}`}>{cnt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {opt.key === 'tags' && form.audience === 'tags' && (allTags || []).length > 0 && (
                        <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                          {(allTags || []).map(tag => {
                            const sel = form.tag_ids.includes(tag.tag_id);
                            const cnt = contacts.filter(c => (c.tag_ids || []).includes(tag.tag_id)).length;
                            return (
                              <button key={tag.tag_id}
                                onClick={() => setForm(p => ({ ...p, tag_ids: sel ? p.tag_ids.filter(id => id !== tag.tag_id) : [...p.tag_ids, tag.tag_id] }))}
                                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border-2 transition-all ${sel ? 'text-white border-transparent' : `border-[var(--border-color)] ${tk.t2}`}`}
                                style={sel ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sel ? 'white' : tag.color }} />
                                {tag.name} <span className={`text-[10px] ${sel ? 'text-white/80' : tk.tm}`}>{cnt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {opt.key === 'lead_stage' && form.audience === 'lead_stage' && (
                        <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                          {E_PIPELINE_STAGES.map(s => {
                            const sel = form.lead_stages.includes(s.id);
                            return (
                              <button key={s.id}
                                onClick={() => setForm(p => ({ ...p, lead_stages: sel ? p.lead_stages.filter(x => x !== s.id) : [...p.lead_stages, s.id] }))}
                                className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`}`}>
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {opt.key === 'school_attrs' && form.audience === 'school_attrs' && (
                        <div className="mt-2 ml-7 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {['CBSE', 'ICSE', 'IB', 'State Board', 'Montessori'].map(bt => {
                              const sel = form.school_types.includes(bt);
                              return (
                                <button key={bt}
                                  onClick={() => setForm(p => ({ ...p, school_types: sel ? p.school_types.filter(x => x !== bt) : [...p.school_types, bt] }))}
                                  className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`}`}>
                                  {bt}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <p className={`text-[10px] ${tk.tm} mb-1`}>Min. strength</p>
                              <input type="number" min="0" placeholder="e.g. 500" value={form.min_strength}
                                onChange={e => setForm(p => ({ ...p, min_strength: e.target.value }))}
                                className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                            </div>
                            <div className="flex-1">
                              <p className={`text-[10px] ${tk.tm} mb-1`}>Cities (comma-sep.)</p>
                              <input type="text" placeholder="Delhi, Mumbai" value={form.school_cities}
                                onChange={e => setForm(p => ({ ...p, school_cities: e.target.value }))}
                                className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Use Template (optional)</Label>
                <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
                  {templates.map(t => {
                    const m = TMPL_CAT_META[t.category] || { bg: 'bg-gray-400/15', col: 'text-gray-400', label: t.category };
                    const selected = form.template_id === t.template_id;
                    return (
                      <button key={t.template_id} onClick={() => selected ? setForm(p => ({ ...p, template_id: '', subject: '', message: '' })) : pickTemplate(t)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${selected ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col}`}>{m.label}</span>
                          <p className={`text-xs font-medium ${tk.t1} truncate`}>{t.name}</p>
                        </div>
                        {t.subject && <p className={`text-[10px] ${tk.tm} mt-1 truncate`}>✉ {t.subject}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Email Subject *</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. How 750+ Schools Save ₹2–5 Lakhs on Craft"
                  value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Email Body</Label>
                <textarea rows={6} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                  placeholder="Write the email body. Use {name} and {school_name} for personalisation."
                  value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              {/* Email preview mock */}
              <div className={`border ${tk.bdr} rounded-xl overflow-hidden`}>
                <div className={`bg-[var(--bg-primary)] border-b ${tk.bdr} px-4 py-3`}>
                  <p className={`text-[10px] ${tk.tm} mb-0.5`}>From: SmartShape Team &lt;noreply@smartshape.in&gt;</p>
                  <p className={`text-[10px] ${tk.tm} mb-0.5`}>To: {audienceCount !== null ? `~${audienceCount} contacts` : 'audience resolved on launch'}</p>
                  <p className={`text-xs font-semibold ${tk.t1}`}>
                    {form.subject.replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School') || '(No subject)'}
                  </p>
                </div>
                <div className="p-4 bg-white/2">
                  <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                    {(form.message || '(No body)').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School').substring(0, 300)}
                    {form.message.length > 300 ? '…' : ''}
                  </p>
                </div>
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-2 block`}>Schedule</Label>
                <div className="flex gap-2">
                  {[{ key: 'draft', label: 'Save as Draft' }, { key: 'now', label: 'Send Immediately' }].map(opt => (
                    <button key={opt.key} onClick={() => setForm(p => ({ ...p, schedule: opt.key }))}
                      className={`flex-1 py-2 rounded-xl border-2 text-xs font-medium transition-all ${
                        form.schedule === opt.key ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={step === 1 ? closeCreate : () => setStep(1)}>
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step === 1 ? (
              <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                onClick={() => setStep(2)} disabled={!form.name.trim()}>Next: Preview →</Button>
            ) : (
              <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                onClick={createCampaign} disabled={saving}>{saving ? 'Saving…' : 'Create Campaign'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailTemplatesSubTab({ tk, templates, setTemplates }) {
  const [filterCat, setFilterCat] = useState('All');
  const [preview, setPreview] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_EMAIL_TMPL);
  const [saving, setSaving] = useState(false);

  const filtered = filterCat === 'All' ? templates : templates.filter(t => t.category === filterCat);

  async function create() {
    if (!form.name.trim()) { toast.error('Template name is required'); return; }
    if (!form.subject.trim()) { toast.error('Subject line is required'); return; }
    if (!form.body.trim()) { toast.error('Email body is required'); return; }
    setSaving(true);
    try {
      const vars = [];
      if (form.body.includes('{name}') || form.subject.includes('{name}')) vars.push('name');
      if (form.body.includes('{school_name}') || form.subject.includes('{school_name}')) vars.push('school_name');
      const res = await emailApi.createTemplate({ ...form, variables: vars });
      setTemplates(prev => [...prev, res.data]);
      setShowCreate(false);
      setForm(BLANK_EMAIL_TMPL);
      toast.success('Email template saved');
    } catch { toast.error('Failed to save template'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Email Templates
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>{templates.length} total</span>
          </h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Reusable email messages — select when creating campaigns</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Template
        </Button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TMPL_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c ? 'bg-[var(--accent)] text-white' : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {TMPL_CAT_META[c]?.label || c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(t => {
          const m = TMPL_CAT_META[t.category] || { label: t.category, col: 'text-gray-400', bg: 'bg-gray-400/15' };
          return (
            <div key={t.template_id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex flex-col gap-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} leading-tight`}>{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium mt-1 inline-block`}>{m.label}</span>
                </div>
                <button onClick={() => setPreview(t)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                  <Eye className={`h-3.5 w-3.5 ${tk.tm}`} />
                </button>
              </div>
              {t.subject && (
                <p className={`text-[11px] font-medium ${tk.t2} leading-tight`}>✉ {t.subject}</p>
              )}
              <p className={`text-[11px] ${tk.tm} leading-relaxed line-clamp-3`}>{t.body}</p>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1.5">
                  {(t.variables || []).map(v => (
                    <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)]">
                      {'{' + v + '}'}
                    </span>
                  ))}
                </div>
                {t.usage_count > 0 && <span className={`text-[10px] ${tk.tm}`}>Used {t.usage_count}×</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview dialog */}
      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto`}>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className={tk.t1}>{preview.name}</DialogTitle>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TMPL_CAT_META[preview.category]?.bg} ${TMPL_CAT_META[preview.category]?.col} font-medium`}>
                  {TMPL_CAT_META[preview.category]?.label || preview.category}
                </span>
              </div>
            </DialogHeader>
            {/* Email mock-up */}
            <div className={`border ${tk.bdr} rounded-xl overflow-hidden text-xs`}>
              <div className={`bg-[var(--bg-primary)] border-b ${tk.bdr} px-4 py-3 space-y-1`}>
                <div className="flex gap-2"><span className={`${tk.tm} w-12`}>From</span><span className={`${tk.t2}`}>SmartShape Team &lt;noreply@smartshape.in&gt;</span></div>
                <div className="flex gap-2"><span className={`${tk.tm} w-12`}>To</span><span className={`${tk.t2}`}>Ramesh Kumar &lt;ramesh@dpsdwarka.edu.in&gt;</span></div>
                <div className="flex gap-2">
                  <span className={`${tk.tm} w-12`}>Subject</span>
                  <span className={`font-semibold ${tk.t1}`}>
                    {(preview.subject || '').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School')}
                  </span>
                </div>
              </div>
              <div className="p-4">
                <p className={`text-[11px] ${tk.t2} leading-relaxed whitespace-pre-wrap`}>
                  {(preview.body || '').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School')}
                </p>
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
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Email Template</DialogTitle>
            <DialogDescription className={tk.tm}>Reusable email for campaigns. Use {'{name}'} and {'{school_name}'} for personalisation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Template Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Principal ROI Pitch"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Category</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TMPL_CAT_META).map(([k, m]) => (
                  <button key={k} onClick={() => setForm(p => ({ ...p, category: k }))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border-2 transition-all ${
                      form.category === k ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                    }`}>{m.label}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Subject Line</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. How 750+ Schools Save ₹2–5 Lakhs on Craft"
                value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Email Body</Label>
              <textarea rows={8} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                placeholder="Write the full email body here. Use {name} and {school_name} for personalisation."
                value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>{form.body.length} chars</p>
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

function EmailAnalyticsSubTab({ tk, analytics }) {
  if (!analytics) {
    return (
      <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
        <RefreshCw className={`h-8 w-8 ${tk.tm} mx-auto mb-3 animate-spin`} />
        <p className={`text-sm ${tk.t2}`}>Loading analytics…</p>
      </div>
    );
  }
  const { messages, campaigns: campData, by_type = {} } = analytics;
  const totalByType = Object.values(by_type).reduce((s, v) => s + v, 0);
  const kpis = [
    { label: 'Total Queued',       value: messages.total,     icon: Inbox,       col: 'text-blue-500',   bg: 'bg-blue-500/10' },
    { label: 'Emails Sent',        value: messages.sent,      icon: Send,        col: 'text-green-500',  bg: 'bg-green-500/10' },
    { label: 'Pending / In Queue', value: messages.pending,   icon: Clock,       col: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Failed',             value: messages.failed,    icon: AlertCircle, col: 'text-red-400',    bg: 'bg-red-400/10' },
    { label: 'Total Campaigns',    value: campData.total,     icon: Megaphone,   col: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: 'Live Campaigns',     value: campData.live,      icon: Activity,    col: 'text-cyan-500',   bg: 'bg-cyan-500/10' },
  ];
  return (
    <div className="space-y-5">
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
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <PieChart className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Emails by Type</h3>
          </div>
          {totalByType === 0 ? (
            <p className={`text-xs ${tk.tm} py-4 text-center`}>No emails queued yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(by_type).map(([type, count]) => {
                const pctVal = Math.round((count / totalByType) * 100);
                const colors = { campaign: { bar: 'bg-purple-500', txt: 'text-purple-500', lbl: 'Campaigns' }, drip: { bar: 'bg-blue-500', txt: 'text-blue-500', lbl: 'Drip' }, other: { bar: 'bg-gray-400', txt: 'text-gray-400', lbl: 'Other' } };
                const m = colors[type] || colors.other;
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${tk.t2}`}>{m.lbl}</span>
                      <span className={`text-xs font-bold ${m.txt}`}>{count.toLocaleString('en-IN')} · {pctVal}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--bg-primary)]">
                      <div className={`h-2 rounded-full ${m.bar} transition-all`} style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center gap-2 px-4 py-3 border-b ${tk.bdr}`}>
            <Target className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Campaign Performance</h3>
          </div>
          {campData.list.length === 0 ? (
            <p className={`text-xs ${tk.tm} p-4 text-center`}>No campaigns yet</p>
          ) : (
            <div className={`divide-y divide-[var(--border-color)]`}>
              {campData.list.slice(0, 6).map(c => (
                <div key={c.campaign_id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${tk.t1} truncate`}>{c.name}</p>
                    <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_count || 0} contacts</p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailSetupSubTab({ tk }) {
  const SEQUENCE = [
    { day: 'Day 0',  icon: AtSign,      col: 'text-blue-500',   bg: 'bg-blue-500/10',   title: 'Cold Introduction',      desc: 'Principal First Touch or Teacher Introduction — machine intro, 750+ schools, offer to share ROI sheet.' },
    { day: 'Day 3',  icon: TrendingUp,  col: 'text-purple-500', bg: 'bg-purple-500/10', title: 'ROI Calculator',          desc: 'Send personalised ROI calculation: how much the school spends vs how much they could save with SMARTS-SHAPES.' },
    { day: 'Day 7',  icon: Calendar,    col: 'text-orange-500', bg: 'bg-orange-500/10', title: 'Demo Invitation',         desc: 'Invite for a 20-minute live demo at school — show the machine in action, no obligation.' },
    { day: 'Day 14', icon: FileText,    col: 'text-cyan-500',   bg: 'bg-cyan-500/10',   title: 'Die Library Catalogue',  desc: 'Share the 750+ die catalogue PDF — helps the school visualise activity planning for the full year.' },
    { day: 'Day 21', icon: Gift,        col: 'text-green-500',  bg: 'bg-green-500/10',  title: 'Bundle Offer',           desc: 'Academic Year Bundle: machine + free 50-die starter pack + priority installation + flexible EMI.' },
    { day: 'Day 30', icon: Star,        col: 'text-amber-500',  bg: 'bg-amber-500/10',  title: 'Peer Success Story',     desc: 'Share a story: a nearby similar school saving ₹4L/year — builds credibility and social proof.' },
    { day: 'Day 45', icon: RefreshCw,   col: 'text-red-400',    bg: 'bg-red-400/10',    title: 'Re-engagement',          desc: 'Cold Lead Revival: "It\'s been a while — here\'s what\'s new." New dies, better pricing, peer installs.' },
  ];
  return (
    <div className="space-y-5">
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${tk.t1}`}>SmartShape Email Marketing Blueprint</h3>
            <p className={`text-xs ${tk.tm}`}>7-touch cold-to-warm sequence for school B2B email outreach</p>
          </div>
        </div>
        <div className="space-y-3">
          {SEQUENCE.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <Icon className={`h-3.5 w-3.5 ${s.col}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${s.bg} ${s.col} font-semibold`}>{s.day}</span>
                    <p className={`text-xs font-semibold ${tk.t1}`}>{s.title}</p>
                  </div>
                  <p className={`text-[11px] ${tk.tm} mt-0.5 leading-relaxed`}>{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <h3 className={`text-sm font-semibold ${tk.t1} mb-3`}>Email Best Practices for School B2B</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Best Send Time',        value: 'Tue–Thu, 8–10am or 4–6pm',      icon: Clock },
            { label: 'Subject Line Length',   value: 'Under 60 characters',            icon: FileText },
            { label: 'Personalisation',       value: 'Always use {name} & school name', icon: Users },
            { label: 'Follow-up Timing',      value: '3–7 days after no reply',         icon: RefreshCw },
            { label: 'Unsubscribe Compliance', value: 'Always include opt-out link',    icon: CheckCircle },
            { label: 'Mobile Preview',        value: 'Test subject on mobile first',    icon: PhoneIcon },
          ].map(tip => {
            const Icon = tip.icon;
            return (
              <div key={tip.label} className={`flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-primary)] border ${tk.bdr}`}>
                <Icon className={`h-4 w-4 ${tk.tm} flex-shrink-0`} />
                <div>
                  <p className={`text-[11px] font-semibold ${tk.t2}`}>{tip.label}</p>
                  <p className={`text-[10px] ${tk.tm}`}>{tip.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmailHubTab({ tk }) {
  const [subTab, setSubTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [roles, setRoles] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);

  function reload() {
    emailApi.getCampaigns().then(r => setCampaigns((r.data || []).map(mapCampaign))).catch(() => {});
    emailApi.getTemplates().then(r => setTemplates(r.data || [])).catch(() => {});
    emailApi.getAnalytics().then(r => setAnalytics(r.data)).catch(() => {});
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
    tagsApi.getAll().then(r => setAllTags(r.data || [])).catch(() => {});
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line

  const EMAIL_SUBTABS = [
    { key: 'campaigns', label: 'Campaigns', Icon: Megaphone },
    { key: 'templates', label: 'Templates', Icon: FileText },
    { key: 'analytics', label: 'Analytics', Icon: PieChart },
    { key: 'setup',     label: 'Setup',     Icon: Key },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className={`flex items-center gap-0.5 p-1 ${tk.card} border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar`}>
        {EMAIL_SUBTABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              subTab === key
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                : `${tk.tm} ${tk.hov} hover:text-[var(--text-secondary)]`
            }`}>
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={reload} className={`h-8 w-8 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${tk.tm}`} />
        </button>
      </div>

      {subTab === 'campaigns' && <EmailCampaignsSubTab tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} templates={templates} allTags={allTags} />}
      {subTab === 'templates' && <EmailTemplatesSubTab tk={tk} templates={templates} setTemplates={setTemplates} />}
      {subTab === 'analytics' && <EmailAnalyticsSubTab tk={tk} analytics={analytics} />}
      {subTab === 'setup'     && <EmailSetupSubTab     tk={tk} />}
    </div>
  );
}

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
  const { isDark } = useTheme();
  const tk = useTk(isDark);

  const [tab, setTab] = useState('overview');
  const [waConnected, setWaConnected] = useState(false);
  // Evolution API state
  const [evolutionState, setEvolutionState] = useState('close');  // open | connecting | close
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
    // Check Evolution API connection
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
      // Ensure instance exists first
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

  // Poll evolution status every 10 s while QR dialog is open (to auto-close on connect)
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
    <AdminLayout>
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

          {/* Content */}
          {tab === 'overview'  && <OverviewTab   tk={tk} campaigns={campaigns} greetings={greetings} drips={drips} waConnected={waConnected} setTab={setTab} analytics={analytics} loadDemo={loadDemo} clearDemo={clearDemo} />}
          {tab === 'campaigns' && <CampaignsTab  tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} templates={templates} allTags={allTags} waConnected={waConnected} openQrDialog={openQrDialog} />}
          {tab === 'templates' && <TemplatesTab  tk={tk} templates={templates} setTemplates={setTemplates} />}
          {tab === 'greetings' && <GreetingsTab  tk={tk} greetings={greetings} setGreetings={setGreetings} />}
          {tab === 'drips'     && <DripsTab      tk={tk} drips={drips} setDrips={setDrips} />}
          {tab === 'analytics' && <AnalyticsTab  tk={tk} analytics={analytics} campaigns={campaigns} />}
          {tab === 'setup'     && <WhatsAppSetupTab tk={tk} waConnected={waConnected} setWaConnected={setWaConnected} evolutionState={evolutionState} openQrDialog={openQrDialog} />}
          {tab === 'email'     && <EmailHubTab   tk={tk} />}
        </div>
      </div>

      {/* ── Evolution API QR Connect Dialog ───────────────────────────────── */}
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
            {/* QR code area */}
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

            {/* Status indicator */}
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
    </AdminLayout>
  );
}
