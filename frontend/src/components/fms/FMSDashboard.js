import React from 'react';

const PINK = '#e94560';

export default function FMSDashboard({ summary, card, textMuted }) {
  const stats = [
    { label: 'Active Flows',   value: summary.active || 0,         color: `text-[${PINK}]`   },
    { label: 'Completed',      value: summary.completed || 0,      color: 'text-green-500'    },
    { label: 'Overdue Stages', value: summary.overdue_stages || 0, color: 'text-red-500'      },
    { label: 'Archived',       value: summary.archived || 0,       color: 'text-blue-500'     },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(s => (
        <div key={s.label} className={`${card} border rounded-xl p-4`}>
          <p className={`text-2xl font-black font-mono ${s.color}`}>{s.value}</p>
          <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
        </div>
      ))}
    </div>
  );
}
