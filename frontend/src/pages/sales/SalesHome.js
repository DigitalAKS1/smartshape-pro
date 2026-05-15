import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SalesLayout from '../../components/layouts/SalesLayout';
import PunchClock from '../../components/PunchClock';
import {
  attendance as attendanceApi, visits as visitsApi,
  leads as leadsApi, tasks as tasksApi, quotations as quotationsApi,
} from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getSalesPermissions } from '../../lib/salesPermissions';
import {
  MapPin, FileText, Receipt, Target, Clock, Phone, MessageSquare,
  ChevronRight, AlertCircle, CheckCircle, Navigation, Flame,
  TrendingUp, Calendar, Star, BarChart2,
} from 'lucide-react';
import { Button } from '../../components/ui/button';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const openWa = (phone) => {
  const n = phone?.replace(/\D/g, '');
  if (n) window.open(`https://wa.me/${n.startsWith('91') ? n : '91' + n}`, '_blank');
};

const fmt = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

function openNavigate(lat, lng, name) {
  if (lat && lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
  } else if (name) {
    window.open(`https://www.google.com/maps/search/${encodeURIComponent(name)}`, '_blank');
  }
}

export default function SalesHome() {
  const { user } = useAuth();
  const today    = new Date().toISOString().split('T')[0];
  const perms    = getSalesPermissions(user?.sales_role);

  const [data, setData]         = useState({ attendance: null, visits: [], leads: [], quotations: [], overdue: [], allLeads: [] });
  const [loading, setLoading]   = useState(true);
  const [punchOpen, setPunchOpen] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [att, vis, ldr, tsk, qts] = await Promise.all([
        attendanceApi.getToday().catch(() => ({ data: null })),
        perms.visits_log     ? visitsApi.getAll().catch(() => ({ data: [] }))      : Promise.resolve({ data: [] }),
        perms.leads_view     ? leadsApi.getAll().catch(() => ({ data: [] }))       : Promise.resolve({ data: [] }),
        tasksApi.getAll().catch(() => ({ data: [] })),
        perms.quotation_view ? quotationsApi.getAll().catch(() => ({ data: [] }))  : Promise.resolve({ data: [] }),
      ]);

      const allLeads = ldr.data || [];
      const allTasks = tsk.data || [];

      setData({
        attendance:  att.data,
        visits:      (vis.data || []).filter(v => v.visit_date === today),
        leads:       allLeads.filter(l => !['won','lost'].includes(l.stage)),
        allLeads,
        quotations:  (qts.data || []).filter(q => ['draft','sent'].includes(q.quotation_status)),
        overdue:     allTasks.filter(t => t.status === 'pending' && t.due_date <= today),
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Priority leads: hot/warm + overdue followup, or just hot
  const priorityLeads = data.leads
    .filter(l => l.lead_type === 'hot' || (l.lead_type === 'warm' && l.next_followup_date && l.next_followup_date <= today))
    .sort((a, b) => {
      if (a.lead_type === 'hot' && b.lead_type !== 'hot') return -1;
      if (b.lead_type === 'hot' && a.lead_type !== 'hot') return 1;
      return 0;
    })
    .slice(0, 5);

  // Week stats (count from allLeads updated this week)
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const weekLeadsActive = data.allLeads.filter(l => !['won','lost'].includes(l.stage)).length;
  const weekWon = data.allLeads.filter(l => l.stage === 'won').length;

  if (loading) return (
    <SalesLayout title="Today">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Today">
      <div className="space-y-4 pb-28">

        {/* ── Greeting ── */}
        <div className="flex items-center justify-between pt-1">
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

        {/* ── Punch Clock (collapsible) ── */}
        <div>
          <button onClick={() => setPunchOpen(o => !o)}
            className={`w-full ${card} rounded-xl px-4 py-3 flex items-center justify-between`}>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className={`text-sm font-semibold ${tPri}`}>Punch Clock</span>
            </div>
            <ChevronRight className={`h-4 w-4 ${tMuted} transition-transform ${punchOpen ? 'rotate-90' : ''}`} />
          </button>
          {punchOpen && (
            <div className="mt-2">
              <PunchClock />
            </div>
          )}
        </div>

        {/* ── Attendance banner ── */}
        {!data.attendance && (
          <Link to="/sales/attendance">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-400">Mark attendance</p>
                  <p className={`text-xs ${tMuted}`}>Not checked in for today yet</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-amber-400" />
            </div>
          </Link>
        )}

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: Target,    label: 'Active',   value: data.leads.length,      color: 'text-blue-400',   bg: 'bg-blue-400/10' },
            { icon: Flame,     label: 'Urgent',   value: priorityLeads.length,   color: 'text-[#e94560]',  bg: 'bg-[#e94560]/10' },
            { icon: MapPin,    label: 'Visits',   value: data.visits.length,     color: 'text-purple-400', bg: 'bg-purple-400/10' },
            { icon: FileText,  label: 'Quotes',   value: data.quotations.length, color: 'text-orange-400', bg: 'bg-orange-400/10' },
          ].map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`${card} rounded-xl p-2.5`}>
              <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center mb-1.5 mx-auto`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <p className={`text-lg font-bold ${color} text-center leading-none`}>{value}</p>
              <p className={`text-[10px] ${tMuted} text-center mt-0.5`}>{label}</p>
            </div>
          ))}
        </div>

        {/* ── 🔥 DO THIS NOW ── */}
        {priorityLeads.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-[#e94560]" />
                <h2 className={`text-sm font-bold ${tPri}`}>Do This Now</h2>
                <span className="text-[10px] bg-[#e94560] text-white px-1.5 py-0.5 rounded-full font-bold">{priorityLeads.length}</span>
              </div>
              <Link to="/sales/leads" className={`text-[11px] text-[#e94560] font-semibold`}>See all →</Link>
            </div>
            <div className="space-y-2">
              {priorityLeads.map(lead => {
                const overdue = lead.next_followup_date && lead.next_followup_date <= today;
                return (
                  <div key={lead.lead_id} className={`${card} ${overdue ? 'border-[#e94560]/40' : 'border-amber-500/30'} rounded-xl p-3`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={`text-sm font-semibold ${tPri} truncate`}>{lead.company_name || lead.contact_name}</p>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                          }`}>{lead.lead_type?.toUpperCase()}</span>
                        </div>
                        <p className={`text-[11px] ${tMuted} mt-0.5`}>{lead.contact_name}</p>
                        {overdue && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-[#e94560] font-medium">
                            <Clock className="h-3 w-3" /> Follow-up overdue · {lead.next_followup_date}
                          </div>
                        )}
                      </div>
                    </div>
                    {lead.contact_phone && (
                      <div className="flex gap-2">
                        <a href={`tel:${lead.contact_phone}`}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-semibold">
                          <Phone className="h-3.5 w-3.5" /> Call
                        </a>
                        <button onClick={() => openWa(lead.contact_phone)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold">
                          <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── TODAY'S VISITS ── */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-purple-400" />
              <h2 className={`text-sm font-bold ${tPri}`}>Today's Visits</h2>
              {data.visits.length > 0 && (
                <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full font-bold">{data.visits.length}</span>
              )}
            </div>
            <Link to="/sales/visits" className={`text-[11px] text-[#e94560] font-semibold`}>+ Plan Visit</Link>
          </div>

          {data.visits.length === 0 ? (
            <div className={`${card} rounded-xl p-5 text-center`}>
              <MapPin className={`h-8 w-8 ${tMuted} mx-auto mb-2 opacity-40`} />
              <p className={`text-sm ${tMuted} mb-3`}>No visits scheduled today</p>
              <Link to="/sales/visits">
                <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white text-xs h-8">Plan a Visit</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Route planner button */}
              {data.visits.filter(v => v.lat || v.planned_address).length > 1 && (
                <button
                  onClick={() => {
                    const pts = data.visits
                      .filter(v => v.lat && v.lng)
                      .map(v => `${v.lat},${v.lng}`)
                      .join('/');
                    if (pts) window.open(`https://www.google.com/maps/dir/${pts}`, '_blank');
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-semibold mb-3">
                  <Navigation className="h-3.5 w-3.5" /> Open Full Route in Google Maps
                </button>
              )}
              <div className="space-y-2">
                {data.visits.map(v => (
                  <div key={v.visit_id} className={`${card} rounded-xl p-3`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${tPri}`}>{v.school_name}</p>
                        <p className={`text-[11px] ${tMuted}`}>{v.visit_time} · {v.contact_person}</p>
                        {v.planned_address && (
                          <p className={`text-[11px] ${tMuted} truncate mt-0.5`}>{v.planned_address}</p>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                        v.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        v.status === 'checked_in' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{v.status}</span>
                    </div>
                    <button
                      onClick={() => openNavigate(v.lat, v.lng, v.school_name || v.planned_address)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-500/10 text-purple-400 text-xs font-semibold">
                      <Navigation className="h-3.5 w-3.5" /> Navigate
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── OVERDUE TASKS ── */}
        {data.overdue.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                <h2 className={`text-sm font-bold ${tPri}`}>Overdue Tasks</h2>
                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">{data.overdue.length}</span>
              </div>
            </div>
            <div className="space-y-2">
              {data.overdue.slice(0, 3).map(task => (
                <div key={task.task_id} className={`${card} border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${tPri} truncate`}>{task.title}</p>
                    <p className="text-[11px] text-amber-400 font-medium mt-0.5">Due {task.due_date}</p>
                  </div>
                  {task.phone && (
                    <a href={`tel:${task.phone}`} className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <Phone className="h-3.5 w-3.5 text-blue-400" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── QUICK ACTIONS ── */}
        <section>
          <h2 className={`text-xs font-bold ${tPri} uppercase tracking-wider mb-2.5`}>Quick Actions</h2>
          {perms.quotation_create && (
            <Link to="/create-quotation" className="block mb-2.5">
              <div className="bg-[#e94560]/10 border border-[#e94560]/30 rounded-xl p-3.5 flex items-center justify-between active:opacity-75 transition-opacity">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4 w-4 text-[#e94560]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#e94560]">Create New Quotation</p>
                    <p className={`text-xs ${tMuted}`}>Build a quote for a client</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#e94560] flex-shrink-0" />
              </div>
            </Link>
          )}
          {(() => {
            const actions = [
              { to: '/sales/attendance', icon: CheckCircle,  label: 'Attendance',   color: 'text-blue-400',   bg: 'bg-blue-400/10',   perm: 'attendance' },
              { to: '/sales/visits',     icon: MapPin,        label: 'Visits',       color: 'text-purple-400', bg: 'bg-purple-400/10', perm: 'visits_log' },
              { to: '/sales/quotations', icon: FileText,      label: 'My Quotes',    color: 'text-orange-400', bg: 'bg-orange-400/10', perm: 'quotation_view' },
              { to: '/sales/expenses',   icon: Receipt,       label: 'Expenses',     color: 'text-green-400',  bg: 'bg-green-400/10',  perm: 'expenses_log' },
              { to: '/leave-management', icon: Calendar,      label: 'Leave',        color: 'text-teal-400',   bg: 'bg-teal-400/10',   perm: 'leave_apply' },
            ].filter(a => perms[a.perm]);
            if (!actions.length) return null;
            return (
              <div className={`grid gap-2 ${actions.length <= 2 ? 'grid-cols-2' : actions.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {actions.map(({ to, icon: Icon, label, color, bg }) => (
                  <Link key={to} to={to} className={`${card} rounded-xl p-2.5 flex flex-col items-center gap-1.5 active:opacity-75 transition-opacity`}>
                    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <span className={`text-[10px] ${tSec} font-medium text-center leading-tight`}>{label}</span>
                  </Link>
                ))}
              </div>
            );
          })()}
        </section>

        {/* ── WEEK STATS ── */}
        <section className={`${card} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="h-4 w-4 text-[#e94560]" />
            <h2 className={`text-sm font-bold ${tPri}`}>Your Pipeline</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Active Leads',  value: weekLeadsActive, color: 'text-blue-400' },
              { label: 'Won',           value: weekWon,          color: 'text-green-400' },
              { label: 'Open Quotes',   value: data.quotations.length, color: 'text-orange-400' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className={`text-[10px] ${tMuted} mt-0.5`}>{s.label}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </SalesLayout>
  );
}
