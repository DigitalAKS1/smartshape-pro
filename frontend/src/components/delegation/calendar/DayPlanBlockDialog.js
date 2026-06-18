import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

const PINK = '#e94560';

export default function DayPlanBlockDialog({
  block, date, onSave, onDelete, onClose, card, textPri, textSec, textMuted, inputCls,
}) {
  const editing = !!block?.block_id || !!block?.entity_id;
  const [form, setForm] = useState({
    title: block?.title || '',
    start_time: block?.start_time || '09:00',
    end_time: block?.end_time || '10:00',
    note: block?.meta?.note ?? block?.note ?? '',
    color: block?.color || PINK,
    busy: block?.busy ?? false,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.title.trim() && form.start_time && form.end_time && form.end_time > form.start_time;

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;
  const delId = block?.block_id || block?.entity_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-sm`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className={`text-base font-semibold ${textPri}`}>{editing ? 'Edit block' : 'New plan block'}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Title</label>
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Focus, Break, Prep…" className={`h-9 text-sm ${inputCls}`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start</label>
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} className={fld} /></div>
            <div><label className={lbl}>End</label>
              <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} className={fld} /></div>
          </div>
          <div><label className={lbl}>Note</label>
            <Input value={form.note} onChange={e => set('note', e.target.value)} className={`h-9 text-sm ${inputCls}`} /></div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.busy} onChange={e => set('busy', e.target.checked)} className="h-4 w-4 accent-[#e94560]" />
            <span className={`text-xs ${textSec}`}>Mark me <b>busy</b> — warn teammates before they assign work in this window</span>
          </label>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border-color)]">
          {editing
            ? <button onClick={() => onDelete(delId)} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={() => onSave({ date, title: form.title, start_time: form.start_time, end_time: form.end_time, note: form.note, color: form.color, busy: form.busy })} disabled={!valid}
              className="h-9 text-white font-semibold" style={{ background: PINK }}>{editing ? 'Save' : 'Add'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
