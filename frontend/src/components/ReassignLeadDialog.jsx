import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { leads as leadsApi, salesPersons as spApi } from '../lib/api';
import { toast } from 'sonner';
import { UserCog, AlertTriangle } from 'lucide-react';

/**
 * Props:
 *  - open, onOpenChange
 *  - lead: the lead object (for single) OR null
 *  - leadIds: array of lead_ids for bulk (overrides lead if set)
 *  - onSuccess: () => void
 */
export default function ReassignLeadDialog({ open, onOpenChange, lead, leadIds, onSuccess }) {
  const [spList, setSpList] = useState([]);
  const [agentEmail, setAgentEmail] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const isBulk = Array.isArray(leadIds) && leadIds.length > 0;
  const count = isBulk ? leadIds.length : 1;
  const reassignedCount = lead?.reassignment_count || 0;

  useEffect(() => {
    if (!open) return;
    setAgentEmail(''); setReason('');
    spApi.getAll().then((r) => setSpList(r.data || [])).catch(() => setSpList([]));
  }, [open]);

  const handleSubmit = async () => {
    if (!agentEmail) { toast.error('Please select an agent'); return; }
    if (!reason.trim()) { toast.error('Reason is mandatory'); return; }
    const sp = spList.find((s) => s.email === agentEmail);
    setSaving(true);
    try {
      if (isBulk) {
        const res = await leadsApi.bulkAssign({ lead_ids: leadIds, new_agent_email: agentEmail, new_agent_name: sp?.name || '', reason });
        toast.success(`${res.data.assigned} lead(s) reassigned`);
      } else {
        await leadsApi.reassign({ lead_id: lead.lead_id, new_agent_email: agentEmail, new_agent_name: sp?.name || '', reason });
        toast.success('Lead reassigned');
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Reassign failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] max-w-md" data-testid="reassign-lead-dialog">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
            <UserCog className="h-5 w-5 text-[#e94560]" /> {isBulk ? `Bulk Reassign (${count} leads)` : 'Reassign Lead'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {!isBulk && reassignedCount > 2 && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2" data-testid="reassign-warning">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-400">
                This lead has been reassigned <b>{reassignedCount} times</b> already. Frequent handoffs hurt conversion — please confirm the reason is genuine.
              </div>
            </div>
          )}
          {!isBulk && lead && (
            <div className="text-xs text-[var(--text-muted)]">
              Currently with: <b className="text-[var(--text-secondary)]">{lead.assigned_name || 'Unassigned'}</b>
            </div>
          )}
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">New Agent *</Label>
            <select
              value={agentEmail}
              onChange={(e) => setAgentEmail(e.target.value)}
              className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm"
              data-testid="reassign-agent-select"
            >
              <option value="">Select agent</option>
              {spList.map((sp) => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Reason * (mandatory)</Label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm"
              placeholder="e.g. Regional mismatch, agent on leave, better domain expertise..."
              data-testid="reassign-reason-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="reassign-submit-btn">
            {saving ? 'Reassigning...' : 'Reassign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
