import React, { useEffect, useState } from 'react';
import { leads as leadsApi } from '../../lib/api';
import { TrendingUp, AlertTriangle, Layers } from 'lucide-react';
import { STAGES } from '../../lib/crmConstants';
import NeedsAttentionPanel from './NeedsAttentionPanel';

const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

function Stat({ label, value, sub, icon: Icon, tone, onClick }) {
  const toneCls = {
    accent: 'text-[#e94560]',
    warn: 'text-orange-400',
    ok: 'text-green-400',
  }[tone] || 'text-[var(--text-primary)]';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-left w-full ${onClick ? 'hover:border-[#e94560] focus:outline-none focus-visible:border-[#e94560]' : ''}`}>
      <div className="flex items-center gap-1.5 text-[var(--text-muted)] text-[11px]">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={`text-lg font-semibold leading-tight ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</div>}
    </Tag>
  );
}

// `leads` (optional): the current master-filtered lead pool from useLeadsCRM
// (O5). Money figures (pipeline value / weighted forecast) stay pipeline-wide —
// they need the backend's quotation-linked values + admin-tunable stage
// probabilities, which aren't available client-side — but "Needs attention"
// is filtered exactly by intersecting with `leads`, since that's just row
// membership. `filterActive` shows a small note so the distinction is honest,
// not silently inconsistent.
export default function ForecastBar({ leads, filterActive = false, onPickLead }) {
  const [fc, setFc] = useState(null);
  const [attn, setAttn] = useState([]);
  // The count was a dead end: the list behind it was fetched only to be
  // counted, so the one number that could say where to start said how many.
  const [attnOpen, setAttnOpen] = useState(false);

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
  // Fall back to the all-in totals if the backend predates the split, so the
  // bar never renders a blank figure mid-deploy.
  const qualified = fc.qualified_value ?? fc.total_value;
  const weighted = fc.qualified_weighted ?? fc.total_weighted;
  const unqualified = fc.unqualified_count || 0;
  const topStage = STAGES
    .filter((s) => byStage[s.id])
    .map((s) => ({ ...s, ...byStage[s.id] }))
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0))[0];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="crm-forecast-bar">
      {/* Money here is deals somebody has actually engaged with. New enquiries —
          QR scans, form fills, imported rows — are real work but no evidence of
          revenue, so they are a count beside the figure rather than part of it.
          Counting them made the headline grow every time a mailer went out. */}
      <Stat
        label="Qualified pipeline"
        value={inr(qualified)}
        icon={TrendingUp}
        sub={[
          unqualified ? `+ ${unqualified} new enquir${unqualified === 1 ? 'y' : 'ies'}` : null,
          filterActive ? 'whole pipeline' : null,
        ].filter(Boolean).join(' · ') || undefined}
      />
      <Stat
        label="Weighted forecast"
        value={inr(weighted)}
        icon={TrendingUp}
        tone="accent"
        sub={filterActive ? 'Whole pipeline (unaffected by filter)' : undefined}
      />
      <Stat
        label="Needs attention"
        value={String(scopedAttn.length)}
        tone={scopedAttn.length ? 'warn' : 'ok'}
        icon={AlertTriangle}
        onClick={() => setAttnOpen(true)}
        sub={`${reasonCount('overdue')} overdue · ${reasonCount('stuck')} stuck · ${reasonCount('no_next_action')} no next step${filterActive ? ' · filtered' : ''}`}
      />
      <Stat
        label="Top weighted stage"
        value={topStage ? topStage.label : '—'}
        icon={Layers}
        sub={topStage ? `${topStage.count} leads · ${inr(topStage.weighted)}` : 'No open leads'}
      />
      <NeedsAttentionPanel
        open={attnOpen}
        onOpenChange={setAttnOpen}
        rows={scopedAttn}
        onPick={(row) => { setAttnOpen(false); onPickLead && onPickLead(row); }}
      />
    </div>
  );
}
