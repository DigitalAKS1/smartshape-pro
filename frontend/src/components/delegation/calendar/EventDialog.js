import React, { useState, useEffect } from 'react';
import { X, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import CollaboratorPicker from './CollaboratorPicker';
import { visitPlans as vpApi, zoomApi } from '../../../lib/api';

const SKY = '#0ea5e9';

/**
 * Create / edit a collaborative calendar event.
 *  - `event` (agenda event with source 'event') → edit mode (reads entity_id + meta)
 *  - `defaults` { date, start_time } → prefill for create (from a clicked slot)
 * onSave(payload, editId|null) → hook createEvent/updateEvent.
 */
export default function EventDialog({
  event, defaults, meetingDefaults = {}, teamOptions = [], onSave, onClose,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const editing = !!event?.entity_id;
  const [form, setForm] = useState({
    title: event?.title || '',
    date: event?.date || defaults?.date || new Date().toISOString().slice(0, 10),
    start_time: event?.start_time || defaults?.start_time || '09:00',
    end_time: event?.end_time || '10:00',
    all_day: event?.all_day || false,
    location: event?.meta?.location || '',
    description: event?.meta?.description || '',
    meeting_provider: event?.meta?.meeting_provider || (editing ? '' : meetingDefaults.provider) || '',
    meeting_link: event?.meta?.meeting_link || (editing ? '' : meetingDefaults.link) || '',
    event_type: event?.meta?.event_type || 'meeting',
    visit_plan_id: event?.meta?.visit_plan_id || '',
    create_visit_plan: false,
    color: event?.color || SKY,
  });
  // edit mode: we only have collaborator display names from the agenda; collaborator
  // editing starts empty (add/replace). create mode: empty.
  const [collab, setCollab] = useState({ emp_ids: [], emails: [] });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [genZoom, setGenZoom] = useState(false);
  const generateZoom = async () => {
    if (!form.title.trim()) { toast.error('Add a title first'); return; }
    if (!form.date || (!form.all_day && !form.start_time)) { toast.error('Set a date and time first'); return; }
    setGenZoom(true);
    try {
      const start = `${form.date}T${form.all_day ? '09:00' : form.start_time}:00`;
      let duration = 60;
      if (!form.all_day && form.start_time && form.end_time && form.end_time > form.start_time) {
        const [sh, sm] = form.start_time.split(':').map(Number);
        const [eh, em] = form.end_time.split(':').map(Number);
        duration = (eh * 60 + em) - (sh * 60 + sm);
      }
      const r = await zoomApi.createMeeting({ topic: form.title.trim(), start_time: start, duration });
      set('meeting_link', r.data.join_url || '');
      toast.success('Zoom meeting created');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create Zoom meeting (check Zoom setup / scope)');
    }
    setGenZoom(false);
  };

  const [plans, setPlans] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const r = await vpApi.getAll();
        setPlans((r.data || []).filter(p => (p.visit_date || '') >= today));
      } catch { /* no plans */ }
    })();
  }, []);
  const IN_PERSON = ['exhibition', 'school_workshop', 'physical_workshop'];
  const isInPerson = IN_PERSON.includes(form.event_type);

  const valid = form.title.trim() && form.date &&
    (form.all_day || (form.start_time && form.end_time && form.end_time > form.start_time)) &&
    (!isInPerson || form.location.trim());

  const submit = () => {
    const payload = {
      title: form.title.trim(), date: form.date,
      start_time: form.all_day ? '' : form.start_time,
      end_time: form.all_day ? '' : form.end_time,
      all_day: form.all_day, location: form.location, description: form.description, color: form.color,
      meeting_provider: form.meeting_provider,
      meeting_link: form.meeting_provider ? form.meeting_link.trim() : '',
    };
    payload.event_type = form.event_type;
    if (form.event_type === 'meeting') {
      payload.meeting_provider = form.meeting_provider;
      payload.meeting_link = form.meeting_provider ? form.meeting_link.trim() : '';
    } else {
      payload.meeting_provider = ''; payload.meeting_link = '';
    }
    if (form.visit_plan_id) payload.visit_plan_id = form.visit_plan_id;
    if (form.create_visit_plan) payload.create_visit_plan = true;
    if (collab.emp_ids.length) payload.collaborator_emp_ids = collab.emp_ids;
    if (collab.emails.length) payload.collaborator_emails = collab.emails;
    onSave(payload, editing ? event.entity_id : null);
  };

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className={`text-base font-semibold ${textPri}`}>{editing ? 'Edit event' : 'New event'}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Title</label>
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Meeting, call, workshop…" className={`h-9 text-sm ${inputCls}`} /></div>
          <div><label className={lbl}>Event type</label>
            <select value={form.event_type} onChange={e => set('event_type', e.target.value)} className={fld}>
              <optgroup label="Online">
                <option value="meeting">Online meeting</option>
              </optgroup>
              <optgroup label="In person">
                <option value="exhibition">Exhibition</option>
                <option value="school_workshop">School workshop</option>
                <option value="physical_workshop">Physical workshop</option>
              </optgroup>
              <option value="other">Other</option>
            </select>
          </div>
          <div><label className={lbl}>Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={fld} /></div>
          <label className={`flex items-center gap-2 text-sm ${textSec}`}>
            <input type="checkbox" checked={form.all_day} onChange={e => set('all_day', e.target.checked)} /> All day
          </label>
          {!form.all_day && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Start</label>
                <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} className={fld} /></div>
              <div><label className={lbl}>End</label>
                <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} className={fld} /></div>
            </div>
          )}
          <div><label className={lbl}>Location{isInPerson ? ' *' : ''}</label>
            <Input value={form.location} onChange={e => set('location', e.target.value)}
              placeholder={isInPerson ? 'Venue / address (required)' : 'Optional'} className={`h-9 text-sm ${inputCls}`} /></div>

          {form.event_type === 'meeting' && (<>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Join via</label>
                <select value={form.meeting_provider} onChange={e => set('meeting_provider', e.target.value)} className={fld}>
                  <option value="">None</option>
                  <option value="zoom">Zoom</option>
                  <option value="meet">Google Meet</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {form.meeting_provider && (
                <div><label className={lbl}>Meeting link</label>
                  <Input value={form.meeting_link} onChange={e => set('meeting_link', e.target.value)}
                    placeholder="https://zoom.us/j/…" className={`h-9 text-sm ${inputCls}`} /></div>
              )}
            </div>
            {form.meeting_provider === 'zoom' && (
              <Button type="button" variant="outline" onClick={generateZoom} disabled={genZoom}
                className={`h-8 text-xs border-[var(--border-color)] ${textSec}`}>
                <Video className="h-3.5 w-3.5 mr-1.5" /> {genZoom ? 'Creating…' : 'Generate Zoom meeting'}
              </Button>
            )}
            {form.meeting_provider && (
              <p className={`text-[11px] ${textMuted}`}>
                Attendees join via a branded SmartShape link; your raw meeting URL stays private.
              </p>
            )}
          </>)}

          {isInPerson && (
            <div className="space-y-2 rounded-lg border border-[var(--border-color)] p-3">
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>Team visit plan</p>
              <select value={form.visit_plan_id} disabled={form.create_visit_plan}
                onChange={e => set('visit_plan_id', e.target.value)} className={`${fld} disabled:opacity-50`}>
                <option value="">— Link an existing visit plan (optional) —</option>
                {plans.map(p => (
                  <option key={p.plan_id} value={p.plan_id}>
                    {p.school_name || 'Visit'} · {p.visit_date}{p.visit_time ? ` ${p.visit_time}` : ''}
                  </option>
                ))}
              </select>
              <label className={`flex items-center gap-2 text-xs ${textSec}`}>
                <input type="checkbox" checked={form.create_visit_plan}
                  onChange={e => { set('create_visit_plan', e.target.checked); if (e.target.checked) set('visit_plan_id', ''); }} />
                Create a new team visit plan from this event
              </label>
            </div>
          )}

          <CollaboratorPicker value={collab} onChange={setCollab} teamOptions={teamOptions}
            textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
          {editing && <p className={`text-[11px] ${textMuted}`}>Adding collaborators here appends/updates the list.</p>}
          <div><label className={lbl}>Notes</label>
            <Input value={form.description} onChange={e => set('description', e.target.value)} className={`h-9 text-sm ${inputCls}`} /></div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="outline" onClick={onClose} className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submit} disabled={!valid} className="h-9 text-white font-semibold" style={{ background: SKY }}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
