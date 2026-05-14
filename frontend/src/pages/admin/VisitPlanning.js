import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { visitPlans, leads as leadsApi, salesPersons } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Plus, MapPin, Calendar, CheckCircle, Clock, AlertTriangle, Trash2, Edit2 } from 'lucide-react';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

export default function VisitPlanning() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [plans, setPlans] = useState([]);
  const [leadsList, setLeadsList] = useState([]);
  const [spList, setSpList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ lead_id: '', school_name: '', lead_name: '', assigned_to: '', assigned_name: '', visit_date: '', visit_time: '', purpose: '' });
  // FMS Phase 4: WhatsApp auto-popup after visit check-out
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx] = useState({ module: 'visit', context: {}, title: 'Send WhatsApp' });

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  const fetchData = async () => {
    try {
      const [pr, lr, spr] = await Promise.all([visitPlans.getAll(), leadsApi.getAll(), salesPersons.getAll()]);
      setPlans(pr.data); setLeadsList(lr.data); setSpList(spr.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setForm({ lead_id: '', school_name: '', lead_name: '', assigned_to: user?.email || '', assigned_name: user?.name || '', visit_date: '', visit_time: '', purpose: '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.visit_date) { toast.error('Visit date required'); return; }
    try {
      const sp = spList.find(s => s.email === form.assigned_to);
      await visitPlans.create({ ...form, assigned_name: sp?.name || form.assigned_name });
      toast.success('Visit planned');
      setDialogOpen(false); fetchData();
    } catch { toast.error('Failed'); }
  };

  const updateStatus = async (planId, status, extra = {}) => {
    try {
      await visitPlans.update(planId, { status, ...extra });
      toast.success(`Visit ${status}`);
      fetchData();
    } catch { toast.error('Failed'); }
  };

  // FMS Phase 3: GPS check-in / WFH check-in
  const handleCheckIn = async (plan, workType) => {
    try {
      if (workType === 'wfh') {
        await visitPlans.checkIn(plan.plan_id, { work_type: 'wfh' });
        toast.success('WFH check-in recorded');
        fetchData();
        return;
      }
      if (!navigator.geolocation) {
        toast.error('GPS not supported by this browser');
        return;
      }
      toast.info('Capturing GPS...');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          await visitPlans.checkIn(plan.plan_id, {
            work_type: 'field',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          toast.success('Field check-in successful');
          fetchData();
        } catch (e) {
          toast.error(e?.response?.data?.detail || 'Check-in failed');
        }
      }, (err) => {
        toast.error(`GPS denied: ${err.message}`);
      }, { enableHighAccuracy: true, timeout: 10000 });
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Check-in failed');
    }
  };

  const handleCheckOut = async (plan) => {
    const notes = window.prompt('Visit notes/outcome (optional):') || '';
    const outcome = notes;
    const isField = (plan.work_type || 'field') === 'field';
    const finish = async (lat, lng) => {
      try {
        await visitPlans.checkOut(plan.plan_id, {
          visit_notes: notes,
          outcome,
          ...(lat !== undefined ? { lat, lng } : {}),
        });
        toast.success('Checked out');
        fetchData();
        // FMS Phase 4: auto-popup WhatsApp after visit check-out
        setTimeout(() => {
          if (window.confirm('Send a WhatsApp follow-up message for this visit?')) {
            const lead = leadsList.find(l => l.lead_id === plan.lead_id);
            setWaCtx({
              module: 'visit',
              title: `WhatsApp follow-up - ${plan.school_name || 'Visit'}`,
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
        }, 200);
      } catch (e) {
        toast.error(e?.response?.data?.detail || 'Check-out failed');
      }
    };
    if (isField && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish(pos.coords.latitude, pos.coords.longitude),
        () => finish(undefined, undefined),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      finish(undefined, undefined);
    }
  };

  const handleDelete = async (planId) => {
    await visitPlans.delete(planId); toast.success('Deleted'); fetchData();
  };

  const filtered = filter === 'all' ? plans : plans.filter(p => p.status === filter);
  const today = new Date().toISOString().split('T')[0];
  const todayPlans = plans.filter(p => p.visit_date === today);
  const upcoming = plans.filter(p => p.visit_date > today && p.status === 'planned');

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="visit-planning-title">Visit Planning</h1>
            <p className={`${textSec} mt-1 text-sm`}>{plans.length} visits planned, {todayPlans.length} today</p>
          </div>
          <Button onClick={openCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="plan-visit-btn">
            <Plus className="mr-1 h-3 w-3" /> Plan Visit
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`${card} border rounded-md p-4`}><Calendar className="h-5 w-5 text-[#e94560] mb-2" /><div className={`text-2xl font-mono font-bold ${textPri}`}>{todayPlans.length}</div><p className={`text-xs ${textMuted}`}>Today</p></div>
          <div className={`${card} border rounded-md p-4`}><Clock className="h-5 w-5 text-blue-400 mb-2" /><div className={`text-2xl font-mono font-bold ${textPri}`}>{upcoming.length}</div><p className={`text-xs ${textMuted}`}>Upcoming</p></div>
          <div className={`${card} border rounded-md p-4`}><CheckCircle className="h-5 w-5 text-green-400 mb-2" /><div className={`text-2xl font-mono font-bold ${textPri}`}>{plans.filter(p => p.status === 'completed').length}</div><p className={`text-xs ${textMuted}`}>Completed</p></div>
          <div className={`${card} border rounded-md p-4`}><AlertTriangle className="h-5 w-5 text-red-400 mb-2" /><div className={`text-2xl font-mono font-bold ${textPri}`}>{plans.filter(p => p.status === 'cancelled').length}</div><p className={`text-xs ${textMuted}`}>Cancelled</p></div>
        </div>

        {/* Filter */}
        <div className="flex gap-1 flex-wrap">
          {['all', 'planned', 'in_progress', 'completed', 'cancelled'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${filter === f ? 'bg-[#e94560] text-white' : `${card} border ${textSec}`}`}
              data-testid={`visit-filter-${f}`}>{f.replace('_', ' ')} ({f === 'all' ? plans.length : plans.filter(p => p.status === f).length})
            </button>
          ))}
        </div>

        {/* Visit List */}
        <div className="space-y-2" data-testid="visit-plans-list">
          {filtered.length === 0 ? (
            <div className={`${card} border rounded-md p-12 text-center`}>
              <MapPin className={`h-12 w-12 ${textMuted} mx-auto mb-3`} /><p className={textMuted}>No visits found</p>
            </div>
          ) : filtered.map(plan => {
            const isPast = plan.visit_date < today && plan.status === 'planned';
            return (
              <div key={plan.plan_id} className={`${card} border rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isPast ? '!border-red-500/40' : ''}`} data-testid={`visit-${plan.plan_id}`}>
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-10 h-10 rounded-md ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f0f0f5]'} flex items-center justify-center flex-shrink-0`}>
                    <MapPin className="h-5 w-5 text-[#e94560]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`${textPri} font-medium`}>{plan.school_name || plan.lead_name || 'Visit'}</p>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        plan.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        plan.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                        plan.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{plan.status.replace('_', ' ')}</span>
                      {isPast && <span className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                    </div>
                    <div className={`flex items-center gap-3 mt-1 text-xs ${textMuted} flex-wrap`}>
                      <span>{plan.visit_date} {plan.visit_time}</span>
                      <span>{plan.assigned_name}</span>
                      {plan.purpose && <span>| {plan.purpose}</span>}
                    </div>
                    {plan.visit_notes && <p className={`text-xs ${textSec} mt-1`}>Notes: {plan.visit_notes}</p>}
                    {plan.outcome && <p className="text-xs text-green-400 mt-1">Outcome: {plan.outcome}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {plan.status === 'planned' && (
                    <>
                      <Button size="sm" onClick={() => handleCheckIn(plan, 'field')} className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs" data-testid={`checkin-${plan.plan_id}`}>GPS Check-In</Button>
                      <Button size="sm" variant="outline" onClick={() => handleCheckIn(plan, 'wfh')} className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10 h-7 text-xs" data-testid={`checkin-wfh-${plan.plan_id}`}>WFH</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(plan.plan_id)} className="text-red-400 h-7"><Trash2 className="h-3 w-3" /></Button>
                    </>
                  )}
                  {plan.status === 'in_progress' && (
                    <Button size="sm" onClick={() => handleCheckOut(plan)} className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs" data-testid={`checkout-${plan.plan_id}`}>Check Out</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Plan Visit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Plan Visit</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className={`${textSec} text-xs`}>Link to Lead</Label>
                <select value={form.lead_id} onChange={e => {
                  const lead = leadsList.find(l => l.lead_id === e.target.value);
                  setForm({ ...form, lead_id: e.target.value, lead_name: lead?.company_name || '', school_name: lead?.company_name || '', school_id: lead?.school_id || '' });
                }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="visit-lead-select">
                  <option value="">Select lead (optional)</option>
                  {leadsList.map(l => <option key={l.lead_id} value={l.lead_id}>{l.company_name || l.contact_name} ({l.stage})</option>)}
                </select>
              </div>
              {!form.lead_id && (
                <div><Label className={`${textSec} text-xs`}>School/Location Name</Label><Input value={form.school_name} onChange={e => setForm({...form, school_name: e.target.value})} className={inputCls} placeholder="Enter school name" /></div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Visit Date *</Label><Input type="date" value={form.visit_date} onChange={e => setForm({...form, visit_date: e.target.value})} className={inputCls} data-testid="visit-date-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Time</Label><Input type="time" value={form.visit_time} onChange={e => setForm({...form, visit_time: e.target.value})} className={inputCls} /></div>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Assign To</Label>
                <select value={form.assigned_to} onChange={e => { const sp = spList.find(s => s.email === e.target.value); setForm({...form, assigned_to: e.target.value, assigned_name: sp?.name || ''}); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="">Select</option>{spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
                </select>
              </div>
              <div><Label className={`${textSec} text-xs`}>Purpose</Label><Input value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} className={inputCls} placeholder="e.g. Demo, Follow-up, Delivery" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={handleSave} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-visit-btn">Plan Visit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <WhatsAppSendDialog open={waOpen} onOpenChange={setWaOpen} module={waCtx.module} context={waCtx.context} title={waCtx.title} />
      </div>
    </AdminLayout>
  );
}
