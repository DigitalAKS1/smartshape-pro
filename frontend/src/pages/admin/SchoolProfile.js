import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { schools as schoolsApi, contacts as contactsApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Building2, Phone, Mail, Globe, MapPin, Users, Eye,
  MessageSquare, Calendar, Package, FileText, Clock, TrendingUp,
  Activity, PhoneCall, Send, BarChart2, ChevronDown, ChevronUp, Plus,
} from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'leads', label: 'Leads', icon: TrendingUp },
  { id: 'sales', label: 'Sales', icon: BarChart2 },
  { id: 'marketing', label: 'Marketing', icon: Send },
  { id: 'visits', label: 'Visits & Meetings', icon: Calendar },
  { id: 'feed', label: 'Activity Feed', icon: Activity },
];

const STAGE_COLORS = {
  new: 'bg-blue-500/20 text-blue-400',
  contacted: 'bg-cyan-500/20 text-cyan-400',
  demo: 'bg-purple-500/20 text-purple-400',
  quoted: 'bg-yellow-500/20 text-yellow-400',
  negotiation: 'bg-orange-500/20 text-orange-400',
  won: 'bg-green-500/20 text-green-400',
  retention: 'bg-teal-500/20 text-teal-400',
  resell: 'bg-indigo-500/20 text-indigo-400',
  lost: 'bg-red-500/20 text-red-400',
};

