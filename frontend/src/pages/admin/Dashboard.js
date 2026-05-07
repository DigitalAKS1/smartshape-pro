import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { analytics, quotations as quotApi } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { TrendingUp, Package, AlertTriangle, DollarSign, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentQuotations, setRecentQuotations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, quotsRes] = await Promise.all([
          analytics.getDashboard(),
          quotApi.getAll()
        ]);
        setStats(statsRes.data);
        setRecentQuotations(quotsRes.data.slice(0, 5));
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
            <p className="mt-4 text-[var(--text-secondary)]">Loading...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="dashboard-title">Dashboard</h1>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">Overview of your business performance</p>
          </div>
          <Link to="/create-quotation">
            <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-quotation-button">
              Create Quotation <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6" data-testid="dashboard-stats-grid">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 sm:p-6 hover:-translate-y-1 transition-all" data-testid="stat-card-total-dies">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <Package className="h-6 w-6 sm:h-8 sm:w-8 text-[#e94560]" strokeWidth={1.5} />
              <span className="text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Dies</span>
            </div>
            <div className="text-3xl sm:text-5xl font-mono font-bold text-[var(--text-primary)]">{stats?.total_dies || 0}</div>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1 sm:mt-2">In inventory</p>
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 sm:p-6 hover:-translate-y-1 transition-all" data-testid="stat-card-low-stock">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <AlertTriangle className="h-6 w-6 sm:h-8 sm:w-8 text-[#f59e0b]" strokeWidth={1.5} />
              <span className="text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-secondary)]">Low Stock</span>
            </div>
            <div className="text-3xl sm:text-5xl font-mono font-bold text-[var(--text-primary)]">{stats?.low_stock_count || 0}</div>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1 sm:mt-2">Items below minimum</p>
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 sm:p-6 hover:-translate-y-1 transition-all" data-testid="stat-card-pending-alerts">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <AlertTriangle className="h-6 w-6 sm:h-8 sm:w-8 text-[#ef4444]" strokeWidth={1.5} />
              <span className="text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-secondary)]">Pending Alerts</span>
            </div>
            <div className="text-3xl sm:text-5xl font-mono font-bold text-[var(--text-primary)]">{stats?.pending_alerts || 0}</div>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1 sm:mt-2">Purchase alerts</p>
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 sm:p-6 hover:-translate-y-1 transition-all" data-testid="stat-card-monthly-revenue">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-[#10b981]" strokeWidth={1.5} />
              <span className="text-[10px] sm:text-xs uppercase tracking-wide text-[var(--text-secondary)]">Monthly Revenue</span>
            </div>
            <div className="text-2xl sm:text-4xl font-mono font-bold text-[var(--text-primary)]">{formatCurrency(stats?.monthly_revenue || 0)}</div>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1 sm:mt-2">This month</p>
          </div>
        </div>

        {/* Recent Quotations */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-2xl font-medium text-[var(--text-primary)]" data-testid="recent-quotations-title">Recent Quotations</h2>
            <Link to="/quotations" className="text-[#e94560] hover:text-[#f05c75] text-sm font-medium" data-testid="view-all-quotations-link">
              View All →
            </Link>
          </div>

          {recentQuotations.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] py-12">No quotations yet</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full" data-testid="recent-quotations-table">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]">
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Quote #</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">School</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Package</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Amount</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Status</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentQuotations.map((quot) => (
                      <tr key={quot.quotation_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors" data-testid={`quotation-row-${quot.quote_number}`}>
                        <td className="py-4 font-mono text-[var(--text-primary)] font-medium">{quot.quote_number}</td>
                        <td className="py-4 text-[var(--text-primary)]">{quot.school_name}</td>
                        <td className="py-4 text-[var(--text-secondary)]">{quot.package_name}</td>
                        <td className="py-4 font-mono text-[var(--text-primary)] font-bold">{formatCurrency(quot.grand_total)}</td>
                        <td className="py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(quot.quotation_status)}`}>
                            {quot.quotation_status}
                          </span>
                        </td>
                        <td className="py-4 text-[var(--text-secondary)]">{formatDate(quot.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-3">
                {recentQuotations.map((quot) => (
                  <Link key={quot.quotation_id} to={`/view-quotation/${quot.quotation_id}`} className="block bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3" data-testid={`quotation-card-${quot.quote_number}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-sm text-[#e94560] font-medium">{quot.quote_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(quot.quotation_status)}`}>{quot.quotation_status}</span>
                    </div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">{quot.school_name}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{formatCurrency(quot.grand_total)}</span>
                      <span className="text-xs text-[var(--text-muted)]">{formatDate(quot.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}