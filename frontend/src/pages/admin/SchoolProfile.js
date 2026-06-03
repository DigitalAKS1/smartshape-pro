import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { ExternalLink, Activity } from 'lucide-react';
import useSchoolProfile from '../../hooks/useSchoolProfile';
import SchoolProfileHeader from '../../components/school/SchoolProfileHeader';
import SchoolContactsSection from '../../components/school/SchoolContactsSection';
import SchoolLeadsSection from '../../components/school/SchoolLeadsSection';
import {
  SchoolSalesSection, SchoolMarketingSection,
  SchoolVisitsSection, SchoolActivityFeed,
} from '../../components/school/SchoolOrdersSection';

// ── Design tokens ────────────────────────────────────────────────────────────
function useTk(isDark) {
  return isDark ? {
    page:'bg-[var(--bg-primary)]', card:'bg-[var(--bg-card)]',
    border:'border-[var(--border-color)]', divide:'divide-[var(--border-color)]',
    t1:'text-[var(--text-primary)]', t2:'text-[var(--text-secondary)]',
    tm:'text-[var(--text-muted)]',
    input:'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    avatar:'bg-[var(--bg-primary)] text-[var(--text-primary)]',
  } : {
    page:'bg-[#f8fafc]', card:'bg-white', border:'border-[#e2e8f0]',
    divide:'divide-[#e2e8f0]', t1:'text-[#0f172a]', t2:'text-[#334155]',
    tm:'text-[#94a3b8]',
    input:'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    avatar:'bg-[#f1f5f9] text-[#0f172a]',
  };
}

function fmt(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function InfoRow({ label, value, href, tm, t2 }) {
  const isEmpty = !value;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#f1f5f9] last:border-0">
      <span className={`text-[10px] uppercase tracking-wider font-semibold w-24 flex-shrink-0 mt-0.5 ${tm}`}>{label}</span>
      {isEmpty
        ? <span className="text-[13px] italic" style={{ color: '#c0ccd8' }}>Not provided</span>
        : href
          ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
               className="text-sm text-[#e94560] hover:underline break-all">{value}</a>
          : <span className={`text-sm ${t2} break-all`}>{value}</span>
      }
    </div>
  );
}

const TABS = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'contacts',  label: 'Contacts'  },
  { id: 'leads',     label: 'Leads'     },
  { id: 'sales',     label: 'Sales'     },
  { id: 'marketing', label: 'Marketing' },
  { id: 'visits',    label: 'Visits'    },
  { id: 'feed',      label: 'Activity'  },
];

