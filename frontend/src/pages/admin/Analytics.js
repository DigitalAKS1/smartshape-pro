import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { analytics } from '../../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function Analytics() {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await analytics.getCharts();
        setChartData(res.data);
      } catch (error) {
        console.error('Error fetching charts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const COLORS = ['#e94560', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="analytics-title">Analytics</h1>
          <p className="text-[var(--text-secondary)] mt-1">Visual insights into your business</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stock by Type */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-xl font-medium text-[var(--text-primary)] mb-6">Stock by Die Type</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData?.stock_by_type || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2d44" />
                <XAxis dataKey="type" stroke="#a0a0b0" style={{ textTransform: 'capitalize' }} />
                <YAxis stroke="#a0a0b0" />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #2d2d44', color: '#fff' }} />
                <Bar dataKey="count" fill="#e94560" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Quotation Status */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-xl font-medium text-[var(--text-primary)] mb-6">Quotation Status Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData?.quotation_status || []}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => entry.status}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="status"
                >
                  {(chartData?.quotation_status || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #2d2d44', color: '#fff' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}