import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { dripSequences as dripApi } from '../../lib/api';

export default function EnrollDripDialog({ open, onOpenChange, leads = [], onDone }) {
  const [sequences, setSequences] = useState([]);
  const [leadId, setLeadId] = useState('');
  const [seqId, setSeqId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  useEffect(() => {
    if (!open) return;
    dripApi.getAll().then(r => setSequences((r.data || []).filter(s => s.is_active))).catch(() => {});
  }, [open]);

  const submit = async () => {
    if (!leadId || !seqId) { toast.error('Pick a lead and a sequence'); return; }
    setSaving(true);
    try {
      await dripApi.enroll({ lead_id: leadId, sequence_id: seqId });
      toast.success('Lead enrolled in drip');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Enroll failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Enroll Lead in Drip</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className={`${textSec} text-xs`}>Lead</Label>
            <select value={leadId} onChange={e => setLeadId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="enroll-lead">
              <option value="">Select a lead</option>
              {leads.map(l => <option key={l.lead_id} value={l.lead_id}>{l.contact_name} · {l.stage}</option>)}
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