export default function SchoolProfile() {
  const { school_id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const tk = useTk(isDark);

  const sp = useSchoolProfile(school_id);
  const { profile, loading, mounted } = sp;

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

        <SchoolProfileHeader school={school} metrics={metrics} tk={tk} rv={rv} />

        {/* Tab Bar */}
        <div className={`${tk.card} border-b ${tk.border} sticky top-0 z-20`}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex sp-scroll overflow-x-auto">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => sp.setActiveTab(tab.id)}
                  className={`relative flex-shrink-0 px-4 py-3.5 text-xs sm:text-sm font-semibold tracking-wide transition-colors whitespace-nowrap ${
                    sp.activeTab === tab.id ? 'text-[#e94560]' : `${tk.tm} hover:${isDark ? 'text-[var(--text-secondary)]' : 'text-[#475569]'}`
                  }`}>
                  {tab.label}
                  {sp.activeTab === tab.id && (
                    <span className="absolute bottom-0 inset-x-0 h-[2px] bg-[#e94560] rounded-t" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

          {sp.activeTab === 'overview' && (
            <div className="sp-tab grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* School info */}
              <div className={`lg:col-span-2 ${tk.card} border ${tk.border} rounded-2xl overflow-hidden`}>
                <div className={`px-5 py-4 border-b ${tk.border} flex items-center justify-between`}>
                  <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tk.tm}`}>School Information</p>
                  <button onClick={() => navigate(`/leads?school=${school.school_id}`)}
                    className="text-[10px] text-[#e94560] hover:underline">Edit →</button>
                </div>
                <div className="px-5 py-1">
                  <InfoRow label="Address"  value={school.address} tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Phone"    value={school.phone}   href={school.phone ? `tel:${school.phone}` : null}            tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Email"    value={school.email}   href={school.email ? `mailto:${school.email}` : null}         tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Website"  value={school.website} href={school.website}                                          tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Contact"  value={school.primary_contact_name ? `${school.primary_contact_name}${school.designation ? ' · ' + school.designation : ''}` : null} tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Alt."     value={school.alternate_contact}   tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Vendor"   value={school.existing_vendor}     tm={tk.tm} t2={tk.t2} />
                  <InfoRow label="Budget"   value={school.annual_budget_range} tm={tk.tm} t2={tk.t2} />
                  {school.number_of_branches > 1 && (
                    <InfoRow label="Branches" value={String(school.number_of_branches)} tm={tk.tm} t2={tk.t2} />
                  )}
                </div>
              </div>

              {/* Recent activity */}
              <div className={`lg:col-span-3 ${tk.card} border ${tk.border} rounded-2xl overflow-hidden`}>
                <div className={`px-5 py-4 border-b ${tk.border} flex items-center justify-between`}>
                  <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tk.tm}`}>Recent Activity</p>
                  {sp.feedItems.length > 6 && (
                    <button onClick={() => sp.setActiveTab('feed')}
                      className="text-[11px] text-[#e94560] hover:underline">
                      All {sp.feedItems.length} →
                    </button>
                  )}
                </div>
                <div className="px-5 py-5">
                  {sp.feedItems.length === 0 ? (
                    <div className="py-10 text-center">
                      <Activity className="h-8 w-8 mx-auto mb-2" style={{ color: '#d1d9e0' }} strokeWidth={1.2} />
                      <p className="text-sm italic" style={{ color: '#94a3b8' }}>No calls, visits or quotations yet</p>
                    </div>
                  ) : (
                    <div className="relative pl-6">
                      <div className={`absolute left-1.5 top-0 bottom-0 w-px ${isDark ? 'bg-[var(--border-color)]' : 'bg-[#e2e8f0]'}`} />
                      <div className="space-y-5">
                        {sp.feedItems.slice(0, 6).map((item, i) => (
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

          {sp.activeTab === 'contacts' && (
            <SchoolContactsSection
              contacts={contacts} isDark={isDark} tk={tk}
              expandedContact={sp.expandedContact}
              setExpandedContact={sp.setExpandedContact}
              openAddContact={sp.openAddContact}
              openEditContact={sp.openEditContact} />
          )}

          {sp.activeTab === 'leads' && (
            <SchoolLeadsSection
              leads={leads} filteredLeads={sp.filteredLeads}
              stageFilter={sp.stageFilter} setStageFilter={sp.setStageFilter}
              tk={tk} />
          )}

          {sp.activeTab === 'sales' && (
            <SchoolSalesSection quotations={quotations} metrics={metrics} tk={tk} />
          )}

          {sp.activeTab === 'marketing' && (
            <SchoolMarketingSection dispatches={dispatches} tk={tk} />
          )}

          {sp.activeTab === 'visits' && (
            <SchoolVisitsSection visits={visits} meetings={meetings} tk={tk} />
          )}

          {sp.activeTab === 'feed' && (
            <SchoolActivityFeed feedItems={sp.feedItems} tk={tk} />
          )}
        </div>
      </div>

      {/* Add / Edit Contact Dialog */}
      <Dialog open={sp.contactOpen} onOpenChange={open => { sp.setContactOpen(open); if (!open) sp.setEditingContact(null); }}>
        <DialogContent className={`${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[#e2e8f0]'} w-[calc(100vw-1.5rem)] sm:max-w-md rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>{sp.editingContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
            <DialogDescription className={tk.tm}>
              {sp.editingContact
                ? `Editing ${sp.editingContact.name} · ${profile?.school?.school_name}`
                : `New contact for ${profile?.school?.school_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Name *</Label>
                <Input value={sp.contactForm.name}
                  onChange={e => sp.setContactForm({ ...sp.contactForm, name: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Full name" autoFocus />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Phone *</Label>
                <Input value={sp.contactForm.phone}
                  onChange={e => sp.setContactForm({ ...sp.contactForm, phone: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="+91 98765..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Email</Label>
                <Input value={sp.contactForm.email}
                  onChange={e => sp.setContactForm({ ...sp.contactForm, email: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="email@school.edu" />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Designation</Label>
                <Input value={sp.contactForm.designation}
                  onChange={e => sp.setContactForm({ ...sp.contactForm, designation: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Principal, Admin..." />
              </div>
            </div>
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Notes</Label>
              <Input value={sp.contactForm.notes}
                onChange={e => sp.setContactForm({ ...sp.contactForm, notes: e.target.value })}
                className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Any additional info..." />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {sp.editingContact && (
              <button
                onClick={() => { sp.setContactOpen(false); navigate('/leads?tab=contacts'); }}
                className={`text-xs ${tk.tm} hover:text-[#e94560] flex items-center gap-1 mr-auto transition-colors`}>
                <ExternalLink className="h-3 w-3" /> Open in CRM
              </button>
            )}
            <Button variant="ghost" onClick={() => { sp.setContactOpen(false); sp.setEditingContact(null); }} className={tk.tm}>Cancel</Button>
            <Button onClick={sp.saveContact} disabled={sp.saving}
              className="bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-5">
              {sp.saving ? 'Saving...' : sp.editingContact ? 'Update Contact' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}