const STATUS_COLORS = {
  draft: 'bg-gray-500/20 text-gray-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  sent: 'bg-blue-500/20 text-blue-400',
  confirmed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

function fmt(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function AgingChip({ days }) {
  if (days === null || days === undefined) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">Never contacted</span>;
  }
  const cls = days < 7
    ? 'bg-green-500/20 text-green-400'
    : days < 30
    ? 'bg-yellow-500/20 text-yellow-400'
    : 'bg-red-500/20 text-red-400';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{days}d since contact</span>;
}

export default function SchoolProfile() {
  const { school_id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedContact, setExpandedContact] = useState(null);
  const [stageFilter, setStageFilter] = useState('all');
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', designation: '', notes: '' });
  const [savingContact, setSavingContact] = useState(false);

  const card = isDark ? 'bg-[var(--bg-card)]' : 'bg-white';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const borderCls = 'border-[var(--border-color)]';
  const bg = isDark ? 'bg-[var(--bg-primary)]' : 'bg-gray-50';

  useEffect(() => {
    loadProfile();
  }, [school_id]);

  async function loadProfile() {
    try {
      setLoading(true);
      const res = await schoolsApi.getProfile(school_id);
      setProfile(res.data);
    } catch (err) {
      toast.error('Failed to load school profile');
      navigate('/leads');
    } finally {
      setLoading(false);
    }
  }

  function openAddContact() {
    setContactForm({ name: '', phone: '', email: '', designation: '', notes: '' });
    setContactDialogOpen(true);
  }

  async function saveContact() {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    setSavingContact(true);
    try {
      await contactsApi.create({ ...contactForm, company: profile?.school?.school_name || '' });
      toast.success('Contact added');
      setContactDialogOpen(false);
      loadProfile();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save contact');
    } finally {
      setSavingContact(false);
    }
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className={`min-h-screen ${bg} flex items-center justify-center`}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e94560]" />
        </div>
      </AdminLayout>
    );
  }

  if (!profile) return null;

  const { school, leads, contacts, quotations, visits, call_notes, meetings, dispatches, metrics } = profile;

  // Build unified activity feed
  const feedItems = [
    ...call_notes.map(n => ({
      date: n.created_at, type: 'call', icon: PhoneCall,
      label: `Call note by ${n.created_by_name || n.created_by}`,
      detail: n.content || n.outcome || '',
      color: 'text-blue-400',
    })),
    ...visits.map(v => ({
      date: v.visit_date, type: 'visit', icon: MapPin,
      label: `Visit by ${v.executive_name || v.created_by || ''}`,
      detail: v.purpose || v.notes || '',
      color: 'text-purple-400',
    })),
    ...meetings.map(m => ({
      date: m.followup_date, type: 'meeting', icon: Calendar,
      label: `Meeting — ${m.assigned_to || ''}`,
      detail: m.notes || '',
      color: 'text-indigo-400',
    })),
    ...quotations.map(q => ({
      date: q.created_at, type: 'quotation', icon: FileText,
      label: `Quotation ${q.quotation_number || ''} (${q.status})`,
      detail: `${q.currency_symbol || '₹'}${(q.grand_total || 0).toLocaleString('en-IN')}`,
      color: 'text-green-400',
    })),
    ...dispatches.map(d => ({
      date: d.sent_date || d.created_at, type: 'dispatch', icon: Package,
      label: `${d.material_type} dispatched`,
      detail: d.courier_name ? `Via ${d.courier_name}${d.tracking_number ? ' · ' + d.tracking_number : ''}` : '',
      color: 'text-orange-400',
    })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 50);

  const filteredLeads = stageFilter === 'all' ? leads : leads.filter(l => l.stage === stageFilter);

  return (
    <AdminLayout>
      <div className={`min-h-screen ${bg}`}>
        {/* Header */}
        <div className={`${card} border-b ${borderCls} px-4 sm:px-6 py-4`}>
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className={`${textMuted} h-8 w-8 p-0 flex-shrink-0 mt-0.5`}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={`text-lg sm:text-xl font-bold ${textPri} truncate`}>{school.school_name}</h1>
                {school.school_type && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#e94560]/20 text-[#e94560] flex-shrink-0">
                    {school.school_type}
                  </span>
                )}
                <AgingChip days={metrics.days_since_last_contact} />
              </div>
              <div className={`flex items-center gap-3 mt-1 flex-wrap text-xs ${textMuted}`}>
                {school.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{school.city}{school.state ? `, ${school.state}` : ''}</span>}
                {school.board && <span>{school.board}</span>}
                {school.school_strength > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{school.school_strength} students</span>}
              </div>
            </div>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="px-4 sm:px-6 py-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: 'Total Leads', value: metrics.total_leads, color: 'text-blue-400' },
              { label: 'Active Leads', value: metrics.active_leads, color: 'text-green-400' },
              { label: 'Contacts', value: metrics.total_contacts, color: 'text-purple-400' },
              { label: 'Visits', value: metrics.total_visits, color: 'text-indigo-400' },
              { label: 'Calls', value: metrics.total_calls, color: 'text-cyan-400' },
              { label: 'Quoted (₹)', value: metrics.total_revenue_quoted > 0 ? `₹${(metrics.total_revenue_quoted / 1000).toFixed(0)}K` : '0', color: 'text-[#e94560]' },
            ].map(kpi => (
              <div key={kpi.label} className={`${card} border ${borderCls} rounded-xl p-3 text-center`}>
                <p className={`text-xl sm:text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5 leading-tight`}>{kpi.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tab Bar */}
        <div className={`${card} border-b ${borderCls} px-4 sm:px-6`}>
          <div className="flex gap-1 overflow-x-auto pb-0 hide-scrollbar">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-[#e94560] text-[#e94560]'
                      : `border-transparent ${textMuted} hover:${textSec}`
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-4 sm:px-6 py-4">

          {/* ===== OVERVIEW ===== */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* School Info */}
              <div className={`${card} border ${borderCls} rounded-xl p-4`}>
                <h3 className={`font-semibold ${textPri} mb-3`}>School Information</h3>
                <div className="space-y-2 text-sm">
                  {school.address && <InfoRow icon={MapPin} label="Address" value={school.address} />}
                  {school.phone && <InfoRow icon={Phone} label="Phone" value={<a href={`tel:${school.phone}`} className="text-[#e94560]">{school.phone}</a>} />}
                  {school.email && <InfoRow icon={Mail} label="Email" value={<a href={`mailto:${school.email}`} className="text-[#e94560]">{school.email}</a>} />}
                  {school.website && <InfoRow icon={Globe} label="Website" value={<a href={school.website} target="_blank" rel="noreferrer" className="text-[#e94560]">{school.website}</a>} />}
                  {school.primary_contact_name && <InfoRow icon={Users} label="Primary Contact" value={`${school.primary_contact_name}${school.designation ? ' · ' + school.designation : ''}`} />}
                  {school.alternate_contact && <InfoRow icon={Phone} label="Alt. Contact" value={school.alternate_contact} />}
                  {school.existing_vendor && <InfoRow icon={Building2} label="Existing Vendor" value={school.existing_vendor} />}
                  {school.annual_budget_range && <InfoRow icon={BarChart2} label="Annual Budget" value={school.annual_budget_range} />}
                  {school.number_of_branches > 1 && <InfoRow icon={Building2} label="Branches" value={school.number_of_branches} />}
                </div>
              </div>

              {/* Recent Activity Preview */}
              <div className={`${card} border ${borderCls} rounded-xl p-4`}>
                <h3 className={`font-semibold ${textPri} mb-3`}>Recent Activity</h3>
                {feedItems.length === 0 ? (
                  <p className={`text-sm ${textMuted}`}>No activity yet.</p>
                ) : (
                  <div className="space-y-3">
                    {feedItems.slice(0, 5).map((item, i) => {
                      const Icon = item.icon;
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <div className={`mt-0.5 flex-shrink-0 ${item.color}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${textPri}`}>{item.label}</p>
                            {item.detail && <p className={`text-xs ${textMuted} truncate`}>{item.detail}</p>}
                            <p className={`text-xs ${textMuted}`}>{fmt(item.date)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {feedItems.length > 5 && (
                  <button onClick={() => setActiveTab('feed')} className={`mt-3 text-xs text-[#e94560] hover:underline`}>
                    View all {feedItems.length} activities →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ===== CONTACTS ===== */}
          {activeTab === 'contacts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className={`text-sm ${textMuted}`}>{contacts.length} contact{contacts.length !== 1 ? 's' : ''} linked via company name</p>
                <Button size="sm" onClick={openAddContact} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8 px-3 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Contact
                </Button>
              </div>
              {contacts.length === 0 ? (
                <EmptyState icon={Users} message="No contacts linked to this school yet." />
              ) : (
                contacts.map(contact => (
                  <div key={contact.contact_id} className={`${card} border ${borderCls} rounded-xl overflow-hidden`}>
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-medium ${textPri}`}>{contact.name}</p>
                          {contact.designation && <span className={`text-xs ${textMuted}`}>{contact.designation}</span>}
                          {contact.converted_to_lead && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400">Converted</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                          {contact.phone && (
                            <a href={`tel:${contact.phone}`} className={`text-sm ${textSec} flex items-center gap-1 hover:text-[#e94560]`}>
                              <Phone className="h-3 w-3" />{contact.phone}
                            </a>
                          )}
                          {contact.email && (
                            <a href={`mailto:${contact.email}`} className={`text-sm ${textSec} flex items-center gap-1 hover:text-[#e94560] truncate`}>
                              <Mail className="h-3 w-3" />{contact.email}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {contact.phone && (
                          <a href={`https://wa.me/${contact.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="ghost" className="text-green-500 h-8 w-8 p-0">
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                          </a>
                        )}
                        <Button size="sm" variant="ghost"
                          onClick={() => setExpandedContact(expandedContact === contact.contact_id ? null : contact.contact_id)}
                          className={`${textMuted} h-8 w-8 p-0`}>
                          {expandedContact === contact.contact_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    {expandedContact === contact.contact_id && (
                      <div className={`px-4 pb-4 border-t ${borderCls} pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm`}>
                        {contact.contact_role_id && <InfoRow icon={Users} label="Role ID" value={contact.contact_role_id} />}
                        {contact.source && <InfoRow icon={Activity} label="Source" value={contact.source} />}
                        {contact.notes && <div className="sm:col-span-2"><InfoRow icon={FileText} label="Notes" value={contact.notes} /></div>}
                        {contact.birthday && <InfoRow icon={Calendar} label="Birthday" value={fmt(contact.birthday)} />}
                        <InfoRow icon={Clock} label="Added" value={fmt(contact.created_at)} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ===== LEADS ===== */}
          {activeTab === 'leads' && (
            <div className="space-y-3">
              {/* Stage filter chips */}
              <div className="flex items-center gap-2 flex-wrap">
                {['all', 'new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost'].map(s => (
                  <button key={s} onClick={() => setStageFilter(s)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors capitalize ${
                      stageFilter === s
                        ? 'bg-[#e94560] text-white border-[#e94560]'
                        : `${borderCls} ${textMuted} hover:border-[#e94560]`
                    }`}>
                    {s === 'all' ? `All (${leads.length})` : s}
                  </button>
                ))}
              </div>
              {filteredLeads.length === 0 ? (
                <EmptyState icon={TrendingUp} message="No leads match the selected filter." />
              ) : (
                filteredLeads.map(lead => (
                  <div key={lead.lead_id} className={`${card} border ${borderCls} rounded-xl p-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-medium ${textPri}`}>{lead.contact_name}</p>
                          {lead.stage && (
                            <span className={`text-[10px] px-2 py-0.5 rounded capitalize ${STAGE_COLORS[lead.stage] || 'bg-gray-500/20 text-gray-400'}`}>
                              {lead.stage}
                            </span>
                          )}
                          {lead.lead_type && (
                            <span className={`text-[10px] px-2 py-0.5 rounded capitalize ${
                              lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400'
                              : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-blue-500/20 text-blue-400'
                            }`}>{lead.lead_type}</span>
                          )}
                        </div>
                        <p className={`text-sm ${textMuted} mt-0.5`}>{lead.designation} · {lead.contact_phone}</p>
                        <div className={`flex items-center gap-4 mt-1.5 text-xs ${textMuted} flex-wrap`}>
                          {lead.assigned_name && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{lead.assigned_name}</span>}
                          {lead.next_followup_date && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Follow-up: {fmt(lead.next_followup_date)}</span>}
                        </div>
                      </div>
                      <Link to={`/leads?lead=${lead.lead_id}`}>
                        <Button size="sm" variant="ghost" className={`${textMuted} h-8 w-8 p-0 hover:text-[#e94560]`} title="View Lead">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ===== SALES / QUOTATIONS ===== */}
          {activeTab === 'sales' && (
            <div className="space-y-3">
              {quotations.length > 0 && (
                <div className={`text-sm ${textMuted} mb-2`}>
                  Total pipeline: <span className={`font-semibold ${textPri}`}>
                    ₹{metrics.total_revenue_quoted.toLocaleString('en-IN')}
                  </span>
                </div>
              )}
              {quotations.length === 0 ? (
                <EmptyState icon={BarChart2} message="No quotations found for this school." />
              ) : (
                quotations.map(q => (
                  <div key={q.quotation_id} className={`${card} border ${borderCls} rounded-xl p-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-medium ${textPri}`}>{q.quotation_number || q.quotation_id}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded capitalize ${STATUS_COLORS[q.status] || 'bg-gray-500/20 text-gray-400'}`}>
                            {q.status}
                          </span>
                        </div>
                        <p className={`text-lg font-bold ${textPri} mt-1`}>
                          {q.currency_symbol || '₹'}{(q.grand_total || 0).toLocaleString('en-IN')}
                        </p>
                        <div className={`flex items-center gap-4 mt-1 text-xs ${textMuted} flex-wrap`}>
                          {q.items?.length > 0 && <span>{q.items.length} item{q.items.length !== 1 ? 's' : ''}</span>}
                          {q.created_by_name && <span>by {q.created_by_name}</span>}
                          <span>{fmt(q.created_at)}</span>
                        </div>
                      </div>
                      <Link to={`/view-quotation/${q.quotation_id}`}>
                        <Button size="sm" variant="ghost" className={`${textMuted} h-8 w-8 p-0 hover:text-[#e94560]`} title="View Quotation">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ===== MARKETING / DISPATCHES ===== */}
          {activeTab === 'marketing' && (
            <div className="space-y-3">
              {dispatches.length === 0 ? (
                <EmptyState icon={Send} message="No physical dispatches recorded for this school." />
              ) : (
                dispatches.map(d => (
                  <div key={d.dispatch_id} className={`${card} border ${borderCls} rounded-xl p-4`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <Package className="h-5 w-5 text-orange-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-medium ${textPri} capitalize`}>{d.material_type}</p>
                          {d.received_confirmed && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400">Received</span>
                          )}
                        </div>
                        {d.description && <p className={`text-sm ${textMuted} mt-0.5`}>{d.description}</p>}
                        <div className={`flex items-center gap-4 mt-1.5 text-xs ${textMuted} flex-wrap`}>
                          {d.courier_name && <span>Via {d.courier_name}</span>}
                          {d.tracking_number && <span>#{d.tracking_number}</span>}
                          <span>{fmt(d.sent_date || d.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ===== VISITS & MEETINGS ===== */}
          {activeTab === 'visits' && (
            <div className="space-y-3">
              {visits.length === 0 && meetings.length === 0 ? (
                <EmptyState icon={Calendar} message="No visits or meetings recorded for this school." />
              ) : (
                [...visits.map(v => ({ ...v, _type: 'visit', _date: v.visit_date })),
                 ...meetings.map(m => ({ ...m, _type: 'meeting', _date: m.followup_date }))
                ].sort((a, b) => (b._date || '').localeCompare(a._date || '')).map((item, i) => (
                  <div key={i} className={`${card} border ${borderCls} rounded-xl p-4`}>
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full mt-1.5 ${item._type === 'visit' ? 'bg-blue-400' : 'bg-purple-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded ${item._type === 'visit' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'} capitalize`}>
                            {item._type}
                          </span>
                          <span className={`text-xs ${textMuted}`}>{fmt(item._date)}</span>
                        </div>
                        {item._type === 'visit' ? (
                          <>
                            {item.executive_name && <p className={`text-sm ${textPri} mt-1`}>{item.executive_name}</p>}
                            {item.purpose && <p className={`text-sm ${textMuted}`}>{item.purpose}</p>}
                            {item.outcome && <p className={`text-sm ${textMuted}`}>Outcome: {item.outcome}</p>}
                          </>
                        ) : (
                          <>
                            {item.assigned_to && <p className={`text-sm ${textPri} mt-1`}>{item.assigned_to}</p>}
                            {item.notes && <p className={`text-sm ${textMuted}`}>{item.notes}</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ===== ACTIVITY FEED ===== */}
          {activeTab === 'feed' && (
            <div className="space-y-2">
              {feedItems.length === 0 ? (
                <EmptyState icon={Activity} message="No activity recorded for this school yet." />
              ) : (
                feedItems.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className={`${card} border ${borderCls} rounded-xl p-3 flex items-start gap-3`}>
                      <div className={`flex-shrink-0 mt-0.5 ${item.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${textPri}`}>{item.label}</p>
                        {item.detail && <p className={`text-xs ${textMuted} truncate`}>{item.detail}</p>}
                        <p className={`text-xs ${textMuted} mt-0.5`}>{fmt(item.date)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>
      </div>

      {/* Add Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)]">Add Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">School (Company)</Label>
              <Input value={profile?.school?.school_name || ''} disabled
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-muted)] text-sm h-10 mt-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Name *</Label>
                <Input value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mt-1"
                  placeholder="Full name" />
              </div>
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Phone *</Label>
                <Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mt-1"
                  placeholder="+91..." />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Email</Label>
                <Input value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mt-1"
                  placeholder="email@example.com" />
              </div>
              <div>
                <Label className="text-[var(--text-secondary)] text-xs">Designation</Label>
                <Input value={contactForm.designation} onChange={e => setContactForm({ ...contactForm, designation: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mt-1"
                  placeholder="Principal, Admin..." />
              </div>
            </div>
            <div>
              <Label className="text-[var(--text-secondary)] text-xs">Notes</Label>
              <Input value={contactForm.notes} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })}
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mt-1"
                placeholder="Any additional info..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setContactDialogOpen(false)} className="text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={saveContact} disabled={savingContact} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
              {savingContact ? 'Saving...' : 'Save Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
      <span className="text-[var(--text-muted)] flex-shrink-0">{label}:</span>
      <span className="text-[var(--text-secondary)] break-all">{value}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
      <Icon className="h-10 w-10 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
