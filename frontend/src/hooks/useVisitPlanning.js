import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { visitPlans, leads as leadsApi, salesPersons, schools as schoolsApi, contacts as contactsApi } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';
import { groupVisits, parseCoordsFromUrl, isShortMapsUrl } from '../lib/visitUtils';

const FILTER_GROUPS = {
  all:         ['overdue', 'today', 'tomorrow', 'upcoming', 'completed', 'cancelled'],
  planned:     ['overdue', 'today', 'tomorrow', 'upcoming'],
  in_progress: ['today'],
  completed:   ['completed'],
  cancelled:   ['cancelled'],
};

export default function useVisitPlanning() {
  const { user }   = useAuth();
  const { isDark } = useTheme();
  const nav        = useNavigate();

  // ── Core data ────────────────────────────────────────────────────────────
  const [plans,        setPlans]        = useState([]);
  const [leadsList,    setLeadsList]    = useState([]);
  const [spList,       setSpList]       = useState([]);
  const [loading,      setLoading]      = useState(true);

  // ── Create-dialog form ───────────────────────────────────────────────────
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [form,         setForm]         = useState({
    lead_id: '', school_name: '', lead_name: '', assigned_to: '', assigned_name: '',
    visit_date: '', visit_time: '', purpose: '', planned_address: '',
    planned_lat: null, planned_lng: null,
  });
  const [mapsInput,    setMapsInput]    = useState('');
  const [gpsLoading,   setGpsLoading]   = useState(false);
  const [urlLoading,   setUrlLoading]   = useState(false);

  // ── Checkout dialog ──────────────────────────────────────────────────────
  const [checkoutDialog, setCheckoutDialog] = useState({ open: false, plan: null, saving: false });
  const [checkoutNotes,  setCheckoutNotes]  = useState('');
  const [checkoutWa,     setCheckoutWa]     = useState(false);

  // ── Reschedule dialog ────────────────────────────────────────────────────
  const [rescheduleDialog, setRescheduleDialog] = useState({ open: false, plan: null, saving: false });
  const [rescheduleForm,   setRescheduleForm]   = useState({ new_date: '', new_time: '', reason: '' });

  // ── History dialog ───────────────────────────────────────────────────────
  const [historyDialog, setHistoryDialog] = useState({ open: false, plan: null });

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx,  setWaCtx]  = useState({ module: 'visit', context: {}, title: '' });

  // ── Filter ───────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('all');

  // ── School / contact pickers ─────────────────────────────────────────────
  const [schoolsList,       setSchoolsList]       = useState([]);
  const [contactsList,      setContactsList]      = useState([]);
  const [schoolQuery,       setSchoolQuery]       = useState('');
  const [showSchoolDrop,    setShowSchoolDrop]    = useState(false);
  const [createSchoolMode,  setCreateSchoolMode]  = useState(false);
  const [newSchool,         setNewSchool]         = useState({ school_name: '', city: '', board: '' });
  const [schoolSaving,      setSchoolSaving]      = useState(false);
  const [contactQuery,      setContactQuery]      = useState('');
  const [showContactDrop,   setShowContactDrop]   = useState(false);
  const [selectedContact,   setSelectedContact]   = useState(null);
  const [createContactMode, setCreateContactMode] = useState(false);
  const [newContact,        setNewContact]        = useState({ first_name: '', last_name: '', phone: '', designation: '' });
  const [contactSaving,     setContactSaving]     = useState(false);

  // ── Design tokens ────────────────────────────────────────────────────────
  const tk = isDark ? {
    page:    'bg-[var(--bg-primary)]',
    card:    'bg-[var(--bg-card)] border-[var(--border-color)]',
    input:   'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    t1:      'text-[var(--text-primary)]',
    t2:      'text-[var(--text-secondary)]',
    tm:      'text-[var(--text-muted)]',
    dlg:     'bg-[var(--bg-card)] border-[var(--border-color)]',
    sel:     'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    infoBox: 'bg-[var(--bg-hover)]',
  } : {
    page:    'bg-[#f8fafc]',
    card:    'bg-white border-[#e2e8f0]',
    input:   'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    t1:      'text-[#0f172a]',
    t2:      'text-[#334155]',
    tm:      'text-[#94a3b8]',
    dlg:     'bg-white border-[#e2e8f0]',
    sel:     'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    infoBox: 'bg-[#f8fafc]',
  };

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [pr, lr, spr, schr, conr] = await Promise.all([
        visitPlans.getAll(), leadsApi.getAll(), salesPersons.getAll(),
        schoolsApi.getAll(), contactsApi.getAll(),
      ]);
      setPlans(pr.data); setLeadsList(lr.data); setSpList(spr.data);
      setSchoolsList(schr.data || []); setContactsList(conr.data || []);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };

  const stableFetch = useCallback(() => { fetchData(); }, []); // eslint-disable-line
  useEffect(() => { stableFetch(); }, [stableFetch]);
  useDataSync('visits', stableFetch);
  useAutoRefresh(stableFetch, 60000);

  // ── Location helpers ─────────────────────────────────────────────────────
  const reverseGeocode = async (lat, lng) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
        headers: { 'User-Agent': 'SmartShapePro/1.0' },
      });
      const d = await r.json();
      return d.display_name || `${lat}, ${lng}`;
    } catch { return `${lat}, ${lng}`; }
  };

  const applyCoords = async (lat, lng) => {
    const addr = await reverseGeocode(lat, lng);
    setForm(f => ({ ...f, planned_lat: lat, planned_lng: lng, planned_address: addr }));
    toast.success('Location captured');
  };

  const handleMapsInput = async (val) => {
    setMapsInput(val);
    const s = val.trim();
    if (!s) return;

    const coords = parseCoordsFromUrl(s);
    if (coords) { await applyCoords(coords.lat, coords.lng); return; }

    if (isShortMapsUrl(s)) {
      setUrlLoading(true);
      try {
        const res = await visitPlans.resolveMapsUrl(s);
        const { lat, lng } = res.data;
        if (lat !== null) {
          await applyCoords(lat, lng);
        } else {
          toast.error('Could not extract coordinates — paste the full Google Maps URL instead');
        }
      } catch {
        toast.error('URL resolution failed — please use the full Maps URL or GPS');
      } finally { setUrlLoading(false); }
    }
  };

  const handleGps = async () => {
    if (!navigator.geolocation) { toast.error('GPS not supported'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await applyCoords(pos.coords.latitude, pos.coords.longitude);
        setMapsInput(`${pos.coords.latitude}, ${pos.coords.longitude}`);
        setGpsLoading(false);
      },
      (err) => { toast.error(`GPS denied: ${err.message}`); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── Create dialog ────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({
      lead_id: '', school_name: '', lead_name: '',
      assigned_to: user?.email || '', assigned_name: user?.name || '',
      visit_date: '', visit_time: '', purpose: '',
      planned_address: '', planned_lat: null, planned_lng: null,
    });
    setMapsInput('');
    setSchoolQuery(''); setShowSchoolDrop(false); setCreateSchoolMode(false);
    setNewSchool({ school_name: '', city: '', board: '' });
    setContactQuery(''); setShowContactDrop(false); setSelectedContact(null);
    setCreateContactMode(false);
    setNewContact({ first_name: '', last_name: '', phone: '', designation: '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.visit_date) { toast.error('Visit date is required'); return; }
    try {
      const sp = spList.find(s => s.email === form.assigned_to);
      await visitPlans.create({ ...form, assigned_name: sp?.name || form.assigned_name });
      toast.success('Visit planned');
      setDialogOpen(false);
      fetchData();
    } catch { toast.error('Failed to save visit'); }
  };

  // ── Check-in ─────────────────────────────────────────────────────────────
  const handleCheckIn = (plan, workType) => {
    if (workType === 'wfh') {
      visitPlans.checkIn(plan.plan_id, { work_type: 'wfh' })
        .then(() => { toast.success('WFH check-in recorded'); fetchData(); })
        .catch(e => toast.error(e?.response?.data?.detail || 'Check-in failed'));
      return;
    }
    if (!navigator.geolocation) { toast.error('GPS not supported'); return; }
    toast.info('Capturing GPS…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await visitPlans.checkIn(plan.plan_id, {
            work_type: 'field',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          toast.success('GPS check-in successful');
          fetchData();
        } catch (e) { toast.error(e?.response?.data?.detail || 'Check-in failed'); }
      },
      (err) => toast.error(`GPS denied: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── Checkout ─────────────────────────────────────────────────────────────
  const openCheckout = (plan) => {
    setCheckoutNotes('');
    setCheckoutWa(false);
    setCheckoutDialog({ open: true, plan, saving: false });
  };

  const handleCheckOut = async () => {
    const { plan } = checkoutDialog;
    setCheckoutDialog(d => ({ ...d, saving: true }));

    const doCheckout = async (lat, lng) => {
      try {
        await visitPlans.checkOut(plan.plan_id, {
          visit_notes: checkoutNotes,
          outcome: checkoutNotes,
          ...(lat !== undefined ? { lat, lng } : {}),
        });
        toast.success('Checked out successfully');
        fetchData();
        setCheckoutDialog({ open: false, plan: null, saving: false });

        if (checkoutWa) {
          const lead = leadsList.find(l => l.lead_id === plan.lead_id);
          setWaCtx({
            module: 'visit',
            title: `WhatsApp follow-up — ${plan.school_name || 'Visit'}`,
            context: {
              lead_id: plan.lead_id,
              school_id: plan.school_id,
              phone: lead?.contact_phone || '',
              contact_name: lead?.contact_name || '',
              school_name: plan.school_name || lead?.company_name || '',
            },
          });
          setWaOpen(true);
        }
      } catch (e) {
        toast.error(e?.response?.data?.detail || 'Check-out failed');
        setCheckoutDialog(d => ({ ...d, saving: false }));
      }
    };

    const isField = (plan.work_type || 'field') === 'field';
    if (isField && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => doCheckout(pos.coords.latitude, pos.coords.longitude),
        ()  => doCheckout(undefined, undefined),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      doCheckout(undefined, undefined);
    }
  };

  // ── Reschedule ───────────────────────────────────────────────────────────
  const openReschedule = (plan) => {
    setRescheduleForm({ new_date: plan.visit_date || '', new_time: plan.visit_time || '', reason: '' });
    setRescheduleDialog({ open: true, plan, saving: false });
  };

  const handleReschedule = async () => {
    if (!rescheduleForm.new_date) { toast.error('New date is required'); return; }
    setRescheduleDialog(d => ({ ...d, saving: true }));
    try {
      await visitPlans.reschedule(rescheduleDialog.plan.plan_id, rescheduleForm);
      toast.success(`Rescheduled to ${rescheduleForm.new_date}`);
      setRescheduleDialog({ open: false, plan: null, saving: false });
      fetchData();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Reschedule failed');
      setRescheduleDialog(d => ({ ...d, saving: false }));
    }
  };

  const handleDelete = async (planId) => {
    await visitPlans.delete(planId);
    toast.success('Visit deleted');
    fetchData();
  };

  // ── School picker handlers ────────────────────────────────────────────────
  const filteredSchools = (() => {
    const q = schoolQuery.toLowerCase();
    if (!q) return schoolsList.slice(0, 8);
    return schoolsList.filter(s =>
      (s.school_name || '').toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q)
    ).slice(0, 8);
  })();

  const filteredContacts = (() => {
    const q = contactQuery.toLowerCase();
    return contactsList.filter(c => {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      return !q || name.includes(q) || (c.phone || '').includes(q);
    }).slice(0, 10);
  })();

  const handleSelectSchool = (s) => {
    setForm(f => ({ ...f, school_name: s.school_name, school_id: s.school_id }));
    setSchoolQuery(s.school_name); setShowSchoolDrop(false);
  };

  const clearSchool = () => {
    setForm(f => ({ ...f, school_name: '', school_id: '' }));
    setSchoolQuery(''); setSelectedContact(null); setContactQuery('');
  };

  const handleCreateSchool = async () => {
    if (!newSchool.school_name.trim()) return;
    setSchoolSaving(true);
    try {
      const r = await schoolsApi.create({ ...newSchool });
      const created = r.data;
      setSchoolsList(prev => [created, ...prev]);
      setForm(f => ({ ...f, school_name: created.school_name, school_id: created.school_id }));
      setSchoolQuery(created.school_name); setCreateSchoolMode(false);
      setNewSchool({ school_name: '', city: '', board: '' });
      toast.success('School created');
    } catch { toast.error('Failed to create school'); }
    finally { setSchoolSaving(false); }
  };

  const handleSelectContact = (c) => {
    setSelectedContact(c);
    const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '';
    // Cross-link the contact's school so the visit isn't orphaned (carries the
    // school_id FK), unless the user already picked a school explicitly. Also
    // carry the contact's name/phone into the visit payload.
    const sch = c.school_id ? schoolsList.find(s => s.school_id === c.school_id) : null;
    setForm(f => ({
      ...f,
      lead_name: fullName,
      contact_person: fullName,
      contact_phone: c.phone || f.contact_phone || '',
      ...(sch && !f.school_id ? { school_id: sch.school_id, school_name: sch.school_name } : {}),
    }));
    setContactQuery(fullName);
    if (sch && !schoolQuery) setSchoolQuery(sch.school_name);
    setShowContactDrop(false);
  };

  const clearContact = () => {
    setSelectedContact(null); setContactQuery('');
    setForm(f => ({ ...f, lead_name: '' }));
  };

  const handleCreateContact = async () => {
    if (!newContact.first_name.trim()) return;
    setContactSaving(true);
    try {
      const fullName = [newContact.first_name, newContact.last_name].filter(Boolean).join(' ');
      const r = await contactsApi.create({ ...newContact, company: form.school_name || '', name: fullName });
      const created = r.data;
      setContactsList(prev => [created, ...prev]);
      handleSelectContact(created);
      setCreateContactMode(false);
      setNewContact({ first_name: '', last_name: '', phone: '', designation: '' });
      toast.success('Contact created');
    } catch { toast.error('Failed to create contact'); }
    finally { setContactSaving(false); }
  };

  // ── Computed values ──────────────────────────────────────────────────────
  const today        = new Date().toISOString().split('T')[0];
  const groups       = groupVisits(plans);
  const todayCount    = groups.today.length;
  const upcomingCount = groups.upcoming.length + groups.tomorrow.length;
  const overdueCount  = groups.overdue.length;
  const completedCount = groups.completed.length;

  const filteredGroups = (FILTER_GROUPS[filter] || FILTER_GROUPS.all)
    .map(key => {
      let items = groups[key] || [];
      if (filter === 'in_progress') items = items.filter(p => p.status === 'in_progress');
      if (filter === 'planned')     items = items.filter(p => p.status === 'planned' || p.status === 'in_progress');
      return {
        key, items,
        label: key === 'today' ? 'Today' : key === 'tomorrow' ? 'Tomorrow'
          : key === 'overdue' ? '⚠ Overdue' : key === 'upcoming' ? 'Upcoming'
          : key === 'completed' ? 'Completed' : 'Cancelled',
      };
    })
    .filter(g => g.items.length > 0);

  return {
    // data
    plans, leadsList, spList, loading,
    // form state
    dialogOpen, setDialogOpen,
    form, setForm,
    mapsInput, setMapsInput: handleMapsInput,
    gpsLoading, urlLoading,
    // checkout
    checkoutDialog, setCheckoutDialog,
    checkoutNotes, setCheckoutNotes,
    checkoutWa, setCheckoutWa,
    // reschedule
    rescheduleDialog, setRescheduleDialog,
    rescheduleForm, setRescheduleForm,
    // history
    historyDialog, setHistoryDialog,
    // whatsapp
    waOpen, setWaOpen, waCtx,
    // filter
    filter, setFilter,
    // school picker
    schoolsList, filteredSchools,
    schoolQuery, setSchoolQuery,
    showSchoolDrop, setShowSchoolDrop,
    createSchoolMode, setCreateSchoolMode,
    newSchool, setNewSchool, schoolSaving,
    // contact picker
    contactsList, filteredContacts,
    contactQuery, setContactQuery,
    showContactDrop, setShowContactDrop,
    selectedContact,
    createContactMode, setCreateContactMode,
    newContact, setNewContact, contactSaving,
    // design tokens
    tk, isDark,
    // computed
    today, groups, todayCount, upcomingCount, overdueCount, completedCount, filteredGroups,
    // handlers
    openCreate, handleSave,
    handleCheckIn, openCheckout, handleCheckOut,
    openReschedule, handleReschedule,
    handleDelete,
    handleSelectSchool, clearSchool, handleCreateSchool,
    handleSelectContact, clearContact, handleCreateContact,
    handleGps,
    nav,
  };
}
