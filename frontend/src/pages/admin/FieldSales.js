import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { formatCurrency } from '../../lib/utils';
import { MapPin, Calendar, Users, Route, Clock, CheckCircle, TrendingUp, Download, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useFieldSales } from '../../hooks/useFieldSales';
import FieldSalesOverviewTab, { AttendanceTab, VisitsTab, ExpensesTab } from '../../components/fieldsales/FieldSalesOverviewTab';
import PunchReportTab from '../../components/fieldsales/PunchReportTab';
import SalesTargetsTab from '../../components/fieldsales/SalesTargetsTab';

const WORK_MODE_COLORS = {
  office:  'bg-green-500/20 text-green-400',
  wfh:     'bg-blue-500/20 text-blue-400',
  unknown: 'bg-gray-500/20 text-gray-400',
};

function StatCard({ icon: Icon, label, value, color, small }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
      <Icon className="h-5 w-5 mb-2" style={{ color }} strokeWidth={1.5} />
      <div className={`font-mono font-bold text-[var(--text-primary)] ${small ? 'text-lg' : 'text-2xl'}`}>{value}</div>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
    </div>
  );
}

export default function FieldSales() {
  const {
    summary, attendance, visits, expenses, loginLogs, geoAlerts,
    activeTab, setActiveTab, loading, tabs,
    punchReport, punchLoading,
    reportDateFrom, setReportDateFrom,
    reportDateTo, setReportDateTo,
    reportUserEmail, setReportUserEmail,
    expandedRows, toggleRow, loadPunchReport,
    targetMonth, setTargetMonth,
    salesReps, targetRows, setTargetRows,
    savingTarget, saveTarget,
    handleExport,
  } = useFieldSales();

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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="field-sales-title">Field Sales</h1>
            <p className="text-[var(--text-secondary)] mt-1">Monitor field team activity — attendance, visits, and travel expenses</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleExport('attendance')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-attendance-btn">
              <Download className="mr-1 h-3 w-3" /> Attendance
            </Button>
            <Button onClick={() => handleExport('field-visits')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-visits-btn">
              <Download className="mr-1 h-3 w-3" /> Visits
            </Button>
            <Button onClick={() => handleExport('expenses')} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" data-testid="export-expenses-btn">
              <Download className="mr-1 h-3 w-3" /> Expenses
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4" data-testid="field-sales-stats">
          <StatCard icon={Calendar}   label="Today Check-ins" value={summary?.today_checkins || 0}              color="#e94560" />
          <StatCard icon={Users}      label="Active Reps"     value={summary?.active_salespersons || 0}         color="#10b981" />
          <StatCard icon={MapPin}     label="Month Visits"    value={summary?.month_visits || 0}                color="#3b82f6" />
          <StatCard icon={CheckCircle}label="Completed"       value={summary?.completed_visits || 0}            color="#10b981" />
          <StatCard icon={Clock}      label="Planned"         value={summary?.planned_visits || 0}              color="#f59e0b" />
          <StatCard icon={Route}      label="Total KM"        value={`${Math.round(summary?.total_km || 0)}`}  color="#8b5cf6" />
          <StatCard icon={TrendingUp} label="Expenses"        value={formatCurrency(summary?.total_expense || 0)} color="#ef4444" small />
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
        {activeTab === 'overview'    && <FieldSalesOverviewTab attendance={attendance} visits={visits} expenses={expenses} />}
        {activeTab === 'attendance'  && <AttendanceTab records={attendance} />}
        {activeTab === 'visits'      && <VisitsTab visits={visits} />}
        {activeTab === 'expenses'    && <ExpensesTab expenses={expenses} />}
        {activeTab === 'targets'     && (
          <SalesTargetsTab
            targetMonth={targetMonth}
            setTargetMonth={setTargetMonth}
            salesReps={salesReps}
            targetRows={targetRows}
            setTargetRows={setTargetRows}
            savingTarget={savingTarget}
            saveTarget={saveTarget}
          />
        )}

        {/* Login Logs */}
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

        {/* Geo Alerts */}
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

        {/* Punch Report */}
        {activeTab === 'punch_report' && (
          <PunchReportTab
            punchReport={punchReport}
            punchLoading={punchLoading}
            reportDateFrom={reportDateFrom}
            setReportDateFrom={setReportDateFrom}
            reportDateTo={reportDateTo}
            setReportDateTo={setReportDateTo}
            reportUserEmail={reportUserEmail}
            setReportUserEmail={setReportUserEmail}
            expandedRows={expandedRows}
            toggleRow={toggleRow}
            loadPunchReport={loadPunchReport}
          />
        )}
      </div>
    </AdminLayout>
  );
}
