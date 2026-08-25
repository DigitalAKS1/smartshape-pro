import React, { useEffect, useState } from 'react';
import { balanceReminder } from '../../lib/api';
import { toast } from 'sonner';
import { IndianRupee, Play } from 'lucide-react';

// Balance-due reminders (Phase: flow gaps). Each morning, any shipped order with
// an outstanding balance older than N days gets a "collect balance" task on the
// owner's plate — so credit / part-paid sales get chased, not just reported.
export default function BalanceReminderSection({
  card = 'bg-[var(--bg-card)] border-[var(--border-color)]',
  textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
  textMuted = 'text-[var(--text-muted)]',
  inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]',
}) {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(7);
  const [time, setTime] = useState('10:00');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await balanceReminder.get();
        setEnabled(!!r.data.enabled);
        setDays(r.data.days ?? 7);
        setTime(r.data.send_time || '10:00');
      } catch { /* defaults */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try { await balanceReminder.save({ enabled, days: Number(days) || 0, send_time: time }); toast.success('Saved'); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  const runNow = async () => {
    setRunning(true);
    try { const r = await balanceReminder.runNow(); toast.success(`Queued ${r.data.created} balance reminder${r.data.created === 1 ? '' : 's'}`); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Run failed'); }
    finally { setRunning(false); }
  };

  return (
    <div className={`${card} border rounded-xl p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        <IndianRupee className="h-4 w-4" style={{ color: '#188a55' }} />
        <h3 className={`text-sm font-semibold ${textPri}`}>Balance-due reminders</h3>
      </div>
      <p className={`text-xs ${textMuted}`}>
        Each morning, any dispatched order with an unpaid balance older than N days gets a
        "collect balance" task (marked 🔴 high) on the owner's plate — so credit and part-paid
        sales get chased, not just left on the outstanding report.
      </p>
      <label className={`flex items-center gap-2 text-sm ${textSec}`}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} data-testid="bal-enabled" />
        Enable balance reminders
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className={`text-xs ${textMuted}`}>Outstanding for</label>
          <input type="number" min={0} max={180} value={days} onChange={e => setDays(e.target.value)}
            className={`h-9 w-20 px-2 text-sm rounded-lg border ${inputCls}`} />
          <span className={`text-xs ${textMuted}`}>days after dispatch</span>
        </div>
        <div className="flex items-center gap-2">
          <label className={`text-xs ${textMuted}`}>Run at (IST)</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className={`h-9 px-2 text-sm rounded-lg border ${inputCls}`} />
        </div>
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
