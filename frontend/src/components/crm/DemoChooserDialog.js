import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { leads as leadsApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Physical-vs-Online workshop chooser + scheduling form.
 * onDone(updatedLead) is called after a successful schedule.
 */
export default function DemoChooserDialog({ open, onOpenChange, lead, onDone }) {
  const { isDark } = useTheme();
  const [format, setFormat] = useState('physical');
  const [form, setForm] = useState({ demo_date: '', demo_time: '', address: '', demo_link: '', purpose: '' });
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const dlg = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!form.demo_date || !form.demo_time) { toast.error('Pick a date and time'); return; }
    if (format === 'online' && !form.demo_link) { toast.error('Add a meeting link'); return; }
    setSaving(true);
    try {
      const r = await leadsApi.scheduleDemo(lead.lead_id, { format, ...form });
      toast.success(format === 'physical' ? 'Demo planned — visit added to the planning sheet' : 'Online demo scheduled — link sent');
      onOpenChange(false);
      onDone && onDone(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to schedule demo');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlg} w-[calc(100vw-1rem)] sm:max-w-md`}>
        <DialogHeader><DialogTitle>Plan Demo / Workshop</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            {['physical', 'online'].map(f => (
              <button key={f} onClick={() => setFormat(f)}
                className={`py-2 rounded-md text-sm font-medium border capitalize ${format === f ? 'bg-[#e94560] text-white border-transparent' : `${textSec} border-[var(--border-color)]`}`}
                data-testid={`demo-format-${f}`}>
                {f === 'physical' ? 'Physical workshop' : 'Online workshop'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Date</Label><Input type="date" value={form.demo_date} onChange={e => setForm({ ...form, demo_date: e.target.value })} className={inputCls} data-testid="demo-date" /></div>
            <div><Label className={`${textSec} text-xs`}>Time</Label><Input type="time" value={form.demo_time} onChange={e => setForm({ ...form, demo_time: e.target.value })} className={inputCls} data-testid="demo-time" /></div>
          </div>
          {format === 'physical' ? (
            <>
              <div><Label className={`${textSec} text-xs`}>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Where is the workshop?" className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Purpose</Label><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Robotics kit demo" className={inputCls} /></div>
            </>
          ) : (
            <div><Label className={`${textSec} text-xs`}>Meeting link</Label><Input value={form.demo_link} onChange={e => setForm({ ...form, demo_link: e.target.value })} placeholder="https://meet..." className={inputCls} data-testid="demo-link" /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="demo-submit">
            {saving ? 'Scheduling…' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
