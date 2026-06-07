import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import CollaboratorPicker from './CollaboratorPicker';

const SKY = '#0ea5e9';

/**
 * Create / edit a collaborative calendar event.
 *  - `event` (agenda event with source 'event') → edit mode (reads entity_id + meta)
 *  - `defaults` { date, start_time } → prefill for create (from a clicked slot)
 * onSave(payload, editId|null) → hook createEvent/updateEvent.
 */
export default function EventDialog({
  event, defaults, teamOptions = [], onSave, onClose,
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
    meeting_provider: event?.meta?.meeting_provider || '',
    meeting_link: event?.meta?.meeting_link || '',
    color: event?.color || SKY,
  });
  // edit mode: we only have collaborator display names from the agenda; collaborator
  // editing starts empty (add/replace). create mode: empty.
  const [collab, setCollab] = useState({ emp_ids: [], emails: [] });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const valid = form.title.trim() && form.date &&
    (form.all_day || (form.start_time && form.end_time && form.end_time > form.start_time));

  const submit = () => {
    const payload = {
      title: form.title.trim(), date: form.date,
      start_time: form.all_day ? '' : form.start_time,
      end_time: form.all_day ? '' : form.end_time,
      all_day: form.all_day, location: form.location, description: form.description, color: form.color,
      meeting_provider: form.meeting_provider,
      meeting_link: form.meeting_provider ? form.meeting_link.trim() : '',
    };
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
          <div><label className={lbl}>Location</label>
            <Input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Optional" className={`h-9 text-sm ${inputCls}`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Meeting type</label>
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
          {form.meeting_provider && (
            <p className={`text-[11px] ${textMuted}`}>
              Attendees join via a branded SmartShape link; your raw meeting URL stays private.
            </p>
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
