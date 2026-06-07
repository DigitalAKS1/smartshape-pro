import React from 'react';
import { Plus } from 'lucide-react';

const START_HOUR = 6, END_HOUR = 22;   // 6 AM .. 10 PM
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;
const label = (h) => { const am = h < 12; const x = h % 12 || 12; return `${x} ${am ? 'AM' : 'PM'}`; };
const isDone = (e) => ['completed', 'verified', 'done'].includes(e.status);

export default function CalendarDay({
  date, events, onEventClick, onAddBlock, onEditBlock, onDropItem, onMoveBlock,
  card, textPri, textSec, textMuted, readOnly,
}) {
  const timed = events.filter(e => e.start_time);
  const unscheduled = events.filter(e => !e.start_time);

  const hourOf = (t) => Math.max(START_HOUR, Math.min(END_HOUR, parseInt((t || '06:00').slice(0, 2), 10)));
  const eventsAtHour = (h) => timed.filter(e => hourOf(e.start_time) === h);

  const handleDrop = (h) => (ev) => {
    ev.preventDefault();
    if (readOnly) return;
    const raw = ev.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d.kind === 'block') onMoveBlock?.(d.id, hhmm(h));
      else if (d.kind === 'item') onDropItem?.(d.event, hhmm(h));
    } catch { /* ignore */ }
  };
  const dragStart = (payload) => (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify(payload));

  return (
    <div className="space-y-3">
      {unscheduled.length > 0 && (
        <div className={`${card} border rounded-xl p-3`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-2 ${textMuted}`}>Unscheduled · drag onto an hour to plan</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(e => (
              <button key={e.event_id} draggable={!readOnly} onDragStart={dragStart({ kind: 'item', event: e })}
                onClick={() => onEventClick?.(e)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-[var(--border-color)] cursor-grab active:cursor-grabbing ${isDone(e) ? 'opacity-50 line-through' : ''}`}
                style={{ background: e.color + '14' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                <span className={textSec}>{e.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${card} border rounded-xl overflow-hidden`}>
        {HOURS.map(h => (
          <div key={h} className="flex border-b border-[var(--border-color)] last:border-0 min-h-[52px]"
            onDragOver={(e) => e.preventDefault()} onDrop={handleDrop(h)}>
            <div className={`w-16 flex-shrink-0 text-right pr-2 pt-1.5 text-[10px] ${textMuted} border-r border-[var(--border-color)]`}>{label(h)}</div>
            <div className={`flex-1 p-1.5 space-y-1 group relative ${!readOnly ? 'cursor-pointer' : ''}`}
              onClick={() => !readOnly && onAddBlock?.(hhmm(h))} title={!readOnly ? 'Click to add here' : undefined}>
              {eventsAtHour(h).map(e => {
                const isBlock = e.source === 'plan';
                return (
                  <div key={e.event_id} draggable={isBlock && !readOnly} onDragStart={isBlock && !readOnly ? dragStart({ kind: 'block', id: e.entity_id }) : undefined}
                    onClick={(ev) => { ev.stopPropagation(); isBlock ? onEditBlock?.(e) : onEventClick?.(e); }}
                    className={`rounded-lg px-2.5 py-1.5 text-xs cursor-pointer flex items-center gap-2 ${isBlock ? 'cursor-grab active:cursor-grabbing' : ''} ${isDone(e) ? 'opacity-50 line-through' : ''}`}
                    style={{ background: e.color + '1f', borderLeft: `3px solid ${e.color}` }}>
                    <span className={`font-mono text-[10px] ${textMuted}`}>{e.start_time}</span>
                    <span className={`${textPri} truncate`}>{e.title}</span>
                    {isBlock && <span className={`ml-auto text-[9px] ${textMuted}`}>plan</span>}
                  </div>
                );
              })}
              {!readOnly && (
                <span className={`absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${textMuted}`} title="Add here">
                  <Plus className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
