import React, { useEffect, useState } from 'react';
import { dailyDigest } from '../../lib/api';
import { toast } from 'sonner';
import { MessageCircle, Send } from 'lucide-react';

export default function DailyDigestSection({
  card = 'bg-[var(--bg-card)] border-[var(--border-color)]',
  textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
  textMuted = 'text-[var(--text-muted)]',
  inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
}) {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('08:00');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await dailyDigest.get(); setEnabled(!!r.data.enabled); setTime(r.data.send_time || '08:00'); }
      catch { /* defaults */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try { await dailyDigest.save({ enabled, send_time: time }); toast.success('Saved'); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  const sendNow = async () => {
    setSending(true);
    try { const r = await dailyDigest.runNow(); toast.success(`Queued ${r.data.sent}, skipped ${r.data.skipped}`); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Send failed'); }
    finally { setSending(false); }
  };

  return (
    <div className={`${card} border rounded-xl p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4" style={{ color: '#25D366' }} />
        <h3 className={`text-sm font-semibold ${textPri}`}>Daily WhatsApp digest</h3>
      </div>
      <p className={`text-xs ${textMuted}`}>
        Each morning, every staff member gets one WhatsApp listing their pending tasks, visits and
        follow-ups (due today or overdue). Requires WhatsApp to be configured.
      </p>
      <label className={`flex items-center gap-2 text-sm ${textSec}`}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enable daily digest
      </label>
      <div className="flex items-center gap-2">
        <label className={`text-xs ${textMuted}`}>Send at (IST)</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          className={`h-9 px-2 text-sm rounded-lg border ${inputCls}`} />
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
