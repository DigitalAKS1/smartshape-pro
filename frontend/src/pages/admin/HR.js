import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import API from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { Users, Calendar, MapPin, Clock } from 'lucide-react';

export default function HR() {
  const [attendance, setAttendance] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes] = await Promise.all([
          API.get('/admin/users'),
        ]);
        setUsers(usersRes.data);
        // Get all attendance records (admin endpoint)
        try {
          const attRes = await API.get('/admin/attendance');
          setAttendance(attRes.data);
        } catch {
          setAttendance([]);
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const activeUsers = users.filter(u => u.is_active !== false);
  const salesUsers = users.filter(u => u.assigned_modules?.includes('sales_portal'));

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
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="hr-title">HR</h1>
          <p className="text-[var(--text-secondary)] mt-1">Team overview, attendance and workforce management</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="hr-stats">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Users className="h-8 w-8 text-[#e94560]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Users</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{users.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Calendar className="h-8 w-8 text-[#10b981]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Active</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{activeUsers.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <MapPin className="h-8 w-8 text-blue-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Field Sales</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{salesUsers.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Clock className="h-8 w-8 text-yellow-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Attendance Records</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{attendance.length}</div>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Team Directory</h2>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="team-table">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Name</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Email</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Role</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Modules</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="py-3 text-[var(--text-primary)] font-medium">{u.name}</td>
                    <td className="py-3 text-[var(--text-secondary)]">{u.email}</td>
                    <td className="py-3">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${
                        u.role === 'admin' ? 'bg-[#e94560]/20 text-[#e94560] border-[#e94560]/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                      }`}>{u.role}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {(u.assigned_modules || []).slice(0, 3).map(m => (
                          <span key={m} className="text-xs bg-[var(--bg-hover)] text-[var(--text-secondary)] px-2 py-0.5 rounded border border-[var(--border-color)]">{m.replace(/_/g, ' ')}</span>
                        ))}
                        {(u.assigned_modules || []).length > 3 && <span className="text-xs text-[var(--text-muted)]">+{u.assigned_modules.length - 3}</span>}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs ${u.is_active !== false ? 'text-green-400' : 'text-red-400'}`}>
                        {u.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {attendance.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Recent Attendance</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Person</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Date</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Type</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Check In</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.slice(0, 20).map((a) => (
                    <tr key={a.attendance_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className="py-3 text-[var(--text-primary)]">{a.sales_person_name}</td>
                      <td className="py-3 text-[var(--text-secondary)]">{a.date}</td>
                      <td className="py-3 text-[var(--text-secondary)] capitalize">{a.work_type}</td>
                      <td className="py-3 text-[var(--text-secondary)]">{a.check_in_time ? formatDate(a.check_in_time) : '-'}</td>
                      <td className="py-3 text-[var(--text-secondary)] text-xs max-w-[200px] truncate">{a.check_in_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
