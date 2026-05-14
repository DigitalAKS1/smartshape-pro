import React from 'react';
import { STAGES, STAGE_COLORS, LEAD_TYPE_COLORS } from '../../lib/crmConstants';

export function StageBadge({ stage, size = 'sm' }) {
  const found = STAGES.find(s => s.id === stage);
  const cls = found ? found.color : 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  const sz = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`${sz} rounded-full font-semibold border capitalize ${cls}`}>
      {found ? found.label : stage}
    </span>
  );
}

export function LeadTypeBadge({ type, size = 'sm' }) {
  const cls = LEAD_TYPE_COLORS[type] || 'bg-gray-500/20 text-gray-400';
  const sz = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`${sz} rounded-full font-semibold capitalize ${cls}`}>{type}</span>
  );
}

export function AgingDot({ days }) {
  if (days === null) return <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" title="Never contacted" />;
  if (days < 7)  return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" title={`${days}d ago`} />;
  if (days < 30) return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" title={`${days}d ago`} />;
  return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" title={`${days}d ago`} />;
}
