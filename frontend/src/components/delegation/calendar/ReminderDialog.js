import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

const ORANGE = '#f97316';
const CATEGORIES = [['subscription', 'Subscription'], ['loan', 'Loan / EMI'], ['insurance', 'Insurance premium'], ['custom', 'Custom']];
const RECUR = [['once', 'One-time'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

/** Create / edit a reminder. onSave(payload, editId|null). */
export default function ReminderDialog({ reminder, onSave, onClose, card, textPri, textSec, textMuted, inputCls }) {
  const editing = !!reminder?.reminder_id;
  const [f, setF] = useState({
    title: reminder?.title || '',
    category: reminder?.category || 'subscription',
    amount: reminder?.amount ?? '',
    recurrence: reminder?.recurrence || 'monthly',
    due_date: reminder?.due_date || new Date().toISOString().slice(0, 10),
    due_time: reminder?.due_time || '09:00',
    lead_offsets: reminder?.lead_offsets?.length ? reminder.lead_offsets : [{ value: 1, unit: 'day' }],
    channels: reminder?.channels || { email: true, whatsapp: true },
    shared: reminder?.shared || false,
    notes: reminder?.notes || '',
    recipient_emails: (reminder?.recipients || []).filter(r => r.type === 'email').map(r => r.email).join(', '),
    recipient_phones: (reminder?.recipients || []).filter(r => r.type === 'phone').map(r => r.phone).join(', '),
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const setOffset = (i, k, v) => setF(s => ({ ...s, lead_offsets: s.lead_offsets.map((o, j) => j === i ? { ...o, [k]: k === 'value' ? Math.max(0, parseInt(v || 0, 10)) : v } : o) }));
  const addOffset = () => setF(s => ({ ...s, lead_offsets: [...s.lead_offsets, { value: 2, unit: 'hour' }] }));
  const rmOffset = (i) => setF(s => ({ ...s, lead_offsets: s.lead_offsets.filter((_, j) => j !== i) }));

  const valid = f.title.trim() && f.due_date && (f.channels.email || f.channels.whatsapp);

  const submit = () => {
    const payload = {
      title: f.title.trim(), category: f.category,
      amount: f.amount === '' ? null : Number(f.amount),
      recurrence: f.recurrence, due_date: f.due_date, due_time: f.due_time,
      lead_offsets: f.lead_offsets, channels: f.channels, shared: f.shared, notes: f.notes,
      recipient_emails: f.recipient_emails.split(',').map(x => x.trim()).filter(Boolean),
      recipient_phones: f.recipient_phones.split(',').map(x => x.trim()).filter(Boolean),
    };
    onSave(payload, editing ? reminder.reminder_id : null);
  };

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`${card} border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className={`text-base font-semibold ${textPri}`}>{editing ? 'Edit reminder' : 'New reminder'}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Title</label>
            <input value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. LIC premium, AWS subscription" className={fld} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Category</label>
              <select value={f.category} onChange={e => set('category', e.target.value)} className={fld}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div><label className={lbl}>Amount (₹)</label>
              <input type="number" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder="optional" className={fld} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lbl}>Repeats</label>
              <select value={f.recurrence} onChange={e => set('recurrence', e.target.value)} className={fld}>
                {RECUR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div><label className={lbl}>Due date</label>
              <input type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} className={fld} /></div>
            <div><label className={lbl}>Time</label>
              <input type="time" value={f.due_time} onChange={e => set('due_time', e.target.value)} className={fld} /></div>
          </div>

          <div>
            <label className={lbl}>Remind me before</label>
            <div className="space-y-1.5">
              {f.lead_offsets.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="number" value={o.value} onChange={e => setOffset(i, 'value', e.target.value)} className={`w-20 h-9 px-2 rounded text-sm border border-[var(--border-color)] ${inputCls}`} />
                  <select value={o.unit} onChange={e => setOffset(i, 'unit', e.target.value)} className={`h-9 px-2 rounded text-sm border border-[var(--border-color)] ${inputCls}`}>
                    <option value="day">day(s) before</option>
                    <option value="hour">hour(s) before</option>
                  </select>
                  {f.lead_offsets.length > 1 && (
                    <button onClick={() => rmOffset(i)} className={`p-1.5 rounded ${textMuted} hover:text-red-400`}><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              <button onClick={addOffset} className={`text-[11px] flex items-center gap-1 ${textSec}`}><Plus className="h-3 w-3" /> Add another reminder time</button>
            </div>
          </div>

          <div>
            <label className={lbl}>Notify via</label>
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 text-sm ${textSec}`}>
                <input type="checkbox" checked={f.channels.email} onChange={e => set('channels', { ...f.channels, email: e.target.checked })} /> Email
              </label>
              <label className={`flex items-center gap-2 text-sm ${textSec}`}>
                <input type="checkbox" checked={f.channels.whatsapp} onChange={e => set('channels', { ...f.channels, whatsapp: e.target.checked })} /> WhatsApp
              </label>
            </div>
          </div>

          <div><label className={lbl}>Also notify emails (comma-separated)</label>
            <input value={f.recipient_emails} onChange={e => set('recipient_emails', e.target.value)} placeholder="optional — you are always included" className={fld} /></div>
          <div><label className={lbl}>Also notify WhatsApp numbers (comma-separated)</label>
            <input value={f.recipient_phones} onChange={e => set('recipient_phones', e.target.value)} placeholder="optional" className={fld} /></div>

          <label className={`flex items-center gap-2 text-sm ${textSec}`}>
            <input type="checkbox" checked={f.shared} onChange={e => set('shared', e.target.checked)} /> Share with the admin team
          </label>
          <div><label className={lbl}>Notes</label>
            <input value={f.notes} onChange={e => set('notes', e.target.value)} className={fld} /></div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <button onClick={onClose} className={`h-9 px-4 rounded-lg text-sm font-semibold border border-[var(--border-color)] ${textSec}`}>Cancel</button>
          <button onClick={submit} disabled={!valid} className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: ORANGE }}>
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
