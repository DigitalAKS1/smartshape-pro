import React, { useState } from 'react';
import { X, Plus, Pause, Play, Pencil, Trash2, Upload, Download } from 'lucide-react';
import { useReminders } from '../../../hooks/useReminders';
import ReminderDialog from './ReminderDialog';

const ORANGE = '#f97316';

const TEMPLATE_COLS = ['title', 'category', 'amount', 'recurrence', 'due_date', 'due_time',
  'lead_offsets', 'channels', 'recipient_emails', 'recipient_phones', 'shared', 'notes'];
const TEMPLATE_SAMPLE = ['LIC premium', 'insurance', '12500', 'yearly', '2026-09-15', '10:00',
  '7d;1d', 'email;whatsapp', 'cfo@acme.in', '9876543210', 'false', 'Policy #123'];

// minimal CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); row = []; cell = ''; }
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function rowsToReminders(csvRows) {
  if (!csvRows.length) return [];
  const header = csvRows[0].map(h => h.trim().toLowerCase());
  return csvRows.slice(1).filter(r => r.some(c => c.trim())).map(cells => {
    const g = (k) => (cells[header.indexOf(k)] || '').trim();
    const offsets = g('lead_offsets').split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/^(\d+)\s*([dh])/i);
      return m ? { value: parseInt(m[1], 10), unit: m[2].toLowerCase() === 'h' ? 'hour' : 'day' } : null;
    }).filter(Boolean);
    const chans = g('channels').toLowerCase();
    return {
      title: g('title'), category: g('category') || 'custom',
      amount: g('amount') ? Number(g('amount')) : null,
      recurrence: g('recurrence') || 'monthly', due_date: g('due_date'), due_time: g('due_time') || '09:00',
      lead_offsets: offsets.length ? offsets : [{ value: 1, unit: 'day' }],
      channels: { email: chans.includes('email'), whatsapp: chans.includes('whatsapp') },
      recipient_emails: g('recipient_emails').split(';').map(x => x.trim()).filter(Boolean),
      recipient_phones: g('recipient_phones').split(';').map(x => x.trim()).filter(Boolean),
      shared: ['true', '1', 'yes'].includes(g('shared').toLowerCase()), notes: g('notes'),
    };
  });
}

export default function RemindersPanel({ onClose, card, textPri, textSec, textMuted, inputCls }) {
  const r = useReminders();
  const [dialog, setDialog] = useState(null);   // {reminder?} | null
  const [importPreview, setImportPreview] = useState(null);  // parsed rows

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportPreview(rowsToReminders(parseCSV(text)));
    e.target.value = '';
  };
  const downloadTemplate = () => {
    const csv = TEMPLATE_COLS.join(',') + '\n' + TEMPLATE_SAMPLE.map(c => /[,;]/.test(c) ? `"${c}"` : c).join(',') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'reminders-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  const confirmImport = async () => {
    const valid = importPreview.filter(x => x.title && x.due_date);
    if (valid.length) await r.bulk(valid);
    setImportPreview(null);
  };

  const fmtNext = (rem) => `${rem.due_date}${rem.due_time ? ' ' + rem.due_time : ''}`;
  const chanStr = (c) => [c?.email && 'Email', c?.whatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`${card} border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className={`text-base font-semibold ${textPri}`}>Reminders</h2>
            <p className={`text-[11px] ${textMuted}`}>Subscriptions, loans, premiums & more — on WhatsApp + email</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${textSec}`}><Download className="h-3.5 w-3.5" /> Template</button>
            <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${textSec} cursor-pointer`}>
              <Upload className="h-3.5 w-3.5" /> Import CSV
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </label>
            <button onClick={() => setDialog({})} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: ORANGE }}><Plus className="h-3.5 w-3.5" /> New</button>
            <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {r.loading ? (
            <p className={`text-sm ${textMuted}`}>Loading…</p>
          ) : r.reminders.length === 0 ? (
            <div className="text-center py-12">
              <p className={`text-sm ${textSec}`}>No reminders yet.</p>
              <p className={`text-[11px] ${textMuted} mt-1`}>Add subscriptions, loan EMIs or insurance premiums — get pinged on WhatsApp + email before they're due.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {r.reminders.map(rem => (
                <div key={rem.reminder_id} className={`border border-[var(--border-color)] rounded-xl p-3 flex items-center gap-3 ${rem.status === 'paused' ? 'opacity-60' : ''}`}>
                  <span className="w-1.5 h-9 rounded-full flex-shrink-0" style={{ background: ORANGE }} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${textPri} truncate`}>{rem.title}
                      {rem.shared && <span className={`ml-2 text-[10px] ${textMuted}`}>· shared</span>}
                      {rem.status === 'paused' && <span className="ml-2 text-[10px] text-amber-500">· paused</span>}
                    </p>
                    <p className={`text-[11px] ${textMuted}`}>
                      {rem.category} · {rem.recurrence} · next {fmtNext(rem)}
                      {rem.amount ? ` · ₹${rem.amount}` : ''} · {chanStr(rem.channels)}
                    </p>
                  </div>
                  <button onClick={() => r.setPaused(rem.reminder_id, rem.status !== 'paused')} className={`p-1.5 rounded ${textMuted} hover:bg-[var(--bg-hover)]`} title={rem.status === 'paused' ? 'Resume' : 'Pause'}>
                    {rem.status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setDialog({ reminder: rem })} className={`p-1.5 rounded ${textMuted} hover:bg-[var(--bg-hover)]`} title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => window.confirm('Delete this reminder?') && r.remove(rem.reminder_id)} className={`p-1.5 rounded ${textMuted} hover:text-red-400`} title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {dialog && (
        <ReminderDialog reminder={dialog.reminder}
          onSave={async (payload, editId) => {
            const ok = editId ? await r.update(editId, payload) : await r.create(payload);
            if (ok) setDialog(null);
          }}
          onClose={() => setDialog(null)}
          card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls} />
      )}

      {importPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setImportPreview(null)}>
          <div className={`${card} border rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5`} onClick={e => e.stopPropagation()}>
            <p className={`text-sm font-semibold ${textPri} mb-2`}>Import preview — {importPreview.length} rows</p>
            <div className="space-y-1 mb-3 max-h-[50vh] overflow-y-auto">
              {importPreview.map((x, i) => {
                const ok = x.title && x.due_date;
                return (
                  <div key={i} className={`text-[11px] px-2 py-1 rounded ${ok ? textSec : 'text-red-400'}`}>
                    {ok ? '✓' : '✗'} {x.title || '(no title)'} — {x.recurrence} {x.due_date || '(no date)'} · {chanStr(x.channels)}
                  </div>
                );
              })}
            </div>
            <p className={`text-[11px] ${textMuted} mb-3`}>Only rows with a title and due date will be imported. (Export Excel as CSV to import.)</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportPreview(null)} className={`h-9 px-4 rounded-lg text-sm font-semibold border border-[var(--border-color)] ${textSec}`}>Cancel</button>
              <button onClick={confirmImport} className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: ORANGE }}>Import {importPreview.filter(x => x.title && x.due_date).length}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
