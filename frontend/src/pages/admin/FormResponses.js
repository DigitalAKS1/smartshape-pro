import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Download, Send, Mail, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Input } from '../../components/ui/input';

const Tick = ({ v }) => v === 'queued' || v === 'sent'
  ? <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
  : v === 'failed'
  ? <XCircle className="h-4 w-4 text-red-500 inline" />
  : <MinusCircle className="h-4 w-4 text-gray-500 inline" />;

export default function FormResponses() {
  const { formId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTo, setShareTo] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
        textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    formsApi.responses(formId).then(r => setData(r.data))
      .catch(() => { toast.error('Could not load responses'); nav('/forms'); });
  }, [formId, nav]);

  if (!data) return <AdminLayout><div className="p-8" /></AdminLayout>;
  const { form, responses, count } = data;

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
            <Button variant="ghost" size="sm" onClick={() => nav(`/forms/${formId}`)}>
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
                  <td className="p-3"><Tick v={r.delivery?.email} /></td>
                  <td className="p-3"><Tick v={r.delivery?.whatsapp} /></td>
                </tr>
              ))}
              {responses.length === 0 && (
                <tr><td colSpan={form.fields.length + 3} className={`p-8 text-center ${textSec}`}>
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
