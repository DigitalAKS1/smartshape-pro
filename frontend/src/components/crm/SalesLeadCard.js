import React from 'react';
import { Phone, MessageSquare, AlertTriangle } from 'lucide-react';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tMuted = 'text-[var(--text-muted)]';

export const STAGES = ['new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost'];

export const STAGE = {
  new:         { label: 'New',         cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',   dot: 'bg-blue-400' },
  contacted:   { label: 'Contacted',   cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
  demo:        { label: 'Demo',        cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' },
  quoted:      { label: 'Quoted',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30', dot: 'bg-orange-400' },
  negotiation: { label: 'Negotiation', cls: 'bg-pink-500/20 text-pink-400 border-pink-500/30',   dot: 'bg-pink-400' },
  won:         { label: 'Won',         cls: 'bg-green-500/20 text-green-400 border-green-500/30', dot: 'bg-green-400' },
  lost:        { label: 'Lost',        cls: 'bg-red-500/20 text-red-400 border-red-500/30',      dot: 'bg-red-400' },
};

export const TYPE_CLS = {
  hot:  'bg-red-500/20 text-red-400',
  warm: 'bg-yellow-500/20 text-yellow-400',
  cold: 'bg-blue-500/20 text-blue-400',
};

export const openWa = (phone, msg = '') => {
  const n = phone?.replace(/\D/g, '');
  if (!n) return;
  const num = n.startsWith('91') ? n : '91' + n;
  window.open(
    msg
      ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/${num}`,
    '_blank'
  );
};

export const daysSince = (d) =>
  d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;

/** Compact card used in Kanban columns */
export function KanbanCard({ lead, onTap }) {
  const today  = new Date().toISOString().split('T')[0];
  const overdue = lead.next_followup_date && lead.next_followup_date < today;
  const ds     = daysSince(lead.last_activity_date || lead.updated_at);

  return (
    <button
      onClick={() => onTap(lead)}
      className={`w-full text-left p-3 rounded-xl border transition-all active:scale-95 ${
        overdue ? 'bg-[#e94560]/5 border-[#e94560]/30' : card
      }`}
    >
      <p className={`text-xs font-bold ${tPri} leading-tight truncate mb-0.5`}>
        {lead.company_name || lead.contact_name}
      </p>
      <p className={`text-[10px] ${tMuted} truncate mb-2`}>{lead.contact_name}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {lead.lead_type && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[lead.lead_type] || ''}`}>
            {lead.lead_type}
          </span>
        )}
        {overdue && <AlertTriangle className="h-3 w-3 text-[#e94560]" />}
        {ds !== null && <span className={`text-[9px] ${tMuted} ml-auto`}>{ds}d</span>}
      </div>
      {lead.contact_phone && (
        <div className="flex gap-1.5 mt-2">
          <a
            href={`tel:${lead.contact_phone}`}
            onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-blue-500/10 text-blue-400"
          >
            <Phone className="h-3 w-3" />
          </a>
          <button
            onClick={e => { e.stopPropagation(); openWa(lead.contact_phone); }}
            className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-green-500/10 text-green-400"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
        </div>
      )}
    </button>
  );
}
