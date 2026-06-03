import React from 'react';
import { ArrowLeft, MapPin, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function AgingChip({ days }) {
  if (days === null || days === undefined)
    return <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">Never contacted</span>;
  const cls = days < 7  ? 'bg-emerald-50 text-emerald-700'
            : days < 30 ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-[#e94560]';
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{days}d since contact</span>;
}

export default function SchoolProfileHeader({ school, metrics, tk, rv }) {
  const navigate = useNavigate();

  return (
    <div className={`${tk.card} border-b ${tk.border}`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-6">

        {/* Breadcrumb */}
        <div className={`${rv()} flex items-center gap-2 mb-5`}>
          <button onClick={() => navigate(-1)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${tk.tm} hover:text-[#e94560] transition-colors`}>
            <ArrowLeft className="h-3.5 w-3.5" />Back
          </button>
          <span className={`text-xs ${tk.tm} opacity-40`}>/</span>
          <span className={`text-xs ${tk.tm}`}>School Profile</span>
        </div>

        {/* School name */}
        <div className={`${rv('delay-75')}`}>
          <h1 className={`text-3xl sm:text-4xl lg:text-[2.75rem] font-black tracking-tight leading-[1.05] ${tk.t1} mb-3`}>
            {school.school_name}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {school.school_type && (
              <span className={`text-[11px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${tk.border} ${tk.tm}`}>
                {school.school_type}
              </span>
            )}
            {school.board && (
              <span className={`text-[11px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${tk.border} ${tk.tm}`}>
                {school.board}
              </span>
            )}
            <AgingChip days={metrics.days_since_last_contact} />
          </div>
          {(school.city || school.school_strength > 0 || school.estd_year) && (
            <div className={`flex items-center gap-4 mt-2.5 text-sm ${tk.tm} flex-wrap`}>
              {school.city && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {school.city}{school.state ? `, ${school.state}` : ''}
                </span>
              )}
              {school.school_strength > 0 && (
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {school.school_strength.toLocaleString('en-IN')} students
                </span>
              )}
              {school.estd_year && <span>Est. {school.estd_year}</span>}
            </div>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className={`${tk.card} border-b ${tk.border}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`${rv('delay-100')} grid grid-cols-3 sm:grid-cols-6 divide-x ${tk.divide}`}>
            {[
              { v: metrics.total_leads,                    label: 'Leads',    accent: false },
              { v: metrics.active_leads,                   label: 'Active',   accent: false },
              { v: metrics.total_contacts,                 label: 'Contacts', accent: false },
              { v: metrics.total_visits,                   label: 'Visits',   accent: false },
              { v: metrics.total_calls,                    label: 'Calls',    accent: false },
              { v: fmtMoney(metrics.total_revenue_quoted), label: 'Pipeline', accent: true  },
            ].map(({ v, label, accent }) => (
              <div key={label} className="px-3 sm:px-5 py-4 sm:py-5 text-center">
                <p className={`sp-num text-2xl sm:text-3xl font-black leading-none ${accent ? 'text-[#e94560]' : tk.t1}`}>{v}</p>
                <p className={`text-[10px] uppercase tracking-widest font-semibold mt-1 ${tk.tm}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtMoney(n) {
  if (!n) return '₹0';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}
