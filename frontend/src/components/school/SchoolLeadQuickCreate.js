import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { leads as leadsApi } from '../../lib/api';

export default function SchoolLeadQuickCreate({ open, onOpenChange, school, rolesList = [], sourcesList = [], spList = [], onDone }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', contact_email: '',
    contact_role_id: '', designation: '', lead_type: 'warm', priority: 'medium',
    interested_product: '', assigned_to: '', source_id: '', source: '',
  });
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!form.contact_name.trim() || !form.contact_phone.trim()) { toast.error('Contact name and phone required'); return; }
    setSaving(true);
    try {
      const sp = spList.find(s => s.email === form.assigned_to);
      await leadsApi.create({
        ...form,
        school_id: school.school_id,
        company_name: school.school_name,
        assigned_name: sp ? sp.name : '',
      });
      toast.success('Lead created');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to create lead');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Lead — {school.school_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Contact Name *</Label><Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className={inputCls} data-testid="ql-name" /></div>
            <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className={inputCls} data-testid="ql-phone" /></div>
          </div>
          <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className={inputCls} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Role</Label>
              <select value={form.contact_role_id} onChange={e => { const r = rolesList.find(x => x.role_id === e.target.value); setForm({ ...form, contact_role_id: e.target.value, designation: r?.name || form.designation }); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Select role</option>
                {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Source</Label>
              <select value={form.source_id} onChange={e => { const s = sourcesList.find(x => x.source_id === e.target.value); setForm({ ...form, source_id: e.target.value, source: s?.name || '' }); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Select source</option>
                {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Type</Label>
              <select value={form.lead_type} onChange={e => setForm({ ...form, lead_type: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Priority</Label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Assign To</Label>
              <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Unassigned</option>
                {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>
          </div>
          <div><Label className={`${textSec} text-xs`}>Interested Product</Label><Input value={form.interested_product} onChange={e => setForm({ ...form, interested_product: e.target.value })} className={inputCls} placeholder="e.g. Robotics kit" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="ql-submit">{saving ? 'Creating…' : 'Create Lead'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
