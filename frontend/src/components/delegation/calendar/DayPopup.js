import React from 'react';
import { X, ChevronRight, ExternalLink } from 'lucide-react';

const SOURCE_LABELS = {
  delegation: 'Task', fms: 'FMS', visit: 'Visit', task: 'CRM', followup: 'Call',
  workshop: 'Workshop', plan: 'Block', reminder: 'Reminder', event: 'Event',
};

export default function DayPopup({ date, events = [], onOpen, onOpenDay, onClose, card, textPri, textSec, textMuted }) {
  const items = [...events].sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99'));
  const nice = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`${card} border rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h3 className={`text-sm font-semibold ${textPri}`}>{nice}</h3>
            <p className={`text-xs ${textMuted} mt-0.5`}>{items.length} item{items.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-3 space-y-1.5">
          {items.length === 0 ? (
            <p className={`text-sm ${textMuted} text-center py-8`}>Nothing scheduled.</p>
          ) : items.map(e => (
            <button key={e.event_id} onClick={() => onOpen(e)}
              className={`${card} border rounded-lg w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--bg-hover)]`}>
              <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: e.color }} />
              <span className={`text-[11px] font-mono ${textMuted} w-12 flex-shrink-0`}>{e.start_time || '—'}</span>
              <span className={`flex-1 min-w-0 text-sm ${textPri} truncate ${['completed', 'verified', 'done'].includes(e.status) ? 'line-through opacity-60' : ''}`}>{e.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: e.color + '22', color: e.color }}>{SOURCE_LABELS[e.source] || e.source}</span>
              <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 ${textMuted}`} />
            </button>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border-color)]">
          <button onClick={onOpenDay} className={`w-full flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open full day
          </button>
        </div>
      </div>
    </div>
  );
}
