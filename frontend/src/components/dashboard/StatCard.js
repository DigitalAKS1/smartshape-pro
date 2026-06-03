import React from 'react';
import { TrendingUp } from 'lucide-react';

/**
 * KPI stat card — icon, value, label, sub-label.
 * Props: label, value, sub, icon (component), iconCls, icoBg, tk (theme tokens)
 */
export default function StatCard({ label, value, sub, icon: Icon, iconCls, icoBg, tk }) {
  return (
    <div
      className={`${tk.card} border rounded-xl p-4 sm:p-5 transition-all hover:-translate-y-0.5 hover:shadow-md`}
      data-testid={`stat-card-${label.toLowerCase().replace(/ /g, '-')}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${icoBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`h-[18px] w-[18px] ${iconCls}`} strokeWidth={1.7} />
        </div>
        <TrendingUp className={`h-3.5 w-3.5 ${tk.tm} opacity-40`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-black leading-none ${tk.t1} tabular-nums`}>{value}</p>
      <p className={`text-[11px] uppercase tracking-widest font-semibold mt-2 ${tk.tm}`}>{label}</p>
      <p className={`text-xs ${tk.tm} mt-0.5 opacity-70`}>{sub}</p>
    </div>
  );
}
