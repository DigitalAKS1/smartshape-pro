import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { attendance as attendanceApi, visits as visitsApi, leads as leadsApi, tasks as tasksApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, MapPin, FileText, Receipt, LogIn, MapPinned, LayoutDashboard, Zap, Target, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { getStatusColor } from '../../lib/utils';
import { Link } from 'react-router-dom';

export default function SalesHome() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [todayVisits, setTodayVisits] = useState([]);
  const [kpis, setKpis] = useState({ assigned: 0, demos: 0, won: 0, pendingFollowups: 0, weekVisitsTotal: 0, weekVisitsDone: 0 });
  const [todayTasks, setTodayTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const monthStart = today.slice(0, 7) + '-01';

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 6);
        const weekAgoStr = weekAgo.toISOString().split('T')[0];

        const [attRes, visitsRes, leadsRes, tasksRes] = await Promise.all([
          attendanceApi.getToday(),
          visitsApi.getAll(),
          leadsApi.getAll(),
          tasksApi.getAll(),
        ]);

        setTodayAttendance(attRes.data);

        const allVisits = visitsRes.data || [];
        setTodayVisits(allVisits.filter(v => v.visit_date === today));

        const allLeads = leadsRes.data || [];
        const assigned = allLeads.length;
        const demos = allLeads.filter(l => l.stage === 'demo' || (l.pipeline_history || []).some(h => h.to_stage === 'demo' && h.at >= monthStart)).length;
        const won = allLeads.filter(l => l.stage === 'won' && (l.updated_at || '').slice(0, 10) >= monthStart).length;

        const allTasks = tasksRes.data || [];
        const pendingFollowups = allTasks.filter(t => t.status === 'pending' && t.due_date <= today).length;
        const todayPending = allTasks.filter(t => t.status === 'pending' && t.due_date === today);
        setTodayTasks(todayPending);

        const weekVisits = allVisits.filter(v => v.visit_date >= weekAgoStr && v.visit_date <= today);
        const weekVisitsDone = weekVisits.filter(v => v.status === 'completed').length;

        setKpis({ assigned, demos, won, pendingFollowups, weekVisitsTotal: weekVisits.length, weekVisitsDone });
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const visitPct = kpis.weekVisitsTotal > 0 ? Math.round((kpis.weekVisitsDone / kpis.weekVisitsTotal) * 100) : 0;

  return (
    <SalesLayout title="SmartShape Field">
      <div className="space-y-6">
        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="sales-home-greeting">{getGreeting()}, {user?.name?.split(' ')[0]}!</h1>
            <p className="text-[var(--text-secondary)] mt-1">Ready to make great sales today?</p>
          </div>
          {isAdmin && (
            <Link to="/dashboard">
              <Button size="sm" className="bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" data-testid="go-to-dashboard-btn">
                <LayoutDashboard className="mr-1.5 h-4 w-4 text-[#e94560]" /> Dashboard
              </Button>
            </Link>
          )}
        </div>

        {/* KPI Cards */}
        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-[var(--text-secondary)]">Leads Assigned</span>
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{kpis.assigned}</p>
            </div>
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-purple-400" />
                <span className="text-xs text-[var(--text-secondary)]">Won This Month</span>
              </div>
              <p className="text-2xl font-bold text-green-400">{kpis.won}</p>
            </div>
            <div className={`bg-[var(--bg-card)] border rounded-md p-4 ${kpis.pendingFollowups > 0 ? 'border-[#e94560]/50' : 'border-[var(--border-color)]'}`}>
              <div className="flex items-center gap-2 mb-1">
                <Clock className={`h-4 w-4 ${kpis.pendingFollowups > 0 ? 'text-[#e94560]' : 'text-[var(--text-muted)]'}`} />
                <span className="text-xs text-[var(--text-secondary)]">Overdue Follow-ups</span>
              </div>
              <p className={`text-2xl font-bold ${kpis.pendingFollowups > 0 ? 'text-[#e94560]' : 'text-[var(--text-primary)]'}`}>{kpis.pendingFollowups}</p>
            </div>
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-400" />
                <span className="text-xs text-[var(--text-secondary)]">Visits This Week</span>
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{kpis.weekVisitsDone}<span className="text-sm font-normal text-[var(--text-muted)]">/{kpis.weekVisitsTotal} ({visitPct}%)</span></p>
            </div>
          </div>
        )}

        {/* Today's Actions highlight card */}
        <Link to="/today" className="block" data-testid="todays-actions-link">
          <div className="bg-gradient-to-r from-[#e94560]/15 to-[#f05c75]/5 border border-[#e94560]/30 rounded-md p-5 hover:from-[#e94560]/20 hover:to-[#f05c75]/10 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-[#e94560] rounded-full p-2.5">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[var(--text-primary)]">Today's Actions</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {todayTasks.length > 0 ? `${todayTasks.length} task${todayTasks.length > 1 ? 's' : ''} due today` : 'Your daily tasks, follow-ups & priorities'}
                  </p>
                </div>
              </div>
              {todayTasks.length > 0 && (
                <span className="text-xs font-bold text-white bg-[#e94560] rounded-full px-2 py-0.5">{todayTasks.length}</span>
              )}
              <span className="text-xs font-medium text-[#e94560]">View →</span>
            </div>
          </div>
        </Link>

        {/* Attendance Status */}
        {todayAttendance ? (
          <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-md p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-[#10b981] rounded-full p-2">
                <Calendar className="h-5 w-5 text-[var(--text-primary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-secondary)]">Checked in at</p>
                <p className="text-lg font-medium text-[var(--text-primary)]">
                  {new Date(todayAttendance.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-xs text-[#10b981] capitalize">{todayAttendance.work_type.replace('_', ' ')}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-md p-6">
            <p className="text-[#f59e0b] font-medium">You haven't checked in today</p>
            <Link to="/sales/attendance">
              <Button className="mt-4 bg-[#e94560] hover:bg-[#f05c75] text-white w-full">
                <LogIn className="mr-2 h-4 w-4" /> Check In Now
              </Button>
            </Link>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-4">
            <Link to="/sales/attendance" className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 hover:bg-[var(--bg-hover)] transition-all" data-testid="quick-action-attendance">
              <Calendar className="h-8 w-8 text-[#e94560] mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Attendance</p>
            </Link>
            <Link to="/sales/visits" className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 hover:bg-[var(--bg-hover)] transition-all" data-testid="quick-action-visits">
              <MapPin className="h-8 w-8 text-[#e94560] mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Plan Visit</p>
            </Link>
            <Link to="/sales/quotations" className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 hover:bg-[var(--bg-hover)] transition-all" data-testid="quick-action-quotations">
              <FileText className="h-8 w-8 text-[#e94560] mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Quotations</p>
            </Link>
            <Link to="/sales/expenses" className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 hover:bg-[var(--bg-hover)] transition-all" data-testid="quick-action-expenses">
              <Receipt className="h-8 w-8 text-[#e94560] mb-3" />
              <p className="text-[var(--text-primary)] font-medium">Log Expense</p>
            </Link>
          </div>
        </div>

        {/* Today's Visits */}
        <div>
          <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Today's Visits</h2>
          {todayVisits.length === 0 ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-8 text-center">
              <MapPinned className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-[var(--text-muted)]">No visits scheduled for today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayVisits.map((visit) => (
                <div key={visit.visit_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`visit-card-${visit.visit_id}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-[var(--text-primary)] font-medium">{visit.school_name}</h3>
                      <p className="text-sm text-[var(--text-secondary)]">{visit.visit_time} • {visit.contact_person}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(visit.status)}`}>
                      {visit.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SalesLayout>
  );
}
