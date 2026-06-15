import React, { useEffect, useState } from 'react';
import { ordersReport } from '../../lib/api';
import { toast } from 'sonner';
import { Package, Send } from 'lucide-react';

export default function OrdersReportSection({
  card = 'bg-[var(--bg-card)] border-[var(--border-color)]',
  textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
  textMuted = 'text-[var(--text-muted)]',
  inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
}) {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('19:00');
  const [recipients, setRecipients] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await ordersReport.get();
        setEnabled(!!r.data.enabled);
        setTime(r.data.send_time || '19:00');
        setRecipients((r.data.recipients || []).join(', '));
      } catch { /* defaults */ }
    })();
  }, []);

  const parseRecipients = () =>
    recipients.split(',').map(p => p.trim()).filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      await ordersReport.save({ enabled, send_time: time, recipients: parseRecipients() });
      toast.success('Saved');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  const sendNow = async () => {
    setSending(true);
    try {
      const r = await ordersReport.runNow();
      toast.success(`${r.data.orders} orders, ${r.data.wa} WhatsApp queued`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Send failed'); }
    finally { setSending(false); }
  };

  return (
    <div className={`${card} border rounded-xl p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4" style={{ color: '#e94560' }} />
        <h3 className={`text-sm font-semibold ${textPri}`}>Daily orders report</h3>
      </div>
      <p className={`text-xs ${textMuted}`}>
        Each evening, get a summary of orders received today (count, total value and the list of
        schools) as an in-app notification, plus an optional WhatsApp to the numbers below.
      </p>
      <label className={`flex items-center gap-2 text-sm ${textSec}`}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enable daily orders report
      </label>
      <div className="flex items-center gap-2">
        <label className={`text-xs ${textMuted}`}>Send at (IST)</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          className={`h-9 px-2 text-sm rounded-lg border ${inputCls}`} />
      </div>
      <div className="space-y-1">
        <label className={`text-xs ${textMuted}`}>WhatsApp numbers (comma separated, optional)</label>
        <input type="text" value={recipients} onChange={e => setRecipients(e.target.value)}
          placeholder="9198xxxxxxxx, 9197xxxxxxxx"
          className={`w-full h-9 px-2 text-sm rounded-lg border ${inputCls}`} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving}
          className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#e94560' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={sendNow} disabled={sending}
          className={`h-9 px-4 rounded-lg text-sm font-semibold border border-[var(--border-color)] ${textSec} flex items-center gap-1.5`}>
          <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send now'}
        </button>
      </div>
    </div>
  );
}
