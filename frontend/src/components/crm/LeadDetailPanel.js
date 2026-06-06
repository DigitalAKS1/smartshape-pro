import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import {
  Phone, MessageSquare, Mail, Calendar, Clock, CheckCircle,
  AlertTriangle, User, UserCog, Edit2, MapPin, Target,
  ChevronRight, UserPlus, Package, Lock, FileText, Zap, X,
} from 'lucide-react';
import { STAGES, LOST_REASONS } from '../../lib/crmConstants';
import { formatDate } from '../../lib/utils';
import { dripSequences as dripSequencesApi } from '../../lib/api';
import EmptyState, { EMPTY_STATES } from '../ui/EmptyState';
import { useTheme } from '../../contexts/ThemeContext';
import DemoChooserDialog from './DemoChooserDialog';

const NOTE_TYPES = [
  { id: 'call', label: 'Call', icon: Phone },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'meeting', label: 'Meeting', icon: Calendar },
  { id: 'note', label: 'Note', icon: Edit2 },
];

export default function LeadDetailPanel({
  detailLead, setDetailLead,
  notes, leadFollowups, physicalDispatches, leadVisits, leadEnrollments,
  noteForm, setNoteForm,
  fuForm, setFuForm,
  pdForm, setPdForm,
  enrollDialogOpen, setEnrollDialogOpen,
  selectedSequenceId, setSelectedSequenceId,
  setLeadEnrollments,
  dripSequencesList, allQuotations,
  addNote, addFollowup, completeFollowup,
  addPhysicalDispatch, markDispatchReceived,
  changeStage,
  openEditLead,
  openCreateTask,
  openWaForLead,
  setReassignLead, setReassignBulkIds, setReassignOpen,
  fetchData,
}) {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [lostOpen, setLostOpen] = React.useState(false);
  const [lostReason, setLostReason] = React.useState('');
  const [lostNote, setLostNote] = React.useState('');
  const [demoOpen, setDemoOpen] = React.useState(false);

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const hoverBg = isDark ? 'hover:bg-[var(--bg-hover)]' : 'hover:bg-[#f0f0f5]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';

  if (!detailLead) return null;

  const OPEN_STAGES = ['new', 'contacted', 'demo', 'quoted', 'negotiation'];
  const fuOverdue = !!detailLead.next_followup_date &&
    new Date(detailLead.next_followup_date) < new Date(new Date().toDateString());
  const noNext = !detailLead.next_followup_date;
  const needsNextAction = OPEN_STAGES.includes(detailLead.stage) && (fuOverdue || noNext);

  // Intercept stage change: moving to "lost" requires a reason
  const handleStageClick = (stageId) => {
    if (stageId === 'lost' && detailLead.stage !== 'lost') {
      setLostReason(''); setLostNote(''); setLostOpen(true);
      return;
    }
    if (stageId === 'demo' && detailLead.stage !== 'demo') {
      setDemoOpen(true);
      return;
    }
    changeStage(detailLead.lead_id, stageId);
  };

  return (
    <>
      {/* LEAD DETAIL DIALOG */}
      <Dialog open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={`${textPri} text-lg flex items-center justify-between`}>
              <div>
                <span>{detailLead.company_name || detailLead.contact_name}</span>
                {detailLead.lead_score > 0 && <span className="ml-2 text-sm px-2 py-0.5 rounded bg-[#e94560]/20 text-[#e94560] font-mono">{detailLead.lead_score}</span>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openWaForLead(detailLead)} className="text-green-500" data-testid="lead-wa-btn"><MessageSquare className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { setReassignLead(detailLead); setReassignBulkIds(null); setReassignOpen(true); }} className="text-[#e94560]" data-testid="lead-reassign-btn"><UserCog className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { openEditLead(detailLead); setDetailLead(null); }} className={textSec}><Edit2 className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => openCreateTask(detailLead)} className={textSec}><Calendar className="h-4 w-4" /></Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Info badges */}
            <div className={`flex items-center gap-3 text-sm ${textSec} flex-wrap`}>
              <span className="flex items-center gap-1"><User className="h-3 w-3" /> {detailLead.contact_name}</span>
              {detailLead.contact_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {detailLead.contact_phone}</span>}
              {detailLead.school_city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {detailLead.school_city}</span>}
              {detailLead.deal_value > 0 && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30" data-testid="detail-deal-value">
                  <Target className="h-3 w-3" /> ₹{Math.round(detailLead.deal_value).toLocaleString('en-IN')}
                  {detailLead.probability != null && <span className="opacity-70">· {detailLead.probability}% → ₹{Math.round(detailLead.weighted_value || 0).toLocaleString('en-IN')}</span>}
                </span>
              )}
              {detailLead.lost_reason && detailLead.stage === 'lost' && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                  <X className="h-3 w-3" /> Lost: {detailLead.lost_reason}
                </span>
              )}
              {detailLead.likely_closure_date && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30" data-testid="detail-likely-closure">
                  <Target className="h-3 w-3" /> Likely close: {detailLead.likely_closure_date}
                </span>
              )}
              {detailLead.visit_required && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30" data-testid="detail-visit-required">
                  <AlertTriangle className="h-3 w-3" /> Visit Required
                </span>
              )}
              {detailLead.is_locked && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] border border-[#e94560]/30" data-testid="detail-locked">
                  <Lock className="h-3 w-3" /> Locked (order placed)
                </span>
              )}
              {(detailLead.reassignment_count || 0) > 0 && (
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${detailLead.reassignment_count > 2 ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'}`} data-testid="detail-reassign-count">
                  <UserCog className="h-3 w-3" /> Reassigned {detailLead.reassignment_count}×
                </span>
              )}
              {detailLead.converted_from_contact && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  <UserPlus className="h-3 w-3" /> From: {detailLead.linked_contact_name || detailLead.converted_from_contact.slice(0, 10)}
                </span>
              )}
              {(detailLead.quotation_ids || []).map(qid => {
                const q = allQuotations.find(x => x.quotation_id === qid);
                return q ? (
                  <button key={qid} onClick={() => navigate(`/quotations/${qid}`)}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25 transition-colors">
                    <FileText className="h-3 w-3" /> {q.quote_number} · ₹{Math.round(q.grand_total || 0).toLocaleString('en-IN')}
                  </button>
                ) : null;
              })}
            </div>

            {/* Stage selector */}
            <div className="flex gap-1 flex-wrap">
              {STAGES.map(s => (
                <button key={s.id} onClick={() => handleStageClick(s.id)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-all ${detailLead.stage === s.id ? s.color + ' ring-1' : `${isDark ? 'border-[var(--border-color)] text-[var(--text-muted)]' : 'border-[var(--border-color)] text-[#888]'} ${hoverBg}`}`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Next-action nudge */}
            {needsNextAction && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-orange-500/10 border border-orange-500/30 text-orange-400" data-testid="next-action-nudge">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1">
                  {fuOverdue ? 'Follow-up is overdue.' : 'No next step scheduled.'} Set one below to keep this lead moving.
                </span>
              </div>
            )}

            {/* Convert to Order */}
            {['negotiation', 'won'].includes(detailLead.stage) && !detailLead.is_locked && (
              <Button onClick={async () => {
                let match = null;
                const linkedIds = detailLead.quotation_ids || [];
                if (linkedIds.length > 0) {
                  match = allQuotations.find(q => linkedIds.includes(q.quotation_id) && ['draft','sent','pending'].includes(q.quotation_status));
                  if (!match) match = allQuotations.find(q => linkedIds.includes(q.quotation_id));
                }
                if (!match) {
                  match = allQuotations.find(q => q.school_name === detailLead.company_name || q.school_name === detailLead.school_name);
                }
                if (!match) { toast.error('No quotation found for this school — create one first'); return; }
                if (!window.confirm(`Convert to order using quotation ${match.quote_number}? Lead will be locked (admin can unlock).`)) return;
                try {
                  const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/orders`, {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quotation_id: match.quotation_id, lead_id: detailLead.lead_id, payment_threshold_pct: 50 }),
                  });
                  const data = await r.json();
                  if (r.ok) {
                    toast.success(`Order ${data.order_number} created`);
                    setDetailLead(prev => ({ ...prev, is_locked: true, stage: 'won', order_id: data.order_id }));
                    fetchData();
                  } else {
                    toast.error(data.detail || 'Conversion failed');
                  }
                } catch { toast.error('Conversion failed'); }
              }} className="bg-green-600 hover:bg-green-700 text-white" data-testid="convert-to-order-btn">
                <Package className="mr-1 h-4 w-4" /> Convert to Order
              </Button>
            )}

            {/* Add Note */}
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 space-y-2">
              <div className="flex gap-1 flex-wrap">
                {NOTE_TYPES.map(nt => (
                  <button key={nt.id} onClick={() => setNoteForm({ ...noteForm, type: nt.id })}
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${noteForm.type === nt.id ? 'bg-[#e94560]/20 text-[#e94560]' : `${textMuted} ${hoverBg}`}`}>
                    <nt.icon className="h-3 w-3" /> {nt.label}
                  </button>
                ))}
              </div>
              <Input value={noteForm.content} onChange={e => setNoteForm({ ...noteForm, content: e.target.value })} placeholder="Log interaction..." className={`${inputCls} text-sm`} data-testid="note-input" />
              <div className="flex gap-2">
                <Input value={noteForm.outcome} onChange={e => setNoteForm({ ...noteForm, outcome: e.target.value })} placeholder="Outcome" className={`${inputCls} text-sm flex-1`} />
                <Button onClick={addNote} size="sm" className="bg-[#e94560] hover:bg-[#f05c75]" data-testid="add-note-button">Add</Button>
              </div>
            </div>

            {/* Schedule Follow-up */}
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
              <p className={`text-xs font-medium ${textSec} mb-2`}>Schedule Follow-up</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Input type="date" value={fuForm.followup_date} onChange={e => setFuForm({...fuForm, followup_date: e.target.value})} className={`${inputCls} text-sm`} />
                <Input type="time" value={fuForm.followup_time} onChange={e => setFuForm({...fuForm, followup_time: e.target.value})} className={`${inputCls} text-sm`} />
                <select value={fuForm.followup_type} onChange={e => setFuForm({...fuForm, followup_type: e.target.value})} className={`h-10 px-2 rounded text-sm ${inputCls}`}>
                  <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option>
                </select>
                <Button onClick={addFollowup} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] h-10 w-full">Schedule</Button>
              </div>
            </div>

            {/* Follow-ups list */}
            {leadFollowups.length > 0 && (
              <div>
                <p className={`text-xs font-medium ${textSec} mb-2`}>Follow-ups ({leadFollowups.length})</p>
                <div className="space-y-1">
                  {leadFollowups.map(fu => (
                    <div key={fu.followup_id} className={`flex items-center justify-between text-sm ${card} border rounded p-2`}>
                      <div>
                        <span className={textPri}>{fu.followup_date} {fu.followup_time}</span>
                        <span className={`ml-2 text-xs ${textMuted} capitalize`}>{fu.followup_type}</span>
                        {fu.notes && <span className={`ml-2 text-xs ${textMuted}`}>- {fu.notes}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${fu.status === 'completed' ? 'bg-green-500/20 text-green-400' : fu.status === 'missed' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{fu.status}</span>
                        {fu.status === 'pending' && (
                          <Button size="sm" variant="ghost" onClick={() => completeFollowup(fu.followup_id)} className="text-green-400 h-6"><CheckCircle className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Visit History */}
            {leadVisits.length > 0 && (
              <div>
                <p className={`text-xs font-medium ${textSec} mb-2`}>Visit History ({leadVisits.length})</p>
                <div className="space-y-1.5">
                  {leadVisits.map((v, i) => (
                    <div key={v.visit_id || i} className={`${card} border rounded-md p-2.5 space-y-0.5`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-semibold ${textPri}`}>{v.visit_date}{v.visit_time ? ` · ${v.visit_time}` : ''}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          v.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                          v.status === 'checked_in' ? 'bg-blue-500/15 text-blue-400' :
                          v.status === 'cancelled' ? 'bg-red-500/15 text-red-400' :
                          'bg-amber-500/15 text-amber-400'
                        }`}>{v.status}</span>
                      </div>
                      {v.rep_name && <p className={`text-xs ${textMuted}`}>Rep: {v.rep_name}</p>}
                      {v.purpose  && <p className={`text-xs ${textMuted}`}>Purpose: {v.purpose}</p>}
                      {v.outcome  && <p className={`text-xs ${textMuted}`}>Outcome: {v.outcome}</p>}
                      {v.check_in_time && (
                        <p className={`text-xs ${textMuted}`}>
                          Checked in: {new Date(v.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          {v.check_out_time && ` → ${new Date(v.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Physical Dispatches */}
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
              <p className={`text-xs font-medium ${textSec} mb-2`}>Physical Material Sent ({physicalDispatches.length})</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                <select value={pdForm.material_type} onChange={e => setPdForm({...pdForm, material_type: e.target.value})} className={`h-9 px-2 rounded text-xs ${inputCls}`}>
                  <option value="brochure">Brochure</option>
                  <option value="sample">Sample</option>
                  <option value="die">Die</option>
                  <option value="catalogue">Catalogue</option>
                  <option value="gift">Gift</option>
                </select>
                <Input value={pdForm.description} onChange={e => setPdForm({...pdForm, description: e.target.value})} placeholder="Description" className={`${inputCls} text-xs h-9 sm:col-span-2`} />
                <Input value={pdForm.courier_name} onChange={e => setPdForm({...pdForm, courier_name: e.target.value})} placeholder="Courier" className={`${inputCls} text-xs h-9`} />
                <Input value={pdForm.tracking_number} onChange={e => setPdForm({...pdForm, tracking_number: e.target.value})} placeholder="Tracking #" className={`${inputCls} text-xs h-9`} />
                <Input type="date" value={pdForm.sent_date} onChange={e => setPdForm({...pdForm, sent_date: e.target.value})} className={`${inputCls} text-xs h-9`} />
                <Button onClick={addPhysicalDispatch} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] h-9 text-xs col-span-2 sm:col-span-1">Log</Button>
              </div>
              {physicalDispatches.length > 0 && (
                <div className="space-y-1">
                  {physicalDispatches.map(d => (
                    <div key={d.dispatch_id} className={`flex items-center justify-between text-xs ${card} border rounded p-2`}>
                      <div>
                        <span className={`font-medium ${textPri} capitalize`}>{d.material_type}</span>
                        {d.description && <span className={`ml-1 ${textMuted}`}>— {d.description}</span>}
                        <span className={`ml-2 ${textMuted}`}>{d.sent_date}</span>
                        {d.courier_name && <span className={`ml-1 ${textMuted}`}>via {d.courier_name}</span>}
                        {d.tracking_number && <span className={`ml-1 text-blue-400`}>#{d.tracking_number}</span>}
                      </div>
                      {d.received_confirmed
                        ? <span className="text-green-400 text-xs">Received</span>
                        : <Button size="sm" variant="ghost" onClick={() => markDispatchReceived(d.dispatch_id)} className={`text-xs h-6 ${textMuted}`}>Mark Received</Button>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity Timeline */}
            <div data-testid="notes-timeline">
              <p className={`text-xs font-medium ${textSec} mb-2`}>Activity ({notes.length})</p>
              {notes.map(note => {
                const nt = NOTE_TYPES.find(n => n.id === note.type) || NOTE_TYPES[4];
                return (
                  <div key={note.note_id} className="flex gap-2 text-sm mb-2">
                    <div className={`w-7 h-7 rounded-full ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f0f0f5]'} flex items-center justify-center flex-shrink-0`}>
                      <nt.icon className="h-3 w-3 text-[#e94560]" />
                    </div>
                    <div className="flex-1 border-l border-[var(--border-color)] pl-2 pb-2">
                      <p className={textPri}>{note.content}</p>
                      {note.outcome && <p className={`text-xs ${textMuted}`}>Outcome: {note.outcome}</p>}
                      <p className={`text-xs ${textMuted}`}>{note.created_by_name} - {formatDate(note.created_at)}</p>
                    </div>
                  </div>
                );
              })}
              {notes.length === 0 && <EmptyState {...EMPTY_STATES.callNotes} compact />}
            </div>

            {/* Pipeline History */}
            {Array.isArray(detailLead.pipeline_history) && detailLead.pipeline_history.length > 0 && (
              <div data-testid="pipeline-history">
                <p className={`text-xs font-medium ${textSec} mb-2`}>Pipeline History ({detailLead.pipeline_history.length})</p>
                <div className="space-y-1.5">
                  {detailLead.pipeline_history.map((h, i) => {
                    const fromObj = STAGES.find(s => s.id === h.from_stage);
                    const toObj = STAGES.find(s => s.id === h.to_stage) || STAGES[0];
                    return (
                      <div key={i} className={`flex items-center gap-2 text-xs ${card} border rounded px-2.5 py-1.5`}>
                        {fromObj ? <span className={`px-1.5 py-0.5 rounded font-medium border ${fromObj.color} text-[10px]`}>{fromObj.label}</span> : <span className={`text-[10px] ${textMuted}`}>—</span>}
                        <ChevronRight className="h-3 w-3" />
                        <span className={`px-1.5 py-0.5 rounded font-medium border ${toObj.color} text-[10px]`}>{toObj.label}</span>
                        <span className={`flex-1 ${textMuted} truncate`}>{h.note}</span>
                        <span className={`${textMuted}`}>{h.by_name?.split(' ')[0]} • {formatDate(h.at)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Reassignment History */}
            {Array.isArray(detailLead.reassignments) && detailLead.reassignments.length > 0 && (
              <div data-testid="reassignment-history">
                <p className={`text-xs font-medium ${textSec} mb-2 flex items-center gap-1`}><UserCog className="h-3 w-3" /> Reassignment History ({detailLead.reassignments.length})</p>
                <div className="space-y-1.5">
                  {detailLead.reassignments.map((r, i) => (
                    <div key={i} className={`text-xs ${card} border rounded px-2.5 py-1.5`}>
                      <div className="flex items-center gap-2">
                        <span className={`${textSec}`}>{r.from_name || 'Unassigned'}</span>
                        <ChevronRight className="h-3 w-3" />
                        <span className={`${textPri} font-medium`}>{r.to_name}</span>
                        <span className={`flex-1 ${textMuted} text-right`}>by {r.by_name?.split(' ')[0]} • {formatDate(r.at)}</span>
                      </div>
                      <p className={`${textMuted} mt-0.5 italic`}>"{r.reason}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Drip Sequences */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-medium ${textSec} flex items-center gap-1`}><Zap className="h-3 w-3" /> Drip Sequences ({leadEnrollments.length})</p>
                <Button size="sm" variant="outline"
                  onClick={() => { setSelectedSequenceId(''); setEnrollDialogOpen(true); }}
                  className={`h-6 text-xs border-[var(--border-color)] ${textSec} px-2`}>+ Enroll</Button>
              </div>
              {leadEnrollments.length > 0 ? (
                <div className="space-y-1">
                  {leadEnrollments.map(enr => {
                    const seq = dripSequencesList.find(s => s.sequence_id === enr.sequence_id);
                    return (
                      <div key={enr.enrollment_id} className={`flex items-center justify-between text-xs ${card} border rounded px-2.5 py-1.5`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`${textPri} font-medium truncate`}>{seq?.name || enr.sequence_id}</span>
                          <span className={`${textMuted} flex-shrink-0`}>Step {(enr.current_step || 0) + 1}</span>
                          {enr.next_step_at && <span className={`${textMuted} flex-shrink-0`}>· Next: {formatDate(enr.next_step_at)}</span>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            enr.status === 'active' ? 'bg-green-500/20 text-green-400'
                            : enr.status === 'completed' ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-gray-500/20 text-gray-400'
                          }`}>{enr.status}</span>
                          {enr.status === 'active' && (
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                try {
                                  await dripSequencesApi.cancelEnrollment(enr.enrollment_id);
                                  setLeadEnrollments(prev => prev.map(e => e.enrollment_id === enr.enrollment_id ? { ...e, status: 'cancelled' } : e));
                                  toast.success('Enrollment cancelled');
                                } catch { toast.error('Failed to cancel'); }
                              }}
                              className="text-red-400 h-6 w-6 p-0">
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className={`text-xs ${textMuted}`}>Not enrolled in any sequence</p>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lost Reason Dialog */}
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Why was this lead lost?</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <select value={lostReason} onChange={e => setLostReason(e.target.value)}
              className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="lost-reason-select">
              <option value="">-- Select a reason --</option>
              {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <Input value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="Optional note" className={`${inputCls} text-sm`} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setLostOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button disabled={!lostReason} data-testid="lost-reason-confirm"
              onClick={async () => {
                await changeStage(detailLead.lead_id, 'lost', { lost_reason: lostReason, lost_reason_note: lostNote });
                setLostOpen(false);
              }}
              className="bg-red-600 hover:bg-red-700 text-white">Mark Lost</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Enroll in Drip Dialog */}
      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Enroll in Drip Sequence</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <select value={selectedSequenceId} onChange={e => setSelectedSequenceId(e.target.value)}
              className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
              <option value="">-- Choose sequence --</option>
              {dripSequencesList.filter(s => s.is_active).map(s => (
                <option key={s.sequence_id} value={s.sequence_id}>
                  {s.name} ({(s.steps || []).length} steps)
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setEnrollDialogOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button
              disabled={!selectedSequenceId}
              onClick={async () => {
                if (!detailLead) return;
                try {
                  const res = await dripSequencesApi.enroll({ sequence_id: selectedSequenceId, lead_id: detailLead.lead_id });
                  setLeadEnrollments(prev => [res.data, ...prev]);
                  setEnrollDialogOpen(false);
                  toast.success('Enrolled in sequence');
                } catch (err) {
                  toast.error(err.response?.data?.detail || 'Enrollment failed');
                }
              }}
              className="bg-[#e94560] hover:bg-[#f05c75] text-white">
              Enroll
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DemoChooserDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        lead={detailLead}
        onDone={(updated) => { setDetailLead(updated); fetchData(); }}
      />
    </>
  );
}
