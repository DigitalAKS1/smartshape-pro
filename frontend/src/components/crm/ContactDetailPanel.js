import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Phone, PhoneCall, X, Clock, CheckCircle2, BookOpen, Zap } from 'lucide-react';
import { startCall } from '../../lib/callBus';
import { dealTypes as dealTypesApi, dripSequences as dripApi } from '../../lib/api';
import ShareBrochureDialog from './ShareBrochureDialog';

/** Trigger a Bonvoice click-to-call and open the live call widget. Rings the rep's
 *  phone first, then the customer. Surfaces the backend's 409/422 message when
 *  calling is off or the record has no phone. */
export async function callViaBonvoice({ kind, ref_id, label }) {
  return startCall({ kind, ref_id, label });
}

export const CALL_OUTCOMES = [
  { value: 'connected',    label: 'Connected',         color: 'bg-green-100 text-green-700' },
  { value: 'no_answer',    label: 'No answer',         color: 'bg-amber-100 text-amber-700' },
  { value: 'busy',         label: 'Busy',              color: 'bg-orange-100 text-orange-700' },
  { value: 'wrong_number', label: 'Wrong number',      color: 'bg-red-100 text-red-700' },
  { value: 'callback',     label: 'Callback requested', color: 'bg-blue-100 text-blue-700' },
];

