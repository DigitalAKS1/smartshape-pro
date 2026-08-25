import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { activation } from '../../lib/api';
import { CheckCircle2, Circle, ChevronRight, Loader2, Rocket, RefreshCw } from 'lucide-react';

export default function ActivationCenter() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    activation.status().then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading) return (
    <AdminLayout>
      <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#e94560]" /></div>
    </AdminLayout>
  );
  if (!data) return <AdminLayout><div className="p-8 text-[var(--text-muted)]">Could not load activation status.</div></AdminLayout>;

  const pct = data.percent || 0;
  const ring = `conic-gradient(#10b981 ${pct * 3.6}deg, var(--border-color) 0deg)`;
  const off = data.items.filter(i => !i.status);
  const on = data.items.filter(i => i.status);

  const Row = ({ i }) => (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${i.status ? 'border-[var(--border-color)] bg-[var(--bg-card)]' : 'border-amber-500/30 bg-amber-500/5'}`}>
      {i.status
        ? <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
        : <Circle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{i.label}</p>
          {i.optional && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-muted)]">optional</span>}
          <span className={`text-[11px] font-mono ${i.status ? 'text-green-500' : 'text-amber-500'}`}>{i.detail}</span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1">{i.impact}</p>
      </div>
      {!i.status && (
        <button onClick={() => nav('/app-settings')}
          className="flex-shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-xs font-semibold">
          Turn on <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <AdminLayout>
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          <div className="flex items-center gap-5 mb-6">
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: ring }}>
              <div className="w-16 h-16 rounded-full bg-[var(--bg-primary)] flex flex-col items-center justify-center">
                <span className="text-lg font-bold font-mono text-[var(--text-primary)]">{pct}%</span>
                <span className="text-[9px] text-[var(--text-muted)]">live</span>
              </div>
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-[var(--text-primary)] flex items-center gap-2 tracking-tight">
                <Rocket className="h-5 w-5 text-[#e94560]" /> Activation Center
              </h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {data.core_done} of {data.core_total} core systems live. Turn the rest on to unlock what's already built.
              </p>
            </div>
            <button onClick={load} className="p-2 rounded-full hover:bg-[var(--bg-hover)]" title="Refresh">
              <RefreshCw className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          </div>

          {off.length > 0 && (
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)] mb-2">Not on yet — highest value first</p>
              <div className="space-y-2">{off.map(i => <Row key={i.key} i={i} />)}</div>
            </div>
          )}

          {on.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--text-muted)] mb-2">Already live ✓</p>
              <div className="space-y-2 opacity-90">{on.map(i => <Row key={i.key} i={i} />)}</div>
            </div>
          )}

          <p className="text-[11px] text-[var(--text-muted)] mt-6">
            Tip: configuring <b className="text-[var(--text-secondary)]">WhatsApp</b> is the single biggest unlock — it lights up campaigns, drips, form confirmations and daily digests at once. All settings live in <button onClick={() => nav('/app-settings')} className="text-[#e94560] hover:underline">App Settings</button>.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
