import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { analytics, quotations as quotApi } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { Package, AlertTriangle, IndianRupee, TrendingUp, ArrowRight, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useTheme } from '../../contexts/ThemeContext';

const QUOT_STATUS_CLS = {
  draft:     'bg-slate-100 text-slate-600 border-slate-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  sent:      'bg-blue-50 text-blue-700 border-blue-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
};

function statusCls(s) {
  return QUOT_STATUS_CLS[s?.toLowerCase?.()] || 'bg-slate-100 text-slate-600 border-slate-200';
}

export default function Dashboard() {
  const { isDark } = useTheme();
  const [stats, setStats]                   = useState(null);
  const [recentQuotations, setRecentQuots]  = useState([]);
  const [loading, setLoading]               = useState(true);
  const [mounted, setMounted]               = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sr, qr] = await Promise.all([analytics.getDashboard(), quotApi.getAll()]);
        setStats(sr.data);
        setRecentQuots(qr.data.slice(0, 5));
      } catch (e) {
        console.error('Dashboard fetch error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loading) { const t = setTimeout(() => setMounted(true), 40); return () => clearTimeout(t); }
  }, [loading]);

  // ── Theme tokens ─────────────────────────────────────────────────────────
  const tk = isDark ? {
    card:   'bg-[var(--bg-card)] border-[var(--border-color)]',
    t1:     'text-[var(--text-primary)]',
    t2:     'text-[var(--text-secondary)]',
    tm:     'text-[var(--text-muted)]',
    divide: 'divide-[var(--border-color)]',
    row:    'hover:bg-[var(--bg-hover)]',
    mobCard:'bg-[var(--bg-hover)] border-[var(--border-color)]',
    icoBg:  (c) => `bg-[var(--bg-hover)]`,
  } : {
    card:   'bg-white border-[#e2e8f0]',
    t1:     'text-[#0f172a]',
    t2:     'text-[#334155]',
    tm:     'text-[#94a3b8]',
    divide: 'divide-[#e2e8f0]',
    row:    'hover:bg-[#f8fafc]',
    mobCard:'bg-[#f8fafc] border-[#e2e8f0]',
    icoBg:  (c) => c,
  };

  const rv = (delay = '') =>
    `transition-all duration-500 ease-out ${delay} ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`;

  // ── Stat card config ──────────────────────────────────────────────────────
  const statCards = [
    {
      label:   'Total Dies',
      value:   stats?.total_dies ?? 0,
      sub:     'In inventory',
      icon:    Package,
      iconCls: 'text-[#e94560]',
      icoBg:   isDark ? 'bg-[var(--bg-hover)]' : 'bg-red-50',
    },
    {
      label:   'Low Stock',
      value:   stats?.low_stock_count ?? 0,
      sub:     'Below minimum',
      icon:    AlertTriangle,
      iconCls: 'text-amber-500',
      icoBg:   isDark ? 'bg-[var(--bg-hover)]' : 'bg-amber-50',
    },
    {
      label:   'Pending Alerts',
      value:   stats?.pending_alerts ?? 0,
      sub:     'Purchase alerts',
      icon:    AlertTriangle,
      iconCls: 'text-red-500',
      icoBg:   isDark ? 'bg-[var(--bg-hover)]' : 'bg-red-50',
    },
    {
      label:   'Monthly Revenue',
      value:   formatCurrency(stats?.monthly_revenue ?? 0),
      sub:     'This month',
      icon:    IndianRupee,
      iconCls: 'text-emerald-500',
      icoBg:   isDark ? 'bg-[var(--bg-hover)]' : 'bg-emerald-50',
    },
  ];

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 pb-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className={`${rv()} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
          <div>
            <h1 className={`text-2xl sm:text-3xl font-bold ${tk.t1} tracking-tight`} data-testid="dashboard-title">
              Dashboard
            </h1>
            <p className={`text-sm ${tk.tm} mt-0.5`}>Business performance at a glance</p>
          </div>
          <Link to="/create-quotation">
            <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9 px-4 rounded-lg"
              data-testid="create-quotation-button">
              New Quotation <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        {/* ── KPI cards ───────────────────────────────────────────────────── */}
        <div className={`${rv('delay-75')} grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4`}
          data-testid="dashboard-stats-grid">
          {statCards.map(({ label, value, sub, icon: Icon, iconCls, icoBg }, i) => (
            <div key={label}
              className={`${tk.card} border rounded-xl p-4 sm:p-5 transition-all hover:-translate-y-0.5 hover:shadow-md`}
              data-testid={`stat-card-${label.toLowerCase().replace(/ /g, '-')}`}>
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg ${icoBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`h-[18px] w-[18px] ${iconCls}`} strokeWidth={1.7} />
                </div>
                <TrendingUp className={`h-3.5 w-3.5 ${tk.tm} opacity-40`} />
              </div>
              <p className={`text-2xl sm:text-3xl font-black leading-none ${tk.t1} tabular-nums`}>{value}</p>
              <p className={`text-[11px] uppercase tracking-widest font-semibold mt-2 ${tk.tm}`}>{label}</p>
              <p className={`text-xs ${tk.tm} mt-0.5 opacity-70`}>{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Recent Quotations ────────────────────────────────────────────── */}
        <div className={`${rv('delay-[120ms]')} ${tk.card} border rounded-2xl overflow-hidden`}>
          <div className={`flex items-center justify-between px-5 sm:px-6 py-4 border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
            <div>
              <p className={`font-bold text-base ${tk.t1}`} data-testid="recent-quotations-title">
                Recent Quotations
              </p>
              <p className={`text-xs ${tk.tm} mt-0.5`}>Last 5 created</p>
            </div>
            <Link to="/quotations"
              className="text-[11px] font-semibold text-[#e94560] hover:text-[#f05c75] flex items-center gap-1 transition-colors"
              data-testid="view-all-quotations-link">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recentQuotations.length === 0 ? (
            <div className="py-16 text-center">
              <p className={`text-sm ${tk.tm}`}>No quotations yet</p>
              <Link to="/create-quotation">
                <Button size="sm" className="mt-4 bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-4 h-8 text-xs">
                  Create first quotation
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block" data-testid="recent-quotations-table">
                <table className="w-full">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
                      {['Quote #', 'School', 'Package', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} className={`text-left text-[10px] uppercase tracking-[0.12em] font-semibold ${tk.tm} px-5 sm:px-6 py-3`}>
                          {h}
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${tk.divide}`}>
                    {recentQuotations.map((q) => (
                      <tr key={q.quotation_id}
                        className={`${tk.row} transition-colors`}
                        data-testid={`quotation-row-${q.quote_number}`}>
                        <td className={`px-5 sm:px-6 py-3.5 text-sm font-semibold text-[#e94560] tabular-nums`}>
                          {q.quote_number || q.quotation_number || '—'}
                        </td>
                        <td className={`px-5 sm:px-6 py-3.5 text-sm font-medium ${tk.t1} max-w-[160px] truncate`}>
                          {q.school_name}
                        </td>
                        <td className={`px-5 sm:px-6 py-3.5 text-sm ${tk.t2}`}>{q.package_name || '—'}</td>
                        <td className={`px-5 sm:px-6 py-3.5 text-sm font-bold ${tk.t1} tabular-nums`}>
                          {formatCurrency(q.grand_total)}
                        </td>
                        <td className="px-5 sm:px-6 py-3.5">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border capitalize ${statusCls(q.quotation_status || q.status)}`}>
                            {q.quotation_status || q.status || 'draft'}
                          </span>
                        </td>
                        <td className={`px-5 sm:px-6 py-3.5 text-xs ${tk.tm} tabular-nums`}>
                          {formatDate(q.created_at)}
                        </td>
                        <td className="pr-3">
                          <Link to={`/view-quotation/${q.quotation_id}`}>
                            <Button size="sm" variant="ghost"
                              className={`${tk.tm} hover:text-[#e94560] h-7 w-7 p-0`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-[var(--border-color)]">
                {recentQuotations.map((q) => (
                  <Link key={q.quotation_id} to={`/view-quotation/${q.quotation_id}`}
                    className={`flex items-center gap-3 px-4 py-3.5 ${tk.row} transition-colors`}
                    data-testid={`quotation-card-${q.quote_number}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-[#e94560] tabular-nums">
                          {q.quote_number || q.quotation_number || '—'}
                        </span>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${statusCls(q.quotation_status || q.status)}`}>
                          {q.quotation_status || q.status || 'draft'}
                        </span>
                      </div>
                      <p className={`text-sm font-medium ${tk.t1} truncate`}>{q.school_name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold ${tk.t1} tabular-nums`}>{formatCurrency(q.grand_total)}</p>
                      <p className={`text-xs ${tk.tm} mt-0.5 tabular-nums`}>{formatDate(q.created_at)}</p>
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
