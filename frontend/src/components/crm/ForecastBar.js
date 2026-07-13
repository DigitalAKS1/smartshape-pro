import React, { useEffect, useState } from 'react';
import { leads as leadsApi } from '../../lib/api';
import { TrendingUp, AlertTriangle, Layers } from 'lucide-react';
import { STAGES } from '../../lib/crmConstants';

const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

function Stat({ label, value, sub, icon: Icon, tone }) {
  const toneCls = {
    accent: 'text-[#e94560]',
    warn: 'text-orange-400',
    ok: 'text-green-400',
  }[tone] || 'text-[var(--text-primary)]';
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[var(--text-muted)] text-[11px]">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={`text-lg font-semibold leading-tight ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

// `leads` (optional): the current master-filtered lead pool from useLeadsCRM
// (O5). Money figures (pipeline value / weighted forecast) stay pipeline-wide —
// they need the backend's quotation-linked values + admin-tunable stage
// probabilities, which aren't available client-side — but "Needs attention"
// is filtered exactly by intersecting with `leads`, since that's just row
// membership. `filterActive` shows a small note so the distinction is honest,
// not silently inconsistent.
export default function ForecastBar({ leads, filterActive = false }) {
  const [fc, setFc] = useState(null);
  const [attn, setAttn] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [f, a] = await Promise.all([leadsApi.forecast(), leadsApi.needsAttention()]);
        if (!active) return;
        setFc(f.data);
        setAttn(Array.isArray(a.data) ? a.data : []);
      } catch { /* non-critical: hide bar on error */ }
    })();
    return () => { active = false; };
  }, []);

  if (!fc) return null;

  const filteredIds = filterActive && Array.isArray(leads) ? new Set(leads.map((l) => l.lead_id)) : null;
  const scopedAttn = filteredIds ? attn.filter((x) => filteredIds.has(x.lead_id)) : attn;
  const reasonCount = (code) => scopedAttn.filter((x) => (x.reasons || []).includes(code)).length;
  const byStage = fc.by_stage || {};
  const topStage = STAGES
    .filter((s) => byStage[s.id])
    .map((s) => ({ ...s, ...byStage[s.id] }))
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0))[0];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="crm-forecast-bar">
      <Stat label="Open pipeline value" value={inr(fc.total_value)} icon={TrendingUp} sub={filterActive ? 'Whole pipeline (unaffected by filter)' : undefined} />
      <Stat label="Weighted forecast" value={inr(fc.total_weighted)} icon={TrendingUp} tone="accent" sub={filterActive ? 'Whole pipeline (unaffected by filter)' : undefined} />
      <Stat
        label="Needs attention"
        value={String(scopedAttn.length)}
        tone={scopedAttn.length ? 'warn' : 'ok'}
        icon={AlertTriangle}
        sub={`${reasonCount('overdue')} overdue · ${reasonCount('stuck')} stuck · ${reasonCount('no_next_action')} no next step${filterActive ? ' · filtered' : ''}`}
      />
      <Stat
        label="Top weighted stage"
        value={topStage ? topStage.label : '—'}
        icon={Layers}
        sub={topStage ? `${topStage.count} leads · ${inr(topStage.weighted)}` : 'No open leads'}
      />
    </div>
  );
}
