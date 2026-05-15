import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { leads as leadsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getSalesPermissions } from '../../lib/salesPermissions';
import { toast } from 'sonner';
import {
  Phone, MessageSquare, Search, Building2, Clock,
  ChevronLeft, AlignJustify, LayoutGrid, MapPin, StickyNote,
  AlertTriangle, ArrowRight, Lock, FileText,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

// ── Design tokens ──────────────────────────────────────────
const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const STAGES = ['new','contacted','demo','quoted','negotiation','won','lost'];
const STAGE = {
  new:         { label: 'New',         cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',   dot: 'bg-blue-400' },
  contacted:   { label: 'Contacted',   cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
  demo:        { label: 'Demo',        cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' },
  quoted:      { label: 'Quoted',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30', dot: 'bg-orange-400' },
  negotiation: { label: 'Negotiation', cls: 'bg-pink-500/20 text-pink-400 border-pink-500/30',   dot: 'bg-pink-400' },
  won:         { label: 'Won',         cls: 'bg-green-500/20 text-green-400 border-green-500/30', dot: 'bg-green-400' },
  lost:        { label: 'Lost',        cls: 'bg-red-500/20 text-red-400 border-red-500/30',      dot: 'bg-red-400' },
};
const TYPE_CLS = {
  hot:  'bg-red-500/20 text-red-400',
  warm: 'bg-yellow-500/20 text-yellow-400',
  cold: 'bg-blue-500/20 text-blue-400',
};

const openWa = (phone, msg = '') => {
  const n = phone?.replace(/\D/g, '');
  if (!n) return;
  const num = n.startsWith('91') ? n : '91' + n;
  window.open(msg ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/${num}`, '_blank');
};

const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;

const waTemplates = (lead) => [
  {
    label: '👋 Introduction',
    msg: `Hello ${lead?.contact_name || 'Sir/Ma\'am'}, I\'m from SmartShape Sports. We offer premium sports equipment for schools. Would you be available for a brief demo? 🏅`,
  },
  {
    label: '📋 Follow-up',
    msg: `Hi ${lead?.contact_name || 'Sir/Ma\'am'}, following up on our earlier conversation about SmartShape equipment for ${lead?.company_name || 'your school'}. Shall we schedule a visit? 🏆`,
  },
  {
    label: '📤 Share Catalogue',
    msg: `Dear ${lead?.contact_name || 'Sir/Ma\'am'}, sharing our latest product catalogue. Our range includes world-class sports & fitness equipment. Looking forward to your feedback! 🎯`,
  },
];

// ── Bottom Sheet wrapper ───────────────────────────────────
function BottomSheet({ open, onClose, children }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
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

// ── Action Sheet (the core UX piece) ──────────────────────
function LeadActionSheet({ lead, onClose, onStageChange, onRefresh, perms }) {
  const [view, setView]             = useState('main');
  const [callOutcome, setCallOutcome] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [noteText, setNoteText]     = useState('');
  const [saving, setSaving]         = useState(false);
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

      {/* Primary: Call + WhatsApp */}
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

      {/* Secondary actions */}
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

      {/* Detail info */}
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
            className={`w-full text-left px-4 py-3 rounded-xl border bg-[var(--bg-primary)] border-[var(--border-color)] active:opacity-70 transition-opacity`}>
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

// ── Kanban Card ────────────────────────────────────────────
function KanbanCard({ lead, onTap }) {
  const today  = new Date().toISOString().split('T')[0];
  const overdue = lead.next_followup_date && lead.next_followup_date < today;
  const ds     = daysSince(lead.last_activity_date || lead.updated_at);
  return (
    <button onClick={() => onTap(lead)}
      className={`w-full text-left p-3 rounded-xl border transition-all active:scale-95 ${
        overdue ? 'bg-[#e94560]/5 border-[#e94560]/30' : card
      }`}>
      <p className={`text-xs font-bold ${tPri} leading-tight truncate mb-0.5`}>
        {lead.company_name || lead.contact_name}
      </p>
      <p className={`text-[10px] ${tMuted} truncate mb-2`}>{lead.contact_name}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {lead.lead_type && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[lead.lead_type] || ''}`}>{lead.lead_type}</span>
        )}
        {overdue && <AlertTriangle className="h-3 w-3 text-[#e94560]" />}
        {ds !== null && <span className={`text-[9px] ${tMuted} ml-auto`}>{ds}d</span>}
      </div>
      {lead.contact_phone && (
        <div className="flex gap-1.5 mt-2">
          <a href={`tel:${lead.contact_phone}`} onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-blue-500/10 text-blue-400">
            <Phone className="h-3 w-3" />
          </a>
          <button onClick={e => { e.stopPropagation(); openWa(lead.contact_phone); }}
            className="flex-1 flex items-center justify-center py-1.5 rounded-lg bg-green-500/10 text-green-400">
            <MessageSquare className="h-3 w-3" />
          </button>
        </div>
      )}
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function SalesLeads() {
  const { user }  = useAuth();
  const today     = new Date().toISOString().split('T')[0];
  const perms     = getSalesPermissions(user?.sales_role);

  const [leads, setLeads]         = useState([]);
  const [search, setSearch]       = useState('');
  const [stageFilter, setStageFilter] = useState('active');
  const [loading, setLoading]     = useState(true);
  const [viewMode, setViewMode]   = useState(() => localStorage.getItem('leads_view') || 'list');
  const [selectedLead, setSelectedLead] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { fetchLeads(); }, []);

  const fetchLeads = async () => {
    try {
      const res = await leadsApi.getAll();
      setLeads(res.data || []);
    } catch { toast.error('Failed to load leads'); }
    finally { setLoading(false); }
  };

  const switchView = (v) => { setViewMode(v); localStorage.setItem('leads_view', v); };

  const openSheet = (lead) => { setSelectedLead(lead); setSheetOpen(true); };

  const handleStageChange = (leadId, newStage) =>
    setLeads(prev => prev.map(l => l.lead_id === leadId ? { ...l, stage: newStage } : l));

  const counts = {};
  leads.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  const activeCount = leads.filter(l => !['won','lost'].includes(l.stage)).length;

  const filtered = leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s ||
      l.company_name?.toLowerCase().includes(s) ||
      l.contact_name?.toLowerCase().includes(s) ||
      l.contact_phone?.includes(s);
    const matchStage =
      stageFilter === 'all'    ? true :
      stageFilter === 'active' ? !['won','lost'].includes(l.stage) :
      l.stage === stageFilter;
    return matchSearch && matchStage;
  });

  if (loading) return (
    <SalesLayout title="Pipeline">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Pipeline">
      <div className="pb-28">

        {/* Search + View toggle */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMuted}`} />
            <Input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)}
              className={`pl-9 bg-[var(--bg-card)] border-[var(--border-color)] ${tPri} h-10`} />
          </div>
          <button onClick={() => switchView(viewMode === 'list' ? 'kanban' : 'list')}
            className={`${card} rounded-xl h-10 w-10 flex items-center justify-center flex-shrink-0`}
            title={viewMode === 'list' ? 'Kanban view' : 'List view'}>
            {viewMode === 'list'
              ? <LayoutGrid className={`h-4 w-4 ${tMuted}`} />
              : <AlignJustify className={`h-4 w-4 ${tMuted}`} />}
          </button>
        </div>

        {/* Stage filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar mb-4">
          {[
            { id: 'active', label: `Active (${activeCount})` },
            { id: 'all',    label: `All (${leads.length})` },
            ...STAGES.map(s => ({ id: s, label: `${STAGE[s].label} (${counts[s] || 0})` })),
          ].map(f => (
            <button key={f.id} onClick={() => setStageFilter(f.id)}
              className={`flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full font-medium border transition-all ${
                stageFilter === f.id ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} ${tMuted}`
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── KANBAN VIEW ── */}
        {viewMode === 'kanban' && (
          <>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 no-scrollbar">
              {STAGES
                .filter(s => stageFilter === 'active' ? !['lost'].includes(s) : stageFilter === 'all' ? true : s === stageFilter)
                .map(s => {
                  const st = STAGE[s];
                  const colLeads = filtered.filter(l => l.stage === s);
                  return (
                    <div key={s} className="flex-shrink-0 w-[200px]">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className={`w-2 h-2 rounded-full ${st.dot}`} />
                        <span className={`text-xs font-semibold ${tSec}`}>{st.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] ${tMuted} ml-auto`}>{colLeads.length}</span>
                      </div>
                      <div className="space-y-2">
                        {colLeads.length === 0 ? (
                          <div className="h-16 rounded-xl border-2 border-dashed border-[var(--border-color)] flex items-center justify-center">
                            <span className={`text-[10px] ${tMuted}`}>Empty</span>
                          </div>
                        ) : colLeads.map(lead => (
                          <KanbanCard key={lead.lead_id} lead={lead} onTap={openSheet} />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className={`text-[10px] ${tMuted} text-center mt-1`}>Tap a card → log call, change stage, send WhatsApp</p>
          </>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && (
          <div className="space-y-2">
            <p className={`text-xs ${tMuted} mb-1`}>{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.length === 0 ? (
              <div className={`${card} rounded-xl p-10 text-center`}>
                <Building2 className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
                <p className={`text-sm ${tMuted}`}>No leads found</p>
              </div>
            ) : filtered.map(lead => {
              const st      = STAGE[lead.stage] || STAGE.new;
              const overdue = lead.next_followup_date && lead.next_followup_date <= today;
              return (
                <button key={lead.lead_id} onClick={() => openSheet(lead)}
                  className={`w-full text-left ${card} ${overdue ? 'border-[#e94560]/40' : ''} rounded-xl p-3 active:opacity-75 transition-opacity`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${tPri} truncate`}>{lead.company_name || lead.contact_name}</p>
                      <p className={`text-[11px] ${tMuted} truncate`}>
                        {lead.contact_name}{lead.contact_phone ? ` · ${lead.contact_phone}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {lead.lead_type && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[lead.lead_type] || ''}`}>{lead.lead_type}</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                  {lead.next_followup_date && (
                    <div className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full mb-2 ${
                      overdue ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] ' + tMuted
                    }`}>
                      <Clock className="h-3 w-3" />
                      {overdue ? 'Overdue · ' : 'Follow-up · '}{lead.next_followup_date}
                    </div>
                  )}
                  {lead.contact_phone && (
                    <div className="flex gap-2">
                      <a href={`tel:${lead.contact_phone}`} onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 font-medium">
                        <Phone className="h-3 w-3" /> Call
                      </a>
                      <button onClick={e => { e.stopPropagation(); openSheet(lead); }}
                        className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 font-medium">
                        <MessageSquare className="h-3 w-3" /> WhatsApp
                      </button>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Bottom Sheet */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <LeadActionSheet
          lead={selectedLead}
          onClose={() => setSheetOpen(false)}
          onStageChange={handleStageChange}
          onRefresh={fetchLeads}
          perms={perms}
        />
      </BottomSheet>
    </SalesLayout>
  );
}
