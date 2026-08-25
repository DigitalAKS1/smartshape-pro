import React, { useEffect, useState } from 'react';
import { keepInTouch } from '../../lib/api';
import { toast } from 'sonner';
import { HeartHandshake, Play } from 'lucide-react';

// Keep-in-touch nurture (Phase 4): each morning, active leads that have gone
// quiet for N+ days get a check-in call task on their owner's plate — so no
// account silently goes cold.
export default function KeepInTouchSection({
  card = 'bg-[var(--bg-card)] border-[var(--border-color)]',
  textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
  textMuted = 'text-[var(--text-muted)]',
  inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
}) {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(60);
  const [custEnabled, setCustEnabled] = useState(false);
  const [custDays, setCustDays] = useState(45);
  const [time, setTime] = useState('09:30');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await keepInTouch.get();
        setEnabled(!!r.data.enabled);
        setDays(r.data.silence_days || 60);
        setCustEnabled(!!r.data.customers_enabled);
        setCustDays(r.data.customer_silence_days || 45);
        setTime(r.data.send_time || '09:30');
      } catch { /* defaults */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await keepInTouch.save({ enabled, silence_days: Number(days) || 60,
        customers_enabled: custEnabled, customer_silence_days: Number(custDays) || 45, send_time: time });
      toast.success('Saved');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  const runNow = async () => {
    setRunning(true);
    try { const r = await keepInTouch.runNow(); toast.success(`Queued ${r.data.created} check-in${r.data.created === 1 ? '' : 's'}`); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Run failed'); }
    finally { setRunning(false); }
  };

  return (
    <div className={`${card} border rounded-xl p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-4 w-4" style={{ color: '#f97316' }} />
        <h3 className={`text-sm font-semibold ${textPri}`}>Keep-in-touch nurture</h3>
      </div>
      <p className={`text-xs ${textMuted}`}>
        Each morning, any active lead with no contact in the last N days gets a check-in call task on
        its owner's plate — so relationships stay warm and no account quietly goes cold. The task shows
        on the calendar and the rep's daily Marketing Touches queue.
      </p>
      <label className={`flex items-center gap-2 text-sm ${textSec}`}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} data-testid="kit-enabled" />
        Enable keep-in-touch
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className={`text-xs ${textMuted}`}>Silent for</label>
          <input type="number" min={7} max={365} value={days} onChange={e => setDays(e.target.value)}
            className={`h-9 w-20 px-2 text-sm rounded-lg border ${inputCls}`} />
          <span className={`text-xs ${textMuted}`}>days</span>
        </div>
        <div className="flex items-center gap-2">
          <label className={`text-xs ${textMuted}`}>Run at (IST)</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className={`h-9 px-2 text-sm rounded-lg border ${inputCls}`} />
        </div>
      </div>

      <div className="border-t border-[var(--border-color)] pt-3 mt-1">
        <label className={`flex items-center gap-2 text-sm ${textSec}`}>
          <input type="checkbox" checked={custEnabled} onChange={e => setCustEnabled(e.target.checked)} data-testid="kit-customers-enabled" />
          Also keep in touch with <b className="font-semibold">Won customers</b> (reorder / referral nurture)
        </label>
        <p className={`text-[11px] ${textMuted} mt-1 ml-6`}>Your best relationships shouldn't go quiet after the sale — this nudges a check-in on paying customers too.</p>
        {custEnabled && (
          <div className="flex items-center gap-2 mt-2 ml-6">
            <label className={`text-xs ${textMuted}`}>Silent for</label>
            <input type="number" min={7} max={365} value={custDays} onChange={e => setCustDays(e.target.value)}
              className={`h-9 w-20 px-2 text-sm rounded-lg border ${inputCls}`} />
            <span className={`text-xs ${textMuted}`}>days after last contact</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving}
          className="h-9 px-4 rounded-lg text-sm font-semibold text-white" style={{ background: '#e94560' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={runNow} disabled={running}
          className={`h-9 px-4 rounded-lg text-sm font-semibold border border-[var(--border-color)] ${textSec} flex items-center gap-1.5`}>
          <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : 'Run now'}
        </button>
      </div>
    </div>
  );
}
