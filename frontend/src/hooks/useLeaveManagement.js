import { useState, useEffect } from 'react';
import { leaves as leavesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

export function useLeaveManagement() {
  const { user } = useAuth();
  const [leavesList, setLeavesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    leave_type: 'casual', from_date: '', to_date: '', half_day: false, reason: '',
  });
  const [filter, setFilter] = useState('all');
  const [approveDialog, setApproveDialog] = useState(null);
  const [approveRemarks, setApproveRemarks] = useState('');

  const canApprove = user?.role === 'admin' ||
    (user?.assigned_modules || []).includes('hr');

  const fetchData = async () => {
    try {
      const lr = await leavesApi.getAll();
      setLeavesList(lr.data);
    } catch {
      toast.error('Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleApply = async () => {
    if (!form.from_date || !form.to_date) { toast.error('Select dates'); return; }
    if (new Date(form.to_date) < new Date(form.from_date)) {
      toast.error('To date must be after from date');
      return;
    }
    try {
      await leavesApi.apply(form);
      toast.success('Leave application submitted!');
      setApplyOpen(false);
      setForm({ leave_type: 'casual', from_date: '', to_date: '', half_day: false, reason: '' });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    }
  };

  const handleApprove = async (status) => {
    if (!approveDialog) return;
    try {
      await leavesApi.approve(approveDialog.leave_id, { status, remarks: approveRemarks });
      toast.success(`Leave ${status}`);
      setApproveDialog(null);
      setApproveRemarks('');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    }
  };

  const handleCancel = async (leaveId) => {
    if (!window.confirm('Cancel this leave application?')) return;
    try {
      await leavesApi.cancel(leaveId);
      toast.success('Leave cancelled');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    }
  };

  const calcDays = (from, to, halfDay) => {
    if (!from || !to) return 0;
    if (halfDay) return 0.5;
    const d = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) + 1;
    return Math.max(d, 0);
  };

  const myLeaves = leavesList.filter(l => l.user_email === user?.email);
  const pendingApprovals = canApprove
    ? leavesList.filter(l => l.status === 'pending' && l.user_email !== user?.email)
    : [];
  const displayLeaves = filter === 'all'
    ? leavesList
    : leavesList.filter(l => l.status === filter);
  const formDays = calcDays(form.from_date, form.to_date, form.half_day);

  return {
    user, leavesList, loading,
    applyOpen, setApplyOpen,
    form, setForm, formDays,
    filter, setFilter,
    approveDialog, setApproveDialog,
    approveRemarks, setApproveRemarks,
    canApprove, myLeaves, pendingApprovals, displayLeaves,
    handleApply, handleApprove, handleCancel,
  };
}
