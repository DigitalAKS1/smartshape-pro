import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { visitPlans, leads as leadsApi, salesPersons } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, MapPin, Calendar, CheckCircle, Clock, AlertTriangle,
  Trash2, RotateCcw, History, Navigation, Link as LinkIcon,
  MessageSquare, Loader2, CheckCheck,
} from 'lucide-react';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

// ── helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function fmtTime(t) {
  if (!t) return '';
  try {
    const [h, m] = t.split(':');
    const hh = parseInt(h);
    return `${hh % 12 || 12}:${m} ${hh >= 12 ? 'PM' : 'AM'}`;
  } catch { return t; }
}

const STATUS_CFG = {
  planned:     { label: 'Planned',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-50 text-red-600 border-red-200' },
};

// Detect short-URL patterns that need backend resolution
function isShortMapsUrl(s) {
  return /share\.google|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(s);
}

function parseCoordsFromUrl(s) {
  const atMatch  = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch)  return { lat: parseFloat(atMatch[1]),  lng: parseFloat(atMatch[2]) };
  const qMatch   = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch)   return { lat: parseFloat(qMatch[1]),   lng: parseFloat(qMatch[2]) };
  const rawMatch = s.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
  if (rawMatch) return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
  return null;
}

// ── Visit group labels ────────────────────────────────────────────────────
function groupVisits(plans) {
  const today      = new Date().toISOString().split('T')[0];
  const tomorrow   = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], completed: [], cancelled: [] };
  for (const p of plans) {
    if (p.status === 'completed')                           { groups.completed.push(p); continue; }
    if (p.status === 'cancelled')                           { groups.cancelled.push(p); continue; }
    if (p.visit_date < today && p.status !== 'in_progress') { groups.overdue.push(p);   continue; }
    if (p.visit_date === today || p.status === 'in_progress') { groups.today.push(p);   continue; }
    if (p.visit_date === tomorrow)                          { groups.tomorrow.push(p);   continue; }
    groups.upcoming.push(p);
  }
  groups.today.sort((a, b) => (a.visit_time || '').localeCompare(b.visit_time || ''));
  groups.upcoming.sort((a, b) => a.visit_date.localeCompare(b.visit_date));
  groups.completed.sort((a, b) => b.visit_date.localeCompare(a.visit_date));
  return groups;
}

