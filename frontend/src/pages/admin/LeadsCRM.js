import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layouts/AppShell';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';
import {
  Plus, MessageSquare, Calendar, Target, Building2, UserPlus,
  Upload, Search, ChevronRight, AlertTriangle, Clock, MoreHorizontal,
  Edit2, Trash2, Lock, UserCog, FileText, Linkedin, Instagram, Eye,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';
import KanbanBoard, { ageColor, AgeBadge } from '../../components/KanbanBoard';
import ReassignLeadDialog from '../../components/ReassignLeadDialog';
import { STAGES, SCHOOL_TYPES } from '../../lib/crmConstants';
import LeadMobileCard from '../../components/crm/LeadMobileCard';
import { FieldTooltip } from '../../components/ui/Tooltip';
import EmptyState, { EMPTY_STATES } from '../../components/ui/EmptyState';
import { leads as leadsApiObj, quotations as quotationsApi2, adminApi, schools as schoolsApiObj } from '../../lib/api';

import useLeadsCRM from '../../hooks/useLeadsCRM';
import LeadDetailPanel from '../../components/crm/LeadDetailPanel';
import LeadFormDialog from '../../components/crm/LeadFormDialog';
import ForecastBar from '../../components/crm/ForecastBar';
import SchoolFormDialog from '../../components/crm/SchoolFormDialog';
import ContactFormDialog from '../../components/crm/ContactFormDialog';
import ContactsTab from '../../components/crm/ContactsTab';
import TasksTab from '../../components/crm/TasksTab';

export default function LeadsCRM() {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const crm = useLeadsCRM();

  // Theme shorthand
  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const hoverBg = isDark ? 'hover:bg-[var(--bg-hover)]' : 'hover:bg-[#f0f0f5]';

  const completionBadge = (pct, onClickFn) => {
    const cls = pct >= 80 ? 'bg-green-500/20 text-green-400' : pct >= 50 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-400';
    return (
      <button onClick={onClickFn} title="Click to edit and complete profile"
        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${cls} cursor-pointer hover:opacity-80 transition-opacity`}>
        {pct}%
      </button>
    );
  };

  const getStageObj = (id) => STAGES.find(s => s.id === id) || STAGES[0];

  // School ownership: admin assigns a school to a Sales Exec; backend cascades
  // the owner onto all of that school's contacts + leads.
  const assignSchoolOwner = async (sch, email) => {
    if (email === (sch.assigned_to || '')) return;
    const sp = crm.spList.find(s => s.email === email);
    const name = sp?.name || '';
    if (!window.confirm(`Assign "${sch.school_name}" to ${name || 'Unassigned'}?\n\nThis moves ALL of its leads & contacts to ${name || 'no owner'}.`)) return;
    try {
      const r = await schoolsApiObj.assign(sch.school_id, { assigned_to: email, assigned_name: name });
      const c = r.data?.cascaded || {};
      toast.success(`Owner ${name ? `set to ${name}` : 'cleared'} — moved ${c.leads ?? 0} leads, ${c.contacts ?? 0} contacts`);
      crm.fetchData();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Assign failed'); }
  };
  const renderOwnerControl = (sch) => (
    crm.user?.role === 'admin' ? (
      <select value={sch.assigned_to || ''} onClick={e => e.stopPropagation()} onChange={e => assignSchoolOwner(sch, e.target.value)}
        className={`h-8 px-2 rounded text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] ${textPri} max-w-[150px]`}
        data-testid={`school-owner-${sch.school_id}`}>
        <option value="">Unassigned</option>
        {crm.spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
      </select>
    ) : (
      <span className={textSec}>{sch.assigned_name || <span className="italic" style={{ color: '#c0ccd8' }}>Unassigned</span>}</span>
    )
  );

  if (crm.loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-96">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="leads-title">School CRM</h1>
            <p className={`${textSec} mt-1 text-sm`}>{crm.contactsList.filter(c => !c.converted_to_lead).length} contacts • {crm.leadsList.length} leads • {crm.schoolsList.length} schools</p>
          </div>
          {/* Mobile header */}
          <div className="flex sm:hidden gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[var(--bg-card)] border-[var(--border-color)]">
                <DropdownMenuItem onClick={crm.openCreateContact} className={textSec}><UserPlus className="mr-2 h-3.5 w-3.5" /> Add Contact</DropdownMenuItem>
                <DropdownMenuItem onClick={() => crm.setImportDialogOpen(true)} className={textSec}><Upload className="mr-2 h-3.5 w-3.5" /> Import CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={crm.openCreateSchool} className={textSec}><Building2 className="mr-2 h-3.5 w-3.5" /> Add School</DropdownMenuItem>
                <DropdownMenuItem onClick={() => crm.openCreateTask(null)} className={textSec}><Calendar className="mr-2 h-3.5 w-3.5" /> New Task</DropdownMenuItem>
                {crm.user?.role === 'admin' && (
                  <DropdownMenuItem onClick={async () => {
                    if (!window.confirm('Auto-assign all unassigned leads?')) return;
                    try { const r = await leadsApiObj.autoAssign(); toast.success(`Auto-assigned ${r.data.assigned} lead(s)`); crm.fetchData(); }
                    catch { toast.error('Auto-assign failed'); }
                  }} className={textSec}><Target className="mr-2 h-3.5 w-3.5" /> Auto-Assign</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={crm.openCreateLead} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-lead-button">
              <Plus className="mr-1 h-3 w-3" /> New Lead
            </Button>
          </div>
          {/* Desktop header */}
          <div className="hidden sm:flex flex-wrap gap-2">
            <Button onClick={crm.openCreateContact} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="add-contact-btn">
              <UserPlus className="mr-1 h-3 w-3" /> Add Contact
            </Button>
            <Button onClick={() => crm.setImportDialogOpen(true)} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="import-btn">
              <Upload className="mr-1 h-3 w-3" /> Import CSV
            </Button>
            <Button onClick={crm.openCreateSchool} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="add-school-btn">
              <Building2 className="mr-1 h-3 w-3" /> Add School
            </Button>
            <Button onClick={() => crm.openCreateTask(null)} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="create-task-button">
              <Calendar className="mr-1 h-3 w-3" /> New Task
            </Button>
            {crm.user?.role === 'admin' && (
              <Button onClick={async () => {
                if (!window.confirm('Round-robin auto-assign all UNASSIGNED leads to active sales persons?')) return;
                try { const r = await leadsApiObj.autoAssign(); toast.success(`Auto-assigned ${r.data.assigned} lead(s)`); crm.fetchData(); }
                catch { toast.error('Auto-assign failed'); }
              }} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="auto-assign-btn">
                <Target className="mr-1 h-3 w-3" /> Auto-Assign
              </Button>
            )}
            {crm.user?.role === 'admin' && (
              <Button onClick={async () => {
                try {
                  const r = await quotationsApi2.backfillLeads();
                  const d = r.data;
                  toast.success(`Sync done — ${d.processed}/${d.total} quotations linked to leads`);
                  crm.fetchData();
                } catch { toast.error('Sync failed'); }
              }} variant="outline" size="sm" className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10" title="Create/link leads for all quotations">
                <FileText className="mr-1 h-3 w-3" /> Sync Quotes→Leads
              </Button>
            )}
            <Button onClick={crm.openCreateLead} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
              <Plus className="mr-1 h-3 w-3" /> New Lead
            </Button>
          </div>
        </div>

        {/* ── Forecast + needs-attention summary ─────────────────────── */}
        <ForecastBar />

        {/* ── View Toggle + Bulk Actions ─────────────────────────────── */}
        {crm.activeTab === 'pipeline' && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`${card} border rounded-md p-0.5 flex gap-0.5`} data-testid="lead-view-toggle">
              {[
                { id: 'pipeline', label: 'Pipeline', mobileHide: false },
                { id: 'kanban', label: 'Kanban', mobileHide: true },
                { id: 'table', label: 'Table', mobileHide: false },
              ].map(v => (
                <button key={v.id} onClick={() => crm.setLeadView(v.id)} data-testid={`view-${v.id}`}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${v.mobileHide ? 'hidden sm:block' : ''} ${crm.leadView === v.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
                  {v.label}
                </button>
              ))}
            </div>
            {crm.selectedLeadIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap" data-testid="bulk-actions-bar">
                <span className={`text-xs ${textSec}`}>{crm.selectedLeadIds.size} selected</span>
                <Button size="sm" onClick={() => { crm.setReassignBulkIds(Array.from(crm.selectedLeadIds)); crm.setReassignLead(null); crm.setReassignOpen(true); }} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid="bulk-reassign-btn">
                  <UserCog className="mr-1 h-3 w-3" /> Reassign
                </Button>
                <select defaultValue="" className={`h-8 px-2 rounded text-xs ${inputCls} cursor-pointer`}
                  onChange={async e => {
                    const tagId = e.target.value;
                    if (!tagId) return;
                    try {
                      await leadsApiObj.bulkTag({ lead_ids: Array.from(crm.selectedLeadIds), tag_id: tagId, action: 'add' });
                      toast.success(`Tag added to ${crm.selectedLeadIds.size} lead(s)`);
                      crm.fetchData();
                    } catch { toast.error('Bulk tag failed'); }
                    e.target.value = '';
                  }}>
                  <option value="">+ Add Tag</option>
                  {crm.tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
                </select>
                <select defaultValue="" className={`h-8 px-2 rounded text-xs ${inputCls} cursor-pointer`}
                  onChange={async e => {
                    const stage = e.target.value;
                    if (!stage) return;
                    if (!window.confirm(`Move ${crm.selectedLeadIds.size} lead(s) to stage "${stage}"?`)) { e.target.value = ''; return; }
                    try {
                      await leadsApiObj.bulkStage({ lead_ids: Array.from(crm.selectedLeadIds), stage });
                      toast.success(`${crm.selectedLeadIds.size} lead(s) moved to ${stage}`);
                      crm.setSelectedLeadIds(new Set());
                      crm.fetchData();
                    } catch { toast.error('Bulk stage change failed'); }
                    e.target.value = '';
                  }}>
                  <option value="">Move to Stage</option>
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={() => crm.setSelectedLeadIds(new Set())} className={`border-[var(--border-color)] ${textSec} h-8`}>Clear</Button>
              </div>
            )}
          </div>
        )}

        {/* ── Search & Filters ───────────────────────────────────────── */}
        <div className="sticky top-14 lg:static z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 sm:py-0 bg-[var(--bg-primary)] sm:bg-transparent border-b sm:border-0 border-[var(--border-color)] flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input value={crm.searchTerm} onChange={e => crm.setSearchTerm(e.target.value)} placeholder="Search school, contact, phone, city..." className={`pl-10 ${inputCls}`} data-testid="search-input" />
          </div>
          <select value={crm.filterType} onChange={e => crm.setFilterType(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="filter-select">
            <option value="all">All Types</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={crm.filterTag} onChange={e => crm.setFilterTag(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="filter-tag-select">
            <option value="">All Tags</option>
            {crm.tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
          </select>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div className={`flex gap-1 ${card} border rounded-md p-1 overflow-x-auto`}>
          {['schools', 'contacts', 'list', 'pipeline', 'tasks', 'reports'].map(tab => (
            <button key={tab} onClick={() => crm.setActiveTab(tab)}
              className={`flex-shrink-0 px-3 py-2 rounded text-xs sm:text-sm font-medium transition-all capitalize ${crm.activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} ${hoverBg}`}`}
              data-testid={`tab-${tab}`}>
              {tab === 'contacts' ? `Contacts (${crm.contactsList.filter(c => !c.converted_to_lead).length})`
                : tab === 'pipeline' ? 'Pipeline'
                : tab === 'list' ? `Leads (${crm.filteredLeads.length})`
                : tab === 'tasks' ? `Tasks (${crm.tasksList.length})`
                : tab === 'schools' ? `Schools (${crm.schoolsList.length})`
                : 'Reports'}
            </button>
          ))}
        </div>

        {/* ── CONTACTS TAB ──────────────────────────────────────────── */}
        {crm.activeTab === 'contacts' && (
          <ContactsTab
            contactsList={crm.contactsList}
            leadsList={crm.leadsList}
            filterRole={crm.filterRole}
            setFilterRole={crm.setFilterRole}
            filterContactTag={crm.filterContactTag}
            setFilterContactTag={crm.setFilterContactTag}
            searchTerm={crm.searchTerm}
            tagsList={crm.tagsList}
            rolesList={crm.rolesList}
            sortConfig={crm.sortConfig}
            toggleSort={crm.toggleSort}
            sortIndicator={crm.sortIndicator}
            sortData={crm.sortData}
            contactPage={crm.contactPage}
            setContactPage={crm.setContactPage}
            contactsPerPage={crm.contactsPerPage}
            getRoleName={crm.getRoleName}
            calcContactCompletion={crm.calcContactCompletion}
            touchAgeCls={crm.touchAgeCls}
            daysSince={crm.daysSince}
            openCreateContact={crm.openCreateContact}
            openEditContact={crm.openEditContact}
            deleteContact={crm.deleteContact}
            openConvert={crm.openConvert}
            openWaForContact={crm.openWaForContact}
            handleContactExport={crm.handleContactExport}
            setContactImportOpen={crm.setContactImportOpen}
            setActiveTab={crm.setActiveTab}
            openDetail={crm.openDetail}
            expandedContactId={crm.expandedContactId}
            contactActivity={crm.contactActivity}
            expandContactActivity={crm.expandContactActivity}
            fetchData={crm.fetchData}
            user={crm.user}
          />
        )}

        {/* ── LEADS LIST VIEW ───────────────────────────────────────── */}
        {crm.activeTab === 'list' && (() => {
          const sortedLeads = crm.sortData(crm.filteredLeads, crm.sortConfig.key, crm.sortConfig.dir);
          return (
            <div className={`${card} border rounded-md overflow-hidden`} data-testid="leads-list-view">
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-[var(--border-color)]">
                {sortedLeads.map(lead => {
                  const stg = getStageObj(lead.stage);
                  return (
                    <div key={lead.lead_id} onClick={() => crm.openDetail(lead)} className="p-3 flex items-start justify-between gap-2 active:bg-[var(--bg-hover)]">
                      <div className="flex-1 min-w-0">
                        <p className={`${textPri} font-medium text-sm truncate`}>{lead.company_name || lead.contact_name}</p>
                        <p className={`text-xs ${textMuted}`}>{lead.contact_name} • {lead.contact_phone}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${stg.color}`}>{stg.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span>
                        </div>
                      </div>
                      <ChevronRight className={`h-4 w-4 ${textMuted} flex-shrink-0 mt-1`} />
                    </div>
                  );
                })}
                {sortedLeads.length === 0 && <div className="p-8 text-center"><p className={`text-sm ${textMuted}`}>No leads found</p></div>}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm" data-testid="leads-flat-table">
                  <thead><tr className="bg-[var(--bg-primary)]">
                    <th className="py-3 px-3 w-8"><input type="checkbox" className="accent-[#e94560]" onChange={e => { if (e.target.checked) crm.setSelectedLeadIds(new Set(sortedLeads.map(l => l.lead_id))); else crm.setSelectedLeadIds(new Set()); }} checked={sortedLeads.length > 0 && sortedLeads.every(l => crm.selectedLeadIds.has(l.lead_id))} /></th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('company_name')}>School{crm.sortIndicator('company_name')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('contact_name')}>Contact{crm.sortIndicator('contact_name')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('lead_type')}>Type{crm.sortIndicator('lead_type')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('stage')}>Stage{crm.sortIndicator('stage')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('lead_score')}>Score{crm.sortIndicator('lead_score')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell`}>Assigned</th>
                    <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {sortedLeads.map(lead => {
                      const stg = getStageObj(lead.stage);
                      return (
                        <tr key={lead.lead_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => crm.openDetail(lead)}>
                          <td className="py-2.5 px-3" onClick={e => e.stopPropagation()}><input type="checkbox" className="accent-[#e94560]" checked={crm.selectedLeadIds.has(lead.lead_id)} onChange={() => crm.toggleLeadSelect(lead.lead_id)} /></td>
                          <td className="py-2.5 px-3">
                            <p className={`${textPri} font-medium text-sm`}>{lead.company_name}</p>
                            <p className={`text-xs ${textMuted}`}>{lead.school_type} {lead.school_city && `| ${lead.school_city}`}</p>
                          </td>
                          <td className="py-2.5 px-3">
                            <p className={`${textPri} text-sm`}>{lead.contact_name}</p>
                            <p className={`text-xs ${textMuted}`}>{lead.contact_phone}</p>
                          </td>
                          <td className="py-2.5 px-3"><span className={`text-xs px-2 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span></td>
                          <td className="py-2.5 px-3"><span className={`text-xs px-2 py-0.5 rounded font-medium border ${stg.color}`}>{stg.label}</span></td>
                          <td className="py-2.5 px-3"><span className="font-mono text-sm text-[#e94560]">{lead.lead_score || 0}</span></td>
                          <td className={`py-2.5 px-3 hidden lg:table-cell text-sm ${textSec}`}>{lead.assigned_name?.split(' ')[0]}</td>
                          <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => crm.openEditLead(lead)} className={`${textSec} h-7`}><Edit2 className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={async () => { if (!window.confirm('Delete this lead?')) return; await leadsApiObj.delete(lead.lead_id); crm.fetchData(); toast.success('Deleted'); }} className="text-red-400 h-7"><Trash2 className="h-3 w-3" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedLeads.length === 0 && <tr><td colSpan="7"><EmptyState {...(crm.searchTerm ? EMPTY_STATES.searchResult : EMPTY_STATES.leads)} compact /></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── PIPELINE VIEW ─────────────────────────────────────────── */}
        {crm.activeTab === 'pipeline' && crm.leadView === 'pipeline' && (
          <>
            {/* Mobile: vertical stacked */}
            <div className="sm:hidden space-y-5" data-testid="pipeline-mobile">
              {STAGES.map(stage => {
                const stageLeads = crm.filteredLeads.filter(l => l.stage === stage.id);
                if (stageLeads.length === 0) return null;
                return (
                  <div key={stage.id}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${stage.color}`}>{stage.label}</span>
                      <span className={`text-xs ${textMuted} font-medium`}>{stageLeads.length} lead{stageLeads.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-2.5">
                      {stageLeads.map(lead => (
                        <LeadMobileCard key={lead.lead_id} lead={lead} onDetail={crm.openDetail} tagsList={crm.tagsList} card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {crm.filteredLeads.length === 0 && <EmptyState {...(crm.searchTerm || crm.filterType !== 'all' ? EMPTY_STATES.searchResult : EMPTY_STATES.leads)} action={{ label: '+ Add Lead', onClick: crm.openCreateLead }} />}
            </div>
            {/* Desktop: horizontal pipeline */}
            <div className="hidden sm:flex gap-2 overflow-x-auto pb-4" data-testid="pipeline-board">
              {STAGES.map(stage => {
                const stageLeads = crm.filteredLeads.filter(l => l.stage === stage.id);
                return (
                  <div key={stage.id} className="min-w-[200px] sm:min-w-[220px] flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${stage.color}`}>{stage.label}</span>
                      <span className={`text-xs ${textMuted}`}>{stageLeads.length}</span>
                    </div>
                    <div className="space-y-2">
                      {stageLeads.map(lead => (
                        <div key={lead.lead_id} onClick={() => crm.openDetail(lead)} className={`${card} border rounded-md p-3 cursor-pointer hover:border-[#e94560]/40 transition-all`} data-testid={`lead-card-${lead.lead_id}`}>
                          <div className="flex items-center justify-between">
                            <p className={`${textPri} font-medium text-sm truncate`}>{lead.company_name || lead.contact_name}</p>
                            {lead.lead_score > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-mono font-bold">{lead.lead_score}</span>}
                          </div>
                          <p className={`text-xs ${textMuted} truncate`}>{lead.contact_name} {lead.designation ? `(${lead.designation})` : ''}</p>
                          <div className="flex items-center justify-between mt-2">
                            {lead.lead_type && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span>}
                            <span className={`text-[10px] ${textMuted}`}>{lead.assigned_name?.split(' ')[0]}</span>
                          </div>
                          {lead.visit_required && <div className="mt-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 inline-flex items-center gap-1" data-testid={`visit-required-${lead.lead_id}`}><AlertTriangle className="h-2.5 w-2.5" /> Visit Required</span></div>}
                          {lead.next_followup_date && <p className={`text-[10px] ${textMuted} mt-1 flex items-center gap-1`}><Clock className="h-3 w-3" /> {lead.next_followup_date}</p>}
                          {(lead.tags || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(lead.tags || []).slice(0, 3).map(tid => {
                                const tag = crm.tagsList.find(t => t.tag_id === tid);
                                if (!tag) return null;
                                return <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>;
                              })}
                              {(lead.tags || []).length > 3 && <span className={`text-[9px] ${textMuted}`}>+{(lead.tags || []).length - 3}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                      {stageLeads.length === 0 && <p className={`text-xs ${textMuted} text-center py-6`}>Empty</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── KANBAN VIEW ───────────────────────────────────────────── */}
        {crm.activeTab === 'pipeline' && crm.leadView === 'kanban' && (
          <>
            {/* Mobile: kanban not supported */}
            <div className="sm:hidden space-y-4">
              <p className={`text-xs ${textMuted} text-center py-1`}>Kanban not available on mobile — showing pipeline list</p>
              {STAGES.map(stage => {
                const stageLeads = crm.filteredLeads.filter(l => l.stage === stage.id);
                if (stageLeads.length === 0) return null;
                return (
                  <div key={stage.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${stage.color}`}>{stage.label}</span>
                      <span className={`text-xs ${textMuted}`}>{stageLeads.length}</span>
                    </div>
                    <div className="space-y-2">
                      {stageLeads.map(lead => (
                        <div key={lead.lead_id} onClick={() => crm.openDetail(lead)} className={`${card} border rounded-md p-3 cursor-pointer active:opacity-70 transition-opacity`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className={`${textPri} font-medium text-sm truncate flex-1`}>{lead.company_name || lead.contact_name}</p>
                            {lead.lead_score > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-mono font-bold flex-shrink-0">{lead.lead_score}</span>}
                          </div>
                          <p className={`text-xs ${textMuted} mt-0.5 truncate`}>{lead.contact_name} • {lead.contact_phone}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {lead.lead_type && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span>}
                            {lead.next_followup_date && <span className={`text-[10px] ${textMuted} flex items-center gap-1`}><Clock className="h-3 w-3" />{lead.next_followup_date}</span>}
                            <span className={`text-[10px] ${textMuted} ml-auto`}>{lead.assigned_name?.split(' ')[0]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Desktop: KanbanBoard */}
            <div className="hidden sm:block">
              <KanbanBoard
                columns={STAGES}
                items={crm.filteredLeads}
                getItemId={(l) => l.lead_id}
                getItemColumnId={(l) => l.stage || 'new'}
                onMove={crm.handleKanbanMove}
                emptyText="Drop leads here"
                renderCard={(lead) => {
                  const days = crm.daysSince(lead.last_activity_date);
                  const borderCls = ageColor(days, lead.next_followup_date);
                  return (
                    <div onClick={() => crm.openDetail(lead)} className={`${card} border-l-4 ${borderCls} rounded-md p-2.5 cursor-pointer hover:shadow-lg hover:shadow-[#e94560]/10 transition-all`} data-testid={`kanban-card-${lead.lead_id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <input type="checkbox" onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); crm.toggleLeadSelect(lead.lead_id); }} checked={crm.selectedLeadIds.has(lead.lead_id)} className="accent-[#e94560]" data-testid={`select-lead-${lead.lead_id}`} />
                        <p className={`${textPri} font-medium text-sm truncate flex-1`}>{lead.company_name || lead.contact_name}</p>
                        {lead.is_locked && <Lock className="h-3 w-3 text-[#e94560]" />}
                        {lead.lead_score > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-mono font-bold">{lead.lead_score}</span>}
                      </div>
                      <p className={`text-xs ${textMuted} truncate mt-0.5`}>{lead.contact_name} • {lead.contact_phone}</p>
                      <div className="flex items-center justify-between mt-2 gap-1">
                        {lead.lead_type && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span>}
                        <span className={`text-[10px] ${textMuted} truncate`}>{lead.assigned_name?.split(' ')[0] || 'Unassigned'}</span>
                      </div>
                      {(lead.reassignment_count || 0) > 2 && (
                        <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1"><UserCog className="h-2.5 w-2.5" /> Reassigned {lead.reassignment_count}×</p>
                      )}
                      <AgeBadge daysSinceActivity={days} followupDate={lead.next_followup_date} />
                      {(lead.tags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(lead.tags || []).slice(0, 3).map(tid => {
                            const tag = crm.tagsList.find(t => t.tag_id === tid);
                            if (!tag) return null;
                            return <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>;
                          })}
                          {(lead.tags || []).length > 3 && <span className={`text-[9px] ${textMuted}`}>+{(lead.tags || []).length - 3}</span>}
                        </div>
                      )}
                      <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--border-color)]">
                        <button type="button" onClick={(e) => { e.stopPropagation(); crm.setReassignLead(lead); crm.setReassignBulkIds(null); crm.setReassignOpen(true); }} className="text-[10px] text-[#e94560] hover:underline" data-testid={`reassign-${lead.lead_id}`}>Reassign</button>
                        <span className={textMuted}>•</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); crm.openWaForLead(lead); }} className="text-[10px] text-green-500 hover:underline">WhatsApp</button>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </>
        )}

        {/* ── TABLE VIEW ────────────────────────────────────────────── */}
        {crm.activeTab === 'pipeline' && crm.leadView === 'table' && (() => {
          const sortedLeads = crm.sortData(crm.filteredLeads, crm.sortConfig.key, crm.sortConfig.dir);
          return (
            <div className={`${card} border rounded-md overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="leads-table">
                  <thead><tr className="bg-[var(--bg-primary)]">
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('company_name')}>School{crm.sortIndicator('company_name')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('contact_name')}>Contact{crm.sortIndicator('contact_name')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('lead_type')}>Type{crm.sortIndicator('lead_type')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('stage')}>Stage{crm.sortIndicator('stage')}</th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('lead_score')}>Score{crm.sortIndicator('lead_score')}<FieldTooltip text="Lead Score (0–100) calculated from engagement, recency, and deal size. Higher = hotter lead." /></th>
                    <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell`}>Assigned</th>
                    <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {sortedLeads.map(lead => {
                      const stg = getStageObj(lead.stage);
                      return (
                        <tr key={lead.lead_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => crm.openDetail(lead)} data-testid={`lead-row-${lead.lead_id}`}>
                          <td className="py-2.5 px-3">
                            <p className={`${textPri} font-medium text-sm`}>{lead.company_name}</p>
                            <p className={`text-xs ${textMuted}`}>{lead.school_type} {lead.school_city && `| ${lead.school_city}`}</p>
                          </td>
                          <td className="py-2.5 px-3">
                            <p className={`${textPri} text-sm`}>{lead.contact_name}</p>
                            <p className={`text-xs ${textMuted}`}>{lead.contact_phone}</p>
                          </td>
                          <td className="py-2.5 px-3 hidden sm:table-cell">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${lead.lead_type === 'hot' ? 'bg-red-500/20 text-red-400' : lead.lead_type === 'warm' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{lead.lead_type}</span>
                          </td>
                          <td className="py-2.5 px-3 hidden md:table-cell">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium border ${stg.color}`}>{stg.label}</span>
                          </td>
                          <td className="py-2.5 px-3 hidden lg:table-cell"><span className="font-mono text-sm text-[#e94560]">{lead.lead_score || 0}</span></td>
                          <td className={`py-2.5 px-3 hidden lg:table-cell text-sm ${textSec}`}>{lead.assigned_name?.split(' ')[0]}</td>
                          <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => crm.openEditLead(lead)} className={`${textSec} h-7`} data-testid={`edit-lead-${lead.lead_id}`}><Edit2 className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={async () => { if (!window.confirm('Delete this lead?')) return; await leadsApiObj.delete(lead.lead_id); crm.fetchData(); toast.success('Deleted'); }} className="text-red-400 h-7" data-testid={`delete-lead-${lead.lead_id}`}><Trash2 className="h-3 w-3" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedLeads.length === 0 && <tr><td colSpan="7"><EmptyState {...(crm.searchTerm ? EMPTY_STATES.searchResult : EMPTY_STATES.leads)} compact /></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── TASKS TAB ─────────────────────────────────────────────── */}
        {crm.activeTab === 'tasks' && (
          <TasksTab
            tasksList={crm.tasksList}
            taskDialogOpen={crm.taskDialogOpen}
            setTaskDialogOpen={crm.setTaskDialogOpen}
            taskForm={crm.taskForm}
            setTaskForm={crm.setTaskForm}
            spList={crm.spList}
            saveTask={crm.saveTask}
            updateTaskStatus={crm.updateTaskStatus}
          />
        )}

        {/* ── SCHOOLS TAB ───────────────────────────────────────────── */}
        {crm.activeTab === 'schools' && (() => {
          let schFiltered = crm.schoolsList;
          if (crm.searchTerm) {
            const s = crm.searchTerm.toLowerCase();
            schFiltered = schFiltered.filter(sc => (sc.school_name || '').toLowerCase().includes(s) || (sc.email || '').toLowerCase().includes(s) || (sc.city || '').toLowerCase().includes(s) || (sc.phone || '').includes(s) || (sc.primary_contact_name || '').toLowerCase().includes(s));
          }
          schFiltered = crm.sortData(schFiltered, crm.sortConfig.key, crm.sortConfig.dir);
          return (
            <div className="space-y-3">
              {/* Mobile: school cards */}
              <div className="sm:hidden space-y-2" data-testid="schools-list-mobile">
                {schFiltered.map(sch => {
                  const schLeads = crm.leadsList.filter(l => l.school_id === sch.school_id);
                  return (
                    <div key={sch.school_id} className={`${card} border rounded-md p-3 flex items-start justify-between gap-2`} data-testid={`school-card-${sch.school_id}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`${textPri} font-medium text-sm truncate`}>{sch.school_name}</p>
                        <p className={`text-xs ${textMuted}`}>{sch.school_type}{sch.city ? ` • ${sch.city}` : ''}</p>
                        <p className="text-xs mt-0.5">
                          {sch.primary_contact_name
                            ? <span className={textSec}>{sch.primary_contact_name}{sch.designation ? ` (${sch.designation})` : ''}</span>
                            : <span className="italic" style={{ color: '#c0ccd8' }}>no contact on record</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs px-2 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-bold">{schLeads.length} leads</span>
                          {completionBadge(crm.calcSchoolCompletion(sch), () => crm.openEditSchool(sch))}
                          {sch.phone && <a href={`tel:${sch.phone}`} className={`text-xs ${textSec}`}>{sch.phone}</a>}
                          {sch.linkedin_url && <a href={sch.linkedin_url.startsWith('http') ? sch.linkedin_url : `https://${sch.linkedin_url}`} target="_blank" rel="noopener noreferrer" className="text-[#0a66c2]" title="LinkedIn"><Linkedin className="h-3.5 w-3.5" /></a>}
                          {sch.instagram_url && <a href={sch.instagram_url.startsWith('http') ? sch.instagram_url : `https://instagram.com/${sch.instagram_url.replace('@','')}`} target="_blank" rel="noopener noreferrer" className="text-[#e1306c]" title="Instagram"><Instagram className="h-3.5 w-3.5" /></a>}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className={`text-[10px] ${textMuted}`}>Owner:</span>
                          {renderOwnerControl(sch)}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/school-profile/${sch.school_id}`)} className={`${textSec} h-9 w-9 p-0`} title="View School Profile"><Eye className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => crm.openEditSchool(sch)} className={`${textSec} h-9 w-9 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => crm.handleDeleteSchool(sch)} className="text-red-400 h-9 w-9 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  );
                })}
                {schFiltered.length === 0 && <p className={`text-center ${textMuted} py-12`}>No schools found</p>}
              </div>
              {/* Desktop: table */}
              <div className={`hidden sm:block ${card} border rounded-md overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="schools-table">
                    <thead><tr className="bg-[var(--bg-primary)]">
                      <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => crm.toggleSort('school_name')}>School{crm.sortIndicator('school_name')}</th>
                      <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('school_type')}>Type{crm.sortIndicator('school_type')}</th>
                      <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('city')}>City{crm.sortIndicator('city')}</th>
                      <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell`}>Contact</th>
                      <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => crm.toggleSort('school_strength')}>Strength{crm.sortIndicator('school_strength')}</th>
                      <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell`}>Profile</th>
                      <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell`}>Owner</th>
                      <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted}`}>Leads</th>
                      <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {schFiltered.map(sch => {
                        const schLeads = crm.leadsList.filter(l => l.school_id === sch.school_id);
                        return (
                          <tr key={sch.school_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => navigate(`/school-profile/${sch.school_id}`)} data-testid={`school-row-${sch.school_id}`}>
                            <td className="py-2.5 px-3">
                              <p className={`${textPri} font-medium hover:text-[#e94560] transition-colors`}>{sch.school_name}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {sch.email && <a href={`mailto:${sch.email}`} className={`text-xs ${textMuted} hover:text-[#e94560] flex items-center gap-0.5`} onClick={e => e.stopPropagation()}><MessageSquare className="h-2.5 w-2.5" />{sch.email}</a>}
                                {sch.linkedin_url && <a href={sch.linkedin_url.startsWith('http') ? sch.linkedin_url : `https://${sch.linkedin_url}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#0a66c2] hover:opacity-75" title="LinkedIn"><Linkedin className="h-3 w-3" /></a>}
                                {sch.instagram_url && <a href={sch.instagram_url.startsWith('http') ? sch.instagram_url : `https://instagram.com/${sch.instagram_url.replace('@','')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#e1306c] hover:opacity-75" title="Instagram"><Instagram className="h-3 w-3" /></a>}
                              </div>
                            </td>
                            <td className={`py-2.5 px-3 hidden sm:table-cell text-xs ${textSec}`}>{sch.school_type}</td>
                            <td className="py-2.5 px-3 hidden md:table-cell text-xs">
                              {sch.city
                                ? <span className={textSec}>{sch.city}{sch.state ? `, ${sch.state}` : ''}</span>
                                : <span className="italic text-[11px]" style={{ color: '#c0ccd8' }}>no city</span>}
                            </td>
                            <td className="py-2.5 px-3 hidden md:table-cell">
                              {sch.primary_contact_name
                                ? <>
                                    <p className={`text-xs ${textPri}`}>{sch.primary_contact_name}</p>
                                    <p className={`text-xs ${textMuted}`}>{sch.designation || <span className="italic" style={{ color: '#c0ccd8' }}>no title</span>}</p>
                                  </>
                                : <span className="text-[11px] italic" style={{ color: '#c0ccd8' }}>no contact</span>}
                            </td>
                            <td className={`py-2.5 px-3 hidden lg:table-cell text-center font-mono ${textPri}`}>{sch.school_strength || '-'}</td>
                            <td className="py-2.5 px-3 hidden lg:table-cell text-center" onClick={e => e.stopPropagation()}>
                              {completionBadge(crm.calcSchoolCompletion(sch), () => crm.openEditSchool(sch))}
                            </td>
                            <td className="py-2.5 px-3 hidden md:table-cell" onClick={e => e.stopPropagation()}>{renderOwnerControl(sch)}</td>
                            <td className="py-2.5 px-3 text-center"><span className="bg-[#e94560]/20 text-[#e94560] px-2 py-0.5 rounded text-xs font-bold">{schLeads.length}</span></td>
                            <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); crm.openEditSchool(sch); }} className={`${textSec} h-7`} data-testid={`edit-school-${sch.school_id}`}><Edit2 className="h-3 w-3" /></Button>
                              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); crm.handleDeleteSchool(sch); }} className="text-red-400 h-7" data-testid={`delete-school-${sch.school_id}`}><Trash2 className="h-3 w-3" /></Button>
                            </td>
                          </tr>
                        );
                      })}
                      {schFiltered.length === 0 && <tr><td colSpan="9" className={`py-12 text-center ${textMuted}`}>No schools match your search</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── REPORTS TAB ───────────────────────────────────────────── */}
        {crm.activeTab === 'reports' && (() => {
          const totalContacts = crm.contactsList.length;
          const convertedContacts = crm.contactsList.filter(c => c.converted_to_lead).length;
          const activeContacts = totalContacts - convertedContacts;
          const totalLeads = crm.leadsList.length;
          const demoLeads = crm.leadsList.filter(l => l.stage === 'demo').length;
          const quotedLeads = crm.leadsList.filter(l => l.stage === 'quoted').length;
          const wonLeads = crm.leadsList.filter(l => l.stage === 'won').length;
          const retentionLeads = crm.leadsList.filter(l => l.stage === 'retention').length;
          const resellLeads = crm.leadsList.filter(l => l.stage === 'resell').length;
          const agingBuckets = [
            { label: 'Fresh (≤3d)', cls: 'bg-green-500/20 text-green-400 border-green-500/30', count: crm.contactsList.filter(c => !c.converted_to_lead && crm.daysSince(c.last_activity_date) <= 3).length },
            { label: 'Active (4-7d)', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', count: crm.contactsList.filter(c => !c.converted_to_lead && crm.daysSince(c.last_activity_date) > 3 && crm.daysSince(c.last_activity_date) <= 7).length },
            { label: 'Cooling (8-14d)', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30', count: crm.contactsList.filter(c => !c.converted_to_lead && crm.daysSince(c.last_activity_date) > 7 && crm.daysSince(c.last_activity_date) <= 14).length },
            { label: 'Cold (15d+)', cls: 'bg-red-500/20 text-red-400 border-red-500/30', count: crm.contactsList.filter(c => !c.converted_to_lead && crm.daysSince(c.last_activity_date) > 14).length },
          ];
          const leadAgingBuckets = [
            { label: '≤3d', cls: 'bg-green-500/20 text-green-400', count: crm.leadsList.filter(l => crm.daysSince(l.last_activity_date) <= 3).length },
            { label: '4-7d', cls: 'bg-yellow-500/20 text-yellow-400', count: crm.leadsList.filter(l => crm.daysSince(l.last_activity_date) > 3 && crm.daysSince(l.last_activity_date) <= 7).length },
            { label: '8-14d', cls: 'bg-orange-500/20 text-orange-400', count: crm.leadsList.filter(l => crm.daysSince(l.last_activity_date) > 7 && crm.daysSince(l.last_activity_date) <= 14).length },
            { label: '15d+', cls: 'bg-red-500/20 text-red-400', count: crm.leadsList.filter(l => crm.daysSince(l.last_activity_date) > 14).length },
          ];
          const teamMap = {};
          crm.spList.forEach(sp => { teamMap[sp.email] = { name: sp.name, leads: 0, won: 0, contacts: 0 }; });
          crm.leadsList.forEach(l => { if (teamMap[l.assigned_to]) { teamMap[l.assigned_to].leads++; if (l.stage === 'won') teamMap[l.assigned_to].won++; } });
          crm.contactsList.forEach(c => { if (teamMap[c.created_by]) teamMap[c.created_by].contacts++; });
          const teamBoard = Object.values(teamMap).sort((a, b) => b.leads - a.leads);
          const schCompletion = { incomplete: 0, low: 0, good: 0, complete: 0 };
          crm.schoolsList.forEach(sch => {
            const p = crm.calcSchoolCompletion(sch);
            if (p < 30) schCompletion.incomplete++;
            else if (p < 60) schCompletion.low++;
            else if (p < 90) schCompletion.good++;
            else schCompletion.complete++;
          });
          const leadsPerSchool = crm.schoolsList.map(sch => ({
            name: sch.school_name, city: sch.city,
            count: crm.leadsList.filter(l => l.school_id === sch.school_id).length,
            pct: crm.calcSchoolCompletion(sch),
          })).filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);

          return (
            <div className="space-y-5" data-testid="reports-tab">
              <div className={`${card} border rounded-md p-4`}>
                <h3 className={`${textPri} font-semibold text-sm mb-3`}>Contact → Lead Funnel</h3>
                <div className="flex flex-wrap gap-2 items-end">
                  {[
                    { label: 'Total Contacts', val: totalContacts, cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                    { label: 'Converted', val: convertedContacts, cls: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', pct: totalContacts ? Math.round(convertedContacts / totalContacts * 100) : 0 },
                    { label: 'Demo', val: demoLeads, cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30', pct: totalLeads ? Math.round(demoLeads / totalLeads * 100) : 0 },
                    { label: 'Quoted', val: quotedLeads, cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', pct: totalLeads ? Math.round(quotedLeads / totalLeads * 100) : 0 },
                    { label: 'Won', val: wonLeads, cls: 'bg-green-500/20 text-green-400 border-green-500/30', pct: totalLeads ? Math.round(wonLeads / totalLeads * 100) : 0 },
                    { label: 'Retention', val: retentionLeads, cls: 'bg-teal-500/20 text-teal-400 border-teal-500/30', pct: wonLeads ? Math.round(retentionLeads / Math.max(wonLeads, 1) * 100) : 0 },
                    { label: 'Resell', val: resellLeads, cls: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', pct: retentionLeads ? Math.round(resellLeads / Math.max(retentionLeads, 1) * 100) : 0 },
                  ].map(f => (
                    <div key={f.label} className={`flex-1 min-w-[90px] border rounded-md p-3 text-center ${f.cls}`}>
                      <p className="text-2xl font-bold">{f.val}</p>
                      <p className="text-[11px] font-medium">{f.label}</p>
                      {f.pct !== undefined && <p className="text-[10px] opacity-70">{f.pct}% conv.</p>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className={`${card} border rounded-md p-4`}>
                  <h3 className={`${textPri} font-semibold text-sm mb-3`}>Contact Follow-up Aging</h3>
                  <div className="space-y-2">
                    {agingBuckets.map(b => (
                      <div key={b.label} className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                        <div className="flex-1 mx-3 bg-[var(--bg-primary)] rounded-full h-2 overflow-hidden">
                          <div className={`h-2 rounded-full ${b.cls.split(' ')[0]}`} style={{ width: `${activeContacts ? Math.round(b.count / activeContacts * 100) : 0}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${textPri} w-6 text-right`}>{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`${card} border rounded-md p-4`}>
                  <h3 className={`${textPri} font-semibold text-sm mb-3`}>Lead Follow-up Aging</h3>
                  <div className="space-y-2">
                    {leadAgingBuckets.map(b => (
                      <div key={b.label} className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded ${b.cls} w-14 text-center`}>{b.label}</span>
                        <div className="flex-1 mx-3 bg-[var(--bg-primary)] rounded-full h-2 overflow-hidden">
                          <div className={`h-2 rounded-full ${b.cls.split(' ')[0]}`} style={{ width: `${totalLeads ? Math.round(b.count / totalLeads * 100) : 0}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${textPri} w-6 text-right`}>{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className={`${card} border rounded-md p-4`}>
                <h3 className={`${textPri} font-semibold text-sm mb-3`}>Lead Stage Distribution</h3>
                <div className="flex flex-wrap gap-2">
                  {STAGES.map(s => {
                    const cnt = crm.leadsList.filter(l => l.stage === s.id).length;
                    return (
                      <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded border ${s.color} flex-1 min-w-[90px] justify-between`}>
                        <span className="text-xs font-medium">{s.label}</span>
                        <span className="text-lg font-bold">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {teamBoard.length > 0 && (
                <div className={`${card} border rounded-md p-4`}>
                  <h3 className={`${textPri} font-semibold text-sm mb-3`}>Team Leaderboard</h3>
                  <div className="rounded-md overflow-hidden border border-[var(--border-color)]">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-[var(--bg-primary)]">
                        <th className={`text-left py-2 px-3 text-xs uppercase ${textMuted}`}>Sales Person</th>
                        <th className={`text-center py-2 px-3 text-xs uppercase ${textMuted}`}>Contacts</th>
                        <th className={`text-center py-2 px-3 text-xs uppercase ${textMuted}`}>Leads</th>
                        <th className={`text-center py-2 px-3 text-xs uppercase ${textMuted}`}>Won</th>
                        <th className={`text-center py-2 px-3 text-xs uppercase ${textMuted}`}>Win Rate</th>
                      </tr></thead>
                      <tbody>
                        {teamBoard.map((m, i) => (
                          <tr key={m.name} className={`border-t border-[var(--border-color)] ${i === 0 ? 'bg-[#e94560]/5' : ''}`}>
                            <td className={`py-2 px-3 font-medium ${textPri}`}>
                              <div className="flex items-center gap-1.5">{i === 0 && <span className="text-yellow-400 text-xs">★</span>}{m.name}</div>
                            </td>
                            <td className={`py-2 px-3 text-center ${textSec}`}>{m.contacts}</td>
                            <td className="py-2 px-3 text-center font-mono text-[#e94560] font-bold">{m.leads}</td>
                            <td className="py-2 px-3 text-center text-green-400 font-bold">{m.won}</td>
                            <td className={`py-2 px-3 text-center text-xs ${textSec}`}>{m.leads ? `${Math.round(m.won / m.leads * 100)}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className={`${card} border rounded-md p-4`}>
                  <h3 className={`${textPri} font-semibold text-sm mb-3`}>School Profile Completion</h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Incomplete (<30%)', val: schCompletion.incomplete, cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
                      { label: 'Low (30-59%)', val: schCompletion.low, cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
                      { label: 'Good (60-89%)', val: schCompletion.good, cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
                      { label: 'Complete (90%+)', val: schCompletion.complete, cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
                    ].map(b => (
                      <div key={b.label} className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded border ${b.cls} min-w-[130px]`}>{b.label}</span>
                        <div className="flex-1 mx-3 bg-[var(--bg-primary)] rounded-full h-2 overflow-hidden">
                          <div className={`h-2 rounded-full ${b.cls.split(' ')[0]}`} style={{ width: `${crm.schoolsList.length ? Math.round(b.val / crm.schoolsList.length * 100) : 0}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${textPri} w-6 text-right`}>{b.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {leadsPerSchool.length > 0 && (
                  <div className={`${card} border rounded-md p-4`}>
                    <h3 className={`${textPri} font-semibold text-sm mb-3`}>Top Schools by Engagement</h3>
                    <div className="space-y-1.5">
                      {leadsPerSchool.slice(0, 8).map(s => (
                        <div key={s.name} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${textPri} truncate`}>{s.name}</p>
                            <p className={`text-[10px] ${textMuted}`}>{s.city}</p>
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.pct >= 90 ? 'bg-green-500/20 text-green-400' : s.pct >= 60 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-orange-500/20 text-orange-400'}`}>{s.pct}%</span>
                            <span className="text-xs font-bold text-[#e94560]">{s.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── DIALOGS ───────────────────────────────────────────────── */}

        <LeadDetailPanel
          detailLead={crm.detailLead}
          setDetailLead={crm.setDetailLead}
          notes={crm.notes}
          leadFollowups={crm.leadFollowups}
          physicalDispatches={crm.physicalDispatches}
          leadVisits={crm.leadVisits}
          leadEnrollments={crm.leadEnrollments}
          noteForm={crm.noteForm}
          setNoteForm={crm.setNoteForm}
          fuForm={crm.fuForm}
          setFuForm={crm.setFuForm}
          pdForm={crm.pdForm}
          setPdForm={crm.setPdForm}
          enrollDialogOpen={crm.enrollDialogOpen}
          setEnrollDialogOpen={crm.setEnrollDialogOpen}
          selectedSequenceId={crm.selectedSequenceId}
          setSelectedSequenceId={crm.setSelectedSequenceId}
          setLeadEnrollments={crm.setLeadEnrollments}
          dripSequencesList={crm.dripSequencesList}
          allQuotations={crm.allQuotations}
          addNote={crm.addNote}
          addFollowup={crm.addFollowup}
          completeFollowup={crm.completeFollowup}
          addPhysicalDispatch={crm.addPhysicalDispatch}
          markDispatchReceived={crm.markDispatchReceived}
          changeStage={crm.changeStage}
          openEditLead={crm.openEditLead}
          openCreateTask={crm.openCreateTask}
          openWaForLead={crm.openWaForLead}
          setReassignLead={crm.setReassignLead}
          setReassignBulkIds={crm.setReassignBulkIds}
          setReassignOpen={crm.setReassignOpen}
          fetchData={crm.fetchData}
        />

        <LeadFormDialog
          open={crm.leadDialogOpen}
          onOpenChange={crm.setLeadDialogOpen}
          editLead={crm.editLead}
          leadForm={crm.leadForm}
          setLeadForm={crm.setLeadForm}
          addNewSchool={crm.addNewSchool}
          setAddNewSchool={crm.setAddNewSchool}
          newSchool={crm.newSchool}
          setNewSchool={crm.setNewSchool}
          newTagInput={crm.newTagInput}
          setNewTagInput={crm.setNewTagInput}
          schoolsList={crm.schoolsList}
          spList={crm.spList}
          rolesList={crm.rolesList}
          sourcesList={crm.sourcesList}
          tagsList={crm.tagsList}
          setTagsList={crm.setTagsList}
          contactsList={crm.contactsList}
          saveLead={crm.saveLead}
        />

        <SchoolFormDialog
          open={crm.schoolDialogOpen}
          onOpenChange={crm.setSchoolDialogOpen}
          editSchool={crm.editSchool}
          setEditSchool={crm.setEditSchool}
          editSchoolForm={crm.editSchoolForm}
          setEditSchoolForm={crm.setEditSchoolForm}
          groupsList={crm.groupsList}
          designationsList={crm.designationsList}
          handleSaveSchool={crm.handleSaveSchool}
        />

        <ContactFormDialog
          contactDialogOpen={crm.contactDialogOpen}
          setContactDialogOpen={crm.setContactDialogOpen}
          editContact={crm.editContact}
          contactForm={crm.contactForm}
          setContactForm={crm.setContactForm}
          schoolsList={crm.schoolsList}
          rolesList={crm.rolesList}
          sourcesList={crm.sourcesList}
          spList={crm.spList}
          tagsList={crm.tagsList}
          designationsList={crm.designationsList}
          contactsList={crm.contactsList}
          saveContact={crm.saveContact}
          convertDialogOpen={crm.convertDialogOpen}
          setConvertDialogOpen={crm.setConvertDialogOpen}
          convertContact={crm.convertContact}
          convertForm={crm.convertForm}
          setConvertForm={crm.setConvertForm}
          convertAddNewSchool={crm.convertAddNewSchool}
          setConvertAddNewSchool={crm.setConvertAddNewSchool}
          convertNewSchool={crm.convertNewSchool}
          setConvertNewSchool={crm.setConvertNewSchool}
          handleConvert={crm.handleConvert}
          contactImportOpen={crm.contactImportOpen}
          setContactImportOpen={crm.setContactImportOpen}
          contactFileRef={crm.contactFileRef}
          importFile={crm.importFile}
          setImportFile={crm.setImportFile}
          importTags={crm.importTags}
          setImportTags={crm.setImportTags}
          importNotes={crm.importNotes}
          setImportNotes={crm.setImportNotes}
          importing={crm.importing}
          importResult={crm.importResult}
          handleContactImport={crm.handleContactImport}
          resetImportDialog={crm.resetImportDialog}
          downloadSampleCsv={crm.downloadSampleCsv}
        />

        {/* Lead import dialog */}
        {crm.importDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => crm.setImportDialogOpen(false)}>
            <div className={`${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]'} border rounded-lg p-6 w-[calc(100vw-2rem)] max-w-md space-y-3`} onClick={e => e.stopPropagation()}>
              <h2 className={`font-semibold text-lg ${textPri}`}>Import Leads from CSV</h2>
              <p className={`text-sm ${textSec}`}>CSV columns: school_name, school_type, website, location, contact_name, designation, phone, email, school_strength, source</p>
              <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-md p-8 text-center cursor-pointer" onClick={() => crm.fileRef.current?.click()}>
                <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload CSV file</p>
                <input ref={crm.fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) crm.handleImport(e.target.files[0]); }} />
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => crm.setImportDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Close</Button>
              </div>
            </div>
          </div>
        )}

        <WhatsAppSendDialog open={crm.waOpen} onOpenChange={crm.setWaOpen} module={crm.waCtx.module} context={crm.waCtx.context} title={crm.waCtx.title} />

        <ReassignLeadDialog
          open={crm.reassignOpen}
          onOpenChange={crm.setReassignOpen}
          lead={crm.reassignLead}
          leadIds={crm.reassignBulkIds}
          onSuccess={() => { crm.setSelectedLeadIds(new Set()); crm.fetchData(); }}
        />

      </div>

      {/* Mobile FAB */}
      <button
        onClick={crm.openCreateLead}
        className="sm:hidden fixed z-40 w-14 h-14 rounded-full bg-[#e94560] hover:bg-[#f05c75] text-white shadow-xl flex items-center justify-center active:scale-95 transition-transform"
        style={{ bottom: 'calc(3.75rem + env(safe-area-inset-bottom) + 1rem)', right: '1rem' }}
        aria-label="New Lead">
        <Plus className="h-6 w-6" />
      </button>
    </AppShell>
  );
}
