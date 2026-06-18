import React from 'react';

const PINK = '#e94560';

export default function DelegationDashboard({ dashboard, onSelect, textPri, textMuted, card }) {
  if (!dashboard) return null;

  // `key` maps a card to the My Tasks filter it opens (null = not a task filter).
  const stats = [
    { label: 'Pending',   value: dashboard.pending,         cls: 'text-orange-500', key: 'pending'   },
    { label: 'Completed', value: dashboard.completed,       cls: 'text-blue-500',   key: 'completed' },
    { label: 'Verified',  value: dashboard.verified,        cls: 'text-green-500',  key: 'verified'  },
    { label: 'Overdue',   value: dashboard.overdue,         cls: 'text-red-500',    key: 'overdue'   },
    { label: 'Today',     value: dashboard.today,           cls: `text-[${PINK}]`,  key: 'today'     },
    { label: 'Team',      value: dashboard.total_employees, cls: textPri,           key: null        },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map(s => {
        const clickable = onSelect && s.key;
        return (
          <button key={s.label} type="button" disabled={!clickable}
            onClick={() => clickable && onSelect(s.key)}
            className={`${card} border rounded-xl p-3 sm:p-4 text-center transition-all ${clickable ? 'hover:border-[#e94560]/50 active:scale-[0.97] cursor-pointer' : 'cursor-default'}`}>
            <p className={`text-xl sm:text-2xl font-black font-mono ${s.cls}`}>{s.value}</p>
            <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5`}>{s.label}</p>
          </button>
        );
      })}
    </div>
  );
}
