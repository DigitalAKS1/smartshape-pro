import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useTheme } from '../../contexts/ThemeContext';
import SchoolFormDialog from '../../components/crm/SchoolFormDialog';
import ContactFormDialog from '../../components/crm/ContactFormDialog';
import {
  schools as schoolsApi, groups as groupsApi, designations as designationsApi,
  salesPersons as salesPersonsApi, contactRoles as contactRolesApi,
  sources as sourcesApi, tags as tagsApi, contacts as contactsApi,
} from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { ExternalLink, Activity } from 'lucide-react';
import useSchoolProfile from '../../hooks/useSchoolProfile';
import SchoolProfileHeader from '../../components/school/SchoolProfileHeader';
import SchoolContactsSection from '../../components/school/SchoolContactsSection';
import SchoolLeadsSection from '../../components/school/SchoolLeadsSection';
import SchoolLeadQuickCreate from '../../components/school/SchoolLeadQuickCreate';
import ConvertContactDialog from '../../components/school/ConvertContactDialog';
import EnrollDripDialog from '../../components/school/EnrollDripDialog';
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

  // Edit-school dialog (opened from the "Edit →" button on this page)
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [groupsList, setGroupsList] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [spList, setSpList] = useState([]);
  const [schoolsList, setSchoolsList] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const contactFileRef = useRef(null);
  const [leadCreateOpen, setLeadCreateOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState(null);
  useEffect(() => {
    const grab = (api, set) => api.getAll().then(r => set(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    grab(groupsApi, setGroupsList);
    grab(designationsApi, setDesignationsList);
    grab(contactRolesApi, setRolesList);
    grab(sourcesApi, setSourcesList);
    grab(tagsApi, setTagsList);
    grab(salesPersonsApi, setSpList);
    grab(schoolsApi, setSchoolsList);
    grab(contactsApi, setContactsList);
  }, []);

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

  const { school, leads, contacts, quotations, orders = [], visits, call_notes, meetings, dispatches, communications = [], metrics } = profile;
  const rv = (delay = '') => `transition-all duration-500 ease-out ${delay} ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`;

  // Open the Edit School modal in place, prefilled from the current school
  const openEditSchool = () => {
    setEditForm({
      school_name: school.school_name || '', school_type: school.school_type || 'CBSE',
      group_id: school.group_id || '', phone: school.phone || '', email: school.email || '',
      alternate_contact: school.alternate_contact || '', city: school.city || '', state: school.state || '',
      address: school.address || '', pincode: school.pincode || '',
      primary_contact_name: school.primary_contact_name || '', designation: school.designation || '',
      school_strength: school.school_strength || '', number_of_branches: school.number_of_branches ?? '',
      annual_budget_range: school.annual_budget_range || '', existing_vendor: school.existing_vendor || '',
      linkedin_url: school.linkedin_url || '', instagram_url: school.instagram_url || '', website: school.website || '',
    });
    setEditTarget(school);
  };
  const handleSaveSchool = async () => {
    try {
      await schoolsApi.update(school.school_id, editForm);
      toast.success('School updated');
      setEditTarget(null);
      sp.reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Update failed');
    }
  };

  // Profile completeness — nudges reps to fill the fields that power scoring & segmentation
  const PROFILE_FIELDS = [
    { k: 'phone', label: 'Phone' }, { k: 'email', label: 'Email' },
    { k: 'address', label: 'Address' }, { k: 'city', label: 'City' },
    { k: 'state', label: 'State' }, { k: 'website', label: 'Website' },
    { k: 'primary_contact_name', label: 'Contact' }, { k: 'school_strength', label: 'Strength' },
    { k: 'annual_budget_range', label: 'Budget' },
  ];
  const hasVal = (v) => v !== undefined && v !== null && v !== '' && v !== 0;
  const missingFields = PROFILE_FIELDS.filter(f => !hasVal(school[f.k]));
  const completeness = Math.round(((PROFILE_FIELDS.length - missingFields.length) / PROFILE_FIELDS.length) * 100);
  const complColor = completeness >= 80 ? '#10b981' : completeness >= 50 ? '#f59e0b' : '#ef4444';

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
                  <button onClick={openEditSchool}
                    className="text-[10px] text-[#e94560] hover:underline">Edit →</button>
                </div>
                {/* Profile completeness */}
                <div className={`px-5 py-3 border-b ${tk.border}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[11px] font-semibold ${tk.t2}`}>Profile completeness</span>
                    <span className="text-[11px] font-mono font-bold" style={{ color: complColor }}>{completeness}%</span>
                  </div>
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[#eef2f7]'}`}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${completeness}%`, backgroundColor: complColor }} />
                  </div>
                  {missingFields.length > 0 && (
                    <p className={`text-[10px] ${tk.tm} mt-1.5`}>
                      Missing: {missingFields.map(f => f.label).join(', ')} —{' '}
                      <button onClick={openEditSchool} className="text-[#e94560] hover:underline">add now</button>
                    </p>
                  )}
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
              openEditContact={sp.openEditContact}
              onConvert={(c) => setConvertTarget(c)} />
          )}

          {sp.activeTab === 'leads' && (
            <SchoolLeadsSection
              leads={leads} filteredLeads={sp.filteredLeads}
              stageFilter={sp.stageFilter} setStageFilter={sp.setStageFilter}
              tk={tk}
              onCreate={() => setLeadCreateOpen(true)}
              onEnroll={() => setEnrollOpen(true)} />
          )}

          {sp.activeTab === 'sales' && (
            <SchoolSalesSection quotations={quotations} orders={orders} metrics={metrics} tk={tk} />
          )}

          {sp.activeTab === 'marketing' && (
            <SchoolMarketingSection dispatches={dispatches} communications={communications} tk={tk} />
          )}

          {sp.activeTab === 'visits' && (
            <SchoolVisitsSection visits={visits} meetings={meetings} tk={tk} school={school} onDone={sp.reload} />
          )}

          {sp.activeTab === 'feed' && (
            <SchoolActivityFeed feedItems={sp.feedItems} tk={tk} />
          )}
        </div>
      </div>

      {/* Edit School Dialog (opens in place from "Edit →") */}
      <SchoolFormDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        editSchool={editTarget}
        setEditSchool={setEditTarget}
        editSchoolForm={editForm}
        setEditSchoolForm={setEditForm}
        groupsList={groupsList}
        designationsList={designationsList}
        handleSaveSchool={handleSaveSchool}
      />

      {/* Add / Edit Contact Dialog — full CRM form (role, designation, source, assigned, birthday, tags) */}
      <ContactFormDialog
        contactDialogOpen={sp.contactOpen}
        setContactDialogOpen={open => { sp.setContactOpen(open); if (!open) sp.setEditingContact(null); }}
        editContact={sp.editingContact}
        contactForm={sp.contactForm}
        setContactForm={sp.setContactForm}
        schoolsList={schoolsList}
        rolesList={rolesList}
        sourcesList={sourcesList}
        spList={spList}
        tagsList={tagsList}
        designationsList={designationsList}
        contactsList={contactsList}
        saveContact={sp.saveContact}
        /* convert-to-lead flow not used on this page — safe no-op defaults */
        convertDialogOpen={false}
        setConvertDialogOpen={() => {}}
        convertContact={null}
        convertForm={{}}
        setConvertForm={() => {}}
        convertAddNewSchool={false}
        setConvertAddNewSchool={() => {}}
        convertNewSchool={{}}
        setConvertNewSchool={() => {}}
        handleConvert={() => {}}
        /* import flow not used on this page — safe no-op defaults */
        contactImportOpen={false}
        setContactImportOpen={() => {}}
        contactFileRef={contactFileRef}
        importFile={null}
        setImportFile={() => {}}
        importTags={[]}
        setImportTags={() => {}}
        importNotes={''}
        setImportNotes={() => {}}
        importing={false}
        importResult={null}
        handleContactImport={() => {}}
        resetImportDialog={() => {}}
        downloadSampleCsv={() => {}}
      />

      <SchoolLeadQuickCreate open={leadCreateOpen} onOpenChange={setLeadCreateOpen} school={school}
        rolesList={rolesList} sourcesList={sourcesList} spList={spList} onDone={sp.reload} />
      <ConvertContactDialog open={!!convertTarget} onOpenChange={(v) => { if (!v) setConvertTarget(null); }}
        contact={convertTarget} spList={spList} onDone={sp.reload} />
      <EnrollDripDialog open={enrollOpen} onOpenChange={setEnrollOpen} leads={leads} onDone={sp.reload} />

    </AdminLayout>
  );
}
