import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import API, { exportData } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { MapPin, Calendar, Users, Route, Clock, CheckCircle, TrendingUp, Navigation, Download } from 'lucide-react';
import { Button } from '../../components/ui/button';

export default function FieldSales() {
  const [summary, setSummary] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [visits, setVisits] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryRes, attRes, visitsRes, expRes] = await Promise.all([
          API.get('/admin/field-sales/summary'),
          API.get('/admin/attendance'),
          API.get('/admin/visits'),
          API.get('/admin/expenses'),
        ]);
        setSummary(summaryRes.data);
        setAttendance(attRes.data);
        setVisits(visitsRes.data);
        setExpenses(expRes.data);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'attendance', label: `Attendance (${attendance.length})` },
    { id: 'visits', label: `Visits (${visits.length})` },
    { id: 'expenses', label: `Expenses (${expenses.length})` },
  ];

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="field-sales-title">Field Sales</h1>
            <p className="text-[var(--text-secondary)] mt-1">Monitor field team activity — attendance, visits, and travel expenses</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportData.download('attendance')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-attendance-btn">
              <Download className="mr-1 h-3 w-3" /> Attendance
            </Button>
            <Button onClick={() => exportData.download('field-visits')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-visits-btn">
              <Download className="mr-1 h-3 w-3" /> Visits
            </Button>
            <Button onClick={() => exportData.download('expenses')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-expenses-btn">
              <Download className="mr-1 h-3 w-3" /> Expenses
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4" data-testid="field-sales-stats">
          <StatCard icon={Calendar} label="Today Check-ins" value={summary?.today_checkins || 0} color="#e94560" />
          <StatCard icon={Users} label="Active Reps" value={summary?.active_salespersons || 0} color="#10b981" />
          <StatCard icon={MapPin} label="Month Visits" value={summary?.month_visits || 0} color="#3b82f6" />
          <StatCard icon={CheckCircle} label="Completed" value={summary?.completed_visits || 0} color="#10b981" />
          <StatCard icon={Clock} label="Planned" value={summary?.planned_visits || 0} color="#f59e0b" />
          <StatCard icon={Route} label="Total KM" value={`${Math.round(summary?.total_km || 0)}`} color="#8b5cf6" />
          <StatCard icon={TrendingUp} label="Expenses" value={formatCurrency(summary?.total_expense || 0)} color="#ef4444" small />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-1" data-testid="field-sales-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2.5 rounded text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-[#e94560] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewTab attendance={attendance} visits={visits} expenses={expenses} />}
        {activeTab === 'attendance' && <AttendanceTab records={attendance} />}
        {activeTab === 'visits' && <VisitsTab visits={visits} />}
        {activeTab === 'expenses' && <ExpensesTab expenses={expenses} />}
      </div>
    </AdminLayout>
  );
}

function StatCard({ icon: Icon, label, value, color, small }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
      <Icon className="h-5 w-5 mb-2" style={{ color }} strokeWidth={1.5} />
      <div className={`font-mono font-bold text-[var(--text-primary)] ${small ? 'text-lg' : 'text-2xl'}`}>{value}</div>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
    </div>
  );
}

function OverviewTab({ attendance, visits, expenses }) {
  const recentAtt = attendance.slice(0, 5);
  const recentVisits = visits.slice(0, 5);
  const recentExp = expenses.slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#e94560]" /> Recent Attendance
        </h3>
        {recentAtt.length === 0 ? <p className="text-[var(--text-muted)] text-sm">No records</p> : (
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
        {recentVisits.length === 0 ? <p className="text-[var(--text-muted)] text-sm">No visits</p> : (
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
        {recentExp.length === 0 ? <p className="text-[var(--text-muted)] text-sm">No expenses</p> : (
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

function AttendanceTab({ records }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="attendance-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Sales Person</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Date</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Type</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Check In</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Check Out</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Location</th>
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

function VisitsTab({ visits }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="visits-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">School</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Sales Person</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Date</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Contact</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Purpose</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Status</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Location</th>
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

function ExpensesTab({ expenses }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="expenses-table">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Sales Person</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Date</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">From → To</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Transport</th>
              <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Distance</th>
              <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Amount</th>
              <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3 px-4">Status</th>
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
