import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { attendance as attendanceApi, visits as visitsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, MapPin, FileText, Receipt, LogIn, MapPinned, LayoutDashboard, Zap } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { formatDate, getStatusColor } from '../../lib/utils';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export default function SalesHome() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [todayVisits, setTodayVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [attRes, visitsRes] = await Promise.all([
          attendanceApi.getToday(),
          visitsApi.getAll()
        ]);
        setTodayAttendance(attRes.data);
        const today = new Date().toISOString().split('T')[0];
        setTodayVisits(visitsRes.data.filter(v => v.visit_date === today));
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

  return (
    <SalesLayout title="SmartShape Field">
      <div className="space-y-6">
        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="sales-home-greeting">{getGreeting()}!</h1>
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
                  <p className="text-xs text-[var(--text-secondary)]">Your daily tasks, follow-ups & priorities</p>
                </div>
              </div>
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