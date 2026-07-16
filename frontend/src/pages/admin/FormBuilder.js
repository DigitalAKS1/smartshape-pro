import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, Copy, Download,
  MessageCircle, Users, Save, Send, ExternalLink,
} from 'lucide-react';

const FIELD_TYPES = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['dropdown', 'Dropdown'],
  ['multiple_choice', 'Multiple choice'], ['checkbox', 'Checkboxes'],
  ['number', 'Number'], ['date', 'Date'],
];
const MAP_OPTIONS = [
  ['', '— not mapped —'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'],
  ['school', 'School'], ['designation', 'Designation'], ['city', 'City'],
];

export default function FormBuilder() {
  const { formId } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('fields'); // fields | messages | share
  const [saving, setSaving] = useState(false);
  const [newCollab, setNewCollab] = useState('');
  const qrRef = useRef(null);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
        textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    formsApi.get(formId).then(r => setForm(r.data))
      .catch(() => { toast.error('Form not found'); nav('/forms'); });
  }, [formId, nav]);

  if (!form) return <AdminLayout><div className="p-8" /></AdminLayout>;

  const publicUrl = `${window.location.origin}/f/${form.public_token}`;
  const isEvent = form.type === 'event';
  const set = (patch) => setForm({ ...form, ...patch });
  const setEvent = (patch) => set({ event: { ...(form.event || {}), ...patch } });
  const setMsg = (patch) => set({ messages: { ...(form.messages || {}), ...patch } });

  const save = async () => {
    setSaving(true);
    try {
      const r = await formsApi.update(form.form_id, {
        title: form.title, description: form.description,
        fields: form.fields, collaborators: form.collaborators,
        messages: form.messages,
        ...(isEvent ? { event: form.event } : {}),
      });
      setForm(r.data);
      toast.success('Saved');
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const setField = (i, patch) => {
    const fields = form.fields.slice();
    fields[i] = { ...fields[i], ...patch };
    set({ fields });
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= form.fields.length) return;
    const fields = form.fields.slice();
    [fields[i], fields[j]] = [fields[j], fields[i]];
    set({ fields });
  };
  const addField = () => set({
    fields: [...form.fields, { field_id: `new_${Date.now()}`, label: 'New question',
                               type: 'text', required: false, choices: [], map_to: null }],
  });
  const removeField = (i) => set({ fields: form.fields.filter((_, k) => k !== i) });

  const copyLink = () => { navigator.clipboard.writeText(publicUrl); toast.success('Link copied'); };
  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${form.title.replace(/\W+/g, '_')}_QR.png`;
    a.click();
  };
  const waShare = () => {
    const ev = form.event || {};
    const text = isEvent
      ? `📢 *${form.title}*\n${ev.theme ? `Theme: ${ev.theme}\n` : ''}` +
        `${ev.date ? `Date: ${ev.date}\n` : ''}${ev.time ? `Time: ${ev.time}\n` : ''}` +
        `\nRegister here:\n${publicUrl}`
      : `Please fill this form: *${form.title}*\n${publicUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };
  const sendReminder = async () => {
    try {
      const r = await formsApi.remind(form.form_id);
      toast.success(`Reminder queued — ${r.data.emails} emails, ${r.data.whatsapp} WhatsApp`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const toggleStatus = async () => {
    const next = form.status === 'open' ? 'closed' : 'open';
    try { await formsApi.setStatus(form.form_id, next); set({ status: next }); }
    catch { toast.error('Failed'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => nav('/forms')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input value={form.title} onChange={e => set({ title: e.target.value })}
                   className={`${inputCls} text-lg font-semibold w-[340px]`} />
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              form.status === 'open' ? 'bg-green-500/15 text-green-500'
                                     : 'bg-gray-500/15 text-gray-400'}`}>
              {form.status}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={toggleStatus}>
              {form.status === 'open' ? 'Close form' : 'Reopen form'}
            </Button>
            {isEvent && (
              <Button variant="outline" size="sm" onClick={sendReminder}>
                <Send className="h-4 w-4 mr-1" /> Send reminder now
              </Button>
            )}
            <Button variant="outline" size="sm"
                    onClick={() => nav(`/forms/${form.form_id}/responses`)}>
              Responses
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-[var(--border-color)]">
          {[['fields', 'Fields'], ['messages', 'Messages'], ['share', 'Share']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`px-4 py-2 text-sm ${tab === k
                      ? `${textPri} border-b-2 border-[#e94560] font-medium`
                      : textSec}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'fields' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {isEvent && (
                <div className={`${card} border rounded-md p-4 space-y-2`}>
                  <h3 className={`text-sm font-medium ${textPri}`}>Event details</h3>
                  <Input placeholder="Theme (e.g. Patriotism Through Creativity)"
                         value={form.event?.theme || ''}
                         onChange={e => setEvent({ theme: e.target.value })} className={inputCls} />
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label className={`text-xs ${textMuted}`}>Date</Label>
                      <Input type="date" value={form.event?.date || ''}
                             onChange={e => setEvent({ date: e.target.value })} className={inputCls} /></div>
                    <div><Label className={`text-xs ${textMuted}`}>Time (IST)</Label>
                      <Input type="time" value={form.event?.time || ''}
                             onChange={e => setEvent({ time: e.target.value })} className={inputCls} /></div>
                    <div><Label className={`text-xs ${textMuted}`}>Duration (min)</Label>
                      <Input type="number" value={form.event?.duration_min || 60}
                             onChange={e => setEvent({ duration_min: e.target.value })} className={inputCls} /></div>
                  </div>
                  <Input placeholder="Zoom link (paste from your Zoom account)"
                         value={form.event?.meeting_link || ''}
                         onChange={e => setEvent({ meeting_link: e.target.value })} className={inputCls} />
                </div>
              )}

              <div className={`${card} border rounded-md p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-medium ${textPri}`}>Questions</h3>
                  <Button size="sm" variant="outline" onClick={addField}>
                    <Plus className="h-4 w-4 mr-1" /> Add question
                  </Button>
                </div>
                {form.fields.map((f, i) => (
                  <div key={f.field_id} className="border border-[var(--border-color)] rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={f.label} onChange={e => setField(i, { label: e.target.value })}
                             className={`${inputCls} flex-1`} />
                      <Button size="sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removeField(i)}><Trash2 className="h-4 w-4 text-red-400" /></Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <select value={f.type} onChange={e => setField(i, { type: e.target.value })}
                              className={`h-9 px-2 rounded-md text-sm ${inputCls}`}>
                        {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <select value={f.map_to || ''} onChange={e => setField(i, { map_to: e.target.value || null })}
                              className={`h-9 px-2 rounded-md text-sm ${inputCls}`}>
                        {MAP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <label className={`flex items-center gap-1 text-sm ${textSec}`}>
                        <input type="checkbox" checked={!!f.required}
                               onChange={e => setField(i, { required: e.target.checked })} /> Required
                      </label>
                    </div>
                    {['dropdown', 'multiple_choice', 'checkbox'].includes(f.type) && (
                      <Input placeholder="Choices, comma-separated"
                             value={(f.choices || []).join(', ')}
                             onChange={e => setField(i, { choices: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                             className={inputCls} />
                    )}
                  </div>
                ))}
              </div>

              <div className={`${card} border rounded-md p-4 space-y-2`}>
                <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}>
                  <Users className="h-4 w-4" /> Collaborators
                </h3>
                <p className={`text-xs ${textMuted}`}>Teammates who can edit this form and see responses.</p>
                {(form.collaborators || []).map(c => (
                  <div key={c} className={`flex items-center justify-between text-sm ${textSec}`}>
                    {c}
                    <Button size="sm" variant="ghost"
                            onClick={() => set({ collaborators: form.collaborators.filter(x => x !== c) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="teammate@smartshape.in" value={newCollab}
                         onChange={e => setNewCollab(e.target.value)} className={inputCls} />
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!newCollab.includes('@')) return toast.error('Enter an email');
                    set({ collaborators: [...(form.collaborators || []), newCollab.toLowerCase().trim()] });
                    setNewCollab('');
                  }}>Add</Button>
                </div>
              </div>
            </div>

            {/* Live mobile-width preview */}
            <div>
              <p className={`text-xs ${textMuted} mb-2`}>Preview (as teachers see it)</p>
              <div className="mx-auto w-[360px] border border-[var(--border-color)] rounded-xl p-4 bg-white text-gray-900 space-y-3">
                <div className="text-center">
                  <div className="text-lg font-bold">{form.title}</div>
                  {isEvent && (
                    <div className="text-xs text-gray-600 mt-1">
                      {form.event?.theme && <div>Theme: {form.event.theme}</div>}
                      <div>{form.event?.date} {form.event?.time && `· ${form.event.time}`}</div>
                    </div>
                  )}
                </div>
                {form.fields.map(f => (
                  <div key={f.field_id}>
                    <div className="text-sm font-medium">
                      {f.label}{f.required && <span className="text-red-500"> *</span>}
                    </div>
                    {['dropdown'].includes(f.type)
                      ? <select className="w-full border rounded p-1.5 text-sm mt-1" disabled>
                          <option>{(f.choices || [])[0] || 'Select…'}</option>
                        </select>
                      : ['multiple_choice', 'checkbox'].includes(f.type)
                      ? <div className="mt-1 space-y-1">{(f.choices || []).map(c => (
                          <label key={c} className="flex items-center gap-2 text-sm">
                            <input type={f.type === 'checkbox' ? 'checkbox' : 'radio'} disabled /> {c}
                          </label>))}</div>
                      : <input className="w-full border rounded p-1.5 text-sm mt-1" disabled
                               placeholder={f.type === 'textarea' ? 'Long answer' : 'Answer'} />}
                  </div>
                ))}
                <button className="w-full bg-[#e94560] text-white rounded-md py-2 text-sm font-semibold" disabled>
                  Register
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'messages' && (
          <div className={`${card} border rounded-md p-4 space-y-4 max-w-2xl`}>
            <p className={`text-xs ${textMuted}`}>
              Placeholders: {'{name} {school_name} {title} {theme} {date} {time} {zoom_link} {calendar_link}'}
            </p>
            <div>
              <Label className={`text-xs ${textMuted}`}>WhatsApp confirmation (sent instantly on registration)</Label>
              <textarea rows={7} value={form.messages?.wa_confirm || ''}
                        onChange={e => setMsg({ wa_confirm: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm ${inputCls}`} />
            </div>
            <div>
              <Label className={`text-xs ${textMuted}`}>WhatsApp reminder (24h & 1h before + manual)</Label>
              <textarea rows={6} value={form.messages?.wa_reminder || ''}
                        onChange={e => setMsg({ wa_reminder: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm ${inputCls}`} />
            </div>
            <div>
              <Label className={`text-xs ${textMuted}`}>
                Custom confirmation email (optional — leave blank to use the standard branded email with Zoom link + calendar button)
              </Label>
              <Input placeholder="Email subject" value={form.messages?.email_subject || ''}
                     onChange={e => setMsg({ email_subject: e.target.value })} className={inputCls} />
              <textarea rows={8} placeholder="Email HTML body" value={form.messages?.email_html || ''}
                        onChange={e => setMsg({ email_html: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm mt-2 font-mono ${inputCls}`} />
            </div>
          </div>
        )}

        {tab === 'share' && (
          <div className={`${card} border rounded-md p-6 max-w-2xl space-y-5`}>
            <div>
              <Label className={`text-xs ${textMuted}`}>Public registration link</Label>
              <div className="flex gap-2 mt-1">
                <Input readOnly value={publicUrl} className={`${inputCls} flex-1`} />
                <Button variant="outline" onClick={copyLink}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
                <Button variant="outline" onClick={() => window.open(publicUrl, '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div ref={qrRef} className="bg-white p-3 rounded-md">
                <QRCodeCanvas value={publicUrl} size={160} />
              </div>
              <div className="space-y-2">
                <Button variant="outline" onClick={downloadQR}>
                  <Download className="h-4 w-4 mr-1" /> Download QR
                </Button>
                <Button className="bg-[#25D366] hover:bg-[#1ebe5b] text-white block" onClick={waShare}>
                  <MessageCircle className="h-4 w-4 mr-1" /> Share on WhatsApp
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
