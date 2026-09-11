import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { dripSequences as dripApi } from '../../lib/api';

// One picker for everyone at the school a sequence can reach: its deals (leads)
// and its people (contacts). A contact is enrolled directly — no lead is made
// for it. The option value carries the kind so the right id is sent.
const leadLabel = (l) => `${l.contact_name || l.company_name || 'Unnamed'} — Lead · ${l.stage || 'no stage'}`;
const contactLabel = (c) => `${c.name || 'Unnamed'} — Contact · ${c.designation || 'no designation'}`;

export default function EnrollDripDialog({ open, onOpenChange, leads = [], contacts = [], onDone }) {
  const [sequences, setSequences] = useState([]);
  const [pick, setPick] = useState('');
  const [seqId, setSeqId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const liveLeads = (leads || []).filter(l => l && l.lead_id && !l.is_deleted);
  const liveContacts = (contacts || []).filter(c => c && c.contact_id && !c.is_deleted);

  useEffect(() => {
    if (!open) return;
    setPick('');
    dripApi.getAll().then(r => setSequences((r.data || []).filter(s => s.is_active))).catch(() => {});
  }, [open]);

  const submit = async () => {
    if (!pick || !seqId) { toast.error('Pick a person and a sequence'); return; }
    const cut = pick.indexOf(':');
    const kind = pick.slice(0, cut);
    const id = pick.slice(cut + 1);
    setSaving(true);
    try {
      await dripApi.enroll(kind === 'contact'
        ? { contact_id: id, sequence_id: seqId }
        : { lead_id: id, sequence_id: seqId });
      toast.success(kind === 'contact' ? 'Contact enrolled in drip' : 'Lead enrolled in drip');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Enroll failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Enroll in Drip</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className={`${textSec} text-xs`}>Lead or contact</Label>
            <select value={pick} onChange={e => setPick(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="enroll-lead">
              <option value="">Select a lead or contact</option>
              {liveLeads.length > 0 && (
                <optgroup label="Leads">
                  {liveLeads.map(l => <option key={`lead:${l.lead_id}`} value={`lead:${l.lead_id}`}>{leadLabel(l)}</option>)}
                </optgroup>
              )}
              {liveContacts.length > 0 && (
                <optgroup label="Contacts">
                  {liveContacts.map(c => <option key={`contact:${c.contact_id}`} value={`contact:${c.contact_id}`}>{contactLabel(c)}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Sequence</Label>
            <select value={seqId} onChange={e => setSeqId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="enroll-seq">
              <option value="">Select a sequence</option>
              {sequences.map(s => <option key={s.sequence_id} value={s.sequence_id}>{s.name} ({(s.steps || []).length} steps)</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="enroll-submit">{saving ? 'Enrolling…' : 'Enroll'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
