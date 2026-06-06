import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { contacts as contactsApi } from '../../lib/api';

const DEFAULT_INTRO = 'Hi {name}, thank you for your interest in SmartShape. Our team will reach out shortly!';

export default function ConvertContactDialog({ open, onOpenChange, contact, spList = [], onDone }) {
  const [saving, setSaving] = useState(false);
  const [leadType, setLeadType] = useState('warm');
  const [assignedTo, setAssignedTo] = useState('');
  const [sendIntro, setSendIntro] = useState(true);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      const message = sendIntro
        ? intro.replace('{name}', (contact.name || '').split(' ')[0] || 'there')
        : '';
      await contactsApi.convertToLead(contact.contact_id, {
        lead_type: leadType, priority: 'medium',
        assigned_to: assignedTo || undefined,
        intro_message: message,
      });
      toast.success(sendIntro ? 'Converted to lead — intro sent' : 'Converted to lead');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Convert failed');
    } finally { setSaving(false); }
  };

  if (!contact) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Convert to Lead — {contact.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Lead Type</Label>
              <select value={leadType} onChange={e => setLeadType(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Assign To</Label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Me / default</option>
                {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={sendIntro} onChange={e => setSendIntro(e.target.checked)} data-testid="send-intro-toggle" />
            Send intro WhatsApp to {contact.phone || 'contact'}
          </label>
          {sendIntro && (
            <div>
              <Label className={`${textSec} text-xs`}>Intro message</Label>
              <textarea value={intro} onChange={e => setIntro(e.target.value)} rows={3}
                className={`w-full px-3 py-2 rounded-md text-sm resize-none border ${inputCls}`} />
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{'{name}'} is replaced with the contact's first name.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="convert-submit">{saving ? 'Converting…' : 'Convert'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
