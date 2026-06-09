import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { analytics, quotations as quotApi } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Package, AlertTriangle, IndianRupee } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useTheme } from '../../contexts/ThemeContext';
import { ArrowRight } from 'lucide-react';
import StatCard from '../../components/dashboard/StatCard';
import RecentQuotationsCard from '../../components/dashboard/RecentQuotationsCard';
import AgentPerformanceCard from '../../components/dashboard/AgentPerformanceCard';
import LeadPipelineCard from '../../components/dashboard/LeadPipelineCard';
import AgendaWeekWidget from '../../components/delegation/AgendaWeekWidget';

export default function Dashboard() {
  const { isDark } = useTheme();
  const [stats, setStats]                  = useState(null);
  const [recentQuotations, setRecentQuots] = useState([]);
  const [conversion, setConversion]        = useState(null);
  const [loading, setLoading]              = useState(true);
  const [mounted, setMounted]              = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sr, qr, convRes] = await Promise.all([
          analytics.getDashboard(), quotApi.getAll(), analytics.getConversion(),
        ]);
        setStats(sr.data);
        setRecentQuots(qr.data.slice(0, 5));
        setConversion(convRes.data);
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

  const tk = isDark ? {
    card:   'bg-[var(--bg-card)] border-[var(--border-color)]',
    t1:     'text-[var(--text-primary)]',
    t2:     'text-[var(--text-secondary)]',
    tm:     'text-[var(--text-muted)]',
    divide: 'divide-[var(--border-color)]',
    row:    'hover:bg-[var(--bg-hover)]',
    mobCard:'bg-[var(--bg-hover)] border-[var(--border-color)]',
  } : {
    card:   'bg-white border-[#e2e8f0]',
    t1:     'text-[#0f172a]',
    t2:     'text-[#334155]',
    tm:     'text-[#94a3b8]',
    divide: 'divide-[#e2e8f0]',
    row:    'hover:bg-[#f8fafc]',
    mobCard:'bg-[#f8fafc] border-[#e2e8f0]',
  };

  const rv = (delay = '') =>
    `transition-all duration-500 ease-out ${delay} ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`;

  const statCards = [
    { label: 'Total Dies',      value: stats?.total_dies ?? 0,               sub: 'In inventory',    icon: Package,       iconCls: 'text-[#e94560]',   icoBg: isDark ? 'bg-[var(--bg-hover)]' : 'bg-red-50' },
    { label: 'Low Stock',       value: stats?.low_stock_count ?? 0,           sub: 'Below minimum',   icon: AlertTriangle, iconCls: 'text-amber-500',   icoBg: isDark ? 'bg-[var(--bg-hover)]' : 'bg-amber-50' },
    { label: 'Pending Alerts',  value: stats?.pending_alerts ?? 0,            sub: 'Purchase alerts', icon: AlertTriangle, iconCls: 'text-red-500',     icoBg: isDark ? 'bg-[var(--bg-hover)]' : 'bg-red-50' },
    { label: 'Monthly Revenue', value: formatCurrency(stats?.monthly_revenue ?? 0), sub: 'This month',icon: IndianRupee,   iconCls: 'text-emerald-500', icoBg: isDark ? 'bg-[var(--bg-hover)]' : 'bg-emerald-50' },
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

        {/* Header */}
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

        {/* KPI cards */}
        <div className={`${rv('delay-75')} grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4`} data-testid="dashboard-stats-grid">
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} tk={tk} />
          ))}
        </div>

        {/* This week agenda */}
        <div className={rv()}>
          <AgendaWeekWidget card={tk.card} textPri={tk.t1} textSec={tk.t2} textMuted={tk.tm} />
        </div>

        {/* Recent Quotations */}
        <RecentQuotationsCard recentQuotations={recentQuotations} tk={tk} isDark={isDark} rv={rv} />

        {/* Agent Performance */}
        <AgentPerformanceCard conversion={conversion} tk={tk} isDark={isDark} rv={rv} />

        {/* Lead Pipeline */}
        <LeadPipelineCard conversion={conversion} tk={tk} isDark={isDark} rv={rv} />

      </div>
    </AdminLayout>
  );
}
