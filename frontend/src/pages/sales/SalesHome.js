import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SalesLayout from '../../components/layouts/SalesLayout';
import {
  attendance as attendanceApi, visits as visitsApi,
  leads as leadsApi, tasks as tasksApi,
  contacts as contactsApi, quotations as quotationsApi,
} from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Calendar, MapPin, FileText, Receipt,
  Target, CheckCircle, Clock, Phone, MessageSquare,
  ChevronRight, User, AlertCircle,
} from 'lucide-react';
import { Button } from '../../components/ui/button';

// ── Design tokens ────────────────────────────────────────────
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const STAGE = {
  new:         { label: 'New',         cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  contacted:   { label: 'Contacted',   cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  demo:        { label: 'Demo',        cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  quoted:      { label: 'Quoted',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  negotiation: { label: 'Negotiation', cls: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  won:         { label: 'Won',         cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  lost:        { label: 'Lost',        cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const QSTATUS = {
  draft:    'bg-gray-500/20 text-gray-400',
  sent:     'bg-blue-500/20 text-blue-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
};

// ── Helpers ──────────────────────────────────────────────────
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const openWa = (phone) => {
  const n = phone?.replace(/\D/g, '');
  if (n) window.open(`https://wa.me/${n.startsWith('91') ? n : '91' + n}`, '_blank');
};

// ── Component ────────────────────────────────────────────────
export default function SalesHome() {
  const { user } = useAuth();
  const today     = new Date().toISOString().split('T')[0];

  const [tab,  setTab]  = useState('overview');
  const [data, setData] = useState({
    attendance: null, visits: [], leads: [], contacts: [],
    quotations: [], overdue: [], todayTasks: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [att, vis, ldr, tsk, ctr, qts] = await Promise.all([
        attendanceApi.getToday().catch(() => ({ data: null })),
        visitsApi.getAll().catch(() => ({ data: [] })),
        leadsApi.getAll().catch(() => ({ data: [] })),
        tasksApi.getAll().catch(() => ({ data: [] })),
        contactsApi.getAll().catch(() => ({ data: [] })),
        quotationsApi.getAll().catch(() => ({ data: [] })),
      ]);

      const allVisits  = vis.data || [];
      const allLeads   = ldr.data || [];
      const allTasks   = tsk.data || [];
      const allContacts = ctr.data || [];
      const allQuots   = qts.data || [];

      setData({
        attendance:  att.data,
        visits:      allVisits.filter(v => v.visit_date === today),
        leads:       allLeads.filter(l => l.stage !== 'won' && l.stage !== 'lost'),
        contacts:    allContacts.slice(0, 30),
        quotations:  allQuots.slice(0, 15),
        overdue:     allTasks.filter(t => t.status === 'pending' && t.due_date < today)
                             .sort((a, b) => a.due_date.localeCompare(b.due_date)),
        todayTasks:  allTasks.filter(t => t.status === 'pending' && t.due_date === today),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const kpi = {
    leads:    data.leads.length,
    followups: data.overdue.length + data.todayTasks.length,
    visits:   data.visits.length,
    quotes:   data.quotations.filter(q => ['draft','sent'].includes(q.quotation_status)).length,
  };

  const TABS = [
    { id: 'overview',   label: 'Overview' },
    { id: 'leads',      label: `Leads (${kpi.leads})` },
    { id: 'contacts',   label: `Contacts (${data.contacts.length})` },
    { id: 'quotations', label: 'Quotes' },
  ];

  if (loading) return (
    <SalesLayout title="My Dashboard">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="My Dashboard">
      <div className="space-y-4 pb-28">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-xs ${tMuted}`}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className={`text-xl font-bold ${tPri} mt-0.5`}>
              {greeting()}, {user?.name?.split(' ')[0]} 👋
            </h1>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#e94560]/15 border border-[#e94560]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[#e94560] font-bold text-sm">{user?.name?.charAt(0)?.toUpperCase()}</span>
          </div>
        </div>

        {/* ── Attendance Banner ── */}
        {!data.attendance ? (
          <Link to="/sales/attendance">
            <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-[#f59e0b] flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#f59e0b]">Not checked in yet</p>
                  <p className={`text-xs ${tMuted}`}>Tap to check in for today</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[#f59e0b]" />
            </div>
          </Link>
        ) : (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3.5 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-400">Checked in</p>
              <p className={`text-xs ${tMuted}`}>
                {new Date(data.attendance.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                {' · '}{data.attendance.work_type?.replace('_', ' ')}
              </p>
            </div>
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { icon: Target,      label: 'Active Leads',    value: kpi.leads,    color: 'text-blue-400',             bg: 'bg-blue-400/10',    alert: false },
            { icon: Clock,       label: 'Follow-ups Due',  value: kpi.followups, color: kpi.followups > 0 ? 'text-[#e94560]' : 'text-green-400', bg: kpi.followups > 0 ? 'bg-[#e94560]/10' : 'bg-green-400/10', alert: kpi.followups > 0 },
            { icon: MapPin,      label: "Today's Visits",  value: kpi.visits,   color: 'text-purple-400',           bg: 'bg-purple-400/10',  alert: false },
            { icon: FileText,    label: 'Open Quotes',     value: kpi.quotes,   color: 'text-orange-400',           bg: 'bg-orange-400/10',  alert: false },
          ].map(({ icon: Icon, label, value, color, bg, alert }) => (
            <div key={label} className={`${card} ${alert ? 'border-[#e94560]/40' : ''} rounded-xl p-3.5`}>
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-2`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className={`text-[11px] ${tMuted} mt-0.5`}>{label}</p>
            </div>
          ))}
        </div>

        {/* ── Section Tabs ── */}
        <div className="flex gap-1 bg-[var(--bg-primary)] rounded-lg p-1 border border-[var(--border-color)]">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-[11px] py-1.5 rounded-md font-medium transition-all truncate ${
                tab === t.id ? 'bg-[#e94560] text-white shadow-sm' : `${tMuted} hover:text-[var(--text-secondary)]`
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (
          <div className="space-y-5">

            {/* Follow-ups */}
            {(data.overdue.length > 0 || data.todayTasks.length > 0) && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <h2 className={`text-xs font-semibold ${tPri} uppercase tracking-wider`}>Follow-ups Due</h2>
                  {data.overdue.length > 0 && (
                    <span className="text-[11px] text-[#e94560] font-semibold bg-[#e94560]/10 px-2 py-0.5 rounded-full">
                      {data.overdue.length} overdue
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {[...data.overdue.slice(0, 3), ...data.todayTasks.slice(0, 3)].map(task => {
                    const isOverdue = task.due_date < today;
                    return (
                      <div key={task.task_id} className={`${card} ${isOverdue ? 'border-[#e94560]/40' : 'border-[#f59e0b]/30'} rounded-xl p-3 flex items-start justify-between gap-3`}>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${tPri} truncate`}>{task.title}</p>
                          <p className={`text-[11px] mt-0.5 ${isOverdue ? 'text-[#e94560]' : 'text-[#f59e0b]'} font-medium`}>
                            {isOverdue ? `Overdue · ${task.due_date}` : 'Due today'}
                            {task.related_to_name ? ` · ${task.related_to_name}` : ''}
                          </p>
                        </div>
                        {task.phone && (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <a href={`tel:${task.phone}`} className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <Phone className="h-3.5 w-3.5 text-blue-400" />
                            </a>
                            <button onClick={() => openWa(task.phone)} className="h-7 w-7 rounded-lg bg-green-500/10 flex items-center justify-center">
                              <MessageSquare className="h-3.5 w-3.5 text-green-400" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Today's Visits */}
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className={`text-xs font-semibold ${tPri} uppercase tracking-wider`}>Today's Visits</h2>
                <Link to="/sales/visits" className="text-[11px] text-[#e94560] font-semibold">+ Plan Visit</Link>
              </div>
              {data.visits.length === 0 ? (
                <div className={`${card} rounded-xl p-6 text-center`}>
                  <MapPin className={`h-8 w-8 ${tMuted} mx-auto mb-2`} />
                  <p className={`text-sm ${tMuted}`}>No visits scheduled today</p>
                  <Link to="/sales/visits">
                    <Button size="sm" className="mt-3 bg-[#e94560] hover:bg-[#f05c75] text-white text-xs h-8">
                      Plan a Visit
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.visits.map(v => (
                    <div key={v.visit_id} className={`${card} rounded-xl p-3 flex items-center justify-between`}>
                      <div>
                        <p className={`text-sm font-medium ${tPri}`}>{v.school_name}</p>
                        <p className={`text-[11px] ${tMuted}`}>{v.visit_time} · {v.contact_person}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${v.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                        {v.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Quick Actions */}
            <section>
              <h2 className={`text-xs font-semibold ${tPri} uppercase tracking-wider mb-2.5`}>Quick Actions</h2>

              {/* Create Quotation — featured CTA */}
              <Link to="/create-quotation" className="block mb-2.5">
                <div className="bg-[#e94560]/10 border border-[#e94560]/30 rounded-xl p-3.5 flex items-center justify-between active:opacity-75 transition-opacity">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-[#e94560]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#e94560]">Create New Quotation</p>
                      <p className={`text-xs ${tMuted}`}>Build a quote for a client</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#e94560] flex-shrink-0" />
                </div>
              </Link>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { to: '/sales/attendance', Icon: Calendar, label: 'Attendance', color: 'text-blue-400',   bg: 'bg-blue-400/10' },
                  { to: '/sales/visits',     Icon: MapPin,   label: 'Visits',     color: 'text-purple-400', bg: 'bg-purple-400/10' },
                  { to: '/sales/quotations', Icon: FileText, label: 'My Quotes',  color: 'text-orange-400', bg: 'bg-orange-400/10' },
                  { to: '/sales/expenses',   Icon: Receipt,  label: 'Expenses',   color: 'text-green-400',  bg: 'bg-green-400/10' },
                ].map(({ to, Icon, label, color, bg }) => (
                  <Link key={to} to={to} className={`${card} rounded-xl p-2.5 flex flex-col items-center gap-1.5 hover:opacity-75 transition-opacity`}>
                    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <span className={`text-[10px] ${tSec} font-medium text-center leading-tight`}>{label}</span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ════════════ LEADS TAB ════════════ */}
        {tab === 'leads' && (
          <div className="space-y-2">
            {data.leads.length === 0 ? (
              <div className={`${card} rounded-xl p-8 text-center`}>
                <Target className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
                <p className={`text-sm ${tMuted}`}>No active leads assigned to you</p>
              </div>
            ) : data.leads.map(lead => {
              const stage = STAGE[lead.stage] || STAGE.new;
              const followupDue = lead.next_followup_date && lead.next_followup_date <= today;
              return (
                <div key={lead.lead_id} className={`${card} ${followupDue ? 'border-[#e94560]/40' : ''} rounded-xl p-3`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${tPri} truncate`}>{lead.company_name || lead.contact_name}</p>
                      <p className={`text-[11px] ${tMuted} truncate`}>{lead.contact_name}{lead.contact_phone ? ` · ${lead.contact_phone}` : ''}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0 ${stage.cls}`}>
                      {stage.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {lead.contact_phone && (
                      <>
                        <a href={`tel:${lead.contact_phone}`} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 font-medium">
                          <Phone className="h-3 w-3" /> Call
                        </a>
                        <button onClick={() => openWa(lead.contact_phone)} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-green-500/10 text-green-400 font-medium">
                          <MessageSquare className="h-3 w-3" /> WhatsApp
                        </button>
                      </>
                    )}
                    {lead.next_followup_date && (
                      <span className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg ml-auto font-medium ${followupDue ? 'bg-[#e94560]/10 text-[#e94560]' : `bg-[var(--bg-primary)] ${tMuted}`}`}>
                        <Clock className="h-3 w-3" /> {lead.next_followup_date}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ════════════ CONTACTS TAB ════════════ */}
        {tab === 'contacts' && (
          <div className="space-y-2">
            {data.contacts.length === 0 ? (
              <div className={`${card} rounded-xl p-8 text-center`}>
                <User className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
                <p className={`text-sm ${tMuted}`}>No contacts assigned to you</p>
              </div>
            ) : data.contacts.map(c => (
              <div key={c.contact_id} className={`${card} rounded-xl p-3 flex items-start justify-between gap-3`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#e94560]/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[#e94560] text-xs font-bold">{c.name?.charAt(0)?.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tPri} truncate`}>{c.name}</p>
                    <p className={`text-[11px] ${tMuted} truncate`}>
                      {[c.designation, c.company].filter(Boolean).join(' · ')}
                    </p>
                    {c.converted_to_lead && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">Converted</span>
                    )}
                  </div>
                </div>
                {c.phone && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <a href={`tel:${c.phone}`} className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Phone className="h-3.5 w-3.5 text-blue-400" />
                    </a>
                    <button onClick={() => openWa(c.phone)} className="h-7 w-7 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <MessageSquare className="h-3.5 w-3.5 text-green-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ════════════ QUOTATIONS TAB ════════════ */}
        {tab === 'quotations' && (
          <div className="space-y-2">
            <Link to="/sales/quotations">
              <Button className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white h-10 mb-1">
                <FileText className="mr-2 h-4 w-4" /> View All Quotations
              </Button>
            </Link>
            {data.quotations.length === 0 ? (
              <div className={`${card} rounded-xl p-8 text-center`}>
                <FileText className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
                <p className={`text-sm ${tMuted}`}>No quotations yet</p>
              </div>
            ) : data.quotations.map(q => (
              <div key={q.quotation_id} className={`${card} rounded-xl p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tPri} truncate`}>{q.school_name || q.principal_name || '—'}</p>
                    <p className={`text-[11px] ${tMuted}`}>{q.quote_number} · {q.created_at?.slice(0, 10)}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${QSTATUS[q.quotation_status] || 'bg-gray-500/20 text-gray-400'}`}>
                    {q.quotation_status}
                  </span>
                </div>
                {q.grand_total > 0 && (
                  <p className="text-xs font-mono font-bold text-[#e94560] mt-1.5">
                    ₹{q.grand_total?.toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </SalesLayout>
  );
}
