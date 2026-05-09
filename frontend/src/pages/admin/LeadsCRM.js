import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { schools as schoolsApi, leads as leadsApi, followups as fuApi, tasks as tasksApi, salesPersons, contacts as contactsApi, exportData, groups as groupsApi, sources as sourcesApi, contactRoles as contactRolesApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Phone, MessageSquare, Mail, Calendar, Clock, CheckCircle, AlertTriangle, User, UserCog, Trash2, Edit2, Upload, Search, Target, ChevronRight, Building2, MapPin, UserPlus, ArrowRightCircle, Download, ChevronLeft, LayoutGrid, Lock, Package } from 'lucide-react';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';
import KanbanBoard, { ageColor, AgeBadge } from '../../components/KanbanBoard';
import ReassignLeadDialog from '../../components/ReassignLeadDialog';

const STAGES = [
  { id: 'new', label: 'New', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { id: 'contacted', label: 'Contacted', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { id: 'demo', label: 'Demo', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { id: 'quoted', label: 'Quoted', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { id: 'negotiation', label: 'Negotiation', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { id: 'won', label: 'Won', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { id: 'retention', label: 'Retention', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { id: 'resell', label: 'Resell', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  { id: 'lost', label: 'Lost', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];
const NOTE_TYPES = [
  { id: 'call', label: 'Call', icon: Phone },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'meeting', label: 'Meeting', icon: Calendar },
  { id: 'note', label: 'Note', icon: Edit2 },
];
const SCHOOL_TYPES = ['CBSE', 'ICSE', 'IB', 'State Board', 'Coaching', 'College'];
const DESIGNATIONS = ['Principal', 'Admin', 'Trustee', 'Purchase Head', 'Director', 'Other'];
const SOURCES = ['Website', 'Referral', 'Exhibition', 'Cold Call', 'WhatsApp', 'Ads', 'Import'];

export default function LeadsCRM() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [leadsList, setLeadsList] = useState([]);
  const [schoolsList, setSchoolsList] = useState([]);
  const [tasksList, setTasksList] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const [spList, setSpList] = useState([]);
  // FMS Phase 1 masters
  const [groupsList, setGroupsList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pipeline');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  // Dialogs
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const [detailLead, setDetailLead] = useState(null);
  const [notes, setNotes] = useState([]);
  const [leadFollowups, setLeadFollowups] = useState([]);
  const [noteForm, setNoteForm] = useState({ type: 'call', content: '', outcome: '' });
  const [fuForm, setFuForm] = useState({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileRef = useRef(null);
  // Forms
  const [editLead, setEditLead] = useState(null);
  const [addNewSchool, setAddNewSchool] = useState(false);
  const [leadForm, setLeadForm] = useState({ school_id: '', contact_name: '', designation: '', contact_role_id: '', contact_phone: '', contact_email: '', source: '', source_id: '', lead_type: 'warm', interested_product: '', priority: 'medium', next_followup_date: '', likely_closure_date: '', assignment_type: 'manual', assigned_to: '', notes: '' });
  const [newSchool, setNewSchool] = useState({ school_name: '', school_type: 'CBSE', phone: '', email: '', city: '', state: '', pincode: '', school_strength: 0 });
  const [schoolForm, setSchoolForm] = useState({});
  const [taskForm, setTaskForm] = useState({ title: '', type: 'follow_up', lead_id: '', lead_name: '', assigned_to: '', due_date: '', due_time: '', priority: 'medium' });
  // Contact state
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', company: '', designation: '', contact_role_id: '', source: '', source_id: '', notes: '' });
  const [editContact, setEditContact] = useState(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertContact, setConvertContact] = useState(null);
  const [convertForm, setConvertForm] = useState({ school_id: '', lead_type: 'warm', priority: 'medium', interested_product: '', assigned_to: '' });
  const [convertAddNewSchool, setConvertAddNewSchool] = useState(false);
  const [convertNewSchool, setConvertNewSchool] = useState({ school_name: '', school_type: 'CBSE', city: '', phone: '', school_strength: 0 });
  const [contactImportOpen, setContactImportOpen] = useState(false);
  const contactFileRef = useRef(null);
  // Sorting
  const [sortConfig, setSortConfig] = useState({ key: '', dir: 'asc' });
  // Pagination
  const [contactPage, setContactPage] = useState(1);
  const contactsPerPage = 10;
  // School edit
  const [editSchool, setEditSchool] = useState(null);
  const [editSchoolForm, setEditSchoolForm] = useState({});
  // WhatsApp dialog (FMS Phase 4)
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx] = useState({ module: 'general', context: {}, title: 'Send WhatsApp' });
  // FMS Phase 5.1 + 5.2: view + bulk + reassign
  const [leadView, setLeadView] = useState('pipeline'); // 'pipeline' | 'kanban' | 'table'
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignLead, setReassignLead] = useState(null);
  const [reassignBulkIds, setReassignBulkIds] = useState(null);

  const fetchData = async () => {
    try {
      const [lr, sr, tr, spr, cr, gr, srcR, rlR] = await Promise.all([
        leadsApi.getAll(), schoolsApi.getAll(), tasksApi.getAll(), salesPersons.getAll(), contactsApi.getAll(),
        groupsApi.getAll().catch(() => ({ data: [] })),
        sourcesApi.getAll().catch(() => ({ data: [] })),
        contactRolesApi.getAll().catch(() => ({ data: [] })),
      ]);
      setLeadsList(lr.data);
      setSchoolsList(sr.data);
      setTasksList(tr.data);
      setSpList(spr.data);
      setContactsList(cr.data);
      setGroupsList(gr.data || []);
      setSourcesList(srcR.data || []);
      setRolesList(rlR.data || []);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  // Theme colors
  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const hoverBg = isDark ? 'hover:bg-[var(--bg-hover)]' : 'hover:bg-[#f0f0f5]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  // Handlers
  const openCreateLead = () => { setEditLead(null); setAddNewSchool(false); setLeadForm({ school_id: '', contact_name: '', designation: '', contact_role_id: '', contact_phone: '', contact_email: '', source: '', source_id: '', lead_type: 'warm', interested_product: '', priority: 'medium', next_followup_date: '', likely_closure_date: '', assignment_type: 'manual', assigned_to: '', notes: '' }); setNewSchool({ school_name: '', school_type: 'CBSE', phone: '', email: '', city: '', state: '', pincode: '', school_strength: 0 }); setLeadDialogOpen(true); };
  const openEditLead = (lead) => { setEditLead(lead); setLeadForm({ ...lead }); setLeadDialogOpen(true); };

  const openDetail = async (lead) => {
    setDetailLead(lead);
    try {
      const [nr, fr] = await Promise.all([leadsApi.getNotes(lead.lead_id), fuApi.getAll(lead.lead_id)]);
      setNotes(nr.data);
      setLeadFollowups(fr.data);
    } catch { setNotes([]); setLeadFollowups([]); }
  };

  const saveLead = async () => {
    if (!leadForm.contact_name || !leadForm.contact_phone) { toast.error('Contact name and phone required'); return; }
    try {
      const payload = { ...leadForm };
      if (addNewSchool && newSchool.school_name) {
        payload.new_school = newSchool;
        payload.company_name = newSchool.school_name;
      } else if (leadForm.school_id) {
        const sch = schoolsList.find(s => s.school_id === leadForm.school_id);
        if (sch) payload.company_name = sch.school_name;
      }
      const sp = spList.find(s => s.email === leadForm.assigned_to);
      if (sp) payload.assigned_name = sp.name;
      if (editLead) {
        await leadsApi.update(editLead.lead_id, payload);
        toast.success('Lead updated');
      } else {
        await leadsApi.create(payload);
        toast.success('Lead created');
      }
      setLeadDialogOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const changeStage = async (leadId, newStage) => {
    await leadsApi.update(leadId, { stage: newStage });
    fetchData();
    if (detailLead?.lead_id === leadId) setDetailLead({ ...detailLead, stage: newStage });
  };

  const addNote = async () => {
    if (!noteForm.content) return;
    const noteType = noteForm.type;
    await leadsApi.addNote(detailLead.lead_id, noteForm);
    setNoteForm({ type: 'call', content: '', outcome: '' });
    const res = await leadsApi.getNotes(detailLead.lead_id);
    setNotes(res.data);
    toast.success('Note added');
    // FMS Phase 4: auto-popup WhatsApp after call/visit/meeting/whatsapp note
    if (['call', 'whatsapp', 'meeting'].includes(noteType)) {
      setTimeout(() => {
        if (window.confirm('Send a WhatsApp follow-up to this contact?')) {
          setWaCtx({
            module: 'lead', title: `WhatsApp follow-up - ${detailLead.contact_name}`,
            context: {
              lead_id: detailLead.lead_id, school_id: detailLead.school_id,
              phone: detailLead.contact_phone, contact_name: detailLead.contact_name,
              school_name: detailLead.company_name || detailLead.school_name,
            },
          });
          setWaOpen(true);
        }
      }, 200);
    }
  };

  const openWaForLead = (lead) => {
    setWaCtx({
      module: 'lead', title: `WhatsApp - ${lead.contact_name}`,
      context: {
        lead_id: lead.lead_id, school_id: lead.school_id,
        phone: lead.contact_phone, contact_name: lead.contact_name,
        school_name: lead.company_name || lead.school_name,
      },
    });
    setWaOpen(true);
  };
  const openWaForContact = (c) => {
    setWaCtx({
      module: 'contact', title: `WhatsApp - ${c.name}`,
      context: { contact_id: c.contact_id, phone: c.phone, contact_name: c.name, school_name: c.company },
    });
    setWaOpen(true);
  };

  // FMS Phase 5.2: Kanban drag-and-drop handler with soft-warning guards
  const handleKanbanMove = async ({ itemId, from, to, item }) => {
    // Guard: activity logged?
    let hasActivity = false;
    try {
      const r = await leadsApi.getNotes(itemId);
      hasActivity = Array.isArray(r.data) && r.data.length > 0;
    } catch { /* ignore */ }
    const hasFollowup = !!item.next_followup_date;
    if (!hasActivity || !hasFollowup) {
      const missing = [!hasActivity ? 'activity log' : null, !hasFollowup ? 'next follow-up date' : null].filter(Boolean).join(' + ');
      const confirmProceed = window.confirm(`Move recommended only after ${missing}. Proceed anyway?`);
      if (!confirmProceed) return;
    }
    try {
      await leadsApi.update(itemId, { stage: to, stage_change_note: `Drag from ${from} to ${to}` });
      toast.success(`Moved to ${STAGES.find(s => s.id === to)?.label || to}`);
      fetchData();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Move failed');
    }
  };

  // Lead selection for bulk
  const toggleLeadSelect = (id) => setSelectedLeadIds(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Days-since-activity for colour coding
  const daysSince = (iso) => {
    if (!iso) return 999;
    return Math.floor((new Date() - new Date(iso)) / (1000 * 60 * 60 * 24));
  };
  const touchAgeCls = (iso) => {
    const d = daysSince(iso);
    if (d <= 3) return 'text-green-400';
    if (d <= 7) return 'text-yellow-400';
    if (d <= 14) return 'text-orange-400';
    return 'text-red-400';
  };
  const calcSchoolCompletion = (sch) => {
    const fields = ['school_name', 'school_type', 'phone', 'email', 'city', 'state', 'primary_contact_name', 'designation', 'school_strength', 'website'];
    const filled = fields.filter(f => sch[f] && String(sch[f]).trim() !== '' && sch[f] !== 0).length;
    return Math.round((filled / fields.length) * 100);
  };

  const addFollowup = async () => {
    if (!fuForm.followup_date) return;
    await fuApi.create({ ...fuForm, lead_id: detailLead.lead_id });
    setFuForm({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
    const res = await fuApi.getAll(detailLead.lead_id);
    setLeadFollowups(res.data);
    toast.success('Follow-up scheduled');
  };

  const completeFollowup = async (fid) => {
    await fuApi.update(fid, { status: 'completed' });
    const res = await fuApi.getAll(detailLead.lead_id);
    setLeadFollowups(res.data);
  };

  const handleImport = async (file) => {
    try {
      const res = await leadsApi.importCsv(file);
      toast.success(`Imported: ${res.data.created} created, ${res.data.linked} linked, ${res.data.duplicates} duplicates`);
      setImportDialogOpen(false);
      fetchData();
    } catch { toast.error('Import failed'); }
  };

  const openCreateTask = (lead) => { setTaskForm({ title: '', type: 'follow_up', lead_id: lead?.lead_id || '', lead_name: lead?.company_name || '', assigned_to: lead?.assigned_to || '', due_date: '', due_time: '', priority: 'medium' }); setTaskDialogOpen(true); };
  const saveTask = async () => {
    if (!taskForm.title || !taskForm.due_date) { toast.error('Title and due date required'); return; }
    const sp = spList.find(s => s.email === taskForm.assigned_to);
    await tasksApi.create({ ...taskForm, assigned_name: sp?.name || '' });
    setTaskDialogOpen(false); fetchData(); toast.success('Task created');
  };
  const updateTaskStatus = async (taskId, status) => { await tasksApi.update(taskId, { status }); fetchData(); };

  // Contact handlers
  const openCreateContact = () => { setEditContact(null); setContactForm({ name: '', phone: '', email: '', company: '', designation: '', contact_role_id: '', source: '', source_id: '', notes: '' }); setContactDialogOpen(true); };
  const openEditContact = (c) => { setEditContact(c); setContactForm({ name: c.name, phone: c.phone, email: c.email || '', company: c.company || '', designation: c.designation || '', contact_role_id: c.contact_role_id || '', source: c.source || '', source_id: c.source_id || '', notes: c.notes || '' }); setContactDialogOpen(true); };
  const saveContact = async () => {
    if (!contactForm.name || !contactForm.phone) { toast.error('Name and phone required'); return; }
    try {
      if (editContact) { await contactsApi.update(editContact.contact_id, contactForm); toast.success('Contact updated'); }
      else { await contactsApi.create(contactForm); toast.success('Contact added'); }
      setContactDialogOpen(false); fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };
  const deleteContact = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    await contactsApi.delete(id); fetchData(); toast.success('Contact deleted');
  };
  const openConvert = (c) => {
    setConvertContact(c);
    setConvertForm({ school_id: '', lead_type: 'warm', priority: 'medium', interested_product: '', assigned_to: user?.email || '' });
    setConvertAddNewSchool(false);
    setConvertNewSchool({ school_name: '', school_type: 'CBSE', city: '', phone: '', school_strength: 0 });
    setConvertDialogOpen(true);
  };
  const handleConvert = async () => {
    try {
      const sp = spList.find(s => s.email === convertForm.assigned_to);
      const payload = { ...convertForm, assigned_name: sp?.name || user?.name || '' };
      if (convertAddNewSchool && convertNewSchool.school_name) {
        payload.new_school = convertNewSchool;
        payload.school_id = '';
      }
      await contactsApi.convertToLead(convertContact.contact_id, payload);
      toast.success(`${convertContact.name} converted to lead!`);
      setConvertDialogOpen(false); fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to convert'); }
  };
  const handleContactImport = async (file) => {
    try {
      const res = await contactsApi.importCsv(file);
      toast.success(`Imported: ${res.data.created} created, ${res.data.duplicates} duplicates`);
      setContactImportOpen(false); fetchData();
    } catch { toast.error('Import failed'); }
  };
  const handleContactExport = () => {
    exportData.download('contacts');
    toast.success('Exporting contacts...');
  };

  // Sort helper
  const toggleSort = (key) => {
    setSortConfig(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const sortIndicator = (key) => sortConfig.key === key ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const sortData = (data, key, dir) => {
    if (!key) return data;
    return [...data].sort((a, b) => {
      const av = (a[key] || ''), bv = (b[key] || '');
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
      return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  };

  // School edit/delete
  const openEditSchool = (sch) => {
    setEditSchool(sch);
    setEditSchoolForm({ school_name: sch.school_name || '', school_type: sch.school_type || 'CBSE', phone: sch.phone || '', email: sch.email || '', city: sch.city || '', state: sch.state || '', primary_contact_name: sch.primary_contact_name || '', designation: sch.designation || '', school_strength: sch.school_strength || 0 });
    setSchoolDialogOpen(true);
  };
  const handleSaveSchool = async () => {
    if (!editSchoolForm.school_name) { toast.error('School name required'); return; }
    try {
      if (editSchool) {
        await schoolsApi.update(editSchool.school_id, editSchoolForm);
        toast.success('School updated');
      } else {
        await schoolsApi.create(editSchoolForm);
        toast.success('School added');
      }
      setSchoolDialogOpen(false);
      setEditSchool(null);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };
  const handleDeleteSchool = async (sch) => {
    if (!window.confirm(`Delete school "${sch.school_name}"? Associated leads will NOT be deleted.`)) return;
    try { await schoolsApi.delete(sch.school_id); toast.success('School deleted'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  // Filter leads
  const filtered = leadsList.filter(l => {
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      if (!((l.company_name || '').toLowerCase().includes(s) || (l.contact_name || '').toLowerCase().includes(s) || (l.contact_phone || '').includes(s) || (l.school_city || '').toLowerCase().includes(s))) return false;
    }
    if (filterType !== 'all') {
      if (['hot', 'warm', 'cold'].includes(filterType) && l.lead_type !== filterType) return false;
      if (SCHOOL_TYPES.includes(filterType) && l.school_type !== filterType) return false;
    }
    return true;
  });

  const getStageObj = (id) => STAGES.find(s => s.id === id) || STAGES[0];

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="leads-title">School CRM</h1>
            <p className={`${textSec} mt-1 text-sm`}>{contactsList.filter(c => !c.converted_to_lead).length} contacts • {leadsList.length} leads • {schoolsList.length} schools</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openCreateContact} variant="outline" size="sm" className={'border-[var(--border-color)] text-[var(--text-secondary)]'} data-testid="add-contact-btn">
              <UserPlus className="mr-1 h-3 w-3" /> Add Contact
            </Button>
            <Button onClick={() => setImportDialogOpen(true)} variant="outline" size="sm" className={'border-[var(--border-color)] text-[var(--text-secondary)]'} data-testid="import-btn">
              <Upload className="mr-1 h-3 w-3" /> Import CSV
            </Button>
            <Button onClick={() => { setEditSchool(null); setEditSchoolForm({ school_name: '', school_type: 'CBSE', group_id: '', phone: '', email: '', city: '', state: '', primary_contact_name: '', designation: '', school_strength: 0 }); setSchoolDialogOpen(true); }} variant="outline" size="sm" className={'border-[var(--border-color)] text-[var(--text-secondary)]'} data-testid="add-school-btn">
              <Building2 className="mr-1 h-3 w-3" /> Add School
            </Button>
            <Button onClick={() => openCreateTask(null)} variant="outline" size="sm" className={`${'border-[var(--border-color)] text-[var(--text-secondary)]'}`} data-testid="create-task-button">
              <Calendar className="mr-1 h-3 w-3" /> New Task
            </Button>
            {user?.role === 'admin' && (
              <Button onClick={async () => {
                if (!window.confirm('Round-robin auto-assign all UNASSIGNED leads to active sales persons?')) return;
                try {
                  const r = await leadsApi.autoAssign();
                  toast.success(`Auto-assigned ${r.data.assigned} lead(s)`);
                  fetchData();
                } catch { toast.error('Auto-assign failed'); }
              }} variant="outline" size="sm" className={'border-[var(--border-color)] text-[var(--text-secondary)]'} data-testid="auto-assign-btn">
                <Target className="mr-1 h-3 w-3" /> Auto-Assign
              </Button>
            )}
            <Button onClick={openCreateLead} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-lead-button">
              <Plus className="mr-1 h-3 w-3" /> New Lead
            </Button>
          </div>
        </div>

        {/* View Toggle + Bulk Actions (FMS Phase 5.1 + 5.2) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className={`${card} border rounded-md p-0.5 flex gap-0.5`} data-testid="lead-view-toggle">
            {[
              { id: 'pipeline', label: 'Pipeline' },
              { id: 'kanban', label: 'Kanban' },
              { id: 'table', label: 'Table' },
            ].map(v => (
              <button key={v.id} onClick={() => setLeadView(v.id)} data-testid={`view-${v.id}`}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${leadView === v.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
                {v.label}
              </button>
            ))}
          </div>
          {selectedLeadIds.size > 0 && (
            <div className="flex items-center gap-2" data-testid="bulk-actions-bar">
              <span className={`text-xs ${textSec}`}>{selectedLeadIds.size} selected</span>
              <Button size="sm" onClick={() => { setReassignBulkIds(Array.from(selectedLeadIds)); setReassignLead(null); setReassignOpen(true); }} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid="bulk-reassign-btn">
                <UserCog className="mr-1 h-3 w-3" /> Bulk Reassign
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedLeadIds(new Set())} className={`border-[var(--border-color)] ${textSec} h-8`}>Clear</Button>
            </div>
          )}
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search school, contact, phone, city..." className={`pl-10 ${inputCls}`} data-testid="search-input" />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="filter-select">
            <option value="all">All Types</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 ${card} border rounded-md p-1 overflow-x-auto`}>
          {['contacts', 'pipeline', 'list', 'tasks', 'schools', 'reports'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-shrink-0 px-3 py-2 rounded text-xs sm:text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} ${hoverBg}`}`} data-testid={`tab-${tab}`}>
              {tab === 'contacts' ? `Contacts (${contactsList.filter(c => !c.converted_to_lead).length})` : tab === 'pipeline' ? `Pipeline` : tab === 'list' ? `Leads (${filtered.length})` : tab === 'tasks' ? `Tasks (${tasksList.length})` : tab === 'schools' ? `Schools (${schoolsList.length})` : `Reports`}
            </button>
          ))}
        </div>

        {/* CONTACTS VIEW */}
        {activeTab === 'contacts' && (() => {
          let cFiltered = contactsList.filter(c => {
            if (searchTerm) {
              const s = searchTerm.toLowerCase();
              return (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.company || '').toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s);
            }
            return true;
          });
          cFiltered = sortData(cFiltered, sortConfig.key, sortConfig.dir);
          const totalPages = Math.max(1, Math.ceil(cFiltered.length / contactsPerPage));
          const safePage = Math.min(contactPage, totalPages);
          const paginated = cFiltered.slice((safePage - 1) * contactsPerPage, safePage * contactsPerPage);
          return (
          <div className="space-y-3" data-testid="contacts-list">
            {/* Contacts action bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleContactExport} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="export-contacts-btn">
                <Download className="mr-1 h-3 w-3" /> Export CSV
              </Button>
              <Button onClick={() => setContactImportOpen(true)} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="import-contacts-btn">
                <Upload className="mr-1 h-3 w-3" /> Import CSV
              </Button>
              <span className={`text-xs ${textMuted} ml-auto`}>{cFiltered.length} contacts{searchTerm ? ' (filtered)' : ''} • {contactsList.filter(c => c.converted_to_lead).length} converted</span>
            </div>

            {cFiltered.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <UserPlus className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No contacts found</p>
                <Button onClick={openCreateContact} size="sm" className="mt-4 bg-[#e94560] hover:bg-[#f05c75] text-white"><Plus className="mr-1 h-3 w-3" /> Add Contact</Button>
              </div>
            ) : (
              <>
                {/* Table */}
                <div className={`${card} border rounded-md overflow-hidden`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="contacts-table">
                      <thead><tr className="bg-[var(--bg-primary)]">
                        <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('name')}>Name{sortIndicator('name')}</th>
                        <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('phone')}>Phone{sortIndicator('phone')}</th>
                        <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => toggleSort('email')}>Email{sortIndicator('email')}</th>
                        <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => toggleSort('company')}>Company{sortIndicator('company')}</th>
                        <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => toggleSort('source')}>Source{sortIndicator('source')}</th>
                        <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden xl:table-cell cursor-pointer select-none`} onClick={() => toggleSort('last_activity_date')}>Last Touch{sortIndicator('last_activity_date')}</th>
                        <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted}`}>Status</th>
                        <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {paginated.map(contact => (
                          <tr key={contact.contact_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] ${contact.converted_to_lead ? 'opacity-55' : ''}`} data-testid={`contact-row-${contact.contact_id}`}>
                            <td className="py-2.5 px-3">
                              <p className={`${textPri} font-medium text-sm`}>{contact.name}</p>
                              {contact.designation && <p className={`text-xs ${textMuted}`}>{contact.designation}</p>}
                            </td>
                            <td className="py-2.5 px-3">
                              <a href={`tel:${contact.phone}`} className={`text-sm ${textSec} hover:text-[#e94560]`}>{contact.phone}</a>
                            </td>
                            <td className={`py-2.5 px-3 hidden sm:table-cell text-sm ${textSec}`}>
                              {contact.email ? <a href={`mailto:${contact.email}`} className="hover:text-[#e94560]">{contact.email}</a> : <span className={textMuted}>—</span>}
                            </td>
                            <td className={`py-2.5 px-3 hidden md:table-cell text-sm ${textSec}`}>{contact.company || <span className={textMuted}>—</span>}</td>
                            <td className={`py-2.5 px-3 hidden lg:table-cell text-xs ${textMuted}`}>{contact.source || '—'}</td>
                            <td className="py-2.5 px-3 hidden xl:table-cell text-center">
                              {contact.last_activity_date ? (
                                <span className={`text-[11px] font-medium ${touchAgeCls(contact.last_activity_date)}`}>
                                  {daysSince(contact.last_activity_date) === 0 ? 'Today' : `${daysSince(contact.last_activity_date)}d ago`}
                                </span>
                              ) : <span className={`text-[11px] ${textMuted}`}>—</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {contact.converted_to_lead ? (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">Converted</span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">Active</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <Button size="sm" variant="ghost" onClick={() => openWaForContact(contact)} className="text-green-500 h-7 px-1.5" title="Send WhatsApp" data-testid={`wa-contact-${contact.contact_id}`}><MessageSquare className="h-3.5 w-3.5" /></Button>
                              {!contact.converted_to_lead && (
                                <Button size="sm" variant="ghost" onClick={() => openConvert(contact)} className="text-[#e94560] h-7 px-1.5" title="Convert to Lead" data-testid={`convert-contact-${contact.contact_id}`}><ArrowRightCircle className="h-3.5 w-3.5" /></Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => openEditContact(contact)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-contact-${contact.contact_id}`}><Edit2 className="h-3 w-3" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteContact(contact.contact_id)} className="text-red-400 h-7 px-1.5" data-testid={`delete-contact-${contact.contact_id}`}><Trash2 className="h-3 w-3" /></Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between" data-testid="contacts-pagination">
                    <p className={`text-xs ${textMuted}`}>Showing {(safePage - 1) * contactsPerPage + 1}–{Math.min(safePage * contactsPerPage, cFiltered.length)} of {cFiltered.length}</p>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setContactPage(p => Math.max(1, p - 1))} className={`border-[var(--border-color)] ${textMuted} h-8 w-8 p-0`} data-testid="contacts-prev-page"><ChevronLeft className="h-4 w-4" /></Button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1).map((p, idx, arr) => (
                        <React.Fragment key={p}>
                          {idx > 0 && arr[idx - 1] !== p - 1 && <span className={`px-1 ${textMuted}`}>...</span>}
                          <Button variant={p === safePage ? 'default' : 'outline'} size="sm" onClick={() => setContactPage(p)}
                            className={`h-8 w-8 p-0 text-xs ${p === safePage ? 'bg-[#e94560] text-white' : `border-[var(--border-color)] ${textSec}`}`}
                            data-testid={`contacts-page-${p}`}>{p}</Button>
                        </React.Fragment>
                      ))}
                      <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setContactPage(p => Math.min(totalPages, p + 1))} className={`border-[var(--border-color)] ${textMuted} h-8 w-8 p-0`} data-testid="contacts-next-page"><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          );
        })()}

        {/* PIPELINE VIEW */}
        {activeTab === 'pipeline' && leadView === 'pipeline' && (
          <div className="flex gap-2 overflow-x-auto pb-4" data-testid="pipeline-board">
            {STAGES.map(stage => {
              const stageLeads = filtered.filter(l => l.stage === stage.id);
              return (
                <div key={stage.id} className="min-w-[200px] sm:min-w-[220px] flex-shrink-0">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${stage.color}`}>{stage.label}</span>
                    <span className={`text-xs ${textMuted}`}>{stageLeads.length}</span>
                  </div>
                  <div className="space-y-2">
                    {stageLeads.map(lead => (
                      <div key={lead.lead_id} onClick={() => openDetail(lead)} className={`${card} border rounded-md p-3 cursor-pointer hover:border-[#e94560]/40 transition-all`} data-testid={`lead-card-${lead.lead_id}`}>
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
                      </div>
                    ))}
                    {stageLeads.length === 0 && <p className={`text-xs ${textMuted} text-center py-6`}>Empty</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* KANBAN VIEW (FMS Phase 5.2) */}
        {activeTab === 'pipeline' && leadView === 'kanban' && (
          <KanbanBoard
            columns={STAGES}
            items={filtered}
            getItemId={(l) => l.lead_id}
            getItemColumnId={(l) => l.stage || 'new'}
            onMove={handleKanbanMove}
            emptyText="Drop leads here"
            renderCard={(lead) => {
              const days = daysSince(lead.last_activity_date);
              const borderCls = ageColor(days, lead.next_followup_date);
              return (
                <div onClick={() => openDetail(lead)} className={`${card} border-l-4 ${borderCls} rounded-md p-2.5 cursor-pointer hover:shadow-lg hover:shadow-[#e94560]/10 transition-all`} data-testid={`kanban-card-${lead.lead_id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <input type="checkbox" onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); toggleLeadSelect(lead.lead_id); }} checked={selectedLeadIds.has(lead.lead_id)} className="accent-[#e94560]" data-testid={`select-lead-${lead.lead_id}`} />
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
                  <div className="flex gap-1 mt-2 pt-2 border-t border-[var(--border-color)]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setReassignLead(lead); setReassignBulkIds(null); setReassignOpen(true); }} className="text-[10px] text-[#e94560] hover:underline" data-testid={`reassign-${lead.lead_id}`}>Reassign</button>
                    <span className={textMuted}>•</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); openWaForLead(lead); }} className="text-[10px] text-green-500 hover:underline">WhatsApp</button>
                  </div>
                </div>
              );
            }}
          />
        )}

        {/* TABLE VIEW via toggle */}
        {activeTab === 'pipeline' && leadView === 'table' && (() => {
          const sortedLeads = sortData(filtered, sortConfig.key, sortConfig.dir);
          return (
          <div className={`${card} border rounded-md overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="leads-table">
                <thead><tr className={'bg-[var(--bg-primary)]'}>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('company_name')}>School{sortIndicator('company_name')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('contact_name')}>Contact{sortIndicator('contact_name')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => toggleSort('lead_type')}>Type{sortIndicator('lead_type')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => toggleSort('stage')}>Stage{sortIndicator('stage')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => toggleSort('lead_score')}>Score{sortIndicator('lead_score')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell`}>Assigned</th>
                  <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                </tr></thead>
                <tbody>
                  {sortedLeads.map(lead => {
                    const stg = getStageObj(lead.stage);
                    return (
                      <tr key={lead.lead_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer`} onClick={() => openDetail(lead)} data-testid={`lead-row-${lead.lead_id}`}>
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
                          <Button size="sm" variant="ghost" onClick={() => openEditLead(lead)} className={`${textSec} h-7`} data-testid={`edit-lead-${lead.lead_id}`}><Edit2 className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={async () => { if (!window.confirm('Delete this lead?')) return; await leadsApi.delete(lead.lead_id); fetchData(); toast.success('Deleted'); }} className="text-red-400 h-7" data-testid={`delete-lead-${lead.lead_id}`}><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                  {sortedLeads.length === 0 && <tr><td colSpan="7" className={`py-12 text-center ${textMuted}`}>No leads match your filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* TASKS VIEW */}
        {activeTab === 'tasks' && (
          <div className="space-y-2" data-testid="tasks-list">
            {tasksList.length === 0 ? <p className={`text-center ${textMuted} py-12`}>No tasks yet</p> : tasksList.map(task => {
              const isOverdue = task.status === 'pending' && task.due_date && new Date(task.due_date) < new Date();
              return (
                <div key={task.task_id} className={`${card} border rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isOverdue ? '!border-red-500/40' : ''}`}>
                  <div className="flex items-center gap-3 flex-1">
                    <button onClick={() => updateTaskStatus(task.task_id, task.status === 'done' ? 'pending' : 'done')} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${task.status === 'done' ? 'bg-green-500 border-green-500' : isOverdue ? 'border-red-400' : isDark ? 'border-[#6b6b80]' : 'border-[#ccc]'}`}>
                      {task.status === 'done' && <CheckCircle className="h-3 w-3 text-[var(--text-primary)]" />}
                    </button>
                    <div>
                      <p className={`font-medium text-sm ${task.status === 'done' ? `line-through ${textMuted}` : textPri}`}>{task.title}</p>
                      <p className={`text-xs ${textMuted}`}>{task.lead_name} | {task.assigned_name} | {task.due_date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOverdue && <span className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                    <span className={`px-2 py-0.5 rounded text-xs border ${task.priority === 'high' ? 'border-red-500/30 text-red-400' : task.priority === 'low' ? 'border-green-500/30 text-green-400' : 'border-yellow-500/30 text-yellow-400'}`}>{task.priority}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SCHOOLS VIEW */}
        {activeTab === 'schools' && (() => {
          let schFiltered = schoolsList;
          if (searchTerm) {
            const s = searchTerm.toLowerCase();
            schFiltered = schFiltered.filter(sc => (sc.school_name || '').toLowerCase().includes(s) || (sc.email || '').toLowerCase().includes(s) || (sc.city || '').toLowerCase().includes(s) || (sc.phone || '').includes(s) || (sc.primary_contact_name || '').toLowerCase().includes(s));
          }
          schFiltered = sortData(schFiltered, sortConfig.key, sortConfig.dir);
          return (
          <div className={`${card} border rounded-md overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="schools-table">
                <thead><tr className={'bg-[var(--bg-primary)]'}>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('school_name')}>School{sortIndicator('school_name')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => toggleSort('school_type')}>Type{sortIndicator('school_type')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => toggleSort('city')}>City{sortIndicator('city')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell`}>Contact</th>
                  <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => toggleSort('school_strength')}>Strength{sortIndicator('school_strength')}</th>
                  <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell`}>Profile</th>
                  <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted}`}>Leads</th>
                  <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                </tr></thead>
                <tbody>
                  {schFiltered.map(sch => {
                    const schLeads = leadsList.filter(l => l.school_id === sch.school_id);
                    return (
                      <tr key={sch.school_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]`} data-testid={`school-row-${sch.school_id}`}>
                        <td className="py-2.5 px-3">
                          <p className={`${textPri} font-medium`}>{sch.school_name}</p>
                          <p className={`text-xs ${textMuted}`}>{sch.email}</p>
                        </td>
                        <td className={`py-2.5 px-3 hidden sm:table-cell text-xs ${textSec}`}>{sch.school_type}</td>
                        <td className={`py-2.5 px-3 hidden md:table-cell text-xs ${textSec}`}>{sch.city}{sch.state ? `, ${sch.state}` : ''}</td>
                        <td className="py-2.5 px-3 hidden md:table-cell">
                          <p className={`text-xs ${textPri}`}>{sch.primary_contact_name}</p>
                          <p className={`text-xs ${textMuted}`}>{sch.designation}</p>
                        </td>
                        <td className={`py-2.5 px-3 hidden lg:table-cell text-center font-mono ${textPri}`}>{sch.school_strength || '-'}</td>
                        <td className="py-2.5 px-3 hidden lg:table-cell text-center">
                          {(() => {
                            const pct = calcSchoolCompletion(sch);
                            const cls = pct >= 90 ? 'bg-green-500/20 text-green-400' : pct >= 60 ? 'bg-yellow-500/20 text-yellow-400' : pct >= 30 ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400';
                            return <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${cls}`}>{pct}%</span>;
                          })()}
                        </td>
                        <td className="py-2.5 px-3 text-center"><span className="bg-[#e94560]/20 text-[#e94560] px-2 py-0.5 rounded text-xs font-bold">{schLeads.length}</span></td>
                        <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => openEditSchool(sch)} className={`${textSec} h-7`} data-testid={`edit-school-${sch.school_id}`}><Edit2 className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteSchool(sch)} className="text-red-400 h-7" data-testid={`delete-school-${sch.school_id}`}><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                  {schFiltered.length === 0 && <tr><td colSpan="8" className={`py-12 text-center ${textMuted}`}>No schools match your search</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* REPORTS TAB */}
        {activeTab === 'reports' && (() => {
          const totalContacts = contactsList.length;
          const convertedContacts = contactsList.filter(c => c.converted_to_lead).length;
          const activeContacts = totalContacts - convertedContacts;
          const totalLeads = leadsList.length;
          const demoLeads = leadsList.filter(l => l.stage === 'demo').length;
          const quotedLeads = leadsList.filter(l => l.stage === 'quoted').length;
          const wonLeads = leadsList.filter(l => l.stage === 'won').length;
          const retentionLeads = leadsList.filter(l => l.stage === 'retention').length;
          const resellLeads = leadsList.filter(l => l.stage === 'resell').length;

          // Aging buckets for contacts (days since last_activity_date)
          const agingBuckets = [
            { label: 'Fresh (≤3d)', cls: 'bg-green-500/20 text-green-400 border-green-500/30', count: contactsList.filter(c => !c.converted_to_lead && daysSince(c.last_activity_date) <= 3).length },
            { label: 'Active (4-7d)', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', count: contactsList.filter(c => !c.converted_to_lead && daysSince(c.last_activity_date) > 3 && daysSince(c.last_activity_date) <= 7).length },
            { label: 'Cooling (8-14d)', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30', count: contactsList.filter(c => !c.converted_to_lead && daysSince(c.last_activity_date) > 7 && daysSince(c.last_activity_date) <= 14).length },
            { label: 'Cold (15d+)', cls: 'bg-red-500/20 text-red-400 border-red-500/30', count: contactsList.filter(c => !c.converted_to_lead && daysSince(c.last_activity_date) > 14).length },
          ];
          // Lead aging buckets
          const leadAgingBuckets = [
            { label: '≤3d', cls: 'bg-green-500/20 text-green-400', count: leadsList.filter(l => daysSince(l.last_activity_date) <= 3).length },
            { label: '4-7d', cls: 'bg-yellow-500/20 text-yellow-400', count: leadsList.filter(l => daysSince(l.last_activity_date) > 3 && daysSince(l.last_activity_date) <= 7).length },
            { label: '8-14d', cls: 'bg-orange-500/20 text-orange-400', count: leadsList.filter(l => daysSince(l.last_activity_date) > 7 && daysSince(l.last_activity_date) <= 14).length },
            { label: '15d+', cls: 'bg-red-500/20 text-red-400', count: leadsList.filter(l => daysSince(l.last_activity_date) > 14).length },
          ];
          // Team leaderboard
          const teamMap = {};
          spList.forEach(sp => { teamMap[sp.email] = { name: sp.name, leads: 0, won: 0, contacts: 0 }; });
          leadsList.forEach(l => { if (teamMap[l.assigned_to]) { teamMap[l.assigned_to].leads++; if (l.stage === 'won') teamMap[l.assigned_to].won++; } });
          contactsList.forEach(c => { if (teamMap[c.created_by]) teamMap[c.created_by].contacts++; });
          const teamBoard = Object.values(teamMap).sort((a, b) => b.leads - a.leads);
          // School completion distribution
          const schCompletion = { incomplete: 0, low: 0, good: 0, complete: 0 };
          schoolsList.forEach(sch => {
            const p = calcSchoolCompletion(sch);
            if (p < 30) schCompletion.incomplete++;
            else if (p < 60) schCompletion.low++;
            else if (p < 90) schCompletion.good++;
            else schCompletion.complete++;
          });
          // Leads per school
          const leadsPerSchool = schoolsList.map(sch => ({
            name: sch.school_name, city: sch.city,
            count: leadsList.filter(l => l.school_id === sch.school_id).length,
            pct: calcSchoolCompletion(sch),
          })).filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);

          return (
          <div className="space-y-5" data-testid="reports-tab">
            {/* Funnel */}
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
                ].map((f, i) => (
                  <div key={f.label} className={`flex-1 min-w-[90px] border rounded-md p-3 text-center ${f.cls}`}>
                    <p className="text-2xl font-bold">{f.val}</p>
                    <p className="text-[11px] font-medium">{f.label}</p>
                    {f.pct !== undefined && <p className="text-[10px] opacity-70">{f.pct}% conv.</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Aging buckets (contacts + leads) */}
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

            {/* Stage distribution */}
            <div className={`${card} border rounded-md p-4`}>
              <h3 className={`${textPri} font-semibold text-sm mb-3`}>Lead Stage Distribution</h3>
              <div className="flex flex-wrap gap-2">
                {STAGES.map(s => {
                  const cnt = leadsList.filter(l => l.stage === s.id).length;
                  return (
                    <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded border ${s.color} flex-1 min-w-[90px] justify-between`}>
                      <span className="text-xs font-medium">{s.label}</span>
                      <span className="text-lg font-bold">{cnt}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team leaderboard */}
            {teamBoard.length > 0 && (
              <div className={`${card} border rounded-md p-4`}>
                <h3 className={`${textPri} font-semibold text-sm mb-3`}>Team Leaderboard</h3>
                <div className={`rounded-md overflow-hidden border border-[var(--border-color)]`}>
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
                            <div className="flex items-center gap-1.5">
                              {i === 0 && <span className="text-yellow-400 text-xs">★</span>}
                              {m.name}
                            </div>
                          </td>
                          <td className={`py-2 px-3 text-center ${textSec}`}>{m.contacts}</td>
                          <td className={`py-2 px-3 text-center font-mono text-[#e94560] font-bold`}>{m.leads}</td>
                          <td className={`py-2 px-3 text-center text-green-400 font-bold`}>{m.won}</td>
                          <td className={`py-2 px-3 text-center text-xs ${textSec}`}>{m.leads ? `${Math.round(m.won / m.leads * 100)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* School profile completion */}
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
                        <div className={`h-2 rounded-full ${b.cls.split(' ')[0]}`} style={{ width: `${schoolsList.length ? Math.round(b.val / schoolsList.length * 100) : 0}%` }} />
                      </div>
                      <span className={`text-xs font-bold ${textPri} w-6 text-right`}>{b.val}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Top schools by leads */}
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

        {/* LEAD DETAIL DIALOG */}
        {detailLead && (
          <Dialog open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
            <DialogContent className={`${dlgCls} max-w-2xl max-h-[90vh] overflow-y-auto`}>
              <DialogHeader>
                <DialogTitle className={`${textPri} text-lg flex items-center justify-between`}>
                  <div>
                    <span>{detailLead.company_name || detailLead.contact_name}</span>
                    {detailLead.lead_score > 0 && <span className="ml-2 text-sm px-2 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-mono">{detailLead.lead_score}</span>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openWaForLead(detailLead)} className="text-green-500" data-testid="lead-wa-btn"><MessageSquare className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { setReassignLead(detailLead); setReassignBulkIds(null); setReassignOpen(true); }} className="text-[#e94560]" data-testid="lead-reassign-btn"><UserCog className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { openEditLead(detailLead); setDetailLead(null); }} className={textSec}><Edit2 className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => openCreateTask(detailLead)} className={textSec}><Calendar className="h-4 w-4" /></Button>
                  </div>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className={`flex items-center gap-3 text-sm ${textSec} flex-wrap`}>
                  <span className="flex items-center gap-1"><User className="h-3 w-3" /> {detailLead.contact_name}</span>
                  {detailLead.contact_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {detailLead.contact_phone}</span>}
                  {detailLead.school_city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {detailLead.school_city}</span>}
                  {detailLead.likely_closure_date && <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30`} data-testid="detail-likely-closure"><Target className="h-3 w-3" /> Likely close: {detailLead.likely_closure_date}</span>}
                  {detailLead.visit_required && <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30`} data-testid="detail-visit-required"><AlertTriangle className="h-3 w-3" /> Visit Required</span>}
                  {detailLead.is_locked && <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] border border-[#e94560]/30" data-testid="detail-locked"><Lock className="h-3 w-3" /> Locked (order placed)</span>}
                  {(detailLead.reassignment_count || 0) > 0 && <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${detailLead.reassignment_count > 2 ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'}`} data-testid="detail-reassign-count"><UserCog className="h-3 w-3" /> Reassigned {detailLead.reassignment_count}×</span>}
                </div>
                {/* Stage selector */}
                <div className="flex gap-1 flex-wrap">
                  {STAGES.map(s => (
                    <button key={s.id} onClick={() => changeStage(detailLead.lead_id, s.id)} className={`px-2 py-1 rounded text-xs font-medium border transition-all ${detailLead.stage === s.id ? s.color + ' ring-1' : `${isDark ? 'border-[var(--border-color)] text-[var(--text-muted)]' : 'border-[var(--border-color)] text-[#888]'} ${hoverBg}`}`}>{s.label}</button>
                  ))}
                </div>

                {/* Convert-to-Order (FMS Phase 5.3) — only when stage = negotiation/won AND not locked */}
                {['negotiation', 'won'].includes(detailLead.stage) && !detailLead.is_locked && (
                  <Button onClick={async () => {
                    // find quotation for this school
                    const quotRes = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/quotations`, { credentials: 'include' });
                    const quots = await quotRes.json();
                    const match = Array.isArray(quots) ? quots.find(q => q.school_name === detailLead.company_name || q.school_name === detailLead.school_name) : null;
                    if (!match) { toast.error('No quotation found for this school — create one first'); return; }
                    if (!window.confirm(`Convert to order using quotation ${match.quote_number}? Lead will be locked (admin can unlock).`)) return;
                    try {
                      const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/orders`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ quotation_id: match.quotation_id, lead_id: detailLead.lead_id, payment_threshold_pct: 50 }),
                      });
                      const data = await r.json();
                      if (r.ok) {
                        toast.success(`Order ${data.order_number} created`);
                        setDetailLead({ ...detailLead, is_locked: true, stage: 'won', order_id: data.order_id });
                        fetchData();
                      } else {
                        toast.error(data.detail || 'Conversion failed');
                      }
                    } catch { toast.error('Conversion failed'); }
                  }} className="bg-green-600 hover:bg-green-700 text-white" data-testid="convert-to-order-btn">
                    <Package className="mr-1 h-4 w-4" /> Convert to Order
                  </Button>
                )}
                {/* Add Note */}
                <div className={`${'bg-[var(--bg-primary)] border-[var(--border-color)]'} border rounded-md p-3 space-y-2`}>
                  <div className="flex gap-1 flex-wrap">
                    {NOTE_TYPES.map(nt => (
                      <button key={nt.id} onClick={() => setNoteForm({ ...noteForm, type: nt.id })} className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${noteForm.type === nt.id ? 'bg-[#e94560]/20 text-[#e94560]' : `${textMuted} ${hoverBg}`}`}>
                        <nt.icon className="h-3 w-3" /> {nt.label}
                      </button>
                    ))}
                  </div>
                  <Input value={noteForm.content} onChange={e => setNoteForm({ ...noteForm, content: e.target.value })} placeholder="Log interaction..." className={`${inputCls} text-sm`} data-testid="note-input" />
                  <div className="flex gap-2">
                    <Input value={noteForm.outcome} onChange={e => setNoteForm({ ...noteForm, outcome: e.target.value })} placeholder="Outcome" className={`${inputCls} text-sm flex-1`} />
                    <Button onClick={addNote} size="sm" className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="add-note-button">Add</Button>
                  </div>
                </div>
                {/* Schedule Follow-up */}
                <div className={`${'bg-[var(--bg-primary)] border-[var(--border-color)]'} border rounded-md p-3`}>
                  <p className={`text-xs font-medium ${textSec} mb-2`}>Schedule Follow-up</p>
                  <div className="flex gap-2 flex-wrap">
                    <Input type="date" value={fuForm.followup_date} onChange={e => setFuForm({...fuForm, followup_date: e.target.value})} className={`${inputCls} text-sm w-36`} />
                    <Input type="time" value={fuForm.followup_time} onChange={e => setFuForm({...fuForm, followup_time: e.target.value})} className={`${inputCls} text-sm w-28`} />
                    <select value={fuForm.followup_type} onChange={e => setFuForm({...fuForm, followup_type: e.target.value})} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                      <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option>
                    </select>
                    <Button onClick={addFollowup} size="sm" className="bg-[#e94560] hover:bg-[#f05c75]">Schedule</Button>
                  </div>
                </div>
                {/* Follow-ups */}
                {leadFollowups.length > 0 && (
                  <div>
                    <p className={`text-xs font-medium ${textSec} mb-2`}>Follow-ups ({leadFollowups.length})</p>
                    <div className="space-y-1">
                      {leadFollowups.map(fu => (
                        <div key={fu.followup_id} className={`flex items-center justify-between text-sm ${card} border rounded p-2`}>
                          <div>
                            <span className={textPri}>{fu.followup_date} {fu.followup_time}</span>
                            <span className={`ml-2 text-xs ${textMuted} capitalize`}>{fu.followup_type}</span>
                            {fu.notes && <span className={`ml-2 text-xs ${textMuted}`}>- {fu.notes}</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${fu.status === 'completed' ? 'bg-green-500/20 text-green-400' : fu.status === 'missed' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{fu.status}</span>
                            {fu.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => completeFollowup(fu.followup_id)} className="text-green-400 h-6"><CheckCircle className="h-3 w-3" /></Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Timeline */}
                <div data-testid="notes-timeline">
                  <p className={`text-xs font-medium ${textSec} mb-2`}>Activity ({notes.length})</p>
                  {notes.map(note => {
                    const nt = NOTE_TYPES.find(n => n.id === note.type) || NOTE_TYPES[4];
                    return (
                      <div key={note.note_id} className="flex gap-2 text-sm mb-2">
                        <div className={`w-7 h-7 rounded-full ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f0f0f5]'} flex items-center justify-center flex-shrink-0`}>
                          <nt.icon className="h-3 w-3 text-[#e94560]" />
                        </div>
                        <div className={`flex-1 border-l ${'border-[var(--border-color)]'} pl-2 pb-2`}>
                          <p className={textPri}>{note.content}</p>
                          {note.outcome && <p className={`text-xs ${textMuted}`}>Outcome: {note.outcome}</p>}
                          <p className={`text-xs ${textMuted}`}>{note.created_by_name} - {formatDate(note.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {notes.length === 0 && <p className={`text-xs ${textMuted} text-center py-4`}>No activity yet</p>}
                </div>

                {/* Pipeline History (FMS Phase 2) */}
                {Array.isArray(detailLead.pipeline_history) && detailLead.pipeline_history.length > 0 && (
                  <div data-testid="pipeline-history">
                    <p className={`text-xs font-medium ${textSec} mb-2`}>Pipeline History ({detailLead.pipeline_history.length})</p>
                    <div className="space-y-1.5">
                      {detailLead.pipeline_history.map((h, i) => {
                        const fromObj = STAGES.find(s => s.id === h.from_stage);
                        const toObj = STAGES.find(s => s.id === h.to_stage) || STAGES[0];
                        return (
                          <div key={i} className={`flex items-center gap-2 text-xs ${card} border rounded px-2.5 py-1.5`}>
                            {fromObj ? <span className={`px-1.5 py-0.5 rounded font-medium border ${fromObj.color} text-[10px]`}>{fromObj.label}</span> : <span className={`text-[10px] ${textMuted}`}>—</span>}
                            <ChevronRight className="h-3 w-3" />
                            <span className={`px-1.5 py-0.5 rounded font-medium border ${toObj.color} text-[10px]`}>{toObj.label}</span>
                            <span className={`flex-1 ${textMuted} truncate`}>{h.note}</span>
                            <span className={`${textMuted}`}>{h.by_name?.split(' ')[0]} • {formatDate(h.at)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reassignment History (FMS Phase 5.1) */}
                {Array.isArray(detailLead.reassignments) && detailLead.reassignments.length > 0 && (
                  <div data-testid="reassignment-history">
                    <p className={`text-xs font-medium ${textSec} mb-2 flex items-center gap-1`}><UserCog className="h-3 w-3" /> Reassignment History ({detailLead.reassignments.length})</p>
                    <div className="space-y-1.5">
                      {detailLead.reassignments.map((r, i) => (
                        <div key={i} className={`text-xs ${card} border rounded px-2.5 py-1.5`}>
                          <div className="flex items-center gap-2">
                            <span className={`${textSec}`}>{r.from_name || 'Unassigned'}</span>
                            <ChevronRight className="h-3 w-3" />
                            <span className={`${textPri} font-medium`}>{r.to_name}</span>
                            <span className={`flex-1 ${textMuted} text-right`}>by {r.by_name?.split(' ')[0]} • {formatDate(r.at)}</span>
                          </div>
                          <p className={`${textMuted} mt-0.5 italic`}>"{r.reason}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* LEAD FORM DIALOG */}
        <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-lg max-h-[90vh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editLead ? 'Edit Lead' : 'New Lead'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              {/* School selection */}
              {!editLead && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className={`${textSec} text-xs`}>School *</Label>
                    <button onClick={() => setAddNewSchool(!addNewSchool)} className="text-xs text-[#e94560]">{addNewSchool ? 'Select Existing' : '+ Add New School'}</button>
                  </div>
                  {addNewSchool ? (
                    <div className={`${'bg-[var(--bg-primary)] border-[var(--border-color)]'} border rounded-md p-3 space-y-2`}>
                      <Input value={newSchool.school_name} onChange={e => setNewSchool({...newSchool, school_name: e.target.value})} placeholder="School name *" className={`${inputCls} text-sm`} />
                      <div className="grid grid-cols-2 gap-2">
                        <select value={newSchool.school_type} onChange={e => setNewSchool({...newSchool, school_type: e.target.value})} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                          {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Input value={newSchool.city} onChange={e => setNewSchool({...newSchool, city: e.target.value})} placeholder="City" className={`${inputCls} text-sm`} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={newSchool.phone} onChange={e => setNewSchool({...newSchool, phone: e.target.value})} placeholder="Phone" className={`${inputCls} text-sm`} />
                        <Input type="number" value={newSchool.school_strength} onChange={e => setNewSchool({...newSchool, school_strength: parseInt(e.target.value) || 0})} placeholder="Strength" className={`${inputCls} text-sm`} />
                      </div>
                    </div>
                  ) : (
                    <select value={leadForm.school_id} onChange={e => setLeadForm({...leadForm, school_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-select">
                      <option value="">Select school</option>
                      {schoolsList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name} ({s.city})</option>)}
                    </select>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Contact Name *</Label><Input value={leadForm.contact_name} onChange={e => setLeadForm({...leadForm, contact_name: e.target.value})} className={inputCls} data-testid="lead-contact-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Role / Designation</Label>
                  <select value={leadForm.contact_role_id || ''} onChange={e => { const role = rolesList.find(r => r.role_id === e.target.value); setLeadForm({...leadForm, contact_role_id: e.target.value, designation: role?.name || leadForm.designation}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lead-role-select">
                    <option value="">{rolesList.length ? 'Select role' : 'Loading roles...'}</option>
                    {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={leadForm.contact_phone} onChange={e => setLeadForm({...leadForm, contact_phone: e.target.value})} className={inputCls} data-testid="lead-phone-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={leadForm.contact_email} onChange={e => setLeadForm({...leadForm, contact_email: e.target.value})} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label className={`${textSec} text-xs`}>Source</Label>
                  <select value={leadForm.source_id || ''} onChange={e => { const src = sourcesList.find(s => s.source_id === e.target.value); setLeadForm({...leadForm, source_id: e.target.value, source: src?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lead-source-select">
                    <option value="">{sourcesList.length ? 'Select source' : 'Loading sources...'}</option>
                    {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={leadForm.lead_type} onChange={e => setLeadForm({...leadForm, lead_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Priority</Label>
                  <select value={leadForm.priority} onChange={e => setLeadForm({...leadForm, priority: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Assign To *</Label>
                  <select value={leadForm.assigned_to} onChange={e => setLeadForm({...leadForm, assigned_to: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="">Select</option>{spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Next Follow-up</Label><Input type="date" value={leadForm.next_followup_date} onChange={e => setLeadForm({...leadForm, next_followup_date: e.target.value})} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Assignment Type</Label>
                  <select value={leadForm.assignment_type || 'manual'} onChange={e => setLeadForm({...leadForm, assignment_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lead-assignment-type-select">
                    <option value="manual">Manual</option>
                    <option value="self">Self</option>
                    <option value="round_robin">Round Robin</option>
                    <option value="auto">Auto</option>
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Likely Closure Date</Label><Input type="date" value={leadForm.likely_closure_date || ''} onChange={e => setLeadForm({...leadForm, likely_closure_date: e.target.value})} className={inputCls} data-testid="lead-likely-closure-input" /></div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={leadForm.notes} onChange={e => setLeadForm({...leadForm, notes: e.target.value})} className={inputCls} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLeadDialogOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={saveLead} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-lead-button">{editLead ? 'Update' : 'Create Lead'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SCHOOL FORM DIALOG */}
        <Dialog open={schoolDialogOpen} onOpenChange={(v) => { setSchoolDialogOpen(v); if (!v) setEditSchool(null); }}>
          <DialogContent className={`${dlgCls} max-w-lg max-h-[90vh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editSchool ? 'Edit School' : 'Add School'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>School Name *</Label><Input value={editSchoolForm.school_name || ''} onChange={e => setEditSchoolForm({...editSchoolForm, school_name: e.target.value})} className={inputCls} data-testid="school-name-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Group / Trust</Label>
                  <select value={editSchoolForm.group_id || ''} onChange={e => setEditSchoolForm({...editSchoolForm, group_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-group-select">
                    <option value="">{groupsList.length ? '-- Select Group --' : 'No groups defined'}</option>
                    {groupsList.map(g => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Email</Label><Input type="email" value={editSchoolForm.email || ''} onChange={e => setEditSchoolForm({...editSchoolForm, email: e.target.value})} className={inputCls} data-testid="school-email-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Type</Label>
                  <select value={editSchoolForm.school_type || 'CBSE'} onChange={e => setEditSchoolForm({...editSchoolForm, school_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><Label className={`${textSec} text-xs`}>Phone</Label><Input value={editSchoolForm.phone || ''} onChange={e => setEditSchoolForm({...editSchoolForm, phone: e.target.value})} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>City</Label><Input value={editSchoolForm.city || ''} onChange={e => setEditSchoolForm({...editSchoolForm, city: e.target.value})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>State</Label><Input value={editSchoolForm.state || ''} onChange={e => setEditSchoolForm({...editSchoolForm, state: e.target.value})} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Contact Name</Label><Input value={editSchoolForm.primary_contact_name || ''} onChange={e => setEditSchoolForm({...editSchoolForm, primary_contact_name: e.target.value})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Role / Designation</Label>
                  <select value={editSchoolForm.designation || ''} onChange={e => setEditSchoolForm({...editSchoolForm, designation: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="school-role-select">
                    <option value="">Select</option>
                    {(rolesList.length ? rolesList.map(r => r.name) : DESIGNATIONS).map(d => <option key={d} value={d}>{d}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Strength</Label><Input type="number" value={editSchoolForm.school_strength || 0} onChange={e => setEditSchoolForm({...editSchoolForm, school_strength: parseInt(e.target.value) || 0})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Existing Vendor</Label><Input value={editSchoolForm.existing_vendor || ''} onChange={e => setEditSchoolForm({...editSchoolForm, existing_vendor: e.target.value})} className={inputCls} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSchoolDialogOpen(false); setEditSchool(null); }} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={handleSaveSchool} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-school-button">{editSchool ? 'Update School' : 'Add School'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* TASK DIALOG */}
        <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>New Task</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>Title *</Label><Input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} className={inputCls} data-testid="task-title-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Due Date *</Label><Input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} className={inputCls} /></div>
                <div><Label className={`${textSec} text-xs`}>Assign To</Label>
                  <select value={taskForm.assigned_to} onChange={e => { const sp = spList.find(s => s.email === e.target.value); setTaskForm({...taskForm, assigned_to: e.target.value, assigned_name: sp?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="">Select</option>{spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                  </select></div>
              </div>
              {taskForm.lead_name && <p className={`text-xs ${textMuted}`}>Lead: {taskForm.lead_name}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTaskDialogOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={saveTask} className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="save-task-button">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* IMPORT DIALOG */}
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Import Leads from CSV</DialogTitle></DialogHeader>
            <div className="py-4 space-y-3">
              <p className={`text-sm ${textSec}`}>CSV columns: school_name, school_type, website, location, contact_name, designation, phone, email, school_strength, source</p>
              <div className={`${'bg-[var(--bg-primary)] border-[var(--border-color)]'} border-2 border-dashed rounded-md p-8 text-center cursor-pointer`} onClick={() => fileRef.current?.click()}>
                <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload CSV file</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); }} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {/* CONTACT DIALOG */}
        <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>{editContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={contactForm.name} onChange={e => setContactForm({...contactForm, name: e.target.value})} className={inputCls} placeholder="Full name" data-testid="contact-name-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={contactForm.phone} onChange={e => setContactForm({...contactForm, phone: e.target.value})} className={inputCls} placeholder="+91..." data-testid="contact-phone-input" /></div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={contactForm.email} onChange={e => setContactForm({...contactForm, email: e.target.value})} className={inputCls} placeholder="email@example.com" data-testid="contact-email-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Company / School</Label><Input value={contactForm.company} onChange={e => setContactForm({...contactForm, company: e.target.value})} className={inputCls} placeholder="Organization" /></div>
                <div><Label className={`${textSec} text-xs`}>Role / Designation</Label>
                  <select value={contactForm.contact_role_id || ''} onChange={e => { const role = rolesList.find(r => r.role_id === e.target.value); setContactForm({...contactForm, contact_role_id: e.target.value, designation: role?.name || contactForm.designation}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="contact-role-select">
                    <option value="">{rolesList.length ? 'Select role' : 'Loading...'}</option>
                    {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Source</Label>
                <select value={contactForm.source_id || ''} onChange={e => { const src = sourcesList.find(s => s.source_id === e.target.value); setContactForm({...contactForm, source_id: e.target.value, source: src?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="contact-source-select">
                  <option value="">{sourcesList.length ? 'Select source' : 'Loading...'}</option>
                  {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
                </select>
              </div>
              <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={contactForm.notes} onChange={e => setContactForm({...contactForm, notes: e.target.value})} className={inputCls} placeholder="Any additional info..." /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setContactDialogOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={saveContact} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-contact-button">{editContact ? 'Update' : 'Add Contact'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CONVERT TO LEAD DIALOG */}
        <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Convert to Lead</DialogTitle></DialogHeader>
            {convertContact && (
              <div className="space-y-4 py-2">
                <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3`}>
                  <p className={`${textPri} font-medium`}>{convertContact.name}</p>
                  <p className={`text-sm ${textMuted}`}>{convertContact.phone}{convertContact.email ? ` • ${convertContact.email}` : ''}</p>
                  {convertContact.company && <p className={`text-xs ${textMuted} mt-1`}>{convertContact.company}{convertContact.designation ? ` • ${convertContact.designation}` : ''}</p>}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className={`${textSec} text-xs`}>Link to School</Label>
                    <button onClick={() => { setConvertAddNewSchool(!convertAddNewSchool); setConvertForm({...convertForm, school_id: ''}); }} className="text-xs text-[#e94560] hover:underline">
                      {convertAddNewSchool ? '← Select Existing' : '+ Create New School'}
                    </button>
                  </div>
                  {convertAddNewSchool ? (
                    <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 space-y-2`}>
                      <Input value={convertNewSchool.school_name} onChange={e => setConvertNewSchool({...convertNewSchool, school_name: e.target.value})} placeholder="School name *" className={`${inputCls} text-sm`} data-testid="convert-new-school-name" />
                      <div className="grid grid-cols-2 gap-2">
                        <select value={convertNewSchool.school_type} onChange={e => setConvertNewSchool({...convertNewSchool, school_type: e.target.value})} className={`h-9 px-2 rounded text-sm ${inputCls}`}>
                          {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Input value={convertNewSchool.city} onChange={e => setConvertNewSchool({...convertNewSchool, city: e.target.value})} placeholder="City" className={`${inputCls} text-sm`} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={convertNewSchool.phone} onChange={e => setConvertNewSchool({...convertNewSchool, phone: e.target.value})} placeholder="Phone" className={`${inputCls} text-sm`} />
                        <Input type="number" value={convertNewSchool.school_strength} onChange={e => setConvertNewSchool({...convertNewSchool, school_strength: parseInt(e.target.value) || 0})} placeholder="Strength" className={`${inputCls} text-sm`} />
                      </div>
                    </div>
                  ) : (
                    <select value={convertForm.school_id} onChange={e => setConvertForm({...convertForm, school_id: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-school-select">
                      <option value="">-- No school (create later) --</option>
                      {schoolsList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name} ({s.city || s.school_type})</option>)}
                    </select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className={`${textSec} text-xs`}>Lead Type</Label>
                    <select value={convertForm.lead_type} onChange={e => setConvertForm({...convertForm, lead_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-lead-type">
                      <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
                    </select>
                  </div>
                  <div><Label className={`${textSec} text-xs`}>Priority</Label>
                    <select value={convertForm.priority} onChange={e => setConvertForm({...convertForm, priority: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                      <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                    </select>
                  </div>
                </div>
                <div><Label className={`${textSec} text-xs`}>Interested Product</Label><Input value={convertForm.interested_product} onChange={e => setConvertForm({...convertForm, interested_product: e.target.value})} className={inputCls} placeholder="e.g. Premium Package" /></div>
                <div><Label className={`${textSec} text-xs`}>Assign To</Label>
                  <select value={convertForm.assigned_to} onChange={e => setConvertForm({...convertForm, assigned_to: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="convert-assign-to">
                    <option value={user?.email}>{user?.name} (Me)</option>
                    {spList.filter(s => s.email !== user?.email).map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                  </select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConvertDialogOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={handleConvert} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-convert-button">
                <ArrowRightCircle className="mr-1.5 h-4 w-4" /> Convert to Lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* CONTACT IMPORT DIALOG */}
        <Dialog open={contactImportOpen} onOpenChange={setContactImportOpen}>
          <DialogContent className={`${dlgCls} max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Import Contacts from CSV</DialogTitle></DialogHeader>
            <div className="py-4 space-y-3">
              <p className={`text-sm ${textSec}`}>CSV columns: name, phone, email, company, designation, source, notes</p>
              <p className={`text-xs ${textMuted}`}>Duplicates (same name + phone) will be skipped.</p>
              <div className={'bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-md p-8 text-center cursor-pointer'} onClick={() => contactFileRef.current?.click()}>
                <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
                <p className={textSec}>Click to upload CSV file</p>
                <input ref={contactFileRef} type="file" accept=".csv" className="hidden" data-testid="contact-import-file-input" onChange={e => { if (e.target.files?.[0]) handleContactImport(e.target.files[0]); }} />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* WHATSAPP SEND DIALOG (FMS Phase 4) */}
        <WhatsAppSendDialog open={waOpen} onOpenChange={setWaOpen} module={waCtx.module} context={waCtx.context} title={waCtx.title} />

        {/* REASSIGN LEAD DIALOG (FMS Phase 5.1) */}
        <ReassignLeadDialog
          open={reassignOpen}
          onOpenChange={setReassignOpen}
          lead={reassignLead}
          leadIds={reassignBulkIds}
          onSuccess={() => { setSelectedLeadIds(new Set()); fetchData(); }}
        />
      </div>
    </AdminLayout>
  );
}
