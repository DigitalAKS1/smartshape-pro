import React from 'react';

const PINK = '#e94560';

export default function DelegationDashboard({ dashboard, textPri, textMuted, card }) {
  if (!dashboard) return null;

  const stats = [
    { label: 'Pending',   value: dashboard.pending,         cls: 'text-orange-500' },
    { label: 'Completed', value: dashboard.completed,       cls: 'text-blue-500'   },
    { label: 'Verified',  value: dashboard.verified,        cls: 'text-green-500'  },
    { label: 'Overdue',   value: dashboard.overdue,         cls: 'text-red-500'    },
    { label: 'Today',     value: dashboard.today,           cls: `text-[${PINK}]`  },
    { label: 'Team',      value: dashboard.total_employees, cls: textPri           },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map(s => (
        <div key={s.label} className={`${card} border rounded-xl p-3 sm:p-4 text-center`}>
          <p className={`text-xl sm:text-2xl font-black font-mono ${s.cls}`}>{s.value}</p>
          <p className={`text-[10px] sm:text-xs ${textMuted} mt-0.5`}>{s.label}</p>
        </div>
      ))}
    </div>
  );
}