// ══════════════════════════════════════════════════════════════════════════════
export default function VisitPlanning() {
  const { user }   = useAuth();
  const { isDark } = useTheme();

  const [plans,     setPlans]     = useState([]);
  const [leadsList, setLeadsList] = useState([]);
  const [spList,    setSpList]    = useState([]);
  const [loading,   setLoading]   = useState(true);

  // Create dialog
  const [dialogOpen,  setDialogOpen]  = useState(false);
  const [form, setForm] = useState({
    lead_id: '', school_name: '', lead_name: '', assigned_to: '', assigned_name: '',
    visit_date: '', visit_time: '', purpose: '', planned_address: '',
    planned_lat: null, planned_lng: null,
  });
  const [mapsInput,   setMapsInput]   = useState('');
  const [gpsLoading,  setGpsLoading]  = useState(false);
  const [urlLoading,  setUrlLoading]  = useState(false);

  // Checkout dialog
  const [checkoutDialog, setCheckoutDialog] = useState({ open: false, plan: null, saving: false });
  const [checkoutNotes,  setCheckoutNotes]  = useState('');
  const [checkoutWa,     setCheckoutWa]     = useState(false);

  // Reschedule dialog
  const [rescheduleDialog, setRescheduleDialog] = useState({ open: false, plan: null, saving: false });
  const [rescheduleForm,   setRescheduleForm]   = useState({ new_date: '', new_time: '', reason: '' });

  // History dialog
  const [historyDialog, setHistoryDialog] = useState({ open: false, plan: null });

  // WhatsApp
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx,  setWaCtx]  = useState({ module: 'visit', context: {}, title: '' });

  // Filter
  const [filter, setFilter] = useState('all');

  // Design tokens
  const tk = isDark ? {
    page:   'bg-[var(--bg-primary)]',
    card:   'bg-[var(--bg-card)] border-[var(--border-color)]',
    input:  'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    t1:     'text-[var(--text-primary)]',
    t2:     'text-[var(--text-secondary)]',
    tm:     'text-[var(--text-muted)]',
    dlg:    'bg-[var(--bg-card)] border-[var(--border-color)]',
    sel:    'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
    infoBox:'bg-[var(--bg-hover)]',
  } : {
    page:   'bg-[#f8fafc]',
    card:   'bg-white border-[#e2e8f0]',
    input:  'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    t1:     'text-[#0f172a]',
    t2:     'text-[#334155]',
    tm:     'text-[#94a3b8]',
    dlg:    'bg-white border-[#e2e8f0]',
    sel:    'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]',
    infoBox:'bg-[#f8fafc]',
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [pr, lr, spr] = await Promise.all([
        visitPlans.getAll(), leadsApi.getAll(), salesPersons.getAll(),
      ]);
      setPlans(pr.data); setLeadsList(lr.data); setSpList(spr.data);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []); // eslint-disable-line

  // ── Location helpers ──────────────────────────────────────────────────────
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

    // Direct coordinate extraction
    const coords = parseCoordsFromUrl(s);
    if (coords) { await applyCoords(coords.lat, coords.lng); return; }

    // Short URL — resolve server-side
    if (isShortMapsUrl(s)) {
      setUrlLoading(true);
      try {
        const res = await visitPlans.resolveMapsUrl(s);
        const { lat, lng, final_url } = res.data;
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

  // ── Create ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({
      lead_id: '', school_name: '', lead_name: '',
      assigned_to: user?.email || '', assigned_name: user?.name || '',
      visit_date: '', visit_time: '', purpose: '',
      planned_address: '', planned_lat: null, planned_lng: null,
    });
    setMapsInput('');
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

  // ── Check-in ──────────────────────────────────────────────────────────────
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

  // ── Check-out dialog ──────────────────────────────────────────────────────
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

  // ── Computed ──────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const groups = groupVisits(plans);
  const todayCount    = groups.today.length;
  const upcomingCount = groups.upcoming.length + groups.tomorrow.length;
  const overdueCount  = groups.overdue.length;
  const completedCount = groups.completed.length;

  // Apply filter
  const FILTER_GROUPS = {
    all:         ['overdue', 'today', 'tomorrow', 'upcoming', 'completed', 'cancelled'],
    planned:     ['overdue', 'today', 'tomorrow', 'upcoming'],
    in_progress: ['today'],
    completed:   ['completed'],
    cancelled:   ['cancelled'],
  };

  const filteredGroups = (FILTER_GROUPS[filter] || ['overdue', 'today', 'tomorrow', 'upcoming', 'completed', 'cancelled'])
    .map(key => {
      let items = groups[key] || [];
      if (filter === 'in_progress') items = items.filter(p => p.status === 'in_progress');
      if (filter === 'planned')     items = items.filter(p => p.status === 'planned' || p.status === 'in_progress');
      return { key, label: key === 'today' ? 'Today' : key === 'tomorrow' ? 'Tomorrow'
        : key === 'overdue' ? '⚠ Overdue' : key === 'upcoming' ? 'Upcoming'
        : key === 'completed' ? 'Completed' : 'Cancelled', items };
    })
    .filter(g => g.items.length > 0);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-5 pb-10">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-bold ${tk.t1} tracking-tight`}>Visit Planning</h1>
            <p className={`text-sm ${tk.tm} mt-0.5`}>
              {todayCount} today · {upcomingCount} upcoming
              {overdueCount > 0 && <span className="text-[#e94560] ml-1">· {overdueCount} overdue</span>}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9 px-4 text-sm rounded-lg">
            <Plus className="h-4 w-4 mr-1.5" />Plan Visit
          </Button>
        </div>

        {/* ── Stats strip ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Calendar,      color: 'text-[#e94560]', value: todayCount,    label: 'Today'    },
            { icon: Clock,         color: 'text-blue-500',  value: upcomingCount, label: 'Upcoming' },
            { icon: CheckCircle,   color: 'text-emerald-500', value: completedCount, label: 'Done'  },
            { icon: AlertTriangle, color: 'text-amber-500', value: overdueCount,  label: 'Overdue'  },
          ].map(({ icon: Icon, color, value, label }) => (
            <div key={label} className={`${tk.card} border rounded-xl p-4 flex items-center gap-3`}>
              <div className={`w-9 h-9 rounded-lg ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f8fafc]'} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4.5 w-4.5 ${color}`} style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <p className={`text-xl font-black leading-none ${tk.t1}`}>{value}</p>
                <p className={`text-[11px] uppercase tracking-wide font-medium mt-0.5 ${tk.tm}`}>{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter chips ──────────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'planned', 'in_progress', 'completed', 'cancelled'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all capitalize border ${
                filter === f
                  ? 'bg-[#e94560] text-white border-[#e94560]'
                  : `${tk.card} ${tk.tm} hover:border-[#e94560] hover:text-[#e94560]`
              }`}>
              {f.replace('_', ' ')}
              <span className="ml-1.5 opacity-70">
                {f === 'all' ? plans.length : plans.filter(p => p.status === f).length}
              </span>
            </button>
          ))}
        </div>

        {/* ── Visit groups ──────────────────────────────────────────────── */}
        {filteredGroups.length === 0 && (
          <div className={`${tk.card} border rounded-2xl p-14 text-center`}>
            <MapPin className={`h-10 w-10 ${tk.tm} mx-auto mb-3 opacity-30`} />
            <p className={`text-sm ${tk.tm}`}>No visits in this view</p>
          </div>
        )}

        {filteredGroups.map(({ key, label, items }) => (
          <div key={key}>
            {/* Group heading */}
            <div className="flex items-center gap-3 mb-2.5">
              <p className={`text-[11px] uppercase tracking-widest font-bold ${
                key === 'overdue' ? 'text-[#e94560]' : tk.tm
              }`}>{label}</p>
              <div className={`flex-1 h-px ${isDark ? 'bg-[var(--border-color)]' : 'bg-[#e2e8f0]'}`} />
              <span className={`text-[11px] font-semibold ${tk.tm}`}>{items.length}</span>
            </div>

            <div className="space-y-2.5">
              {items.map(plan => <VisitCard key={plan.plan_id} plan={plan} tk={tk} isDark={isDark} today={today}
                onCheckIn={handleCheckIn} onOpenCheckout={openCheckout}
                onReschedule={openReschedule} onDelete={handleDelete}
                onHistory={() => setHistoryDialog({ open: true, plan })} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ PLAN VISIT DIALOG ══════════════════════════════════════════════ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Plan a Visit</DialogTitle>
            <DialogDescription className={tk.tm}>Fill in the details to schedule a field visit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-1">

            {/* Lead select */}
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Link to Lead (optional)</Label>
              <select value={form.lead_id} onChange={e => {
                const lead = leadsList.find(l => l.lead_id === e.target.value);
                setForm({ ...form, lead_id: e.target.value, lead_name: lead?.company_name || '', school_name: lead?.company_name || '', school_id: lead?.school_id || '' });
              }} className={`w-full h-10 px-3 rounded-lg text-sm border ${tk.sel}`}>
                <option value="">— no lead —</option>
                {leadsList.map(l => <option key={l.lead_id} value={l.lead_id}>{l.company_name || l.contact_name} ({l.stage})</option>)}
              </select>
            </div>

            {!form.lead_id && (
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>School / Location Name</Label>
                <Input value={form.school_name} onChange={e => setForm({ ...form, school_name: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Enter school or place name" />
              </div>
            )}

            {/* Location input */}
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Location</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  {urlLoading
                    ? <Loader2 className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm} animate-spin`} />
                    : <LinkIcon className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${tk.tm}`} />
                  }
                  <Input
                    value={mapsInput}
                    onChange={e => handleMapsInput(e.target.value)}
                    className={`${tk.input} h-10 pl-8 text-sm rounded-lg`}
                    placeholder="Paste Google Maps link, share.google/…, or lat,lng"
                  />
                </div>
                <Button type="button" size="sm" variant="outline" onClick={handleGps} disabled={gpsLoading}
                  className={`border ${isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'} ${tk.tm} h-10 px-3 flex-shrink-0 rounded-lg`}
                  title="Use current GPS location">
                  {gpsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {form.planned_lat && (
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-emerald-700 break-all leading-snug">{form.planned_address}</p>
                    <p className="text-[10px] text-emerald-500 mt-0.5">{form.planned_lat?.toFixed(5)}, {form.planned_lng?.toFixed(5)}</p>
                  </div>
                  <a href={`https://www.google.com/maps?q=${form.planned_lat},${form.planned_lng}`} target="_blank" rel="noreferrer"
                    className="text-emerald-600 hover:text-emerald-800 flex-shrink-0 mt-0.5" title="Preview on Maps">
                    <Navigation className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}

              <Input value={form.planned_address}
                onChange={e => setForm({ ...form, planned_address: e.target.value })}
                className={`${tk.input} h-10 text-sm rounded-lg mt-2`}
                placeholder="Or type address manually" />
            </div>

            {/* Date + time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Visit Date *</Label>
                <Input type="date" value={form.visit_date} onChange={e => setForm({ ...form, visit_date: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Time</Label>
                <Input type="time" value={form.visit_time} onChange={e => setForm({ ...form, visit_time: e.target.value })}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
            </div>

            {/* Assign to */}
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Assign To</Label>
              <select value={form.assigned_to} onChange={e => {
                const sp = spList.find(s => s.email === e.target.value);
                setForm({ ...form, assigned_to: e.target.value, assigned_name: sp?.name || '' });
              }} className={`w-full h-10 px-3 rounded-lg text-sm border ${tk.sel}`}>
                <option value="">Select team member</option>
                {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>

            {/* Purpose */}
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Purpose</Label>
              <Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}
                className={`h-10 text-sm rounded-lg ${tk.input}`} placeholder="Demo, Follow-up, Delivery…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className={tk.tm}>Cancel</Button>
            <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-5">
              Plan Visit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ CHECK-OUT DIALOG ═══════════════════════════════════════════════ */}
      <Dialog open={checkoutDialog.open} onOpenChange={o => !checkoutDialog.saving && setCheckoutDialog(d => ({ ...d, open: o }))}>
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-sm rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Check Out</DialogTitle>
            <DialogDescription className={tk.tm}>
              {checkoutDialog.plan?.school_name || checkoutDialog.plan?.lead_name || 'Visit'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Visit notes / outcome</Label>
              <textarea
                value={checkoutNotes}
                onChange={e => setCheckoutNotes(e.target.value)}
                rows={3}
                className={`w-full rounded-xl text-sm p-3 border resize-none focus:outline-none focus:ring-2 focus:ring-[#e94560]/30 ${tk.input}`}
                placeholder="What happened? Any follow-up needed?"
              />
            </div>
            {/* WhatsApp toggle */}
            <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
              checkoutWa
                ? 'border-emerald-500/40 bg-emerald-50'
                : isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'
            }`}>
              <MessageSquare className={`h-4 w-4 flex-shrink-0 ${checkoutWa ? 'text-emerald-600' : tk.tm}`} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${checkoutWa ? 'text-emerald-700' : tk.t1}`}>Send WhatsApp follow-up</p>
                <p className={`text-xs ${checkoutWa ? 'text-emerald-600' : tk.tm}`}>Open message dialog after check-out</p>
              </div>
              <input type="checkbox" checked={checkoutWa} onChange={e => setCheckoutWa(e.target.checked)}
                className="w-4 h-4 accent-[#e94560]" />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCheckoutDialog({ open: false, plan: null, saving: false })}
              disabled={checkoutDialog.saving} className={tk.tm}>Cancel</Button>
            <Button onClick={handleCheckOut} disabled={checkoutDialog.saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-5">
              {checkoutDialog.saving
                ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Checking out…</>
                : <><CheckCircle className="h-3.5 w-3.5 mr-2" />Check Out</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ RESCHEDULE DIALOG ══════════════════════════════════════════════ */}
      <Dialog open={rescheduleDialog.open} onOpenChange={o => !rescheduleDialog.saving && setRescheduleDialog(d => ({ ...d, open: o }))}>
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-sm rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Reschedule Visit</DialogTitle>
            <DialogDescription className={tk.tm}>
              {rescheduleDialog.plan
                ? `${rescheduleDialog.plan.school_name || rescheduleDialog.plan.lead_name} — currently ${rescheduleDialog.plan.visit_date}${rescheduleDialog.plan.visit_time ? ' ' + fmtTime(rescheduleDialog.plan.visit_time) : ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>New Date *</Label>
                <Input type="date" value={rescheduleForm.new_date}
                  onChange={e => setRescheduleForm(f => ({ ...f, new_date: e.target.value }))}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
              <div>
                <Label className={`text-xs ${tk.tm} mb-1.5 block`}>New Time</Label>
                <Input type="time" value={rescheduleForm.new_time}
                  onChange={e => setRescheduleForm(f => ({ ...f, new_time: e.target.value }))}
                  className={`h-10 text-sm rounded-lg ${tk.input}`} />
              </div>
            </div>
            <div>
              <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Reason</Label>
              <Input value={rescheduleForm.reason}
                onChange={e => setRescheduleForm(f => ({ ...f, reason: e.target.value }))}
                className={`h-10 text-sm rounded-lg ${tk.input}`}
                placeholder="School holiday, Availability conflict…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRescheduleDialog({ open: false, plan: null, saving: false })}
              disabled={rescheduleDialog.saving} className={tk.tm}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={rescheduleDialog.saving}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-5">
              {rescheduleDialog.saving
                ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Saving…</>
                : <><RotateCcw className="h-3.5 w-3.5 mr-2" />Reschedule</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ HISTORY DIALOG ═════════════════════════════════════════════════ */}
      <Dialog open={historyDialog.open} onOpenChange={o => setHistoryDialog(d => ({ ...d, open: o }))}>
        <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-md rounded-2xl`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Reschedule History</DialogTitle>
            <DialogDescription className={tk.tm}>
              {historyDialog.plan?.school_name || historyDialog.plan?.lead_name}
              {' — '}{historyDialog.plan?.reschedule_count || 0} reschedule{historyDialog.plan?.reschedule_count !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 max-h-64 overflow-y-auto">
            {(historyDialog.plan?.reschedule_history || []).map((h, i) => (
              <div key={i} className={`rounded-xl p-3 text-sm ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f8fafc]'} border ${isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-amber-500 text-xs font-semibold">#{i + 1}</span>
                  <span className={`text-xs ${tk.tm}`}>{h.rescheduled_at?.slice(0, 10)} · {h.rescheduled_by}</span>
                </div>
                <p className={`text-xs ${tk.t2}`}>{h.old_date} {h.old_time} → <span className={`font-semibold ${tk.t1}`}>{h.new_date} {h.new_time}</span></p>
                {h.reason && <p className={`text-xs ${tk.tm} italic mt-1`}>"{h.reason}"</p>}
              </div>
            ))}
            {!(historyDialog.plan?.reschedule_history?.length) && (
              <p className={`text-sm text-center py-6 ${tk.tm}`}>No history recorded</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHistoryDialog({ open: false, plan: null })} className={tk.tm}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsAppSendDialog open={waOpen} onOpenChange={setWaOpen}
        module={waCtx.module} context={waCtx.context} title={waCtx.title} />

    </AdminLayout>
  );
}

// ── Visit Card ────────────────────────────────────────────────────────────────
function VisitCard({ plan, tk, isDark, today, onCheckIn, onOpenCheckout, onReschedule, onDelete, onHistory }) {
  const isOverdue = plan.visit_date < today && plan.status === 'planned';
  const statusCfg = STATUS_CFG[plan.status] || STATUS_CFG.planned;

  return (
    <div className={`${tk.card} border rounded-xl p-4 ${isOverdue ? '!border-[#e94560]/40' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">

        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f1f5f9]'
            }`}>
              <MapPin className="h-4 w-4 text-[#e94560]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`font-semibold text-sm ${tk.t1} truncate max-w-[200px] sm:max-w-none`}>
                  {plan.school_name || plan.lead_name || 'Visit'}
                </p>
                <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${statusCfg.cls}`}>
                  {statusCfg.label}
                </span>
                {isOverdue && (
                  <span className="flex items-center gap-1 text-[11px] text-[#e94560] font-medium">
                    <AlertTriangle className="h-3 w-3" />Overdue
                  </span>
                )}
              </div>

              <div className={`flex items-center gap-3 mt-1.5 text-xs ${tk.tm} flex-wrap`}>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {plan.visit_date}
                  {plan.visit_time && <span className="ml-1 font-medium">{fmtTime(plan.visit_time)}</span>}
                </span>
                {plan.assigned_name && <span className="flex items-center gap-1">· {plan.assigned_name}</span>}
                {plan.purpose && <span className="flex items-center gap-1">· {plan.purpose}</span>}
                {plan.work_type === 'wfh' && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-semibold">WFH</span>
                )}
              </div>

              {plan.planned_address && (
                <div className={`flex items-start gap-1.5 mt-1.5 text-xs ${tk.tm}`}>
                  <MapPin className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span className="break-all leading-snug">{plan.planned_address}</span>
                </div>
              )}

              {plan.visit_notes && (
                <p className={`text-xs ${tk.t2} mt-1.5 italic`}>"{plan.visit_notes}"</p>
              )}
              {plan.outcome && plan.outcome !== plan.visit_notes && (
                <p className="text-xs text-emerald-600 mt-1">Outcome: {plan.outcome}</p>
              )}
              {plan.reschedule_count > 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  Rescheduled {plan.reschedule_count}× · {plan.reschedule_reason || '—'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0">
          {plan.planned_lat && plan.planned_lng && (
            <Button size="sm" variant="ghost"
              onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${plan.planned_lat},${plan.planned_lng}`, '_blank')}
              className={`${tk.tm} h-8 px-2.5 text-xs rounded-lg`}>
              <Navigation className="h-3.5 w-3.5 mr-1" />Nav
            </Button>
          )}

          {plan.status === 'planned' && (
            <>
              <Button size="sm" onClick={() => onCheckIn(plan, 'field')}
                className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-3 text-xs rounded-lg">
                GPS In
              </Button>
              <Button size="sm" variant="outline" onClick={() => onCheckIn(plan, 'wfh')}
                className="border-violet-400/40 text-violet-500 hover:bg-violet-50 h-8 px-3 text-xs rounded-lg">
                WFH
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReschedule(plan)}
                className="border-amber-400/40 text-amber-500 hover:bg-amber-50 h-8 px-2.5 text-xs rounded-lg">
                <RotateCcw className="h-3 w-3 mr-1" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(plan.plan_id)}
                className="text-red-400 hover:text-red-500 hover:bg-red-50 h-8 w-8 p-0 rounded-lg">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {plan.status === 'in_progress' && (
            <>
              <Button size="sm" onClick={() => onOpenCheckout(plan)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3 text-xs rounded-lg">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Check Out
              </Button>
              <Button size="sm" variant="outline" onClick={() => onReschedule(plan)}
                className="border-amber-400/40 text-amber-500 hover:bg-amber-50 h-8 px-2.5 text-xs rounded-lg">
                <RotateCcw className="h-3 w-3 mr-1" />
              </Button>
            </>
          )}

          {plan.reschedule_count > 0 && (
            <Button size="sm" variant="ghost" onClick={onHistory}
              className={`${tk.tm} h-8 px-2.5 text-xs rounded-lg`}>
              <History className="h-3.5 w-3.5 mr-1" />{plan.reschedule_count}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
