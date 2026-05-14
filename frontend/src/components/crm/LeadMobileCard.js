import React from 'react';
import { Phone, MessageSquare, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { waLink } from '../../lib/crmUtils';
import { LeadTypeBadge } from './StageBadge';

/**
 * Mobile lead card with tappable body + Call/WhatsApp/Detail quick-action strip.
 * Used in the pipeline list view and list view on mobile.
 */
export default function LeadMobileCard({ lead, onDetail, tagsList = [], borderCls, card, textPri, textSec, textMuted }) {
  const phone = lead.contact_phone;

  return (
    <div className={`${card} border rounded-xl overflow-hidden`} data-testid={`lead-card-${lead.lead_id}`}>
      {/* Tappable body */}
      <div onClick={() => onDetail(lead)} className="p-3.5 cursor-pointer active:bg-[var(--bg-hover)] transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`${textPri} font-semibold text-sm leading-snug truncate`}>
              {lead.company_name || lead.contact_name}
            </p>
            <p className={`text-xs ${textMuted} mt-0.5 truncate`}>
              {lead.contact_name}{lead.designation ? ` · ${lead.designation}` : ''}
            </p>
          </div>
          {lead.lead_score > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e94560]/20 text-[#e94560] font-mono font-bold flex-shrink-0">
              {lead.lead_score}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {lead.lead_type && <LeadTypeBadge type={lead.lead_type} size="xs" />}
          {lead.visit_required && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> Visit
            </span>
          )}
          {lead.next_followup_date && (
            <span className={`text-[10px] ${textMuted} flex items-center gap-1`}>
              <Clock className="h-3 w-3" />{lead.next_followup_date}
            </span>
          )}
          <span className={`text-[10px] ${textMuted} ml-auto`}>
            {lead.assigned_name?.split(' ')[0]}
          </span>
        </div>

        {(lead.tags || []).length > 0 && tagsList.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(lead.tags || []).slice(0, 3).map(tid => {
              const tag = tagsList.find(t => t.tag_id === tid);
              return tag ? (
                <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: tag.color }}>{tag.name}</span>
              ) : null;
            })}
            {(lead.tags || []).length > 3 && (
              <span className={`text-[9px] ${textMuted}`}>+{(lead.tags || []).length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Quick-action strip */}
      {phone && (
        <div className={`flex border-t border-[var(--border-color)]`}>
          <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
          <div className="w-px bg-[var(--border-color)]" />
          <a href={waLink(phone)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold text-green-400 hover:bg-green-500/10 transition-colors">
            <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
          </a>
          <div className="w-px bg-[var(--border-color)]" />
          <button onClick={e => { e.stopPropagation(); onDetail(lead); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold ${textMuted} hover:bg-[var(--bg-hover)] transition-colors`}>
            <ChevronRight className="h-3.5 w-3.5" /> Detail
          </button>
        </div>
      )}
    </div>
  );
}
