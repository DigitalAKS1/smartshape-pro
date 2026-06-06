import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';
import { visitPlans as visitPlansApi } from '../../lib/api';

/**
 * "Plan Visit" button for the School Profile. Creates a visit_plan linked to the
 * school (and shows in the central Visit Planning sheet). onDone refreshes the profile.
 */
export default function PlanVisitButton({ school, onDone }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ visit_date: '', visit_time: '', purpose: '', planned_address: '' });
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const submit = async () => {
    if (!form.visit_date || !form.visit_time) { toast.error('Pick a date and time'); return; }
    setSaving(true);
    try {
      await visitPlansApi.create({
        school_id: school.school_id,
        school_name: school.school_name,
        contact_person: school.primary_contact_name || '',
        contact_phone: school.phone || '',
        purpose: form.purpose || 'School visit',
        visit_date: form.visit_date, visit_time: form.visit_time,
        planned_address: form.planned_address || school.address || '',
      });
      toast.success('Visit planned — added to the Visit Planning sheet');
      setOpen(false);
      setForm({ visit_date: '', visit_time: '', purpose: '', planned_address: '' });
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to plan visit');
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="plan-visit-btn">
        <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Plan Visit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Plan Visit — {school.school_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[var(--text-secondary)] text-xs">Date</Label><Input type="date" value={form.visit_date} onChange={e => setForm({ ...form, visit_date: e.target.value })} className={inputCls} data-testid="visit-date" /></div>
              <div><Label className="text-[var(--text-secondary)] text-xs">Time</Label><Input type="time" value={form.visit_time} onChange={e => setForm({ ...form, visit_time: e.target.value })} className={inputCls} data-testid="visit-time" /></div>
            </div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Purpose</Label><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="Reason for the visit" className={inputCls} /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Address</Label><Input value={form.planned_address} onChange={e => setForm({ ...form, planned_address: e.target.value })} placeholder="Defaults to school address" className={inputCls} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="visit-submit">{saving ? 'Saving…' : 'Plan Visit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
