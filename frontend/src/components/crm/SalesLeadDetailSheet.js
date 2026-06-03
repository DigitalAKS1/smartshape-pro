import React, { useState, useEffect } from 'react';
import { leads as leadsApi } from '../../lib/api';
import { toast } from 'sonner';
import {
  Phone, MessageSquare, ChevronLeft, StickyNote,
  ArrowRight, Lock, FileText, Clock,
} from 'lucide-react';
import { Input } from '../ui/input';
import { STAGES, STAGE, TYPE_CLS, openWa } from './SalesLeadCard';

const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';

const waTemplates = (lead) => [
  {
    label: '👋 Introduction',
    msg: `Hello ${lead?.contact_name || "Sir/Ma'am"}, I'm from SmartShape Sports. We offer premium sports equipment for schools. Would you be available for a brief demo? 🏅`,
  },
  {
    label: '📋 Follow-up',
    msg: `Hi ${lead?.contact_name || "Sir/Ma'am"}, following up on our earlier conversation about SmartShape equipment for ${lead?.company_name || 'your school'}. Shall we schedule a visit? 🏆`,
  },
  {
    label: '📤 Share Catalogue',
    msg: `Dear ${lead?.contact_name || "Sir/Ma'am"}, sharing our latest product catalogue. Our range includes world-class sports & fitness equipment. Looking forward to your feedback! 🎯`,
  },
];

/** Bottom sheet wrapper that locks body scroll while open */
export function BottomSheet({ open, onClose, children }) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--bg-card)] pt-3 pb-1 flex justify-center z-10">
          <div className="w-10 h-1 bg-[var(--border-color)] rounded-full" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Multi-view action sheet for a single lead */
