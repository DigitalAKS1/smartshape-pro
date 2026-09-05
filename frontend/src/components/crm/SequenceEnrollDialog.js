import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { dripSequences } from '../../lib/api';
import { X, Zap, Phone, MessageCircle, Mail, Truck, Plus, Trash2, Copy } from 'lucide-react';

const STEP_ICON = { whatsapp: MessageCircle, email: Mail, physical_material: Truck, call_task: Phone };

const CHANNELS = [
  { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'email', label: 'Email' },
  { v: 'physical_material', label: 'Post something' },
  { v: 'call_task', label: 'Call task (for the rep)' },
];

const BLANK_STEP = { delay_days: 0, message_type: 'whatsapp', message_template: '', material_type: 'brochure', material_name: '' };

// Start a marketing plan on selected schools — enrol each school's lead into a
// saved multi-channel sequence (Call / Mail / WhatsApp / Email), or build a new
// one right here when none of the saved plans fit. Steps land on each school's
// sales agent (Delegation + School Activity).
export default function SequenceEnrollDialog({ open, onClose, schoolIds = [], onDone }) {
  const [seqs, setSeqs] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('existing');            // 'existing' | 'new'
  const [form, setForm] = useState({ name: '', steps: [{ ...BLANK_STEP }] });

  useEffect(() => {
    if (!open) return;
    setPick(''); setMode('existing');
    setForm({ name: '', steps: [{ ...BLANK_STEP }] });
    dripSequences.getAll()
      .then(r => setSeqs((Array.isArray(r.data) ? r.data : []).filter(s => s.is_active !== false && (s.steps || []).length)))
      .catch(() => {});
  }, [open]);

  if (!open) return null;
  const chosen = seqs.find(s => s.sequence_id === pick);

  const setStep = (i, patch) =>
    setForm(f => ({ ...f, steps: f.steps.map((s, ii) => ii === i ? { ...s, ...patch } : s) }));
  const addStep = () => setForm(f => {
    const last = f.steps[f.steps.length - 1];
    return { ...f, steps: [...f.steps, { ...BLANK_STEP, delay_days: (Number(last?.delay_days) || 0) + 3 }] };
  });
  const removeStep = (i) => setForm(f => ({ ...f, steps: f.steps.filter((_, ii) => ii !== i) }));

  // Copy a saved plan as the starting point — most new plans are a variant of one
  // that already works, not a blank page.
  const copyFrom = (sequence_id) => {
    const src = seqs.find(s => s.sequence_id === sequence_id);
    if (!src) return;
    setForm({
      name: `${src.name} (copy)`,
      steps: (src.steps || []).map(s => ({
        delay_days: s.delay_days ?? 0,
        message_type: s.message_type || 'whatsapp',
        message_template: s.message_template || '',
        material_type: s.material_type || 'brochure',
        material_name: s.material_name || '',
      })),
    });
  };

  const enrollInto = async (sequence_id) => {
    const r = await dripSequences.enrollSchools({ sequence_id, school_ids: schoolIds });
    const d = r.data;
    toast.success(`Enrolled ${d.enrolled} school${d.enrolled === 1 ? '' : 's'} in "${d.sequence_name}"`
      + (d.skipped ? ` · ${d.skipped} already in it` : '')
      + (d.leads_created ? ` · ${d.leads_created} new lead(s)` : ''));
    // Step 1 goes out in the background. Say where to look for it — otherwise
    // Offline Mail just sits there empty and the plan looks like it did nothing.
    if (d.starting_now) {
      toast('Step 1 is going out now', {
        description: "Anything to be posted appears in Offline Mail → Today's Post in a moment.",
      });
    }
    onClose();
    onDone && onDone();
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'new') {
        if (!form.name.trim()) { toast.error('Give the plan a name'); return; }
        // A step with nothing in it would enrol schools into silence.
        const steps = form.steps.filter(s =>
          s.message_type === 'physical_material'
            ? (s.material_name || '').trim() || (s.message_template || '').trim()
            : (s.message_template || '').trim());
        if (!steps.length) { toast.error('Add at least one step with something in it'); return; }
        const created = await dripSequences.create({
          name: form.name.trim(),
          description: 'Created from the Schools tab',
          trigger: 'manual',
          is_active: true,
          steps: steps.map(s => ({
            delay_days: parseInt(s.delay_days) || 0,
            message_type: s.message_type,
            message_template: s.message_template || '',
            ...(s.message_type === 'physical_material'
              ? { material_type: s.material_type || 'brochure', material_name: (s.material_name || '').trim() }
              : {}),
          })),
        });
        await enrollInto(created.data.sequence_id);
      } else {
        if (!pick) { toast.error('Pick a plan'); return; }
        await enrollInto(pick);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || (mode === 'new' ? 'Could not create the plan' : 'Enrolment failed'));
    } finally { setBusy(false); }
  };

  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const sm = 'h-9 rounded-lg px-2 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const tab = (k, label) => (
    <button key={k} onClick={() => setMode(k)} data-testid={`seq-mode-${k}`}
      className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${mode === k ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="sequence-enroll-dialog">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><Zap className="h-4 w-4 text-[#e94560]" /> Start Marketing Plan</h3>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Enrol <b className="text-[var(--text-secondary)]">{schoolIds.length}</b> selected school(s).
          Each Call / Post / WhatsApp step lands on that school's sales agent.
        </p>

        <div className="flex items-center gap-1 mb-3">
          {tab('existing', 'Use a saved plan')}
          {tab('new', 'Build a new one')}
        </div>

        {mode === 'existing' ? (
          <>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Plan</label>
            <select className={inp + ' mt-1'} value={pick} onChange={e => setPick(e.target.value)} data-testid="seq-pick">
              <option value="">Choose a plan…</option>
              {seqs.map(s => <option key={s.sequence_id} value={s.sequence_id}>{s.name} ({(s.steps || []).length} steps)</option>)}
            </select>
            {seqs.length === 0 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1">No saved plans yet — switch to <b>Build a new one</b>.</p>
            )}

            {chosen && (
              <div className="mt-3 rounded-lg border border-[var(--border-color)] p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Steps</p>
                  <button onClick={() => { copyFrom(pick); setMode('new'); }} data-testid="seq-copy"
                    className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[#e94560] inline-flex items-center gap-1">
                    <Copy className="h-3 w-3" /> Copy &amp; edit
                  </button>
                </div>
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
          </>
        ) : (
          <>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Plan name</label>
            <input className={inp + ' mt-1'} placeholder="e.g. CBSE catalogue drop"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              data-testid="seq-new-name" />

            {seqs.length > 0 && (
              <select className={sm + ' w-full mt-2'} defaultValue="" data-testid="seq-copy-from"
                onChange={e => { if (e.target.value) copyFrom(e.target.value); e.target.value = ''; }}>
                <option value="">Start from a saved plan…</option>
                {seqs.map(s => <option key={s.sequence_id} value={s.sequence_id}>{s.name}</option>)}
              </select>
            )}

            <div className="mt-3 space-y-2">
              {form.steps.map((s, i) => {
                const isPost = s.message_type === 'physical_material';
                const isCall = s.message_type === 'call_task';
                return (
                  <div key={i} className="rounded-lg border border-[var(--border-color)] p-2.5" data-testid={`seq-step-${i}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[var(--text-muted)] w-7">#{i + 1}</span>
                      <select className={sm + ' flex-1 min-w-0'} value={s.message_type}
                        onChange={e => setStep(i, { message_type: e.target.value })}
                        data-testid={`seq-step-channel-${i}`}>
                        {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                      </select>
                      <span className="text-[11px] text-[var(--text-muted)]">Day</span>
                      <input className={sm + ' w-14 text-center'} inputMode="numeric" value={s.delay_days}
                        onChange={e => setStep(i, { delay_days: e.target.value.replace(/\D/g, '') })}
                        data-testid={`seq-step-day-${i}`} />
                      {form.steps.length > 1 && (
                        <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-500 p-1"
                          data-testid={`seq-step-remove-${i}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                    {isPost ? (
                      <input className={sm + ' w-full mt-2'} placeholder="What are you posting? e.g. 2026 Die Catalogue"
                        value={s.material_name} onChange={e => setStep(i, { material_name: e.target.value })}
                        data-testid={`seq-step-material-${i}`} />
                    ) : (
                      <textarea className={sm + ' w-full mt-2 h-auto py-2 resize-y'} rows={2}
                        placeholder={isCall ? 'What should the rep do on this call?' : 'Message — {name} and {school_name} are filled in'}
                        value={s.message_template} onChange={e => setStep(i, { message_template: e.target.value })}
                        data-testid={`seq-step-text-${i}`} />
                    )}
                  </div>
                );
              })}
            </div>

            <button onClick={addStep} data-testid="seq-add-step"
              className="mt-2 h-9 w-full rounded-lg border border-dashed border-[var(--border-color)] text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] inline-flex items-center justify-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add a step
            </button>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">
              A <b>Post</b> step creates a printable, QR-tracked mailer in Offline Mail on the day it fires.
              Post and call steps need no WhatsApp opt-in.
            </p>
          </>
        )}

        <button className="mt-4 h-10 w-full rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={busy || (mode === 'existing' ? !pick : !form.name.trim())} onClick={submit} data-testid="seq-enroll-submit">
          <Zap className="h-4 w-4" />
          {busy ? 'Working…' : mode === 'new'
            ? `Create & start for ${schoolIds.length} school(s)`
            : `Start plan for ${schoolIds.length} school(s)`}
        </button>
      </div>
    </div>
  );
}
