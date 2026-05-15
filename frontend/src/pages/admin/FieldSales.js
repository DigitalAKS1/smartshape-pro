import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import API, { exportData, fieldAdmin, punchApi } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { MapPin, Calendar, Users, Route, Clock, CheckCircle, TrendingUp, Navigation, Download, AlertTriangle, LogIn, LogOut, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../components/ui/button';

const WORK_MODE_COLORS = {
  office: 'bg-green-500/20 text-green-400',
  wfh:    'bg-blue-500/20 text-blue-400',
  unknown:'bg-gray-500/20 text-gray-400',
};

export default function FieldSales() {
  const [summary, setSummary] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [visits, setVisits] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loginLogs, setLoginLogs] = useState([]);
  const [geoAlerts, setGeoAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  // Punch report
  const [punchReport,        setPunchReport]        = useState([]);
  const [punchLoading,       setPunchLoading]        = useState(false);
  const [reportDateFrom,     setReportDateFrom]      = useState(new Date().toISOString().split('T')[0]);
  const [reportDateTo,       setReportDateTo]        = useState(new Date().toISOString().split('T')[0]);
  const [reportUserEmail,    setReportUserEmail]     = useState('');
  const [expandedRows,       setExpandedRows]        = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryRes, attRes, visitsRes, expRes, logsRes, alertsRes] = await Promise.all([
          API.get('/admin/field-sales/summary'),
          API.get('/admin/attendance'),
          API.get('/admin/visits'),
          API.get('/admin/expenses'),
          fieldAdmin.loginLogs().catch(() => ({ data: [] })),
          fieldAdmin.geofenceAlerts().catch(() => ({ data: [] })),
        ]);
        setSummary(summaryRes.data);
        setAttendance(attRes.data);
        setVisits(visitsRes.data);
        setExpenses(expRes.data);
        setLoginLogs(logsRes.data || []);
        setGeoAlerts(alertsRes.data || []);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const loadPunchReport = async () => {
    setPunchLoading(true);
    try {
      const r = await punchApi.punchReport({ date_from: reportDateFrom, date_to: reportDateTo, user_email: reportUserEmail });
      setPunchReport(r.data || []);
    } catch { setPunchReport([]); }
    setPunchLoading(false);
  };

  const toggleRow = (key) => setExpandedRows(p => ({ ...p, [key]: !p[key] }));

  const unreadAlerts = geoAlerts.filter(a => !a.is_read).length;
  const tabs = [
    { id: 'overview',   label: 'Overview' },
    { id: 'attendance', label: `Attendance (${attendance.length})` },
    { id: 'visits',     label: `Visits (${visits.length})` },
    { id: 'expenses',   label: `Expenses (${expenses.length})` },
    { id: 'login_logs',   label: `Login Logs (${loginLogs.length})` },
    { id: 'geo_alerts',   label: `Geo Alerts${unreadAlerts > 0 ? ` (${unreadAlerts}🔴)` : ` (${geoAlerts.length})`}` },
    { id: 'punch_report', label: 'Punch Report' },
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

        {/* ── Login Logs ────────────────────────────────────────────────── */}
        {activeTab === 'login_logs' && (
          <div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">Login and logout events with location and work mode auto-detection.</p>
            <div className="overflow-x-auto rounded-md border border-[var(--border-color)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-card)] border-b border-[var(--border-color)]">
                  <tr>
                    {['User', 'Role', 'Login Time', 'Logout Time', 'Work Mode', 'IP Address', 'Location'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loginLogs.length === 0
                    ? <tr><td colSpan={7} className="text-center py-10 text-[var(--text-muted)]">No login logs yet</td></tr>
                    : loginLogs.map(log => (
                      <tr key={log.log_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="px-3 py-2">
                          <p className="font-medium text-[var(--text-primary)]">{log.user_name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{log.user_email}</p>
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] capitalize text-xs">{log.role?.replace('_',' ')}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] text-xs">{log.login_time ? new Date(log.login_time).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] text-xs">{log.logout_time ? new Date(log.logout_time).toLocaleString() : <span className="text-green-400">Active</span>}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${WORK_MODE_COLORS[log.work_mode] || WORK_MODE_COLORS.unknown}`}>
                            {log.work_mode === 'office' ? '🏢 Office' : log.work_mode === 'wfh' ? '🏠 WFH' : '❓ Unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)] text-xs font-mono">{log.ip_address || '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)] text-xs max-w-xs truncate" title={log.address}>{log.address || (log.lat ? `${Number(log.lat).toFixed(4)}, ${Number(log.lng).toFixed(4)}` : '—')}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Geo Alerts ────────────────────────────────────────────────── */}
        {activeTab === 'geo_alerts' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Geofence Breach Alerts</p>
                <p className="text-xs text-[var(--text-muted)]">Triggered when an employee checks in as "Office" but is outside the configured geofence radius.</p>
              </div>
            </div>
            {geoAlerts.length === 0
              ? <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-8 text-center">
                  <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" />
                  <p className="text-green-400 font-semibold">No Geofence Breaches</p>
                  <p className="text-[var(--text-muted)] text-sm mt-1">All check-ins are within the office geofence.</p>
                </div>
              : <div className="space-y-3">
                  {geoAlerts.map(alert => (
                    <div key={alert.alert_id} className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-[var(--text-primary)]">{alert.user_name}</p>
                            <p className="text-xs text-[var(--text-muted)]">{alert.user_email}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-red-400 bg-red-500/20 px-2 py-0.5 rounded-full font-semibold">BREACH</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div><p className="text-[var(--text-muted)]">Claimed Mode</p><p className="text-[var(--text-primary)] font-medium capitalize">{alert.claimed_work_type}</p></div>
                        <div><p className="text-[var(--text-muted)]">Distance from Office</p><p className="text-red-400 font-semibold">{alert.distance_from_office_m ? `${alert.distance_from_office_m}m` : '—'}</p></div>
                        <div><p className="text-[var(--text-muted)]">Office Radius</p><p className="text-[var(--text-primary)] font-medium">{alert.office_radius_m}m</p></div>
                        <div><p className="text-[var(--text-muted)]">Triggered At</p><p className="text-[var(--text-primary)] font-medium">{alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : '—'}</p></div>
                      </div>
                      {alert.address && <p className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-1"><MapPin className="h-3 w-3" />{alert.address}</p>}
                    </div>
                  ))}
                </div>
            }
          </div>
        )}
        {/* ── Punch Report ──────────────────────────────────────────────── */}
        {activeTab === 'punch_report' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 flex flex-wrap gap-3 items-end">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">From</p>
                <input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)}
                  className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">To</p>
                <input type="date" value={reportDateTo} onChange={e => setReportDateTo(e.target.value)}
                  className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
              </div>
              <div className="flex-1 min-w-40">
                <p className="text-xs text-[var(--text-muted)] mb-1">Employee Email (optional)</p>
                <input type="email" value={reportUserEmail} onChange={e => setReportUserEmail(e.target.value)}
                  placeholder="all employees"
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#e94560]/60" />
              </div>
              <button onClick={loadPunchReport} disabled={punchLoading}
                className="px-5 py-2 bg-[#e94560] hover:bg-[#f05c75] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors">
                <BarChart2 className="h-4 w-4" />
                {punchLoading ? 'Loading…' : 'Load Report'}
              </button>
            </div>

            {/* Efficiency legend */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'optimal',        label: '1 cycle — Optimal',        cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
                { key: 'good',           label: '2 cycles — Good',          cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                { key: 'moderate',       label: '3 cycles — Moderate',      cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
                { key: 'frequent_exits', label: '4+ cycles — Frequent Exits', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
              ].map(e => (
                <span key={e.key} className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${e.cls}`}>{e.label}</span>
              ))}
              <span className="text-xs text-[var(--text-muted)] self-center">· One cycle = 1 punch-in + 1 punch-out</span>
            </div>

            {punchLoading ? (
              <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" /></div>
            ) : punchReport.length === 0 ? (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-12 text-center">
                <BarChart2 className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
                <p className="text-[var(--text-secondary)] text-sm">No punch data for selected range</p>
                <p className="text-[var(--text-muted)] text-xs mt-1">Click "Load Report" to fetch data</p>
              </div>
            ) : (
              <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--border-color)]">
                    <tr>
                      {['Employee', 'Date', 'First In', 'Last Out', 'Hours', 'Punches', 'Efficiency', ''].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {punchReport.map((row) => {
                      const rowKey = `${row.date}-${row.user_email}`;
                      const expanded = expandedRows[rowKey];
                      const EFF_CLS = {
                        optimal:        'bg-green-500/20 text-green-400 border-green-500/30',
                        good:           'bg-blue-500/20 text-blue-400 border-blue-500/30',
                        moderate:       'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                        frequent_exits: 'bg-red-500/20 text-red-400 border-red-500/30',
                      };
                      const fmtT = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                      return (
                        <>
                          <tr key={rowKey} className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${row.auto_logout_count > 0 ? 'bg-orange-500/5' : ''}`}>
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-[var(--text-primary)]">{row.user_name}</p>
                              <p className="text-[10px] text-[var(--text-muted)]">{row.user_email}</p>
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs font-mono">{row.date}</td>
                            <td className="px-3 py-2.5">
                              <span className="text-green-400 font-mono text-xs">{fmtT(row.first_in)}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="text-red-400 font-mono text-xs">{fmtT(row.last_out)}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="text-[var(--text-primary)] font-semibold text-xs">
                                {row.total_hours != null ? `${row.total_hours}h` : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[var(--text-primary)] font-bold text-sm">{row.punch_count}</span>
                                <span className="text-[10px] text-[var(--text-muted)]">({row.in_count}↑ {row.out_count}↓)</span>
                                {row.auto_logout_count > 0 && (
                                  <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-semibold">{row.auto_logout_count} auto</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${EFF_CLS[row.efficiency] || EFF_CLS.frequent_exits}`}>
                                {row.efficiency?.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <button onClick={() => toggleRow(rowKey)}
                                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1">
                                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr key={`${rowKey}-detail`} className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
                              <td colSpan={8} className="px-6 py-3">
                                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">Full Punch Timeline</p>
                                <div className="flex flex-wrap gap-3">
                                  {row.punches.map((p, i) => (
                                    <div key={p.punch_id} className={`flex items-start gap-2 rounded-lg px-3 py-2 ${p.type === 'in' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${p.type === 'in' ? 'bg-green-500/30' : 'bg-red-500/30'}`}>
                                        {p.type === 'in'
                                          ? <LogIn  className="h-2.5 w-2.5 text-green-400" />
                                          : <LogOut className="h-2.5 w-2.5 text-red-400" />}
                                      </div>
                                      <div>
                                        <p className={`text-xs font-semibold ${p.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>
                                          #{i + 1} {p.type === 'in' ? 'In' : 'Out'} — {fmtT(p.timestamp)}
                                        </p>
                                        {p.source === 'geofence_auto_logout' && (
                                          <span className="text-[10px] text-orange-400">🚨 Auto-logout</span>
                                        )}
                                        {p.distance_from_office_m != null && (
                                          <p className="text-[10px] text-[var(--text-muted)]">{p.distance_from_office_m}m from office</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>

                {/* Summary footer */}
                <div className="px-4 py-3 border-t border-[var(--border-color)] flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                  <span>Total records: <strong className="text-[var(--text-primary)]">{punchReport.length}</strong></span>
                  <span>Total punches: <strong className="text-[var(--text-primary)]">{punchReport.reduce((s, r) => s + r.punch_count, 0)}</strong></span>
                  <span>Auto-logouts: <strong className="text-orange-400">{punchReport.reduce((s, r) => s + r.auto_logout_count, 0)}</strong></span>
                  <span>Avg hours/day: <strong className="text-[var(--text-primary)]">{
                    (() => {
                      const valid = punchReport.filter(r => r.total_hours != null);
                      return valid.length ? (valid.reduce((s, r) => s + r.total_hours, 0) / valid.length).toFixed(1) + 'h' : '—';
                    })()
                  }</strong></span>
                </div>
              </div>
            )}
          </div>
        )}

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
