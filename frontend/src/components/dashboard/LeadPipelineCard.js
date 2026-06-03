import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Target } from 'lucide-react';

const PIPELINE_STAGES = [
  { stage: 'new',         label: 'New',         color: 'text-slate-400' },
  { stage: 'contacted',   label: 'Contacted',   color: 'text-blue-400' },
  { stage: 'demo',        label: 'Demo',        color: 'text-purple-400' },
  { stage: 'quoted',      label: 'Quoted',      color: 'text-amber-400' },
  { stage: 'negotiation', label: 'Negotiation', color: 'text-orange-400' },
  { stage: 'won',         label: 'Won',         color: 'text-emerald-400' },
  { stage: 'lost',        label: 'Lost',        color: 'text-red-400' },
];

/**
 * Lead pipeline summary section.
 * Props: conversion (pipeline object), tk (theme tokens), isDark, rv (animation fn)
 */
export default function LeadPipelineCard({ conversion, tk, isDark, rv }) {
  if (!conversion?.pipeline) return null;

  return (
    <div className={`${rv('delay-[280ms]')} ${tk.card} border rounded-2xl overflow-hidden`}>
      <div className={`flex items-center justify-between px-5 sm:px-6 py-4 border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
        <div>
          <p className={`font-bold text-base ${tk.t1} flex items-center gap-2`}>
            <Target className="h-4 w-4 text-purple-400" />
            Lead Pipeline
          </p>
          <p className={`text-xs ${tk.tm} mt-0.5`}>
            {conversion.total_leads} total · {conversion.won} won · {conversion.conversion_rate}% conversion
          </p>
        </div>
        <Link to="/leads" className="text-[11px] font-semibold text-[#e94560] hover:text-[#f05c75] flex items-center gap-1">
          CRM <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-7 divide-x divide-[var(--border-color)]">
        {PIPELINE_STAGES.map(({ stage, label, color }) => (
          <div key={stage} className={`px-3 py-4 text-center ${tk.row} transition-colors`}>
            <p className={`text-2xl font-black ${color} tabular-nums`}>{conversion.pipeline[stage] || 0}</p>
            <p className={`text-[9px] uppercase tracking-widest font-semibold ${tk.tm} mt-0.5`}>{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
