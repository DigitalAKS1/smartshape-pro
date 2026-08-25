import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { dripSequences } from '../../lib/api';
import { X, Zap, Phone, MessageCircle, Mail, Truck } from 'lucide-react';

const STEP_ICON = { whatsapp: MessageCircle, email: Mail, physical_material: Truck, call_task: Phone };

// Start a marketing plan on selected schools — enrol each school's lead into a
// saved multi-channel sequence (Call / Mail / WhatsApp / Email). Steps land on
// each school's sales agent (Delegation + School Activity).
export default function SequenceEnrollDialog({ open, onClose, schoolIds = [], onDone }) {
  const [seqs, setSeqs] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPick('');
    dripSequences.getAll()
      .then(r => setSeqs((Array.isArray(r.data) ? r.data : []).filter(s => s.is_active !== false && (s.steps || []).length)))
      .catch(() => {});
  }, [open]);

  if (!open) return null;
  const chosen = seqs.find(s => s.sequence_id === pick);

  const enroll = async () => {
    if (!pick) { toast.error('Pick a sequence'); return; }
    setBusy(true);
    try {
      const r = await dripSequences.enrollSchools({ sequence_id: pick, school_ids: schoolIds });
      const d = r.data;
      toast.success(`Enrolled ${d.enrolled} school${d.enrolled === 1 ? '' : 's'} in "${d.sequence_name}"`
        + (d.skipped ? ` · ${d.skipped} already in it` : '')
        + (d.leads_created ? ` · ${d.leads_created} new lead(s)` : ''));
      onClose();
      onDone && onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Enrolment failed'); }
    finally { setBusy(false); }
  };

  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="sequence-enroll-dialog">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><Zap className="h-4 w-4 text-[#e94560]" /> Start Marketing Plan</h3>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Enrol <b className="text-[var(--text-secondary)]">{schoolIds.length}</b> selected school(s) into a saved sequence.
          Each Call / Mail / WhatsApp step lands on that school's sales agent.
        </p>

        <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Sequence</label>
        <select className={inp + ' mt-1'} value={pick} onChange={e => setPick(e.target.value)} data-testid="seq-pick">
          <option value="">Choose a sequence…</option>
          {seqs.map(s => <option key={s.sequence_id} value={s.sequence_id}>{s.name} ({(s.steps || []).length} steps)</option>)}
        </select>
        {seqs.length === 0 && (
          <p className="text-[11px] text-[var(--text-muted)] mt-1">No sequences yet — build one in Marketing → Drip first.</p>
        )}

        {chosen && (
          <div className="mt-3 rounded-lg border border-[var(--border-color)] p-2.5">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-2">Steps</p>
            <div className="space-y-1.5">
              {(chosen.steps || []).map((st, i) => {
                const Icon = STEP_ICON[st.message_type] || Zap;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span className="font-mono text-[10px] text-[var(--text-muted)] w-12">Day {st.delay_days ?? 0}</span>
                    <span className="capitalize">{(st.message_type || '').replace('_', ' ')}{st.material_name ? ` — ${st.material_name}` : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button className="mt-4 h-10 w-full rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={busy || !pick} onClick={enroll} data-testid="seq-enroll-submit">
          <Zap className="h-4 w-4" /> {busy ? 'Enrolling…' : `Start plan for ${schoolIds.length} school(s)`}
        </button>
      </div>
    </div>
  );
}
