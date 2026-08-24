import React, { useMemo, useState } from 'react';
import {
  Phone, MapPin, Video, FileText, Package, Truck, MessageCircle,
  Mail, Repeat, Gift, CalendarClock, Circle, ArrowDownLeft, Activity,
} from 'lucide-react';

// ── Channel → icon + colour. Presentation lives here; the API stays neutral. ──
const CH = {
  call:     { icon: Phone,        color: '#3b82f6', label: 'Call' },
  visit:    { icon: MapPin,       color: '#8b5cf6', label: 'Visit' },
  meeting:  { icon: Video,        color: '#6366f1', label: 'Meeting' },
  quote:    { icon: FileText,     color: '#10b981', label: 'Quote' },
  order:    { icon: Package,      color: '#d946ef', label: 'Order' },
  mail:     { icon: Truck,        color: '#f59e0b', label: 'Post' },
  whatsapp: { icon: MessageCircle,color: '#22c55e', label: 'WhatsApp' },
  email:    { icon: Mail,         color: '#0ea5e9', label: 'Email' },
  drip:     { icon: Repeat,       color: '#06b6d4', label: 'Drip' },
  greeting: { icon: Gift,         color: '#ec4899', label: 'Greeting' },
  activity: { icon: CalendarClock,color: '#64748b', label: 'Planned' },
};
const FALLBACK = { icon: Circle, color: '#94a3b8', label: 'Other' };
const meta = (ch) => CH[ch] || FALLBACK;

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);   if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);   if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);   if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);    if (w < 5)  return `${w}w ago`;
  const mo = Math.floor(d / 30);  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
function absDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

export default function SchoolEngagementTimeline({ timeline = [], tk, isDark }) {
  const [filter, setFilter] = useState('all');

  const items = Array.isArray(timeline) ? timeline : [];

  // Present-channel chips with live counts, ordered by frequency.
  const chips = useMemo(() => {
    const counts = {};
    items.forEach(e => { counts[e.channel] = (counts[e.channel] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([ch, n]) => ({ ch, n }));
  }, [items]);

  const shown = filter === 'all' ? items : items.filter(e => e.channel === filter);

  const chipBase = 'px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide transition-colors border';
  const chipOff = isDark
    ? 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
    : 'border-[#e2e8f0] text-[#64748b] hover:text-[#0f172a]';

  return (
    <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden`}>
      {/* Header + filter rail */}
      <div className={`px-5 py-4 border-b ${tk.border}`}>
        <div className="flex items-center justify-between mb-3">
          <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tk.tm}`}>
            Engagement Timeline
          </p>
          <span className={`text-[11px] font-mono ${tk.tm} sp-num`}>{items.length} touches</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilter('all')}
            className={`${chipBase} ${filter === 'all'
              ? 'bg-[#e94560] border-[#e94560] text-white'
              : chipOff}`}>
            All · {items.length}
          </button>
          {chips.map(({ ch, n }) => {
            const m = meta(ch);
            const active = filter === ch;
            return (
              <button key={ch} onClick={() => setFilter(active ? 'all' : ch)}
                className={`${chipBase} inline-flex items-center gap-1.5`}
                style={active
                  ? { background: m.color, borderColor: m.color, color: '#fff' }
                  : { borderColor: isDark ? undefined : '#e2e8f0' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? '#fff' : m.color }} />
                <span className={active ? '' : (isDark ? 'text-[var(--text-secondary)]' : 'text-[#64748b]')}>
                  {m.label} · {n}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline body */}
      <div className="px-5 py-5">
        {shown.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="h-8 w-8 mx-auto mb-2" style={{ color: '#d1d9e0' }} strokeWidth={1.2} />
            <p className="text-sm italic" style={{ color: '#94a3b8' }}>
              {items.length === 0 ? 'No engagement recorded yet' : 'No touches on this channel'}
            </p>
          </div>
        ) : (
          <div className="relative pl-8">
            <div className={`absolute left-[15px] top-1 bottom-1 w-px ${isDark ? 'bg-[var(--border-color)]' : 'bg-[#e2e8f0]'}`} />
            <div className="space-y-4">
              {shown.map((e, i) => {
                const m = meta(e.channel);
                const Icon = m.icon;
                const isResponse = e.direction === 'in';
                return (
                  <div key={e.id || i} className="relative">
                    <div className={`absolute -left-8 top-0 w-[30px] h-[30px] rounded-full flex items-center justify-center border-2 ${isDark ? 'border-[var(--bg-card)]' : 'border-white'}`}
                      style={{ background: `${m.color}1a` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: m.color }} strokeWidth={2} />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${tk.t1} leading-snug flex items-center gap-1.5 flex-wrap`}>
                          {e.title || m.label}
                          {isResponse && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                              style={{ background: '#22c55e1a', color: '#16a34a' }}>
                              <ArrowDownLeft className="w-2.5 h-2.5" /> RESPONSE
                            </span>
                          )}
                          {e.status && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${isDark ? 'bg-[var(--bg-primary)] text-[var(--text-muted)]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
                              {e.status}
                            </span>
                          )}
                        </p>
                        {e.detail && (
                          <p className={`text-xs ${tk.t2} mt-0.5 break-words`}>{e.detail}</p>
                        )}
                        <p className={`text-[11px] ${tk.tm} mt-0.5`}>
                          <span style={{ color: m.color }} className="font-semibold">{m.label}</span>
                          {e.by ? ` · ${e.by}` : ''}
                        </p>
                      </div>
                      <span className={`text-[11px] ${tk.tm} whitespace-nowrap flex-shrink-0 mt-0.5`} title={absDate(e.at)}>
                        {relTime(e.at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
