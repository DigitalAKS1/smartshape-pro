import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart2, Trophy, Phone, MapPin, FileText, Target } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

/**
 * Agent performance report section.
 * Props: conversion (salesperson_conversion array), tk (theme tokens), isDark, rv (animation fn)
 */
export default function AgentPerformanceCard({ conversion, tk, isDark, rv }) {
  if (!conversion?.salesperson_conversion?.length) return null;

  return (
    <div className={`${rv('delay-[200ms]')} ${tk.card} border rounded-2xl overflow-hidden`}>
      <div className={`flex items-center justify-between px-5 sm:px-6 py-4 border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
        <div>
          <p className={`font-bold text-base ${tk.t1} flex items-center gap-2`}>
            <BarChart2 className="h-4 w-4 text-[#e94560]" />
            Agent Performance
          </p>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Calls · Visits · Quotes · Sales</p>
        </div>
        <Link to="/analytics" className="text-[11px] font-semibold text-[#e94560] hover:text-[#f05c75] flex items-center gap-1">
          Full Report <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className={`border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
              {['Agent', 'Calls', 'Visits', 'Quotes', 'Sales (Won)', 'Revenue', 'Conv %'].map(h => (
                <th key={h} className={`text-left text-[10px] uppercase tracking-[0.12em] font-semibold ${tk.tm} px-4 sm:px-5 py-3`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y ${tk.divide}`}>
            {conversion.salesperson_conversion.map((sp, i) => (
              <tr key={sp.email} className={`${tk.row} transition-colors`}>
                <td className="px-4 sm:px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      i === 0 ? 'bg-amber-500/20 text-amber-400' :
                      i === 1 ? 'bg-slate-400/20 text-slate-400' :
                      'bg-[var(--bg-hover)] text-[var(--text-muted)]'
                    }`}>
                      {i === 0 ? <Trophy className="h-3.5 w-3.5" /> : sp.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${tk.t1} truncate`}>{sp.name}</p>
                      <p className={`text-xs ${tk.tm} truncate`}>{sp.active} active leads</p>
                    </div>
                  </div>
                </td>
                <td className={`px-4 sm:px-5 py-3 text-sm font-mono ${tk.t2}`}>{sp.calls ?? '—'}</td>
                <td className={`px-4 sm:px-5 py-3 text-sm font-mono ${tk.t2}`}>{sp.visits ?? '—'}</td>
                <td className={`px-4 sm:px-5 py-3 text-sm font-mono ${tk.t2}`}>{sp.quotations}</td>
                <td className="px-4 sm:px-5 py-3 text-sm font-mono text-emerald-400 font-semibold">{sp.won}</td>
                <td className={`px-4 sm:px-5 py-3 text-sm font-mono font-bold ${tk.t1}`}>{formatCurrency(sp.revenue)}</td>
                <td className="px-4 sm:px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-[var(--bg-primary)] rounded-full h-1.5 min-w-[50px]">
                      <div className="h-1.5 rounded-full bg-[#e94560]" style={{ width: `${Math.min(sp.conversion_rate, 100)}%` }} />
                    </div>
                    <span className={`text-xs font-semibold ${tk.t2} tabular-nums`}>{sp.conversion_rate?.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-[var(--border-color)]">
        {conversion.salesperson_conversion.map((sp, i) => (
          <div key={sp.email} className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
                }`}>
                  {i === 0 ? '★' : sp.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${tk.t1}`}>{sp.name}</p>
                  <p className={`text-xs ${tk.tm}`}>{sp.conversion_rate?.toFixed(1)}% conversion</p>
                </div>
              </div>
              <span className={`text-sm font-bold ${tk.t1}`}>{formatCurrency(sp.revenue)}</span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              {[
                { label: 'Calls',  val: sp.calls ?? 0,   icon: Phone },
                { label: 'Visits', val: sp.visits ?? 0,  icon: MapPin },
                { label: 'Quotes', val: sp.quotations,   icon: FileText },
                { label: 'Won',    val: sp.won,           icon: Target },
              ].map(({ label, val, icon: Icon }) => (
                <div key={label} className="bg-[var(--bg-primary)] rounded-lg py-2">
                  <p className={`text-lg font-black ${tk.t1} tabular-nums`}>{val}</p>
                  <p className={`text-[9px] uppercase tracking-wide ${tk.tm} font-semibold`}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
