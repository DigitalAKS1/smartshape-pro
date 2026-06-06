import React, { useState } from 'react';
import {
  Zap, Plus, ChevronDown, Pencil, Trash2, Paperclip,
  RefreshCw, X, Upload, Loader2, FileText, Check, ChevronRight,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import RichMessageEditor from '../RichMessageEditor';
import { dripSequences as dripApi, whatsApp as waApi } from '../../lib/api';
import { mapSeq } from '../../lib/marketingUtils';

const BLANK_FORM = { name: '', description: '', trigger: 'lead_created', filter_designation: '', steps: [{ message_type: 'whatsapp', message_template: '', delay_days: 0, attachment_id: null, material_type: 'brochure' }] };

export default function DripsTab({ tk, drips, setDrips }) {
  const [expanded, setExpanded]     = useState(null);
  const [showCreate, setShowCreate]  = useState(false);
  const [editingSeq, setEditingSeq]  = useState(null);
  const [deleteSeq, setDeleteSeq]    = useState(null);
  const [deleting, setDeleting]      = useState(false);
  const [form, setForm]              = useState(BLANK_FORM);
  const [saving, setSaving]          = useState(false);
  const [attachments, setAttachments]      = useState([]);
  const [pickingFor, setPickingFor]        = useState(null);
  const [loadingAttach, setLoadingAttach]  = useState(false);
  const [uploadingAttach, setUploadingAttach] = useState(false);

  async function toggle(d) {
    try {
      await dripApi.update(d.sequence_id, { is_active: !d.active });
      setDrips(prev => prev.map(x => x.id === d.id ? { ...x, active: !x.active } : x));
    } catch {
      toast.error('Failed to update sequence');
    }
  }

  function addStep() {
    const nextDay = form.steps.length === 0 ? 0 : (parseInt(form.steps[form.steps.length - 1].delay_days) || 0) + 3;
    setForm(p => ({ ...p, steps: [...p.steps, { message_type: 'whatsapp', message_template: '', delay_days: nextDay, attachment_id: null, material_type: 'brochure' }] }));
  }

  function removeStep(i) {
    setForm(p => ({ ...p, steps: p.steps.filter((_, ii) => ii !== i) }));
  }

  function closeDialog() {
    setShowCreate(false);
    setEditingSeq(null);
    setForm(BLANK_FORM);
  }

  function startEdit(d) {
    setForm({
      name: d.name,
      description: d.description || '',
      trigger: d.trigger_raw || 'lead_created',
      filter_designation: d.filter_designation || '',
      steps: d.steps.map(s => ({
        message_type: s.message_type || 'whatsapp',
        message_template: s.message_template || '',
        delay_days: s.delay_days,
        attachment_id: s.attachment_id || null,
        material_type: s.material_type || 'brochure',
      })),
    });
    setEditingSeq(d);
    setShowCreate(true);
  }

  async function openAttachPicker(stepIndex) {
    setPickingFor(stepIndex);
    if (attachments.length === 0) {
      setLoadingAttach(true);
      try {
        const res = await waApi.listAttachments();
        setAttachments(res.data || []);
      } catch {
        toast.error('Failed to load attachments');
      } finally {
        setLoadingAttach(false);
      }
    }
  }

  function pickAttachment(attachId) {
    setForm(p => ({
      ...p,
      steps: p.steps.map((ss, ii) => ii === pickingFor ? { ...ss, attachment_id: attachId } : ss),
    }));
    setPickingFor(null);
  }

  function clearAttachment(stepIndex) {
    setForm(p => ({
      ...p,
      steps: p.steps.map((ss, ii) => ii === stepIndex ? { ...ss, attachment_id: null } : ss),
    }));
  }

  async function uploadNewAttachment(file) {
    if (!file) return;
    setUploadingAttach(true);
    try {
      const res = await waApi.uploadAttachment(file);
      const newAttach = res.data;
      setAttachments(prev => [newAttach, ...prev]);
      if (pickingFor !== null) {
        setForm(p => ({
          ...p,
          steps: p.steps.map((ss, ii) => ii === pickingFor ? { ...ss, attachment_id: newAttach.attachment_id } : ss),
        }));
        setPickingFor(null);
      }
      toast.success('Attachment uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploadingAttach(false);
    }
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Sequence name is required'); return; }
    if (form.steps.length === 0) { toast.error('Add at least one step'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        trigger: form.trigger,
        filter_designation: form.filter_designation.trim() || null,
        is_active: editingSeq ? editingSeq.active : true,
        steps: form.steps.map((s, i) => {
          const isPhysical = s.message_type === 'physical_material';
          const plain = s.message_template
            ? s.message_template.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : '';
          return {
            step_number: i + 1,
            delay_days: parseInt(s.delay_days) || 0,
            message_type: s.message_type || 'whatsapp',
            message_template: isPhysical ? '' : (s.message_template || `Step ${i + 1}`),
            message_plain: isPhysical ? '' : plain,
            ...(isPhysical ? { material_type: s.material_type || 'brochure' } : {}),
            ...(s.attachment_id ? { attachment_id: s.attachment_id } : {}),
          };
        }),
      };

      if (editingSeq) {
        const res = await dripApi.update(editingSeq.sequence_id, payload);
        setDrips(prev => prev.map(x => x.id === editingSeq.id ? mapSeq(res.data) : x));
        toast.success('Sequence updated');
      } else {
        const res = await dripApi.create(payload);
        setDrips(prev => [mapSeq(res.data), ...prev]);
        toast.success('Drip sequence created');
      }
      closeDialog();
    } catch {
      toast.error(editingSeq ? 'Failed to update sequence' : 'Failed to create sequence');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteSeq) return;
    setDeleting(true);
    try {
      await dripApi.delete(deleteSeq.sequence_id);
      setDrips(prev => prev.filter(x => x.id !== deleteSeq.id));
      toast.success('Sequence deleted');
      setDeleteSeq(null);
    } catch {
      toast.error('Failed to delete sequence');
    } finally {
      setDeleting(false);
    }
  }

  const TRIGGERS = [
    { k: 'lead_created',   l: 'Lead Created',    d: 'Auto-enroll every new lead' },
    { k: 'quotation_sent', l: 'Quotation Sent',   d: 'Follow up after sending a quote' },
    { k: 'manual',         l: 'Manual Only',      d: 'Enroll contacts manually' },
  ];

  function findAttach(id) { return attachments.find(a => a.attachment_id === id); }

  return (
    <div className="space-y-4">
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Drip Sequences</h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Automated message series triggered by lead actions</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => { setEditingSeq(null); setForm(BLANK_FORM); setShowCreate(true); }}>
          <Plus className="h-3 w-3" /> New Sequence
        </Button>
      </div>

      <div className="space-y-3">
        {drips.map(d => (
          <div key={d.id} className={`${tk.card} border ${tk.bdr} rounded-xl overflow-hidden`}>
            {/* Card header */}
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                <Zap className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold ${tk.t1} truncate`}>{d.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    d.active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'
                  }`}>{d.active ? 'Active' : 'Paused'}</span>
                </div>
                <p className={`text-xs ${tk.tm} mt-0.5`}>
                  {d.steps.length} step{d.steps.length !== 1 ? 's' : ''} · {d.trigger}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="text-right hidden sm:block mr-1">
                  <p className={`text-xs font-semibold ${tk.t1}`}>{d.enrolled}</p>
                  <p className={`text-[10px] ${tk.tm}`}>enrolled</p>
                </div>
                <div className="text-right hidden sm:block mr-2">
                  <p className={`text-xs font-semibold ${tk.t1}`}>{d.completed}</p>
                  <p className={`text-[10px] ${tk.tm}`}>done</p>
                </div>
                <Switch checked={d.active} onCheckedChange={() => toggle(d)} />
                <button onClick={() => startEdit(d)} title="Edit sequence"
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`}>
                  <Pencil className={`h-3.5 w-3.5 ${tk.tm}`} />
                </button>
                <button onClick={() => setDeleteSeq(d)} title="Delete sequence"
                  className="h-7 w-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
                <button onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`}>
                  <ChevronDown className={`h-4 w-4 ${tk.tm} transition-transform duration-200 ${expanded === d.id ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Expanded steps */}
            {expanded === d.id && (
              <div className={`border-t ${tk.bdr} bg-[var(--bg-primary)] px-4 py-4`}>
                {d.description && (
                  <p className={`text-xs ${tk.tm} mb-3 italic`}>{d.description}</p>
                )}
                <div className="space-y-0">
                  {d.steps.map((s, i) => {
                    const attach = s.attachment_id ? findAttach(s.attachment_id) : null;
                    return (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-[var(--accent)]/15 border-2 border-[var(--accent)]/30 flex items-center justify-center flex-shrink-0 z-10">
                            <span className="text-[10px] font-bold text-[var(--accent)]">{s.n}</span>
                          </div>
                          {i < d.steps.length - 1 && (
                            <div className="w-px flex-1 bg-[var(--border-color)] my-0.5" style={{ minHeight: 16 }} />
                          )}
                        </div>
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">{s.delay}</span>
                            {s.attachment_id && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 flex items-center gap-1">
                                <Paperclip className="h-2.5 w-2.5" />
                                {attach ? attach.filename : 'Attachment'}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm ${tk.t1}`}>{s.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => startEdit(d)}
                  className={`mt-3 w-full h-8 rounded-lg border ${tk.bdr} text-xs ${tk.tm} ${tk.hov} flex items-center justify-center gap-1.5 transition-colors`}>
                  <Pencil className="h-3 w-3" /> Edit sequence
                </button>
              </div>
            )}
          </div>
        ))}
        {drips.length === 0 && (
          <div className={`${tk.card} border ${tk.bdr} rounded-xl px-6 py-10 text-center`}>
            <Zap className={`h-8 w-8 ${tk.tm} mx-auto mb-2`} />
            <p className={`text-sm font-medium ${tk.t2}`}>No drip sequences yet</p>
            <p className={`text-xs ${tk.tm} mt-1`}>Create your first automated sequence to start nurturing leads</p>
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={showCreate} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>{editingSeq ? 'Edit Drip Sequence' : 'New Drip Sequence'}</DialogTitle>
            <DialogDescription className={tk.tm}>
              {editingSeq ? 'Update the sequence name, trigger, and steps' : 'Build an automated message series triggered by lead activity'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto py-1 pr-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Sequence Name <span className="text-red-400">*</span></Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Teacher Welcome Series"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') save(); }} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Description <span className={`${tk.tm} font-normal`}>(optional)</span></Label>
              <Input className={`h-9 ${tk.inp}`} placeholder="Short note about what this sequence does…"
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Trigger</Label>
              <div className="space-y-2">
                {TRIGGERS.map(t => (
                  <button key={t.k} onClick={() => setForm(p => ({ ...p, trigger: t.k }))}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border-2 text-left transition-colors ${
                      form.trigger === t.k ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                    }`}>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      form.trigger === t.k ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                    }`}>
                      {form.trigger === t.k && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${tk.t1}`}>{t.l}</p>
                      <p className={`text-[11px] ${tk.tm}`}>{t.d}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {form.trigger === 'lead_created' && (
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Filter by Designation <span className={`${tk.tm} font-normal`}>(optional)</span></Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Teacher, Principal — leave blank for all"
                  value={form.filter_designation}
                  onChange={e => setForm(p => ({ ...p, filter_designation: e.target.value }))} />
                <p className={`text-[11px] ${tk.tm} mt-1`}>Only enroll leads whose designation matches (case-insensitive)</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className={`${tk.t2} text-xs`}>Steps ({form.steps.length})</Label>
                <button onClick={addStep} className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add step
                </button>
              </div>
              <div className="space-y-4">
                {form.steps.map((s, i) => (
                  <div key={i} className={`rounded-xl border ${tk.bdr} overflow-hidden`}>
                    <div className={`flex items-center gap-2 px-3 py-2 bg-[var(--bg-primary)]`}>
                      <div className="w-6 h-6 rounded-full bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[var(--accent)]">{i + 1}</span>
                      </div>
                      <span className={`text-xs ${tk.t2} flex-1`}>
                        {i === 0 ? 'Send immediately (Day 0)' : (
                          <span className="flex items-center gap-1.5">
                            Day
                            <input type="number" min="1" className={`h-6 w-14 rounded-md border px-2 text-xs ${tk.inp}`}
                              value={s.delay_days}
                              onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, delay_days: e.target.value } : ss) }))} />
                            after enrollment
                          </span>
                        )}
                      </span>
                      <button type="button" title={s.attachment_id ? 'Change attachment' : 'Add attachment'}
                        onClick={() => openAttachPicker(i)}
                        className={`h-6 px-2 rounded-md flex items-center gap-1 text-[11px] transition-colors ${
                          s.attachment_id
                            ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
                            : `${tk.hov} ${tk.tm} border ${tk.bdr}`
                        }`}>
                        <Paperclip className="h-3 w-3" />
                        {s.attachment_id ? 'Attached' : 'Attach'}
                      </button>
                      {s.attachment_id && (
                        <button type="button" onClick={() => clearAttachment(i)} title="Remove attachment"
                          className={`h-6 w-6 rounded-md ${tk.hov} flex items-center justify-center`}>
                          <X className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                      {i > 0 && (
                        <button onClick={() => removeStep(i)}
                          className={`h-6 w-6 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                          <Trash2 className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                    </div>
                    <div className={`px-3 py-2 border-t ${tk.bdr} flex items-center gap-2`}>
                      <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>Type:</span>
                      <select
                        value={s.message_type || 'whatsapp'}
                        onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, message_type: e.target.value } : ss) }))}
                        className={`h-7 px-2 rounded text-xs ${tk.inp} border`}
                        data-testid={`step-type-${i}`}>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Email</option>
                        <option value="physical_material">Physical material</option>
                      </select>
                      {s.message_type === 'physical_material' && (
                        <select
                          value={s.material_type || 'brochure'}
                          onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, material_type: e.target.value } : ss) }))}
                          className="h-9 px-2 rounded text-sm bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                          data-testid={`step-material-${i}`}>
                          <option value="brochure">Brochure</option>
                          <option value="sample">Sample</option>
                          <option value="catalogue">Catalogue</option>
                          <option value="kit">Kit</option>
                          <option value="gift">Gift</option>
                        </select>
                      )}
                    </div>
                    {s.message_type !== 'physical_material' && (
                    <RichMessageEditor
                      value={s.message_template}
                      onChange={html => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) => ii === i ? { ...ss, message_template: html } : ss) }))}
                      placeholder="Write your drip message — paste from ChatGPT, Claude, or type directly…"
                    />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={closeDialog}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={save} disabled={saving}>
              {saving ? (editingSeq ? 'Saving…' : 'Creating…') : (editingSeq ? 'Save Changes' : 'Create Sequence')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteSeq} onOpenChange={open => { if (!open) setDeleteSeq(null); }}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-sm`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Delete Sequence?</DialogTitle>
            <DialogDescription className={tk.tm}>
              <span className="font-medium text-[var(--text-primary)]">"{deleteSeq?.name}"</span> will be permanently deleted.
              Active enrollments will be cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setDeleteSeq(null)}>Cancel</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachment picker dialog */}
      <Dialog open={pickingFor !== null} onOpenChange={open => { if (!open) setPickingFor(null); }}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>Choose Attachment</DialogTitle>
            <DialogDescription className={tk.tm}>
              For Step {pickingFor != null ? pickingFor + 1 : ''} — pick an existing file or upload a new one
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
              uploadingAttach ? `${tk.bdr} opacity-60` : `border-[var(--accent)]/30 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/5`
            }`}>
              <input type="file" className="sr-only" accept="image/*,.pdf,.doc,.docx"
                disabled={uploadingAttach}
                onChange={e => uploadNewAttachment(e.target.files?.[0])} />
              {uploadingAttach
                ? <Loader2 className="h-5 w-5 text-[var(--accent)] animate-spin flex-shrink-0" />
                : <Upload className="h-5 w-5 text-[var(--accent)] flex-shrink-0" />}
              <div>
                <p className={`text-sm font-medium ${tk.t1}`}>{uploadingAttach ? 'Uploading…' : 'Upload new file'}</p>
                <p className={`text-[11px] ${tk.tm}`}>Images, PDFs, Word documents (max 16 MB)</p>
              </div>
            </label>

            {loadingAttach ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
              </div>
            ) : attachments.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <p className={`text-[11px] font-medium ${tk.tm}`}>Existing files ({attachments.length})</p>
                  <button
                    onClick={async () => {
                      setLoadingAttach(true);
                      try { const r = await waApi.listAttachments(); setAttachments(r.data || []); }
                      catch { toast.error('Refresh failed'); }
                      finally { setLoadingAttach(false); }
                    }}
                    className={`text-[11px] ${tk.tm} hover:text-[var(--accent)] flex items-center gap-1`}>
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                  {attachments.map(a => {
                    const isImg = a.attachment_type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename || '');
                    const isSelected = pickingFor !== null && form.steps[pickingFor]?.attachment_id === a.attachment_id;
                    return (
                      <button key={a.attachment_id}
                        onClick={() => pickAttachment(a.attachment_id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : `${tk.bdr} ${tk.hov}`
                        }`}>
                        <div className="w-9 h-9 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {isImg && a.url
                            ? <img src={a.url} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.display='none'; }} />
                            : <FileText className="h-4 w-4 text-[var(--text-muted)]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${tk.t1} truncate`}>{a.filename || a.attachment_id}</p>
                          <p className={`text-[11px] ${tk.tm} capitalize`}>{a.attachment_type || 'file'}</p>
                        </div>
                        {isSelected
                          ? <Check className="h-4 w-4 text-[var(--accent)] flex-shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={`text-center py-6 rounded-xl border ${tk.bdr}`}>
                <Paperclip className={`h-6 w-6 ${tk.tm} mx-auto mb-1.5`} />
                <p className={`text-xs font-medium ${tk.t2}`}>No attachments uploaded yet</p>
                <p className={`text-[11px] ${tk.tm} mt-0.5`}>Use the upload button above to add your first file</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setPickingFor(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
