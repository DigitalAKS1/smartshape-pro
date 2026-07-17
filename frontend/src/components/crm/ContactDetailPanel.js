import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Phone, PhoneCall, X, Clock, CheckCircle2 } from 'lucide-react';
import { startCall } from '../../lib/callBus';

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
  const [fuForm, setFuForm] = useState({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });

  useEffect(() => {
    setTab('call');
    setOutcome('connected');
    setNotes('');
    setFuForm({ followup_date: '', followup_time: '', followup_type: 'call', notes: '' });
  }, [detailContact?.contact_id]);

  if (!detailContact) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pending = contactFollowups.filter(f => f.status === 'pending');

  const submitCall = async () => { await logContactCall(outcome, notes); setNotes(''); };
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
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Log a call</p>
              <select value={outcome} onChange={e => setOutcome(e.target.value)}
                className="h-10 w-full px-2 rounded text-sm border border-[var(--border-color)] bg-transparent mb-2">
                {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
    </div>
  );
}
