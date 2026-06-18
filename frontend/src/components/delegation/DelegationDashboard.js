import React from 'react';

const PINK = '#e94560';

export default function DelegationDashboard({ dashboard, textPri, textMuted, card, onStatClick }) {
  if (!dashboard) return null;

  const stats = [
    { key: 'pending',   label: 'Pending',   value: dashboard.pending,         cls: 'text-orange-500' },
    { key: 'completed', label: 'Completed', value: dashboard.completed,       cls: 'text-blue-500'   },
    { key: 'verified',  label: 'Verified',  value: dashboard.verified,        cls: 'text-green-500'  },
    { key: 'overdue',   label: 'Overdue',   value: dashboard.overdue,         cls: 'text-red-500'    },
    { key: 'today',     label: 'Today',     value: dashboard.today,           cls: `text-[${PINK}]`  },
    { key: 'team',      label: 'Team',      value: dashboard.total_employees, cls: textPri           },
  ];

  const clickable = typeof onStatClick === 'function';

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map(s => (
        <button
          key={s.label}
          type="button"
          onClick={clickable ? () => onStatClick(s.key) : undefined}
          disabled={!clickable}
          className={`${card} border rounded-xl p-3 sm:p-4 text-center transition-all ${
            clickable ? 'cursor-pointer hover:border-[#e94560]/50 active:scale-[0.97]' : 'cursor-default'
          }`}
        >
          <p className={`text-xl sm:text-2xl font-black font-mono ${s.cls}`}>{s.value}</p>
          <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5`}>{s.label}</p>
        </button>
      ))}
    </div>
  );
}
