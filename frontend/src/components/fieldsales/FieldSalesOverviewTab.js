import React from 'react';
import { Calendar, MapPin, Navigation } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { getStatusColor } from '../../lib/utils';

/**
 * Overview / summary tab — 3 panels: Recent Attendance, Recent Visits, Recent Expenses.
 * Props: attendance, visits, expenses
 */
export default function FieldSalesOverviewTab({ attendance, visits, expenses }) {
  const recentAtt    = attendance.slice(0, 5);
  const recentVisits = visits.slice(0, 5);
  const recentExp    = expenses.slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#e94560]" /> Recent Attendance
        </h3>
        {recentAtt.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No records</p>
        ) : (
          <div className="space-y-2">
            {recentAtt.map((a) => (
              <div key={a.attendance_id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-[var(--text-primary)]">{a.sales_person_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{a.date}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs ${a.work_type === 'field' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'}`}>
                  {a.work_type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-400" /> Recent Visits
        </h3>
        {recentVisits.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No visits</p>
        ) : (
          <div className="space-y-2">
            {recentVisits.map((v) => (
              <div key={v.visit_id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-[var(--text-primary)]">{v.school_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{v.sales_person_name} - {v.visit_date}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(v.status)}`}>{v.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Navigation className="h-4 w-4 text-purple-400" /> Recent Expenses
        </h3>
        {recentExp.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No expenses</p>
        ) : (
          <div className="space-y-2">
            {recentExp.map((e) => (
              <div key={e.expense_id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-[var(--text-primary)]">{e.sales_person_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{e.from_location} → {e.to_location}</p>
                </div>
                <span className="text-[var(--text-primary)] font-mono text-xs">{formatCurrency(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Attendance, Visits, Expenses full table tabs (kept co-located for brevity) ── */

export function AttendanceTab({ records }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="attendance-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              {['Sales Person', 'Date', 'Type', 'Check In', 'Check Out', 'Location'].map(h => (
                <th key={h} className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((a) => (
              <tr key={a.attendance_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{a.sales_person_name}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{a.date}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs ${a.work_type === 'field' ? 'bg-green-500/20 text-green-300' : a.work_type === 'office' ? 'bg-blue-500/20 text-blue-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                    {a.work_type}
                  </span>
                </td>
                <td className="py-3 px-4 text-[var(--text-secondary)] text-sm">{a.check_in_time ? new Date(a.check_in_time).toLocaleTimeString() : '-'}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)] text-sm">{a.check_out_time ? new Date(a.check_out_time).toLocaleTimeString() : '-'}</td>
                <td className="py-3 px-4 text-[var(--text-muted)] text-xs max-w-[250px] truncate">{a.check_in_address || '-'}</td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td colSpan={6} className="text-center text-[var(--text-muted)] py-12">No attendance records</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VisitsTab({ visits }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="visits-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              {['School', 'Sales Person', 'Date', 'Contact', 'Purpose', 'Status', 'Location'].map(h => (
                <th key={h} className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.visit_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{v.school_name}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{v.sales_person_name}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{v.visit_date} {v.visit_time}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)] text-sm">{v.contact_person}</td>
                <td className="py-3 px-4 text-[var(--text-muted)] text-sm max-w-[150px] truncate">{v.purpose || '-'}</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs border ${getStatusColor(v.status)}`}>{v.status}</span>
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)] text-xs max-w-[200px] truncate">{v.planned_address || v.visited_address || '-'}</td>
              </tr>
            ))}
            {visits.length === 0 && (
              <tr><td colSpan={7} className="text-center text-[var(--text-muted)] py-12">No field visits</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExpensesTab({ expenses }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="expenses-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              {['Sales Person', 'Date', 'From → To', 'Transport', 'Distance', 'Amount', 'Status'].map(h => (
                <th key={h} className={`text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4 ${['Distance','Amount'].includes(h) ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.expense_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{e.sales_person_name}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{e.date}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)] text-sm max-w-[200px] truncate">{e.from_location} → {e.to_location}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)] text-sm capitalize">{e.transport_mode?.replace(/_/g, ' ')}</td>
                <td className="py-3 px-4 text-right text-[var(--text-primary)] font-mono">{e.distance_km} km</td>
                <td className="py-3 px-4 text-right text-[var(--text-primary)] font-mono font-bold">{formatCurrency(e.amount)}</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs border ${getStatusColor(e.status)}`}>{e.status}</span>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr><td colSpan={7} className="text-center text-[var(--text-muted)] py-12">No travel expenses</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
