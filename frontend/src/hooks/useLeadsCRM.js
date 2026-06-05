import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { STAGES, SCHOOL_TYPES } from '../lib/crmConstants';
import {
  schools as schoolsApi,
  leads as leadsApi,
  followups as fuApi,
  tasks as tasksApi,
  salesPersons,
  contacts as contactsApi,
  exportData,
  groups as groupsApi,
  sources as sourcesApi,
  contactRoles as contactRolesApi,
  tags as tagsApi,
  dripSequences as dripSequencesApi,
  quotations as quotationsApi,
  designations as designationsApi,
} from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

export default function useLeadsCRM() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Data lists ──────────────────────────────────────────────────────────────
  const [leadsList, setLeadsList] = useState([]);
  const [schoolsList, setSchoolsList] = useState([]);
  const [tasksList, setTasksList] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const [spList, setSpList] = useState([]);
  const [groupsList, setGroupsList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [dripSequencesList, setDripSequencesList] = useState([]);
  const [allQuotations, setAllQuotations] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('schools');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterContactTag, setFilterContactTag] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: '', dir: 'asc' });
  const [contactPage, setContactPage] = useState(1);
  const contactsPerPage = 10;

  // ── View / selection ─────────────────────────────────────────────────────────
  const [leadView, setLeadView] = useState('pipeline'); // 'pipeline' | 'kanban' | 'table'
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignLead, setReassignLead] = useState(null);
  const [reassignBulkIds, setReassignBulkIds] = useState(null);

  // ── WhatsApp dialog ───────────────────────────────────────────────────────────
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx] = useState({ module: 'general', context: {}, title: 'Send WhatsApp' });

  // ── Lead detail panel ────────────────────────────────────────────────────────
  const [detailLead, setDetailLead] = useState(null);
  const [notes, setNotes] = useState([]);
  const [leadFollowups, setLeadFollowups] = useState([]);
  const [physicalDispatches, setPhysicalDispatches] = useState([]);
  const [leadVisits, setLeadVisits] = useState([]);
  const [leadEnrollments, setLeadEnrollments] = useState([]);
  const [noteForm, setNoteForm] = useState({ type: 'call', content: '', outcome: '' });
  const [fuForm, setFuForm] = useState({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  const [pdForm, setPdForm] = useState({ material_type: 'brochure', description: '', courier_name: '', tracking_number: '', sent_date: '' });
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedSequenceId, setSelectedSequenceId] = useState('');

  // ── Lead form dialog ─────────────────────────────────────────────────────────
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [addNewSchool, setAddNewSchool] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [leadForm, setLeadForm] = useState({
    school_id: '', contact_name: '', designation: '', contact_role_id: '',
    contact_phone: '', contact_email: '', source: '', source_id: '',
    lead_type: 'warm', interested_product: '', priority: 'medium',
    next_followup_date: '', likely_closure_date: '', assignment_type: 'manual',
    assigned_to: '', notes: '', expected_value: '', tags: [], referred_by_contact_id: '', referral_reward_status: 'none',
  });
  const [newSchool, setNewSchool] = useState({ school_name: '', school_type: 'CBSE', phone: '', email: '', city: '', state: '', pincode: '', school_strength: 0 });

  // ── School form dialog ───────────────────────────────────────────────────────
  const [schoolDialogOpen, setSchoolDialogOpen] = useState(false);
  const [editSchool, setEditSchool] = useState(null);
  const [editSchoolForm, setEditSchoolForm] = useState({});

  // ── Task dialog ───────────────────────────────────────────────────────────────
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', type: 'follow_up', lead_id: '', lead_name: '', assigned_to: '', due_date: '', due_time: '', priority: 'medium' });

  // ── Contact state ─────────────────────────────────────────────────────────────
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', school_id: '', company: '', designation: '', contact_role_id: '', source: '', source_id: '', notes: '', birthday: '', tag_ids: [], assigned_to: '' });
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertContact, setConvertContact] = useState(null);
  const [convertForm, setConvertForm] = useState({ school_id: '', lead_type: 'warm', priority: 'medium', interested_product: '', assigned_to: '' });
  const [convertAddNewSchool, setConvertAddNewSchool] = useState(false);
  const [convertNewSchool, setConvertNewSchool] = useState({ school_name: '', school_type: 'CBSE', city: '', phone: '', school_strength: 0 });
  const [contactImportOpen, setContactImportOpen] = useState(false);
  const contactFileRef = useRef(null);
  const [importFile, setImportFile] = useState(null);
  const [importTags, setImportTags] = useState([]);
  const [importNotes, setImportNotes] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // ── Import dialog (leads) ─────────────────────────────────────────────────────
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileRef = useRef(null);

  // ── Contact activity ──────────────────────────────────────────────────────────
  const [expandedContactId, setExpandedContactId] = useState(null);
  const [contactActivity, setContactActivity] = useState([]);

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA FETCH
  // ─────────────────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [lr, sr, tr, spr, cr, gr, srcR, rlR, tgR, dripR, qR, desR] = await Promise.all([
        leadsApi.getAll(), schoolsApi.getAll(), tasksApi.getAll(), salesPersons.getAll(), contactsApi.getAll(),
        groupsApi.getAll().catch(() => ({ data: [] })),
        sourcesApi.getAll().catch(() => ({ data: [] })),
        contactRolesApi.getAll().catch(() => ({ data: [] })),
        tagsApi.getAll().catch(() => ({ data: [] })),
        dripSequencesApi.getAll().catch(() => ({ data: [] })),
        quotationsApi.getAll().catch(() => ({ data: [] })),
        designationsApi.getAll().catch(() => ({ data: [] })),
      ]);
      setLeadsList(lr.data);
      setSchoolsList(sr.data);
      setTasksList(tr.data);
      setSpList(spr.data);
      setContactsList(cr.data);
      setGroupsList(gr.data || []);
      setSourcesList(srcR.data || []);
      setRolesList(rlR.data || []);
      setTagsList(tgR.data || []);
      setDripSequencesList(dripR.data || []);
      setAllQuotations(qR.data || []);
      setDesignationsList(desR.data || []);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  const stableFetch = useCallback(() => { fetchData(); }, []); // eslint-disable-line
  useEffect(() => { stableFetch(); }, [stableFetch]);
  useDataSync('crm', stableFetch);
  useAutoRefresh(stableFetch, 90000);

  // Open lead detail or switch tab from URL params
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    const tabParam  = searchParams.get('tab');
    if (!loading) {
      if (leadParam && leadsList.length > 0) {
        const lead = leadsList.find(l => l.lead_id === leadParam);
        if (lead) { setActiveTab('pipeline'); openDetail(lead); }
      } else if (tabParam) {
        setActiveTab(tabParam);
      }
      if (leadParam || tabParam) setSearchParams({}, { replace: true });
    }
  }, [loading, leadsList, searchParams]); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────────
  // LEAD HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const openCreateLead = () => {
    setEditLead(null);
    setAddNewSchool(false);
    setLeadForm({ school_id: '', contact_name: '', designation: '', contact_role_id: '', contact_phone: '', contact_email: '', source: '', source_id: '', lead_type: 'warm', interested_product: '', priority: 'medium', next_followup_date: '', likely_closure_date: '', assignment_type: 'manual', assigned_to: '', notes: '', expected_value: '', tags: [], referred_by_contact_id: '', referral_reward_status: 'none' });
    setNewTagInput('');
    setNewSchool({ school_name: '', school_type: 'CBSE', phone: '', email: '', city: '', state: '', pincode: '', school_strength: 0 });
    setLeadDialogOpen(true);
  };

  const openEditLead = (lead) => { setEditLead(lead); setLeadForm({ ...lead }); setLeadDialogOpen(true); };

  const openDetail = async (lead) => {
    setDetailLead(lead);
    setPhysicalDispatches([]);
    setLeadVisits([]);
    setPdForm({ material_type: 'brochure', description: '', courier_name: '', tracking_number: '', sent_date: new Date().toISOString().slice(0, 10) });
    try {
      const [nr, fr, pdRes, enrollRes, visitsRes] = await Promise.all([
        leadsApi.getNotes(lead.lead_id),
        fuApi.getAll(lead.lead_id),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/physical-dispatches?lead_id=${lead.lead_id}`, { credentials: 'include' }).then(r => r.json()).catch(() => []),
        dripSequencesApi.enrollments({ lead_id: lead.lead_id }).catch(() => ({ data: [] })),
        fetch(`${process.env.REACT_APP_BACKEND_URL}/api/leads/${lead.lead_id}/visit-history`, { credentials: 'include' }).then(r => r.json()).catch(() => []),
      ]);
      setNotes(nr.data);
      setLeadFollowups(fr.data);
      setPhysicalDispatches(Array.isArray(pdRes) ? pdRes : []);
      setLeadEnrollments(Array.isArray(enrollRes.data) ? enrollRes.data : []);
      setLeadVisits(Array.isArray(visitsRes) ? visitsRes : []);
    } catch { setNotes([]); setLeadFollowups([]); setLeadEnrollments([]); setLeadVisits([]); }
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

  const changeStage = async (leadId, newStage, extra = {}) => {
    try {
      await leadsApi.update(leadId, { stage: newStage, ...extra });
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Stage change failed');
      return;
    }
    fetchData();
    if (detailLead?.lead_id === leadId) setDetailLead(prev => ({ ...prev, stage: newStage, ...extra }));
  };

  const addNote = async () => {
    if (!noteForm.content) return;
    const noteType = noteForm.type;
    await leadsApi.addNote(detailLead.lead_id, noteForm);
    setNoteForm({ type: 'call', content: '', outcome: '' });
    const res = await leadsApi.getNotes(detailLead.lead_id);
    setNotes(res.data);
    toast.success('Note added');
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

  const addPhysicalDispatch = async () => {
    if (!detailLead) return;
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/physical-dispatches`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pdForm, lead_id: detailLead.lead_id, lead_name: detailLead.company_name || detailLead.contact_name }),
      });
      const created = await res.json();
      setPhysicalDispatches(prev => [created, ...prev]);
      setPdForm({ material_type: 'brochure', description: '', courier_name: '', tracking_number: '', sent_date: new Date().toISOString().slice(0, 10) });
      toast.success('Dispatch logged');
    } catch { toast.error('Failed to log dispatch'); }
  };

  const markDispatchReceived = async (dispatch_id) => {
    await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/physical-dispatches/${dispatch_id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received_confirmed: true }),
    });
    setPhysicalDispatches(prev => prev.map(d => d.dispatch_id === dispatch_id ? { ...d, received_confirmed: true } : d));
  };

  const handleKanbanMove = async ({ itemId, from, to, item }) => {
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
    const extra = {};
    if (to === 'lost') {
      const reason = window.prompt('Reason for marking this lead Lost? (Price / Competitor / No budget / No response / Timing / Other)');
      if (!reason || !reason.trim()) { toast.error('Lost reason required'); return; }
      extra.lost_reason = reason.trim();
    }
    try {
      await leadsApi.update(itemId, { stage: to, stage_change_note: `Drag from ${from} to ${to}`, ...extra });
      toast.success(`Moved to ${STAGES.find(s => s.id === to)?.label || to}`);
      fetchData();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Move failed');
    }
  };

  const toggleLeadSelect = (id) => setSelectedLeadIds(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const handleImport = async (file) => {
    try {
      const res = await leadsApi.importCsv(file);
      toast.success(`Imported: ${res.data.created} created, ${res.data.linked} linked, ${res.data.duplicates} duplicates`);
      setImportDialogOpen(false);
      fetchData();
    } catch { toast.error('Import failed'); }
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

  // ─────────────────────────────────────────────────────────────────────────────
  // SCHOOL HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const openEditSchool = (sch) => {
    setEditSchool(sch);
    setEditSchoolForm({ school_name: sch.school_name || '', school_type: sch.school_type || 'CBSE', group_id: sch.group_id || '', phone: sch.phone || '', email: sch.email || '', city: sch.city || '', state: sch.state || '', address: sch.address || '', pincode: sch.pincode || '', primary_contact_name: sch.primary_contact_name || '', designation: sch.designation || '', school_strength: sch.school_strength || 0, existing_vendor: sch.existing_vendor || '', linkedin_url: sch.linkedin_url || '', instagram_url: sch.instagram_url || '', website: sch.website || '' });
    setSchoolDialogOpen(true);
  };

  const openCreateSchool = () => {
    setEditSchool(null);
    setEditSchoolForm({ school_name: '', school_type: 'CBSE', group_id: '', phone: '', email: '', city: '', state: '', address: '', pincode: '', primary_contact_name: '', designation: '', school_strength: 0, existing_vendor: '', linkedin_url: '', instagram_url: '', website: '' });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // TASK HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const openCreateTask = (lead) => {
    setTaskForm({ title: '', type: 'follow_up', lead_id: lead?.lead_id || '', lead_name: lead?.company_name || '', assigned_to: lead?.assigned_to || '', due_date: '', due_time: '', priority: 'medium' });
    setTaskDialogOpen(true);
  };

  const saveTask = async () => {
    if (!taskForm.title || !taskForm.due_date) { toast.error('Title and due date required'); return; }
    const sp = spList.find(s => s.email === taskForm.assigned_to);
    await tasksApi.create({ ...taskForm, assigned_name: sp?.name || '' });
    setTaskDialogOpen(false); fetchData(); toast.success('Task created');
  };

  const updateTaskStatus = async (taskId, status) => { await tasksApi.update(taskId, { status }); fetchData(); };

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTACT HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const openCreateContact = () => {
    setEditContact(null);
    setContactForm({ name: '', phone: '', email: '', school_id: '', company: '', designation: '', contact_role_id: '', source: '', source_id: '', notes: '', birthday: '', tag_ids: [], assigned_to: user?.email || '' });
    setContactDialogOpen(true);
  };

  const openEditContact = (c) => {
    setEditContact(c);
    setContactForm({ name: c.name, phone: c.phone, email: c.email || '', school_id: c.school_id || '', company: c.company || '', designation: c.designation || '', contact_role_id: c.contact_role_id || '', source: c.source || '', source_id: c.source_id || '', notes: c.notes || '', birthday: c.birthday || '', tag_ids: c.tag_ids || [], assigned_to: c.assigned_to || '' });
    setContactDialogOpen(true);
  };

  const saveContact = async () => {
    if (!contactForm.name || !contactForm.phone) { toast.error('Name and phone required'); return; }
    try {
      const { tag_ids, ...payload } = contactForm;
      if (!payload.school_id && payload.company) {
        const matched = schoolsList.find(s => s.school_name.toLowerCase() === payload.company.toLowerCase());
        if (matched) {
          payload.school_id = matched.school_id;
        } else {
          payload.create_school_if_missing = true;
        }
      }
      let contactId;
      if (editContact) {
        await contactsApi.update(editContact.contact_id, payload);
        contactId = editContact.contact_id;
        toast.success('Contact updated');
        const prevTags = editContact.tag_ids || [];
        const toAdd = tag_ids.filter(id => !prevTags.includes(id));
        const toRemove = prevTags.filter(id => !tag_ids.includes(id));
        await Promise.all([
          ...toAdd.map(id => contactsApi.addTag(contactId, id)),
          ...toRemove.map(id => contactsApi.removeTag(contactId, id)),
        ]);
      } else {
        const res = await contactsApi.create(payload);
        contactId = res.data?.contact_id;
        toast.success('Contact added');
        if (contactId && tag_ids.length > 0) {
          await Promise.all(tag_ids.map(id => contactsApi.addTag(contactId, id)));
        }
      }
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

  const handleContactImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const res = await contactsApi.importCsv(importFile, { tagIds: importTags, globalNotes: importNotes });
      setImportResult(res.data);
      fetchData();
    } catch { toast.error('Import failed'); }
    finally { setImporting(false); }
  };

  const resetImportDialog = () => {
    setImportFile(null); setImportTags([]); setImportNotes(''); setImportResult(null);
  };

  const downloadSampleCsv = () => {
    const cols = ['name','phone','email','school','designation','source','notes','birthday','assigned_to'];
    const row1 = ['Rajesh Kumar','9876543210','rajesh@school.edu','Delhi Public School','Principal','Referral','Met at education expo 2024','1975-04-12',''];
    const row2 = ['Priya Sharma','9123456780','priya@abc.edu','ABC Academy','Purchase Head','Exhibition','','',''];
    const blob = new Blob([[cols, row1, row2].map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'contacts_sample.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const handleContactExport = () => {
    exportData.download('contacts');
    toast.success('Exporting contacts...');
  };

  const openWaForContact = (c) => {
    setWaCtx({
      module: 'contact', title: `WhatsApp - ${c.name}`,
      context: { contact_id: c.contact_id, phone: c.phone, contact_name: c.name, school_name: c.company },
    });
    setWaOpen(true);
  };

  const expandContactActivity = async (contactId) => {
    if (expandedContactId === contactId) { setExpandedContactId(null); return; }
    try {
      const res = await contactsApi.getActivity(contactId);
      setContactActivity(res.data || []);
      setExpandedContactId(contactId);
    } catch { toast.error('Failed to load activity'); }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SORT HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY FUNCTIONS (computed / used by UI)
  // ─────────────────────────────────────────────────────────────────────────────
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

  const calcContactCompletion = (c) => {
    const checks = [
      !!(c.name?.trim()),
      !!(c.phone?.trim()),
      !!(c.email?.trim()),
      !!(c.company?.trim() || c.school_id),
      !!(c.contact_role_id || c.designation?.trim()),
      !!(c.source?.trim()),
      !!(c.notes?.trim()),
      !!(c.birthday?.trim()),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  };

  const getRoleName = (contact) => {
    if (contact.contact_role_id && rolesList.length) {
      const r = rolesList.find(r => r.role_id === contact.contact_role_id);
      if (r) return r.name;
    }
    return contact.designation || null;
  };

  // Filtered leads (for pipeline / kanban / table views)
  const filteredLeads = leadsList.filter(l => {
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      if (!((l.company_name || '').toLowerCase().includes(s) || (l.contact_name || '').toLowerCase().includes(s) || (l.contact_phone || '').includes(s) || (l.school_city || '').toLowerCase().includes(s))) return false;
    }
    if (filterType !== 'all') {
      if (['hot', 'warm', 'cold'].includes(filterType) && l.lead_type !== filterType) return false;
      if (SCHOOL_TYPES.includes(filterType) && l.school_type !== filterType) return false;
    }
    if (filterTag && !(l.tags || []).includes(filterTag)) return false;
    return true;
  });

  return {
    // State — data
    user,
    leadsList, schoolsList, tasksList, contactsList, spList,
    groupsList, sourcesList, rolesList, tagsList, setTagsList, dripSequencesList,
    allQuotations, designationsList,
    loading,

    // State — UI
    activeTab, setActiveTab,
    searchTerm, setSearchTerm,
    filterType, setFilterType,
    filterTag, setFilterTag,
    filterRole, setFilterRole,
    filterContactTag, setFilterContactTag,
    sortConfig, toggleSort, sortIndicator, sortData,
    contactPage, setContactPage, contactsPerPage,
    leadView, setLeadView,
    selectedLeadIds, setSelectedLeadIds,
    filteredLeads,

    // State — WhatsApp
    waOpen, setWaOpen, waCtx,
    openWaForLead, openWaForContact,

    // State — Reassign
    reassignOpen, setReassignOpen,
    reassignLead, setReassignLead,
    reassignBulkIds, setReassignBulkIds,

    // State — Lead detail
    detailLead, setDetailLead,
    notes, leadFollowups, physicalDispatches, leadVisits, leadEnrollments,
    noteForm, setNoteForm,
    fuForm, setFuForm,
    pdForm, setPdForm,
    enrollDialogOpen, setEnrollDialogOpen,
    selectedSequenceId, setSelectedSequenceId,
    setLeadEnrollments,

    // State — Lead form
    leadDialogOpen, setLeadDialogOpen,
    editLead,
    addNewSchool, setAddNewSchool,
    newTagInput, setNewTagInput,
    leadForm, setLeadForm,
    newSchool, setNewSchool,

    // State — School form
    schoolDialogOpen, setSchoolDialogOpen,
    editSchool, setEditSchool,
    editSchoolForm, setEditSchoolForm,

    // State — Task
    taskDialogOpen, setTaskDialogOpen,
    taskForm, setTaskForm,

    // State — Contacts
    contactDialogOpen, setContactDialogOpen,
    editContact,
    contactForm, setContactForm,
    convertDialogOpen, setConvertDialogOpen,
    convertContact,
    convertForm, setConvertForm,
    convertAddNewSchool, setConvertAddNewSchool,
    convertNewSchool, setConvertNewSchool,
    contactImportOpen, setContactImportOpen,
    contactFileRef,
    importFile, setImportFile,
    importTags, setImportTags,
    importNotes, setImportNotes,
    importing,
    importResult,
    expandedContactId,
    contactActivity,

    // State — Lead import
    importDialogOpen, setImportDialogOpen,
    fileRef,

    // Handlers — fetch
    fetchData,

    // Handlers — leads
    openCreateLead, openEditLead, openDetail,
    saveLead, changeStage, addNote,
    addFollowup, completeFollowup,
    addPhysicalDispatch, markDispatchReceived,
    handleKanbanMove, toggleLeadSelect,
    handleImport,

    // Handlers — schools
    openEditSchool, openCreateSchool,
    handleSaveSchool, handleDeleteSchool,

    // Handlers — tasks
    openCreateTask, saveTask, updateTaskStatus,

    // Handlers — contacts
    openCreateContact, openEditContact, saveContact, deleteContact,
    openConvert, handleConvert,
    handleContactImport, resetImportDialog,
    downloadSampleCsv, handleContactExport,
    expandContactActivity,

    // Utility
    daysSince, touchAgeCls,
    calcSchoolCompletion, calcContactCompletion,
    getRoleName,
  };
}