export function LeadActionSheet({ lead, onClose, onStageChange, onRefresh, perms }) {
  const [view, setView]               = useState('main');
  const [callOutcome, setCallOutcome] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [noteText, setNoteText]       = useState('');
  const [saving, setSaving]           = useState(false);
  const today = new Date().toISOString().split('T')[0];

  if (!lead) return null;
  const stage = STAGE[lead.stage] || STAGE.new;
  const si    = STAGES.indexOf(lead.stage);

  const OUTCOMES = [
    { id: 'interested',     label: '✅ Answered — Interested',    advance: true  },
    { id: 'not_interested', label: '❌ Answered — Not Interested', advance: false },
    { id: 'no_answer',      label: '📵 No Answer / Busy',          advance: false },
    { id: 'callback',       label: '🔄 Requested Callback',        advance: false },
    { id: 'voicemail',      label: '📬 Left Voicemail',            advance: false },
  ];

  async function saveCallLog(outcome) {
    setSaving(true);
    try {
      await leadsApi.addNote(lead.lead_id, {
        content: `Call: ${outcome}${noteText ? ' — ' + noteText : ''}`,
        call_outcome: outcome,
        call_date: new Date().toISOString(),
        next_followup_date: followupDate || undefined,
      });
      const chosen = OUTCOMES.find(o => o.id === outcome);
      if (chosen?.advance && si >= 0 && si < STAGES.length - 2) {
        const next = STAGES[si + 1];
        await leadsApi.update(lead.lead_id, { stage: next, next_followup_date: followupDate || undefined });
        onStageChange(lead.lead_id, next);
        toast.success(`Call logged · moved to ${STAGE[next]?.label}`);
      } else {
        if (followupDate) await leadsApi.update(lead.lead_id, { next_followup_date: followupDate });
        toast.success('Call logged');
      }
      onRefresh();
      onClose();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  }

  async function saveNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await leadsApi.addNote(lead.lead_id, { content: noteText });
      toast.success('Note saved');
      onRefresh();
      onClose();
    } catch { toast.error('Failed to save note'); }
    finally { setSaving(false); }
  }

  async function moveStage(newStage) {
    setSaving(true);
    try {
      await leadsApi.update(lead.lead_id, { stage: newStage });
      onStageChange(lead.lead_id, newStage);
      toast.success(`Moved to ${STAGE[newStage]?.label}`);
      onClose();
    } catch { toast.error('Failed to update stage'); }
    finally { setSaving(false); }
  }

  /* ── MAIN ── */
  if (view === 'main') return (
    <div className="px-4 pb-8 pt-2">
      <div className="mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <h3 className={`font-bold text-base ${tPri}`}>{lead.company_name || lead.contact_name}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${stage.cls}`}>{stage.label}</span>
          {lead.lead_type && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${TYPE_CLS[lead.lead_type] || ''}`}>{lead.lead_type}</span>
          )}
        </div>
        <p className={`text-sm ${tMuted}`}>{lead.contact_name}{lead.contact_phone ? ` · ${lead.contact_phone}` : ''}</p>
        {lead.next_followup_date && (
          <div className={`inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium ${
            lead.next_followup_date <= today ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] ' + tMuted
          }`}>
            <Clock className="h-3 w-3" />
            {lead.next_followup_date <= today ? 'Overdue · ' : 'Follow-up · '}{lead.next_followup_date}
          </div>
        )}
      </div>

      {lead.contact_phone && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <a href={`tel:${lead.contact_phone}`}
            onClick={() => setTimeout(() => setView('call_outcome'), 1800)}
            className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 active:scale-95 transition-transform">
            <Phone className="h-6 w-6" />
            <span className="text-xs font-bold">Call</span>
          </a>
          <button onClick={() => setView('wa_templates')}
            className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20 active:scale-95 transition-transform">
            <MessageSquare className="h-6 w-6" />
            <span className="text-xs font-bold">WhatsApp</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <button onClick={() => setView('call_outcome')}
          className={`flex flex-col items-center gap-1.5 py-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] active:opacity-70`}>
          <StickyNote className={`h-4 w-4 ${tMuted}`} />
          <span className={`text-[10px] font-medium ${tSec}`}>Log Call</span>
        </button>
        <button onClick={() => setView('log_note')}
          className={`flex flex-col items-center gap-1.5 py-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] active:opacity-70`}>
          <FileText className={`h-4 w-4 ${tMuted}`} />
          <span className={`text-[10px] font-medium ${tSec}`}>Add Note</span>
        </button>
        <button onClick={() => setView('stage')}
          className={`flex flex-col items-center gap-1.5 py-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] active:opacity-70`}>
          <ArrowRight className={`h-4 w-4 ${tMuted}`} />
          <span className={`text-[10px] font-medium ${tSec}`}>Move Stage</span>
        </button>
      </div>

      {perms.leads_details ? (
        <div className={`${card} rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs`}>
          {lead.lead_type    && <><span className={tMuted}>Type</span><span className={`${tSec} capitalize font-medium`}>{lead.lead_type}</span></>}
          {lead.source       && <><span className={tMuted}>Source</span><span className={`${tSec} font-medium`}>{lead.source}</span></>}
          {lead.assigned_name && <><span className={tMuted}>Assigned</span><span className={`${tSec} font-medium`}>{lead.assigned_name}</span></>}
          {lead.contact_email && (
            <div className="col-span-2 flex items-center gap-1">
              <span className={tMuted}>Email</span>
              <a href={`mailto:${lead.contact_email}`} className="text-[#e94560] truncate ml-2">{lead.contact_email}</a>
            </div>
          )}
          {lead.notes && (
            <div className="col-span-2">
              <span className={`block ${tMuted} mb-0.5`}>Last note</span>
              <span className={`${tSec} line-clamp-2`}>{lead.notes}</span>
            </div>
          )}
        </div>
      ) : (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-primary)] text-xs ${tMuted}`}>
          <Lock className="h-3.5 w-3.5 flex-shrink-0" /> Contact details restricted — trainee access
        </div>
      )}
    </div>
  );

  /* ── STAGE ── */
  if (view === 'stage') return (
    <div className="px-4 pb-8 pt-2">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('main')} className={`${tMuted} p-1`}><ChevronLeft className="h-5 w-5" /></button>
        <h3 className={`font-bold ${tPri}`}>Move to Stage</h3>
      </div>
      <div className="space-y-2">
        {STAGES.map(s => {
          const st = STAGE[s];
          const isCurrent = s === lead.stage;
          return (
            <button key={s} onClick={() => !isCurrent && moveStage(s)} disabled={saving || isCurrent}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                isCurrent
                  ? `${st.cls} opacity-60`
                  : `bg-[var(--bg-primary)] border-[var(--border-color)] ${tSec} hover:border-[#e94560]/60 active:opacity-70`
              }`}>
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${st.dot}`} />
              <span className="font-medium text-sm">{st.label}</span>
              {isCurrent && <span className="ml-auto text-[10px] opacity-60">Current</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ── CALL OUTCOME ── */
  if (view === 'call_outcome') return (
    <div className="px-4 pb-8 pt-2">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('main')} className={`${tMuted} p-1`}><ChevronLeft className="h-5 w-5" /></button>
        <h3 className={`font-bold ${tPri}`}>Log This Call</h3>
      </div>
      <p className={`text-sm ${tMuted} mb-3`}>How did the call go?</p>
      <div className="space-y-2 mb-4">
        {OUTCOMES.map(o => (
          <button key={o.id} onClick={() => setCallOutcome(o.id)}
            className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
              callOutcome === o.id
                ? 'bg-[#e94560]/10 border-[#e94560] text-[#e94560]'
                : `bg-[var(--bg-primary)] border-[var(--border-color)] ${tSec}`
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      <Input value={followupDate} type="date" onChange={e => setFollowupDate(e.target.value)}
        className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-10 mb-2"
        placeholder="Next follow-up date (optional)" />
      <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2}
        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-xl px-3 py-2.5 resize-none placeholder:text-[var(--text-muted)] mb-4"
        placeholder="Quick note (optional)..." />
      <button onClick={() => callOutcome && saveCallLog(callOutcome)} disabled={!callOutcome || saving}
        className="w-full py-3.5 rounded-xl bg-[#e94560] text-white font-bold text-sm disabled:opacity-40">
        {saving ? 'Saving...' : 'Save & Log Call'}
      </button>
    </div>
  );

  /* ── WHATSAPP TEMPLATES ── */
  if (view === 'wa_templates') return (
    <div className="px-4 pb-8 pt-2">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('main')} className={`${tMuted} p-1`}><ChevronLeft className="h-5 w-5" /></button>
        <h3 className={`font-bold ${tPri}`}>WhatsApp</h3>
      </div>
      <div className="space-y-2 mb-3">
        {waTemplates(lead).map(t => (
          <button key={t.label} onClick={() => openWa(lead.contact_phone, t.msg)}
            className="w-full text-left px-4 py-3 rounded-xl border bg-[var(--bg-primary)] border-[var(--border-color)] active:opacity-70 transition-opacity">
            <p className={`text-sm font-semibold ${tPri} mb-0.5`}>{t.label}</p>
            <p className={`text-[11px] ${tMuted} line-clamp-2`}>{t.msg}</p>
          </button>
        ))}
      </div>
      <button onClick={() => openWa(lead.contact_phone)}
        className="w-full py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-semibold active:opacity-70">
        Open WhatsApp (blank)
      </button>
    </div>
  );

  /* ── LOG NOTE ── */
  if (view === 'log_note') return (
    <div className="px-4 pb-8 pt-2">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setView('main')} className={`${tMuted} p-1`}><ChevronLeft className="h-5 w-5" /></button>
        <h3 className={`font-bold ${tPri}`}>Add Note</h3>
      </div>
      <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={5} autoFocus
        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-xl px-3 py-3 resize-none placeholder:text-[var(--text-muted)] mb-4"
        placeholder="Meeting notes, call summary, next steps..." />
      <button onClick={saveNote} disabled={!noteText.trim() || saving}
        className="w-full py-3.5 rounded-xl bg-[#e94560] text-white font-bold text-sm disabled:opacity-40">
        {saving ? 'Saving...' : 'Save Note'}
      </button>
    </div>
  );

  return null;
}
