import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { quotations as quotApi, payroll, expenses as expApi } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { IndianRupee, FileText, Clock, CheckCircle } from 'lucide-react';

export default function Accounts() {
  const [reimbursements, setReimbursements] = useState([]);
  const [quots, setQuots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [reimbRes, quotRes] = await Promise.all([
          payroll.getReimbursements(),
          quotApi.getAll()
        ]);
        setReimbursements(reimbRes.data);
        setQuots(quotRes.data);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const totalRevenue = quots.filter(q => ['confirmed', 'sent', 'pending'].includes(q.quotation_status)).reduce((s, q) => s + q.grand_total, 0);
  const totalReimbursements = reimbursements.reduce((s, r) => s + r.total_amount, 0);
  const pendingReimb = reimbursements.filter(r => r.status === 'submitted');
  const approvedReimb = reimbursements.filter(r => r.status === 'approved');

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
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="accounts-title">Accounts</h1>
          <p className="text-[var(--text-secondary)] mt-1">Financial overview and expense tracking</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="accounts-stats">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <IndianRupee className="h-8 w-8 text-[#10b981]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Revenue</span>
            </div>
            <div className="text-4xl font-mono font-bold text-[var(--text-primary)]">{formatCurrency(totalRevenue)}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="h-8 w-8 text-blue-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Quotations</span>
            </div>
            <div className="text-4xl font-mono font-bold text-[var(--text-primary)]">{quots.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Clock className="h-8 w-8 text-yellow-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Pending Approvals</span>
            </div>
            <div className="text-4xl font-mono font-bold text-[var(--text-primary)]">{pendingReimb.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <CheckCircle className="h-8 w-8 text-[#e94560]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Expenses</span>
            </div>
            <div className="text-4xl font-mono font-bold text-[var(--text-primary)]">{formatCurrency(totalReimbursements)}</div>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Recent Reimbursements</h2>
          {reimbursements.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] py-8">No reimbursements yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="reimbursements-table">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Sales Person</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Month</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Amount</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">KM</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reimbursements.map((r) => (
                    <tr key={r.reimbursement_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className="py-3 text-[var(--text-primary)]">{r.sales_person_name}</td>
                      <td className="py-3 text-[var(--text-secondary)]">{r.month_year}</td>
                      <td className="py-3 font-mono text-[var(--text-primary)]">{formatCurrency(r.total_amount)}</td>
                      <td className="py-3 text-[var(--text-secondary)]">{r.total_km} km</td>
                      <td className="py-3">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(r.status)}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
