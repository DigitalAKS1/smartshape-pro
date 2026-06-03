import React from 'react';
import {
  Send, Zap, Gift, Clock, AlertCircle, Inbox,
  PieChart, Target, RefreshCw,
} from 'lucide-react';
import { STATUS_CHIP } from '../../lib/marketingUtils';

export default function AnalyticsTab({ tk, analytics, campaigns }) {
  if (!analytics) {
    return (
      <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
        <RefreshCw className={`h-8 w-8 ${tk.tm} mx-auto mb-3 animate-spin`} />
        <p className={`text-sm ${tk.t2}`}>Loading analytics…</p>
      </div>
    );
  }

  const { messages, drips, greetings, by_type = {} } = analytics;
  const totalByType = Object.values(by_type).reduce((s, v) => s + v, 0);

  const TYPE_META = {
    campaign:   { label: 'Campaigns',  col: 'bg-purple-500', pct_col: 'text-purple-500' },
    drip:       { label: 'Drip Steps', col: 'bg-blue-500',   pct_col: 'text-blue-500' },
    greeting:   { label: 'Greetings',  col: 'bg-pink-500',   pct_col: 'text-pink-500' },
    other:      { label: 'Other',      col: 'bg-gray-400',   pct_col: 'text-gray-400' },
  };

  const kpis = [
    { label: 'Total Queued',        value: messages.total,   icon: Inbox,      col: 'text-blue-500',   bg: 'bg-blue-500/10' },
    { label: 'Messages Sent',       value: messages.sent,    icon: Send,       col: 'text-green-500',  bg: 'bg-green-500/10' },
    { label: 'Pending / In Queue',  value: messages.pending, icon: Clock,      col: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Failed',              value: messages.failed,  icon: AlertCircle,col: 'text-red-400',    bg: 'bg-red-400/10' },
    { label: 'Active Drip Leads',   value: drips.active,     icon: Zap,        col: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: 'Greetings Sent',      value: greetings.total_sent, icon: Gift,   col: 'text-pink-500',   bg: 'bg-pink-500/10' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4 w-4 ${k.col}`} />
              </div>
              <p className={`text-xl font-bold ${tk.t1} leading-none`}>{(k.value || 0).toLocaleString('en-IN')}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{k.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Message breakdown by type */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <PieChart className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Messages by Channel</h3>
          </div>
          {totalByType === 0 ? (
            <p className={`text-xs ${tk.tm} py-4 text-center`}>No messages queued yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(by_type).map(([type, count]) => {
                const m = TYPE_META[type] || { label: type, col: 'bg-gray-400', pct_col: 'text-gray-400' };
                const pctVal = Math.round((count / totalByType) * 100);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${tk.t2}`}>{m.label}</span>
                      <span className={`text-xs font-bold ${m.pct_col}`}>{count.toLocaleString('en-IN')} · {pctVal}%</span>
                    </div>
                    <div className={`h-2 rounded-full bg-[var(--bg-primary)]`}>
                      <div className={`h-2 rounded-full ${m.col} transition-all`} style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Campaign performance */}
        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center gap-2 px-4 py-3 border-b ${tk.bdr}`}>
            <Target className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Campaign Performance</h3>
          </div>
          {campaigns.length === 0 ? (
            <p className={`text-xs ${tk.tm} p-4 text-center`}>No campaigns yet</p>
          ) : (
            <div className={`divide-y divide-[var(--border-color)]`}>
              {campaigns.slice(0, 6).map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${tk.t1} truncate`}>{c.name}</p>
                    <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_count} contacts · {c.created_at}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                      {c.status}
                    </span>
                    {c.stats.sent > 0 && (
                      <span className={`text-[10px] ${tk.tm}`}>{c.stats.sent} sent</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drip funnel */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <div className="flex items-center gap-2 mb-4">
          <Zap className={`h-4 w-4 ${tk.tm}`} />
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Drip Sequence Funnel</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Enrollments',   value: drips.active,     col: 'text-blue-500',   bg: 'bg-blue-500/10' },
            { label: 'Completed',            value: drips.completed,  col: 'text-green-500',  bg: 'bg-green-500/10' },
            { label: 'Greetings Sent',       value: greetings.total_sent, col: 'text-pink-500', bg: 'bg-pink-500/10' },
            { label: 'Total WA Messages',    value: messages.total,   col: 'text-purple-500', bg: 'bg-purple-500/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3.5 text-center`}>
              <p className={`text-2xl font-bold ${s.col}`}>{(s.value || 0).toLocaleString('en-IN')}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
