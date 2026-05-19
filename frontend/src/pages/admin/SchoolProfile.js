import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { schools as schoolsApi, contacts as contactsApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, Globe, MapPin, Users, Eye,
  MessageSquare, Calendar, Clock, Package, FileText,
  PhoneCall, Send, BarChart2, Plus, TrendingUp, Activity, Building2,
} from 'lucide-react';

// ── Design tokens ────────────────────────────────────────────────────────────
function useTk(isDark) {
  return isDark ? {
    page:    'bg-[var(--bg-primary)]',
    card:    'bg-[var(--bg-card)]',
    border:  'border-[var(--border-color)]',
    divide:  'divide-[var(--border-color)]',
    t1:      'text-[var(--text-primary)]',
    t2:      'text-[var(--text-secondary)]',
    tm:      'text-[var(--text-muted)]',
    input:   'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    avatar:  'bg-[var(--bg-primary)] text-[var(--text-primary)]',
  } : {
    page:    'bg-[#f8fafc]',
    card:    'bg-white',
    border:  'border-[#e2e8f0]',
    divide:  'divide-[#e2e8f0]',
    t1:      'text-[#0f172a]',
    t2:      'text-[#334155]',
    tm:      'text-[#94a3b8]',
    input:   'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    avatar:  'bg-[#f1f5f9] text-[#0f172a]',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function fmtMoney(n) {
  if (!n) return '₹0';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

// ── Badge ────────────────────────────────────────────────────────────────────
const STAGE_CLS = {
  new:         'bg-blue-50 text-blue-700',
  contacted:   'bg-cyan-50 text-cyan-700',
  demo:        'bg-violet-50 text-violet-700',
  quoted:      'bg-amber-50 text-amber-700',
  negotiation: 'bg-orange-50 text-orange-700',
  won:         'bg-emerald-50 text-emerald-700',
  retention:   'bg-teal-50 text-teal-700',
  resell:      'bg-indigo-50 text-indigo-700',
  lost:        'bg-red-50 text-red-600',
};
const QUOT_CLS = {
  draft:     'bg-slate-100 text-slate-600',
  pending:   'bg-amber-50 text-amber-700',
  sent:      'bg-blue-50 text-blue-700',
  confirmed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-600',
};

function Badge({ label, cls }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${cls || 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

function AgingChip({ days }) {
  if (days === null || days === undefined)
    return <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">Never contacted</span>;
  const cls = days < 7  ? 'bg-emerald-50 text-emerald-700'
            : days < 30 ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-[#e94560]';
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{days}d since contact</span>;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'contacts',  label: 'Contacts' },
  { id: 'leads',     label: 'Leads'    },
  { id: 'sales',     label: 'Sales'    },
  { id: 'marketing', label: 'Marketing'},
  { id: 'visits',    label: 'Visits'   },
  { id: 'feed',      label: 'Activity' },
];

// ── Info row (overview card) ─────────────────────────────────────────────────
function InfoRow({ label, value, href, tm, t2 }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#f1f5f9] last:border-0">
      <span className={`text-[10px] uppercase tracking-wider font-semibold w-24 flex-shrink-0 mt-0.5 ${tm}`}>{label}</span>
      {href
        ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
             className="text-sm text-[#e94560] hover:underline break-all">{value}</a>
        : <span className={`text-sm ${t2} break-all`}>{value}</span>
      }
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="py-20 text-center">
      <p className="text-sm text-[#94a3b8]">{label}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function SchoolProfile() {
  const { school_id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const tk = useTk(isDark);

  const [profile,          setProfile]          = useState(null);
  const [loading,          setLoading]           = useState(true);
  const [activeTab,        setActiveTab]         = useState('overview');
  const [expandedContact,  setExpandedContact]   = useState(null);
  const [stageFilter,      setStageFilter]       = useState('all');
  const [contactOpen,      setContactOpen]       = useState(false);
  const [contactForm,      setContactForm]       = useState({ name: '', phone: '', email: '', designation: '', notes: '' });
  const [saving,           setSaving]            = useState(false);
  const [mounted,          setMounted]           = useState(false);

  useEffect(() => { loadProfile(); }, [school_id]); // eslint-disable-line
  useEffect(() => { if (!loading) { const t = setTimeout(() => setMounted(true), 40); return () => clearTimeout(t); } }, [loading]);

  async function loadProfile() {
    try {
      setLoading(true);
      const res = await schoolsApi.getProfile(school_id);
      setProfile(res.data);
    } catch {
      toast.error('Failed to load school profile');
      navigate('/leads');
    } finally {
      setLoading(false);
    }
  }

  async function saveContact() {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) { toast.error('Name and phone required'); return; }
    setSaving(true);
    try {
      await contactsApi.create({ ...contactForm, company: profile?.school?.school_name || '' });
      toast.success('Contact added');
      setContactOpen(false);
      loadProfile();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminLayout>
        <div className={`min-h-screen ${tk.page} flex items-center justify-center`}>
          <div className="w-7 h-7 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }
  if (!profile) return null;

  const { school, leads, contacts, quotations, visits, call_notes, meetings, dispatches, metrics } = profile;

  // ── Unified activity feed ─────────────────────────────────────────────────
  const feedItems = [
    ...call_notes.map(n => ({
      date: n.created_at, dot: 'bg-blue-400',
      label: `Call note · ${n.created_by_name || n.created_by || '—'}`,
      detail: n.content || n.outcome || '',
    })),
    ...visits.map(v => ({
      date: v.visit_date, dot: 'bg-violet-400',
      label: `Visit · ${v.executive_name || '—'}`,
      detail: v.purpose || v.notes || '',
    })),
    ...meetings.map(m => ({
      date: m.followup_date, dot: 'bg-indigo-400',
      label: `Meeting · ${m.assigned_to || '—'}`,
      detail: m.notes || '',
    })),
    ...quotations.map(q => ({
      date: q.created_at, dot: 'bg-emerald-400',
      label: `Quotation ${q.quotation_number || ''} · ${q.status}`,
      detail: fmtMoney(q.grand_total),
    })),
    ...dispatches.map(d => ({
      date: d.sent_date || d.created_at, dot: 'bg-amber-400',
      label: `${d.material_type} dispatched`,
      detail: d.courier_name ? `Via ${d.courier_name}${d.tracking_number ? ' · ' + d.tracking_number : ''}` : '',
    })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 50);

  const filteredLeads = stageFilter === 'all' ? leads : leads.filter(l => l.stage === stageFilter);

  // Reveal animation
  const rv = (delay = '') => `transition-all duration-500 ease-out ${delay} ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`;

  return (
    <AdminLayout>
      <style>{`
        .sp-tab { animation: spTabIn .18s ease forwards; }
        @keyframes spTabIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        .sp-scroll::-webkit-scrollbar { display: none; }
        .sp-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .sp-num { font-variant-numeric: tabular-nums; }
      `}</style>

      <div className={`min-h-screen ${tk.page}`}>

        {/* ═══ HERO HEADER ════════════════════════════════════════════════════ */}
        <div className={`${tk.card} border-b ${tk.border}`}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-6">

            {/* Breadcrumb */}
            <div className={`${rv()} flex items-center gap-2 mb-5`}>
              <button onClick={() => navigate(-1)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${tk.tm} hover:text-[#e94560] transition-colors`}>
                <ArrowLeft className="h-3.5 w-3.5" />Back
              </button>
              <span className={`text-xs ${tk.tm} opacity-40`}>/</span>
              <span className={`text-xs ${tk.tm}`}>School Profile</span>
            </div>

            {/* School name — editorial headline */}
            <div className={`${rv('delay-75')}`}>
              <h1 className={`text-3xl sm:text-4xl lg:text-[2.75rem] font-black tracking-tight leading-[1.05] ${tk.t1} mb-3`}>
                {school.school_name}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                {school.school_type && (
                  <span className={`text-[11px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${tk.border} ${tk.tm}`}>
                    {school.school_type}
                  </span>
                )}
                {school.board && (
                  <span className={`text-[11px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${tk.border} ${tk.tm}`}>
                    {school.board}
                  </span>
                )}
                <AgingChip days={metrics.days_since_last_contact} />
              </div>
              {(school.city || school.school_strength > 0 || school.estd_year) && (
                <div className={`flex items-center gap-4 mt-2.5 text-sm ${tk.tm} flex-wrap`}>
                  {school.city && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {school.city}{school.state ? `, ${school.state}` : ''}
                    </span>
                  )}
                  {school.school_strength > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {school.school_strength.toLocaleString('en-IN')} students
                    </span>
                  )}
                  {school.estd_year && <span>Est. {school.estd_year}</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ KPI STRIP ══════════════════════════════════════════════════════ */}
        <div className={`${tk.card} border-b ${tk.border}`}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`${rv('delay-100')} grid grid-cols-3 sm:grid-cols-6 divide-x ${tk.divide}`}>
              {[
                { v: metrics.total_leads,                          label: 'Leads',    accent: false },
                { v: metrics.active_leads,                         label: 'Active',   accent: false },
                { v: metrics.total_contacts,                       label: 'Contacts', accent: false },
                { v: metrics.total_visits,                         label: 'Visits',   accent: false },
                { v: metrics.total_calls,                          label: 'Calls',    accent: false },
                { v: fmtMoney(metrics.total_revenue_quoted),       label: 'Pipeline', accent: true  },
              ].map(({ v, label, accent }) => (
                <div key={label} className="px-3 sm:px-5 py-4 sm:py-5 text-center">
                  <p className={`sp-num text-2xl sm:text-3xl font-black leading-none ${accent ? 'text-[#e94560]' : tk.t1}`}>{v}</p>
                  <p className={`text-[10px] uppercase tracking-widest font-semibold mt-1 ${tk.tm}`}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ TAB BAR ════════════════════════════════════════════════════════ */}
        <div className={`${tk.card} border-b ${tk.border} sticky top-0 z-20`}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex sp-scroll overflow-x-auto">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-shrink-0 px-4 py-3.5 text-xs sm:text-sm font-semibold tracking-wide transition-colors whitespace-nowrap ${
                    activeTab === tab.id ? 'text-[#e94560]' : `${tk.tm} hover:${isDark ? 'text-[var(--text-secondary)]' : 'text-[#475569]'}`
                  }`}>
                  {tab.label}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 inset-x-0 h-[2px] bg-[#e94560] rounded-t" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ TAB CONTENT ════════════════════════════════════════════════════ */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

          {/* ─── OVERVIEW ─────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="sp-tab grid grid-cols-1 lg:grid-cols-5 gap-5">

              {/* School info */}
              <div className={`lg:col-span-2 ${tk.card} border ${tk.border} rounded-2xl overflow-hidden`}>
                <div className={`px-5 py-4 border-b ${tk.border}`}>
                  <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tk.tm}`}>School Information</p>
                </div>
                <div className="px-5 py-1">
                  {school.address              && <InfoRow label="Address"  value={school.address}              tm={tk.tm} t2={tk.t2} />}
                  {school.phone                && <InfoRow label="Phone"    value={school.phone}    href={`tel:${school.phone}`}           tm={tk.tm} t2={tk.t2} />}
                  {school.email                && <InfoRow label="Email"    value={school.email}    href={`mailto:${school.email}`}        tm={tk.tm} t2={tk.t2} />}
                  {school.website              && <InfoRow label="Website"  value={school.website}  href={school.website}                  tm={tk.tm} t2={tk.t2} />}
                  {school.primary_contact_name && <InfoRow label="Contact"  value={`${school.primary_contact_name}${school.designation ? ' · ' + school.designation : ''}`} tm={tk.tm} t2={tk.t2} />}
                  {school.alternate_contact    && <InfoRow label="Alt."     value={school.alternate_contact}   tm={tk.tm} t2={tk.t2} />}
                  {school.existing_vendor      && <InfoRow label="Vendor"   value={school.existing_vendor}     tm={tk.tm} t2={tk.t2} />}
                  {school.annual_budget_range  && <InfoRow label="Budget"   value={school.annual_budget_range} tm={tk.tm} t2={tk.t2} />}
                  {school.number_of_branches > 1 && <InfoRow label="Branches" value={school.number_of_branches} tm={tk.tm} t2={tk.t2} />}
                  {!school.address && !school.phone && !school.email && (
                    <p className={`py-4 text-sm ${tk.tm}`}>No details on record.</p>
                  )}
                </div>
              </div>

              {/* Recent activity timeline */}
              <div className={`lg:col-span-3 ${tk.card} border ${tk.border} rounded-2xl overflow-hidden`}>
                <div className={`px-5 py-4 border-b ${tk.border} flex items-center justify-between`}>
                  <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tk.tm}`}>Recent Activity</p>
                  {feedItems.length > 6 && (
                    <button onClick={() => setActiveTab('feed')}
                      className="text-[11px] text-[#e94560] hover:underline">
                      All {feedItems.length} →
                    </button>
                  )}
                </div>
                <div className="px-5 py-5">
                  {feedItems.length === 0 ? (
                    <p className={`text-sm ${tk.tm}`}>No activity recorded yet.</p>
                  ) : (
                    <div className="relative pl-6">
                      {/* Spine */}
                      <div className={`absolute left-1.5 top-0 bottom-0 w-px ${isDark ? 'bg-[var(--border-color)]' : 'bg-[#e2e8f0]'}`} />
                      <div className="space-y-5">
                        {feedItems.slice(0, 6).map((item, i) => (
                          <div key={i} className="relative">
                            <div className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full border-2 ${isDark ? 'border-[var(--bg-card)]' : 'border-white'} ${item.dot}`} />
                            <p className={`text-sm font-medium ${tk.t1} leading-snug`}>{item.label}</p>
                            {item.detail && <p className={`text-xs ${tk.tm} mt-0.5 truncate`}>{item.detail}</p>}
                            <p className={`text-[11px] ${tk.tm} mt-0.5`}>{fmt(item.date)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── CONTACTS ─────────────────────────────────────────────────── */}
          {activeTab === 'contacts' && (
            <div className="sp-tab space-y-4">
              <div className="flex items-center justify-between">
                <p className={`text-sm ${tk.tm}`}>
                  {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
                </p>
                <Button size="sm"
                  onClick={() => { setContactForm({ name: '', phone: '', email: '', designation: '', notes: '' }); setContactOpen(true); }}
                  className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8 px-4 text-xs rounded-lg">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />Add Contact
                </Button>
              </div>

              {contacts.length === 0 ? <EmptyState label="No contacts linked to this school yet." /> : (
                <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                  {contacts.map(c => (
                    <div key={c.contact_id}>
                      <div className="px-5 py-4 flex items-center gap-4">
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold ${tk.avatar}`}>
                          {c.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-semibold text-sm ${tk.t1}`}>{c.name}</span>
                            {c.designation && <span className={`text-xs ${tk.tm}`}>{c.designation}</span>}
                            {c.converted_to_lead && <Badge label="Converted" cls="bg-emerald-50 text-emerald-700" />}
                          </div>
                          <div className="flex items-center gap-4 mt-1 flex-wrap">
                            {c.phone && <a href={`tel:${c.phone}`} className={`text-xs ${tk.tm} hover:text-[#e94560] flex items-center gap-1`}><Phone className="h-3 w-3" />{c.phone}</a>}
                            {c.email && <a href={`mailto:${c.email}`} className={`text-xs ${tk.tm} hover:text-[#e94560] flex items-center gap-1 truncate max-w-[200px]`}><Mail className="h-3 w-3" />{c.email}</a>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {c.phone && (
                            <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="ghost" className="text-emerald-500 h-8 w-8 p-0">
                                <MessageSquare className="h-4 w-4" />
                              </Button>
                            </a>
                          )}
                          <Button size="sm" variant="ghost"
                            onClick={() => setExpandedContact(expandedContact === c.contact_id ? null : c.contact_id)}
                            className={`${tk.tm} h-8 px-2.5 text-xs`}>
                            {expandedContact === c.contact_id ? 'Less' : 'More'}
                          </Button>
                        </div>
                      </div>
                      {expandedContact === c.contact_id && (
                        <div className={`px-5 pb-4 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-3 border-t ${tk.border}`}>
                          {c.source    && <div><p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Source</p><p className={`text-xs ${tk.t2}`}>{c.source}</p></div>}
                          {c.birthday  && <div><p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Birthday</p><p className={`text-xs ${tk.t2}`}>{fmt(c.birthday)}</p></div>}
                          <div><p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Added</p><p className={`text-xs ${tk.t2}`}>{fmt(c.created_at)}</p></div>
                          {c.notes     && <div className="col-span-2 sm:col-span-3"><p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Notes</p><p className={`text-xs ${tk.t2}`}>{c.notes}</p></div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── LEADS ────────────────────────────────────────────────────── */}
          {activeTab === 'leads' && (
            <div className="sp-tab space-y-4">
              {/* Stage chips */}
              <div className="flex items-center gap-2 flex-wrap">
                {['all', 'new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost'].map(s => (
                  <button key={s} onClick={() => setStageFilter(s)}
                    className={`text-[11px] px-3 py-1 rounded-full font-semibold transition-all border capitalize ${
                      stageFilter === s
                        ? 'bg-[#e94560] text-white border-[#e94560]'
                        : `${tk.border} ${tk.tm} hover:border-[#e94560] hover:text-[#e94560]`
                    }`}>
                    {s === 'all' ? `All · ${leads.length}` : s}
                  </button>
                ))}
              </div>

              {filteredLeads.length === 0 ? <EmptyState label="No leads match this filter." /> : (
                <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                  {filteredLeads.map(lead => (
                    <div key={lead.lead_id} className="px-5 py-4 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold text-sm ${tk.t1}`}>{lead.contact_name}</span>
                          {lead.stage     && <Badge label={lead.stage}     cls={STAGE_CLS[lead.stage]} />}
                          {lead.lead_type && <Badge label={lead.lead_type} cls={
                            lead.lead_type === 'hot' ? 'bg-red-50 text-red-600'
                          : lead.lead_type === 'warm' ? 'bg-amber-50 text-amber-700'
                          : 'bg-blue-50 text-blue-700'} />}
                        </div>
                        {(lead.designation || lead.contact_phone) && (
                          <p className={`text-xs ${tk.tm} mt-0.5`}>
                            {lead.designation}{lead.designation && lead.contact_phone ? ' · ' : ''}{lead.contact_phone}
                          </p>
                        )}
                        <div className={`flex items-center gap-4 mt-1.5 text-xs ${tk.tm} flex-wrap`}>
                          {lead.assigned_name      && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{lead.assigned_name}</span>}
                          {lead.next_followup_date && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Followup {fmt(lead.next_followup_date)}</span>}
                        </div>
                      </div>
                      <Link to={`/leads?lead=${lead.lead_id}`}>
                        <Button size="sm" variant="ghost" className={`${tk.tm} hover:text-[#e94560] h-8 w-8 p-0`} title="Open Lead">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── SALES ────────────────────────────────────────────────────── */}
          {activeTab === 'sales' && (
            <div className="sp-tab space-y-4">
              {quotations.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className={`text-sm ${tk.tm}`}>{quotations.length} quotation{quotations.length !== 1 ? 's' : ''}</p>
                  <p className={`text-sm font-semibold ${tk.t1}`}>
                    Pipeline: <span className="text-[#e94560]">{fmtMoney(metrics.total_revenue_quoted)}</span>
                  </p>
                </div>
              )}

              {quotations.length === 0 ? <EmptyState label="No quotations found for this school." /> : (
                <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                  {quotations.map(q => (
                    <div key={q.quotation_id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold text-sm ${tk.t1}`}>{q.quotation_number || q.quotation_id}</span>
                          <Badge label={q.status} cls={QUOT_CLS[q.status]} />
                        </div>
                        <p className="sp-num text-xl font-black text-[#e94560] mt-0.5">{fmtMoney(q.grand_total)}</p>
                        <div className={`flex items-center gap-3 mt-0.5 text-xs ${tk.tm} flex-wrap`}>
                          {q.items?.length > 0 && <span>{q.items.length} item{q.items.length !== 1 ? 's' : ''}</span>}
                          {q.created_by_name && <span>{q.created_by_name}</span>}
                          <span>{fmt(q.created_at)}</span>
                        </div>
                      </div>
                      <Link to={`/view-quotation/${q.quotation_id}`}>
                        <Button size="sm" variant="ghost" className={`${tk.tm} hover:text-[#e94560] h-8 w-8 p-0`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── MARKETING ────────────────────────────────────────────────── */}
          {activeTab === 'marketing' && (
            <div className="sp-tab space-y-4">
              <p className={`text-sm ${tk.tm}`}>{dispatches.length} dispatch{dispatches.length !== 1 ? 'es' : ''}</p>
              {dispatches.length === 0 ? <EmptyState label="No physical dispatches recorded for this school." /> : (
                <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                  {dispatches.map((d, i) => (
                    <div key={i} className="px-5 py-4 flex items-start gap-4">
                      <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-2" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold text-sm ${tk.t1} capitalize`}>{d.material_type}</span>
                          {d.received_confirmed && <Badge label="Received" cls="bg-emerald-50 text-emerald-700" />}
                        </div>
                        {d.description && <p className={`text-xs ${tk.tm} mt-0.5`}>{d.description}</p>}
                        <div className={`flex items-center gap-3 mt-1 text-xs ${tk.tm} flex-wrap`}>
                          {d.courier_name    && <span>Via {d.courier_name}</span>}
                          {d.tracking_number && <span>#{d.tracking_number}</span>}
                          <span>{fmt(d.sent_date || d.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── VISITS & MEETINGS ────────────────────────────────────────── */}
          {activeTab === 'visits' && (() => {
            const items = [
              ...visits.map(v => ({ ...v, _type: 'visit', _date: v.visit_date })),
              ...meetings.map(m => ({ ...m, _type: 'meeting', _date: m.followup_date })),
            ].sort((a, b) => (b._date || '').localeCompare(a._date || ''));
            return (
              <div className="sp-tab">
                {items.length === 0 ? <EmptyState label="No visits or meetings recorded for this school." /> : (
                  <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                    {items.map((item, i) => (
                      <div key={i} className="px-5 py-4 flex items-start gap-4">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${item._type === 'visit' ? 'bg-blue-400' : 'bg-violet-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge label={item._type} cls={item._type === 'visit' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'} />
                            <span className={`text-xs ${tk.tm}`}>{fmt(item._date)}</span>
                          </div>
                          {item._type === 'visit' ? (
                            <>
                              {item.executive_name && <p className={`text-sm font-medium ${tk.t1} mt-1`}>{item.executive_name}</p>}
                              {item.purpose        && <p className={`text-xs ${tk.tm} mt-0.5`}>{item.purpose}</p>}
                              {item.outcome        && <p className={`text-xs ${tk.tm}`}>Outcome: {item.outcome}</p>}
                            </>
                          ) : (
                            <>
                              {item.assigned_to && <p className={`text-sm font-medium ${tk.t1} mt-1`}>{item.assigned_to}</p>}
                              {item.notes       && <p className={`text-xs ${tk.tm} mt-0.5`}>{item.notes}</p>}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─── ACTIVITY FEED ────────────────────────────────────────────── */}
          {activeTab === 'feed' && (
            <div className="sp-tab">
              {feedItems.length === 0 ? <EmptyState label="No activity recorded for this school yet." /> : (
                <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
                  {feedItems.map((item, i) => (
                    <div key={i} className="px-5 py-3.5 flex items-start gap-4">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${item.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-sm font-medium ${tk.t1}`}>{item.label}</p>
                          <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>{fmt(item.date)}</span>
                        </div>
                        {item.detail && <p className={`text-xs ${tk.tm} mt-0.5 truncate`}>{item.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ═══ ADD CONTACT DIALOG ═════════════════════════════════════════════ */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className={`${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[#e2e8f0]'} w-[calc(100vw-1.5rem)] sm:max-w-md rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Add Contact</DialogTitle>
            <DialogDescription className={tk.tm}>Linked to {profile?.school?.school_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Name *</Label>
                <Input value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Full name" />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Phone *</Label>
                <Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="+91 98765..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Email</Label>
                <Input value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="email@school.edu" />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Designation</Label>
                <Input value={contactForm.designation} onChange={e => setContactForm({ ...contactForm, designation: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Principal, Admin..." />
              </div>
            </div>
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Notes</Label>
              <Input value={contactForm.notes} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })}
                className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Any additional info..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setContactOpen(false)} className={tk.tm}>Cancel</Button>
            <Button onClick={saveContact} disabled={saving}
              className="bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-5">
              {saving ? 'Saving...' : 'Save Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}
