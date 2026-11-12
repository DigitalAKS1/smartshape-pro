import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi, schools as schoolsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Download, Send, Mail, CheckCircle2, XCircle, MinusCircle, Link2, School } from 'lucide-react';
import { Input } from '../../components/ui/input';
import useGoBack from '../../hooks/useGoBack';

const Tick = ({ v }) => v === 'queued' || v === 'sent'
  ? <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
  : v === 'failed'
  ? <XCircle className="h-4 w-4 text-red-500 inline" />
  : <MinusCircle className="h-4 w-4 text-gray-500 inline" />;

// One response's CRM school: linked name, a fuzzy suggestion to accept, or search to choose.
function SchoolLinkCell({ response, suggestion, schoolsById, schools, onLink }) {
  const [choosing, setChoosing] = useState(false);
  const [q, setQ] = useState('');
  const linked = response.school_id ? schoolsById[response.school_id] : null;
  const matches = q.trim().length < 2 ? [] : schools
    .filter(s => (s.school_name || '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  if (choosing) {
    return (
      <div className="relative min-w-[220px]">
        <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search school…"
          className="h-8 text-xs bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
          onKeyDown={e => { if (e.key === 'Escape') setChoosing(false); }} />
        {matches.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg">
            {matches.map(s => (
              <button key={s.school_id} type="button" onClick={() => { onLink(response.response_id, s.school_id); setChoosing(false); }}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)]">
                {s.school_name}{s.city ? <span className="text-[var(--text-muted)]"> · {s.city}</span> : ''}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setChoosing(false)} className="text-[10px] text-[var(--text-muted)] mt-0.5">cancel</button>
      </div>
    );
  }
  if (linked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500" data-testid={`linked-${response.response_id}`}>
        <School className="h-3 w-3" /> {linked.school_name}
        <button type="button" onClick={() => setChoosing(true)} className="ml-1 text-[10px] text-[var(--text-muted)] underline">change</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {suggestion ? (
        <>
          <span className="text-[var(--text-secondary)]" title={`Typed: ${suggestion.typed}`}>Suggest: <b>{suggestion.school_name}</b></span>
          <button type="button" onClick={() => onLink(response.response_id, suggestion.school_id)}
            className="px-1.5 py-0.5 rounded bg-[#e94560]/15 text-[#e94560] font-semibold" data-testid={`link-suggest-${response.response_id}`}>Link</button>
        </>
      ) : <span className="text-[var(--text-muted)]">Not linked</span>}
      <button type="button" onClick={() => setChoosing(true)} className="text-[10px] text-[var(--text-muted)] underline">choose</button>
    </span>
  );
}

export default function FormResponses() {
  const { formId } = useParams();
  const nav = useNavigate();
  const goBack = useGoBack(`/forms/${formId}`);
  const [data, setData] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTo, setShareTo] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);
  const [suggestions, setSuggestions] = useState({});
  const [schools, setSchools] = useState([]);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
        textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    formsApi.responses(formId).then(r => setData(r.data))
      .catch(() => { toast.error('Could not load responses'); nav('/forms'); });
    formsApi.schoolSuggestions(formId).then(r => setSuggestions(r.data || {})).catch(() => {});
    schoolsApi.getAll().then(r => setSchools(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [formId, nav]);

  if (!data) return <AdminLayout><div className="p-8" /></AdminLayout>;
  const { form, responses, count } = data;
  const schoolsById = Object.fromEntries(schools.map(s => [s.school_id, s]));
  const pendingSuggested = (responses || []).filter(r => !r.school_id && suggestions[r.response_id]);

  // Manual sync: link response(s) to a CRM school (and its contact), fill blank school fields.
  const linkSchools = async (links) => {
    try {
      const r = await formsApi.linkSchools(formId, links);
      const { linked, skipped } = r.data;
      if (linked) toast.success(`${linked} response${linked === 1 ? '' : 's'} synced to school data`);
      if (skipped?.length) toast.error(`${skipped.length} skipped: ${skipped[0].reason}`);
      if (r.data.contacts_kept?.length) {
        toast.info(`${r.data.contacts_kept.length} contact(s) already belong to another school (e.g. ${r.data.contacts_kept[0].contact_school}) — kept there; only the response was linked.`, { duration: 8000 });
      }
      const ids = new Map(links.map(l => [l.response_id, l.school_id]));
      setData(d => ({ ...d, responses: d.responses.map(x => (ids.has(x.response_id) && !skipped.some(s => s.response_id === x.response_id)
        ? { ...x, school_id: ids.get(x.response_id) } : x)) }));
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not sync'); }
  };

  const sendReminder = async () => {
    try {
      const r = await formsApi.remind(formId);
      toast.success(`Reminder queued — ${r.data.emails} emails, ${r.data.whatsapp} WhatsApp`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const shareResponses = async () => {
    if (!shareTo.trim()) return toast.error('Enter at least one email');
    setSharing(true);
    try {
      const r = await formsApi.shareResponses(formId, shareTo, shareNote);
      toast.success(`Sent to ${r.data.sent_to.length} recipient(s) — ${r.data.count} registrations`);
      setShareOpen(false); setShareTo(''); setShareNote('');
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not send'); }
    finally { setSharing(false); }
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className={`text-xl font-semibold ${textPri}`}>{form.title}</h1>
              <p className={`text-sm ${textSec}`}>{count} registration{count === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {form.type === 'event' && (
              <Button variant="outline" size="sm" onClick={sendReminder}>
                <Send className="h-4 w-4 mr-1" /> Send reminder now
              </Button>
            )}
            {pendingSuggested.length > 0 && (
              <Button variant="outline" size="sm" data-testid="link-all-suggested"
                onClick={() => linkSchools(pendingSuggested.map(r => ({ response_id: r.response_id, school_id: suggestions[r.response_id].school_id })))}>
                <Link2 className="h-4 w-4 mr-1" /> Link {pendingSuggested.length} suggested to schools
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShareOpen(v => !v)}>
              <Mail className="h-4 w-4 mr-1" /> Share responses
            </Button>
            <Button variant="outline" size="sm"
                    onClick={() => window.open(formsApi.exportUrl(formId, 'xlsx'), '_blank')}>
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm"
                    onClick={() => window.open(formsApi.exportUrl(formId, 'csv'), '_blank')}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        {shareOpen && (
          <div className={`${card} border rounded-md p-4 space-y-3 max-w-2xl`}>
            <div>
              <label className={`text-xs ${textMuted}`}>Email the registrations (Excel attached) to:</label>
              <Input value={shareTo} onChange={e => setShareTo(e.target.value)}
                     placeholder="owner@smartshape.in, teammate@smartshape.in"
                     className={`${inputCls} mt-1`} />
              <p className={`text-[11px] ${textMuted} mt-1`}>Separate multiple emails with commas.</p>
            </div>
            <Input value={shareNote} onChange={e => setShareNote(e.target.value)}
                   placeholder="Optional note to include in the email" className={inputCls} />
            <div className="flex gap-2">
              <Button size="sm" onClick={shareResponses} disabled={sharing}>
                <Mail className="h-4 w-4 mr-1" /> {sharing ? 'Sending…' : 'Send Excel'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShareOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className={`${card} border rounded-md overflow-x-auto`}>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className={`${textSec} text-left border-b border-[var(--border-color)]`}>
                <th className="p-3">Submitted</th>
                {form.fields.map(f => <th key={f.field_id} className="p-3">{f.label}</th>)}
                <th className="p-3">CRM School</th>
                <th className="p-3">Email</th><th className="p-3">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {(responses || []).map(r => (
                <tr key={r.response_id} className="border-b border-[var(--border-color)]">
                  <td className={`p-3 ${textSec}`}>
                    {(r.submitted_at || '').slice(0, 16).replace('T', ' ')}
                  </td>
                  {form.fields.map(f => {
                    const v = (r.answers || {})[f.field_id];
                    return <td key={f.field_id} className={`p-3 ${textPri}`}>
                      {Array.isArray(v) ? v.join(', ') : (v || '—')}
                    </td>;
                  })}
                  <td className="p-3">
                    <SchoolLinkCell response={r} suggestion={suggestions[r.response_id]} schoolsById={schoolsById}
                      schools={schools} onLink={(rid, sid) => linkSchools([{ response_id: rid, school_id: sid }])} />
                  </td>
                  <td className="p-3"><Tick v={r.delivery?.email} /></td>
                  <td className="p-3"><Tick v={r.delivery?.whatsapp} /></td>
                </tr>
              ))}
              {responses.length === 0 && (
                <tr><td colSpan={form.fields.length + 4} className={`p-8 text-center ${textSec}`}>
                  No registrations yet — share the form link.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
