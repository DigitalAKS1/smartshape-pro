import { useState, useEffect } from 'react';
import API, { exportData, fieldAdmin, punchApi, salesTargets } from '../lib/api';
import { toast } from 'sonner';

/**
 * Hook encapsulating all FieldSales state and API calls.
 */
export function useFieldSales() {
  const [summary,       setSummary]       = useState(null);
  const [attendance,    setAttendance]    = useState([]);
  const [visits,        setVisits]        = useState([]);
  const [expenses,      setExpenses]      = useState([]);
  const [loginLogs,     setLoginLogs]     = useState([]);
  const [geoAlerts,     setGeoAlerts]     = useState([]);
  const [activeTab,     setActiveTab]     = useState('overview');
  const [loading,       setLoading]       = useState(true);

  // Punch report
  const [punchReport,     setPunchReport]     = useState([]);
  const [punchLoading,    setPunchLoading]    = useState(false);
  const [reportDateFrom,  setReportDateFrom]  = useState(new Date().toISOString().split('T')[0]);
  const [reportDateTo,    setReportDateTo]    = useState(new Date().toISOString().split('T')[0]);
  const [reportUserEmail, setReportUserEmail] = useState('');
  const [expandedRows,    setExpandedRows]    = useState({});

  // Targets
  const [targetMonth,   setTargetMonth]   = useState(new Date().toISOString().slice(0, 7));
  const [salesReps,     setSalesReps]     = useState([]);
  const [targetRows,    setTargetRows]    = useState({});
  const [savingTarget,  setSavingTarget]  = useState(null);

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
        console.error('FieldSales fetch error:', err);
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
    } catch {
      setPunchReport([]);
    } finally {
      setPunchLoading(false);
    }
  };

  const toggleRow = (key) => setExpandedRows(p => ({ ...p, [key]: !p[key] }));

  const loadTargets = async (month) => {
    try {
      const [usersRes, targetsRes] = await Promise.all([
        API.get('/admin/users'),
        salesTargets.getAll(month),
      ]);
      const reps = (usersRes.data || []).filter(u => u.role === 'sales_person' || u.role === 'sales' || u.team === 'sales');
      setSalesReps(reps);
      const rows = {};
      reps.forEach(r => { rows[r.email] = { visits_target: 0, leads_target: 0, demos_target: 0 }; });
      (targetsRes.data || []).forEach(t => {
        rows[t.email] = { visits_target: t.visits_target || 0, leads_target: t.leads_target || 0, demos_target: t.demos_target || 0 };
      });
      setTargetRows(rows);
    } catch {
      toast.error('Failed to load targets');
    }
  };

  useEffect(() => {
    if (activeTab === 'targets') loadTargets(targetMonth);
  }, [activeTab, targetMonth]);

  const saveTarget = async (rep) => {
    setSavingTarget(rep.email);
    try {
      const row = targetRows[rep.email] || {};
      await salesTargets.set({ email: rep.email, name: rep.name, month_year: targetMonth, ...row });
      toast.success(`Target saved for ${rep.name}`);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingTarget(null);
    }
  };

  const handleExport = (type) => exportData.download(type);

  const unreadAlerts = geoAlerts.filter(a => !a.is_read).length;

  const tabs = [
    { id: 'overview',    label: 'Overview' },
    { id: 'attendance',  label: `Attendance (${attendance.length})` },
    { id: 'visits',      label: `Visits (${visits.length})` },
    { id: 'expenses',    label: `Expenses (${expenses.length})` },
    { id: 'targets',     label: 'Monthly Targets' },
    { id: 'login_logs',  label: `Login Logs (${loginLogs.length})` },
    { id: 'geo_alerts',  label: `Geo Alerts${unreadAlerts > 0 ? ` (${unreadAlerts}🔴)` : ` (${geoAlerts.length})`}` },
    { id: 'punch_report',label: 'Punch Report' },
  ];

  return {
    summary, attendance, visits, expenses, loginLogs, geoAlerts,
    activeTab, setActiveTab, loading, tabs,
    punchReport, punchLoading,
    reportDateFrom, setReportDateFrom,
    reportDateTo, setReportDateTo,
    reportUserEmail, setReportUserEmail,
    expandedRows, toggleRow,
    loadPunchReport,
    targetMonth, setTargetMonth,
    salesReps, targetRows, setTargetRows,
    savingTarget, saveTarget,
    handleExport,
    unreadAlerts,
  };
}
