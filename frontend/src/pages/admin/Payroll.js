import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { payroll, expenses } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ChevronDown, ChevronUp, Check, X, MapPin, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function Payroll() {
  const [reimbursements, setReimbursements] = useState([]);
  const [expandedRow, setExpandedRow] = useState(null);
  const [tripDetails, setTripDetails] = useState({});
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReimbursements();
  }, [monthFilter]);

  const fetchReimbursements = async () => {
    try {
      const res = await payroll.getReimbursements(monthFilter);
      setReimbursements(res.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching reimbursements:', error);
      toast.error('Failed to load reimbursements');
      setLoading(false);
    }
  };

  const fetchTripDetails = async (salesPersonEmail, monthYear) => {
    try {
      const res = await expenses.getAll(monthYear);
      const personExpenses = res.data.filter(e => e.sales_person_email === salesPersonEmail);
      setTripDetails({ ...tripDetails, [salesPersonEmail]: personExpenses });
    } catch (error) {
      console.error('Error fetching trip details:', error);
    }
  };

  const handleToggleExpand = async (salesPersonEmail, monthYear) => {
    if (expandedRow === salesPersonEmail) {
      setExpandedRow(null);
    } else {
      setExpandedRow(salesPersonEmail);
      if (!tripDetails[salesPersonEmail]) {
        await fetchTripDetails(salesPersonEmail, monthYear);
      }
    }
  };

  const handleApprove = async (reimbursementId) => {
    try {
      await payroll.approve(reimbursementId);
      toast.success('Reimbursement approved!');
      fetchReimbursements();
    } catch (error) {
      console.error('Error approving:', error);
      toast.error('Failed to approve');
    }
  };

  const handleReject = async (reimbursementId) => {
    const notes = prompt('Reason for rejection:');
    if (!notes) return;
    
    try {
      await payroll.reject(reimbursementId, notes);
      toast.success('Reimbursement rejected');
      fetchReimbursements();
    } catch (error) {
      console.error('Error rejecting:', error);
      toast.error('Failed to reject');
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      submitted: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      approved: 'bg-green-500/20 text-green-300 border-green-500/30',
      rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
      paid: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  };

  const stats = {
    submitted: reimbursements.filter(r => r.status === 'submitted').length,
    approved: reimbursements.filter(r => r.status === 'approved').length,
    total_km: reimbursements.reduce((sum, r) => sum + r.total_km, 0),
    total_amount: reimbursements.reduce((sum, r) => sum + r.total_amount, 0),
    field_days: reimbursements.reduce((sum, r) => sum + r.field_days, 0),
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="payroll-title">Payroll Dashboard</h1>
            <p className="text-[var(--text-secondary)] mt-1">Review and approve travel reimbursements</p>
          </div>
          <Input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-48 bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]"
            data-testid="month-filter"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[#3b82f6]">{stats.submitted}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Submitted</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[#10b981]">{stats.approved}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Approved</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-2xl font-mono font-bold text-[var(--text-primary)]">{stats.total_km.toFixed(1)} km</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Total KM</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-2xl font-mono font-bold text-[#e94560]">{formatCurrency(stats.total_amount)}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Total Amount</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">{stats.field_days}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Field Days</p>
          </div>
        </div>

        {/* Reimbursements Table */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
            </div>
          ) : reimbursements.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--text-muted)]">No reimbursements for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="payroll-table">
                <thead className="bg-[var(--bg-primary)]/50">
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Sales Person</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Total KM</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Amount</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Visits</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Field Days</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Status</th>
                    <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Actions</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {reimbursements.map((reimb) => (
                    <React.Fragment key={reimb.reimbursement_id}>
                      <tr className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]" data-testid={`reimb-row-${reimb.sales_person_email}`}>
                        <td className="px-6 py-4">
                          <p className="text-[var(--text-primary)] font-medium">{reimb.sales_person_name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{reimb.sales_person_email}</p>
                        </td>
                        <td className="px-6 py-4 font-mono text-[var(--text-primary)] font-bold">{reimb.total_km.toFixed(1)} km</td>
                        <td className="px-6 py-4 font-mono text-[var(--text-primary)] font-bold">{formatCurrency(reimb.total_amount)}</td>
                        <td className="px-6 py-4 text-[var(--text-primary)]">{reimb.total_visits}</td>
                        <td className="px-6 py-4 text-[var(--text-primary)]">{reimb.field_days}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(reimb.status)}`}>
                            {reimb.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {reimb.status === 'submitted' && (
                            <div className="flex space-x-2">
                              <Button size="sm" onClick={() => handleApprove(reimb.reimbursement_id)} className="bg-[#10b981] hover:bg-[#059669] text-white" data-testid={`approve-${reimb.sales_person_email}`}>
                                <Check className="mr-1 h-3 w-3" /> Approve
                              </Button>
                              <Button size="sm" onClick={() => handleReject(reimb.reimbursement_id)} variant="outline" className="border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444]/10">
                                <X className="mr-1 h-3 w-3" /> Reject
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleToggleExpand(reimb.sales_person_email, reimb.month_year)}
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            data-testid={`expand-${reimb.sales_person_email}`}
                          >
                            {expandedRow === reimb.sales_person_email ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </button>
                        </td>
                      </tr>
                      
                      {/* Expanded Trip Details */}
                      {expandedRow === reimb.sales_person_email && (
                        <tr className="bg-[var(--bg-primary)]/50 border-b border-[var(--border-color)]">
                          <td colSpan="8" className="px-6 py-4">
                            <div className="space-y-3">
                              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Trip Details</h3>
                              {tripDetails[reimb.sales_person_email]?.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)]">No trips recorded</p>
                              ) : (
                                tripDetails[reimb.sales_person_email]?.map((trip) => (
                                  <div key={trip.expense_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`trip-detail-${trip.expense_id}`}>
                                    <div className="grid grid-cols-5 gap-4 text-sm">
                                      <div>
                                        <p className="text-[var(--text-muted)] mb-1">Date</p>
                                        <p className="text-[var(--text-primary)]">{trip.date}</p>
                                      </div>
                                      <div className="col-span-2">
                                        <p className="text-[var(--text-muted)] mb-1">Route</p>
                                        <div className="flex items-center space-x-2">
                                          <span className="text-[#10b981] truncate">{trip.from_location}</span>
                                          <ArrowRight className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
                                          <span className="text-[#ef4444] truncate">{trip.to_location}</span>
                                        </div>
                                      </div>
                                      <div>
                                        <p className="text-[var(--text-muted)] mb-1">Distance & Mode</p>
                                        <p className="text-[var(--text-primary)]">{trip.distance_km} km • {trip.transport_mode.replace('_', ' ')}</p>
                                      </div>
                                      <div>
                                        <p className="text-[var(--text-muted)] mb-1">Amount</p>
                                        <p className="text-[var(--text-primary)] font-mono font-bold">{formatCurrency(trip.amount)}</p>
                                      </div>
                                    </div>
                                    {trip.from_lat && trip.to_lat && (
                                      <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
                                        <a
                                          href={`https://www.google.com/maps/dir/${trip.from_lat},${trip.from_lng}/${trip.to_lat},${trip.to_lng}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-[#e94560] hover:text-[#f05c75] inline-flex items-center"
                                        >
                                          <MapPin className="h-3 w-3 mr-1" />
                                          View route on Google Maps
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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