export function CallStatusBadge({ contact }) {
  if (!contact?.last_call_at) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Never contacted</span>;
  }
  const o = CALL_OUTCOMES.find(x => x.value === contact.last_call_outcome);
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full ${o ? o.color : 'bg-slate-100 text-slate-600'}`}>
      {o ? o.label : 'Called'}
    </span>
  );
}

const DRIP_STATUS_CLS = {
  active: 'bg-green-500/20 text-green-500',
  completed: 'bg-blue-500/20 text-blue-500',
  paused: 'bg-yellow-500/20 text-yellow-600',
};

/** The drip sequences this CONTACT is enrolled in directly (D5) — sequence,
 *  status, step — with Cancel, and Resume for a paused one. Mirrors the lead
 *  panel's list: an enrolment stopped with a `cancel_reason` (bulk-cancelled,
 *  or stopped because the person was deleted) offers no Resume — resuming
 *  would fire a stale step — only "re-enrol". */
export function ContactDripSection({ contactId }) {
  const [rows, setRows] = useState(null);           // null = loading
  const [seqs, setSeqs] = useState({});

  useEffect(() => {
    if (!contactId) return undefined;
    let alive = true;
    setRows(null);
    Promise.all([
      dripApi.enrollments({ contact_id: contactId }),
      dripApi.getAll().catch(() => ({ data: [] })),
    ]).then(([e, s]) => {
      if (!alive) return;
      setRows(Array.isArray(e?.data) ? e.data : []);
      setSeqs(Object.fromEntries((s?.data || []).map(x => [x.sequence_id, x])));
    }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [contactId]);

  const patch = (id, change) => setRows(prev => (prev || []).map(r => (r.enrollment_id === id ? { ...r, ...change } : r)));

  const cancel = async (enr) => {
    try {
      await dripApi.cancelEnrollment(enr.enrollment_id);
      patch(enr.enrollment_id, { status: 'cancelled' });
      toast.success('Enrollment cancelled');
    } catch { toast.error('Failed to cancel'); }
  };
  const resume = async (enr) => {
    try {
      await dripApi.resumeEnrollment(enr.enrollment_id);
      patch(enr.enrollment_id, { status: 'active', paused_reason: '' });
      toast.success('Back in the sequence — the next step runs shortly');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not resume'); }
  };

  return (
    <div className="border-t border-[var(--border-color)] pt-3 mt-3" data-testid="contact-drips">
      <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 flex items-center gap-1">
        <Zap className="h-3 w-3" /> Drip sequences{rows ? ` (${rows.length})` : ''}
      </p>
      {rows === null ? (
        <p className="text-[11px] text-[var(--text-secondary)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-secondary)]">Not enrolled in any sequence</p>
      ) : (
        <div className="space-y-1">
          {rows.map(enr => {
            const seq = seqs[enr.sequence_id];
            const total = (seq?.steps || []).length;
            const stopped = enr.status === 'cancelled' && enr.cancel_reason;
            return (
              <div key={enr.enrollment_id} data-testid={`contact-drip-${enr.enrollment_id}`}
                className="flex items-center justify-between gap-2 text-xs border border-[var(--border-color)] rounded px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--text-primary)] truncate">{seq?.name || enr.sequence_id}</p>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    Step {Math.min((enr.current_step || 0) + 1, total || Infinity)}{total ? ` of ${total}` : ''}
                    {enr.status === 'paused' && enr.paused_reason ? ` · ${enr.paused_reason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DRIP_STATUS_CLS[enr.status] || 'bg-gray-500/20 text-gray-500'}`}>{enr.status}</span>
                  {enr.status === 'active' && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(enr)}
                      title="Stop this sequence for this contact" aria-label="Cancel enrolment"
                      data-testid={`cancel-contact-drip-${enr.enrollment_id}`}
                      className="text-red-500 h-6 w-6 p-0"><X className="h-3 w-3" /></Button>
                  )}
                  {(enr.status === 'paused' || enr.status === 'cancelled') && !enr.cancel_reason && (
                    <Button size="sm" variant="ghost" onClick={() => resume(enr)}
                      data-testid={`resume-contact-drip-${enr.enrollment_id}`}
                      className="text-green-600 h-6 px-1.5 text-[10px]">Resume</Button>
                  )}
                  {stopped && (
                    <span className="text-[10px] italic text-[var(--text-secondary)]" title={enr.cancel_reason}>
                      {/in bulk/i.test(enr.cancel_reason) ? 'Cancelled in bulk' : 'Stopped'} — re-enrol to continue
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'call',     label: 'Call & Follow-up' },
  { id: 'history',  label: 'History' },
];

export default function ContactDetailPanel({
  detailContact, setDetailContact,
  contactActivity = [], contactFollowups = [],
  logContactCall, addContactFollowup, completeContactFollowup,
}) {
  const [tab, setTab] = useState('call');
  const [outcome, setOutcome] = useState('connected');
  const [notes, setNotes] = useState('');
  const [dealType, setDealType] = useState('');
  const [dealTypesList, setDealTypesList] = useState([]);
  const [fuForm, setFuForm] = useState({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  const [brochureOpen, setBrochureOpen] = useState(false);

  useEffect(() => {
    setTab('call');
    setOutcome('connected');
    setNotes('');
    setDealType(detailContact?.deal_type || '');
    setFuForm({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  }, [detailContact?.contact_id]); // eslint-disable-line

  useEffect(() => {
    dealTypesApi.getAll().then(r => setDealTypesList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  if (!detailContact) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pending = contactFollowups.filter(f => f.status === 'pending');

  const submitCall = async () => { await logContactCall(outcome, notes, dealType); setNotes(''); };
  const submitFu = async () => {
    await addContactFollowup(fuForm);
    setFuForm({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Contact details">
      <div className="flex-1 bg-black/40" onClick={() => setDetailContact(null)} />
      <div className="w-full max-w-md h-full bg-[var(--bg-card)] shadow-xl overflow-y-auto">
        <div className="flex items-start justify-between p-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{detailContact.name}</h2>
            <p className="text-xs text-[var(--text-secondary)]">{detailContact.company || ''}</p>
            <div className="mt-1.5"><CallStatusBadge contact={detailContact} /></div>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close contact panel" onClick={() => setDetailContact(null)}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex border-b border-[var(--border-color)]">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2 text-xs font-medium ${tab === t.id
                ? 'text-[#e94560] border-b-2 border-[#e94560]'
                : 'text-[var(--text-secondary)]'}`}>{t.label}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="p-4 space-y-2 text-sm text-[var(--text-secondary)]">
            <p><span className="font-medium">Phone:</span> {detailContact.phone || '—'}</p>
            <p><span className="font-medium">Email:</span> {detailContact.email || '—'}</p>
            <p><span className="font-medium">Designation:</span> {detailContact.designation || '—'}</p>
            <p><span className="font-medium">Owner:</span> {detailContact.assigned_name || 'Unassigned'}</p>
            <ContactDripSection contactId={detailContact.contact_id} />
          </div>
        )}

        {tab === 'call' && (
          <div className="p-4 space-y-5">
            {detailContact.phone && (
              <Button onClick={() => callViaBonvoice({ kind: 'contact', ref_id: detailContact.contact_id, label: detailContact.name })}
                size="sm" className="w-full bg-green-600 hover:bg-green-700 text-white">
                <PhoneCall className="h-3.5 w-3.5 mr-1" /> Call {detailContact.phone}
              </Button>
            )}
            <Button onClick={() => setBrochureOpen(true)} size="sm" variant="outline"
              className="w-full border-[#f97316]/40 text-[#f97316] hover:bg-[#f97316]/10">
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Share brochure (tracked)
            </Button>
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Log a call</p>
              <select value={outcome} onChange={e => setOutcome(e.target.value)}
                className="h-10 w-full px-2 rounded text-sm border border-[var(--border-color)] bg-transparent mb-2">
                {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={dealType} onChange={e => setDealType(e.target.value)}
                className="h-10 w-full px-2 rounded text-sm border border-[var(--border-color)] bg-transparent mb-2"
                data-testid="call-deal-type">
                <option value="">Link a deal type (optional)…</option>
                {dealTypesList.map(d => <option key={d.deal_type_id || d.name} value={d.name}>{d.name}</option>)}
              </select>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened?" className="text-sm mb-2" />
              <Button onClick={submitCall} size="sm" className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Phone className="h-3.5 w-3.5 mr-1" /> Log call
              </Button>
            </div>

            <div className="border-t border-[var(--border-color)] pt-4">
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Schedule follow-up</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Input type="date" value={fuForm.followup_date} onChange={e => setFuForm({ ...fuForm, followup_date: e.target.value })} className="text-sm" />
                <Input type="time" value={fuForm.followup_time} onChange={e => setFuForm({ ...fuForm, followup_time: e.target.value })} className="text-sm" />
              </div>
              <select value={fuForm.followup_type} onChange={e => setFuForm({ ...fuForm, followup_type: e.target.value })}
                className="h-10 w-full px-2 rounded text-sm border border-[var(--border-color)] bg-transparent mb-2">
                <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option><option value="meeting">Meeting</option>
              </select>
              <Button onClick={submitFu} size="sm" className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white">Schedule</Button>
              <p className="text-[10px] text-[var(--text-secondary)] mt-1">A reminder task is created for {detailContact.assigned_name || 'you'}.</p>
            </div>

            {pending.length > 0 && (
              <div className="border-t border-[var(--border-color)] pt-4">
                <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Pending</p>
                {pending.map(f => {
                  const overdue = f.followup_date && f.followup_date < today;
                  return (
                    <div key={f.followup_id} className="flex items-center justify-between py-1.5">
                      <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-[var(--text-secondary)]'}`}>
                        <Clock className="h-3 w-3 inline mr-1" />
                        {f.followup_date} {f.followup_time} · {f.followup_type}
                        {overdue && ' · overdue'}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => completeContactFollowup(f.followup_id)}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="p-4 space-y-2">
            {contactActivity.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No activity yet.</p>}
            {contactActivity.map((a, i) => (
              <div key={i} className="border-b border-[var(--border-color)] pb-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">{a.label}</p>
                {a.summary && <p className="text-[11px] text-[var(--text-secondary)]">{a.summary}</p>}
                {a.recording_url && (
                  <audio controls preload="none" src={a.recording_url} className="mt-1 h-8 w-full max-w-[240px]" />
                )}
                <p className="text-[10px] text-[var(--text-secondary)]">{(a.at || '').slice(0, 10)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <ShareBrochureDialog open={brochureOpen} onClose={() => setBrochureOpen(false)}
        context={{ contactId: detailContact.contact_id, schoolId: detailContact.school_id || '',
          leadId: detailContact.lead_id || '', schoolName: detailContact.company || '', phone: detailContact.phone || '' }} />
    </div>
  );
}
