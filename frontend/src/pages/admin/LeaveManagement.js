import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { leaves as leavesApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Switch } from '../../components/ui/switch';
import { toast } from 'sonner';
import { Plus, Check, X, Calendar, Clock, User } from 'lucide-react';

const LEAVE_TYPES = [
  { id: 'casual', label: 'Casual Leave', short: 'CL', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', bar: 'bg-blue-500' },
  { id: 'sick', label: 'Sick Leave', short: 'SL', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', bar: 'bg-orange-500' },
  { id: 'earned', label: 'Earned Leave', short: 'EL', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', bar: 'bg-purple-500' },
];

export default function LeaveManagement() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [leavesList, setLeavesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: 'casual', from_date: '', to_date: '', half_day: false, reason: '' });
  const [filter, setFilter] = useState('all');
  const [approveDialog, setApproveDialog] = useState(null);
  const [approveRemarks, setApproveRemarks] = useState('');

  const canApprove = user?.role === 'admin' || (user?.assigned_modules || []).includes('hr');

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)] shadow-sm';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)]';
  const hoverBg = isDark ? 'hover:bg-[var(--bg-hover)]' : 'hover:bg-[#f0f0f5]';

  const fetchData = async () => {
    try {
      const lr = await leavesApi.getAll();
      setLeavesList(lr.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleApply = async () => {
    if (!form.from_date || !form.to_date) { toast.error('Select dates'); return; }
    if (new Date(form.to_date) < new Date(form.from_date)) { toast.error('To date must be after from date'); return; }
    try {
      await leavesApi.apply(form);
      toast.success('Leave application submitted!');
      setApplyOpen(false);
      setForm({ leave_type: 'casual', from_date: '', to_date: '', half_day: false, reason: '' });
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleApprove = async (status) => {
    if (!approveDialog) return;
    try {
      await leavesApi.approve(approveDialog.leave_id, { status, remarks: approveRemarks });
      toast.success(`Leave ${status}`);
      setApproveDialog(null);
      setApproveRemarks('');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleCancel = async (leaveId) => {
    if (!window.confirm('Cancel this leave application?')) return;
    try {
      await leavesApi.cancel(leaveId);
      toast.success('Leave cancelled');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const myLeaves = leavesList.filter(l => l.user_email === user?.email);
  const pendingApprovals = canApprove ? leavesList.filter(l => l.status === 'pending' && l.user_email !== user?.email) : [];
  const displayLeaves = filter === 'all' ? leavesList : leavesList.filter(l => l.status === filter);

  // Calculate days between dates
  const calcDays = (from, to, halfDay) => {
    if (!from || !to) return 0;
    if (halfDay) return 0.5;
    const d = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) + 1;
    return Math.max(d, 0);
  };

  const formDays = calcDays(form.from_date, form.to_date, form.half_day);

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="leave-title">Leave Management</h1>
            <p className={`${textSec} mt-1 text-sm`}>
              {canApprove ? `${pendingApprovals.length} pending approvals` : `${myLeaves.filter(l => l.status === 'approved').length} approved, ${myLeaves.filter(l => l.status === 'pending').length} pending`}
            </p>
          </div>
          <Button onClick={() => setApplyOpen(true)} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="apply-leave-btn">
            <Plus className="mr-2 h-4 w-4" /> Apply for Leave
          </Button>
        </div>

        {/* Pending Approvals Banner (for HR/Admin) */}
        {canApprove && pendingApprovals.length > 0 && (
          <div className={`border rounded-lg p-4 ${isDark ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-yellow-50 border-yellow-200'}`} data-testid="pending-approvals">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-yellow-500" />
              <h2 className={`text-sm font-semibold ${textPri}`}>Pending Approvals ({pendingApprovals.length})</h2>
            </div>
            <div className="space-y-2">
              {pendingApprovals.map(lv => {
                const ltObj = LEAVE_TYPES.find(t => t.id === lv.leave_type) || LEAVE_TYPES[0];
                return (
                  <div key={lv.leave_id} className={`${card} border rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2`} data-testid={`approval-${lv.leave_id}`}>
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f0f0f5]'} flex items-center justify-center`}>
                        <User className="h-4 w-4 text-[#e94560]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`${textPri} font-medium text-sm`}>{lv.user_name}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${ltObj.color}`}>{ltObj.label}</span>
                          {lv.half_day && <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Half Day</span>}
                        </div>
                        <p className={`text-xs ${textMuted} mt-0.5`}>
                          {lv.from_date} → {lv.to_date} ({lv.days} day{lv.days !== 1 ? 's' : ''})
                          {lv.reason && ` — ${lv.reason}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" onClick={() => { setApproveDialog(lv); setApproveRemarks(''); }} className="bg-green-600 hover:bg-green-700 text-white h-8" data-testid={`approve-${lv.leave_id}`}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" onClick={() => { setApproveDialog(lv); setApproveRemarks(''); }} variant="outline" className="border-red-500/30 text-red-400 h-8" data-testid={`reject-${lv.leave_id}`}>
                        <X className="h-3 w-3 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-1 flex-wrap">
          {['all', 'pending', 'approved', 'rejected'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${filter === f ? 'bg-[#e94560] text-white' : `${card} border ${textSec} ${hoverBg}`}`}
              data-testid={`filter-${f}`}>
              {f} ({f === 'all' ? leavesList.length : leavesList.filter(l => l.status === f).length})
            </button>
          ))}
        </div>

        {/* Leave History */}
        <div className="space-y-2" data-testid="leaves-list">
          {displayLeaves.length === 0 ? (
            <div className={`${card} border rounded-lg p-12 text-center`}>
              <Calendar className={`h-12 w-12 ${textMuted} mx-auto mb-3`} />
              <p className={`${textPri} font-medium`}>No leaves found</p>
              <p className={`text-sm ${textMuted} mt-1`}>Click "Apply for Leave" to submit a leave request</p>
            </div>
          ) : displayLeaves.map(lv => {
            const ltObj = LEAVE_TYPES.find(t => t.id === lv.leave_type) || LEAVE_TYPES[0];
            const isOwn = lv.user_email === user?.email;
            return (
              <div key={lv.leave_id} className={`${card} border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`} data-testid={`leave-${lv.leave_id}`}>
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-10 h-10 rounded-full ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f0f0f5]'} flex items-center justify-center flex-shrink-0`}>
                    <span className={`text-sm font-bold ${ltObj.color.split(' ')[1]}`}>{ltObj.short}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canApprove && <span className={`${textPri} font-medium text-sm`}>{lv.user_name}</span>}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${ltObj.color}`}>{ltObj.label}</span>
                      {lv.half_day && <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Half Day</span>}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        lv.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                        lv.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{lv.status}</span>
                    </div>
                    <div className={`flex items-center gap-3 mt-1 text-sm ${textSec}`}>
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {lv.from_date} → {lv.to_date}</span>
                      <span className="font-medium">{lv.days} day{lv.days !== 1 ? 's' : ''}</span>
                    </div>
                    {lv.reason && <p className={`text-xs ${textMuted} mt-1`}>Reason: {lv.reason}</p>}
                    {lv.approved_by && <p className={`text-xs ${lv.status === 'approved' ? 'text-green-400' : 'text-red-400'} mt-1`}>{lv.status === 'approved' ? 'Approved' : 'Rejected'} by {lv.approved_by}{lv.remarks ? ` — ${lv.remarks}` : ''}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isOwn && lv.status === 'pending' && (
                    <Button size="sm" variant="ghost" onClick={() => handleCancel(lv.leave_id)} className="text-red-400 h-8 text-xs" data-testid={`cancel-${lv.leave_id}`}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Apply Leave Dialog */}
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Apply for Leave</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              {/* Leave Type Selector */}
              <div>
                <Label className={`${textSec} text-xs mb-2 block`}>Leave Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {LEAVE_TYPES.map(lt => (
                    <button key={lt.id} type="button" onClick={() => setForm({...form, leave_type: lt.id})}
                      className={`p-3 rounded-lg border text-center transition-all ${form.leave_type === lt.id ? `${lt.color} ring-1` : `${'border-[var(--border-color)]'} ${hoverBg}`}`}
                      data-testid={`leave-type-${lt.id}`}>
                      <span className={`text-sm font-medium ${form.leave_type === lt.id ? '' : textSec}`}>{lt.short}</span>
                      <p className={`text-[10px] ${textMuted} mt-0.5`}>{lt.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${textSec} text-xs`}>From Date *</Label>
                  <Input type="date" value={form.from_date} onChange={e => setForm({...form, from_date: e.target.value, to_date: form.to_date || e.target.value})} className={inputCls} data-testid="leave-from-date" />
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>To Date *</Label>
                  <Input type="date" value={form.to_date} onChange={e => setForm({...form, to_date: e.target.value})} className={inputCls} min={form.from_date} data-testid="leave-to-date" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Switch checked={form.half_day} onCheckedChange={v => setForm({...form, half_day: v})} data-testid="leave-half-day" />
                  <Label className={textSec}>Half Day</Label>
                </div>
                {formDays > 0 && (
                  <span className={`text-sm font-medium ${textPri}`}>
                    {formDays} day{formDays !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div>
                <Label className={`${textSec} text-xs`}>Reason</Label>
                <Input value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} className={inputCls} placeholder="Why do you need leave?" data-testid="leave-reason" />
              </div>

            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApplyOpen(false)} className={'border-[var(--border-color)] text-[var(--text-secondary)]'}>Cancel</Button>
              <Button onClick={handleApply} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="submit-leave-btn">Submit Application</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve/Reject Dialog */}
        <Dialog open={!!approveDialog} onOpenChange={() => setApproveDialog(null)}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>Review Leave Request</DialogTitle></DialogHeader>
            {approveDialog && (
              <div className="space-y-3 py-2">
                <div className={`${'bg-[var(--bg-primary)] border-[var(--border-color)]'} border rounded-md p-3`}>
                  <p className={`${textPri} font-medium`}>{approveDialog.user_name}</p>
                  <p className={`text-sm ${textSec}`}>{LEAVE_TYPES.find(t => t.id === approveDialog.leave_type)?.label} — {approveDialog.days} day{approveDialog.days !== 1 ? 's' : ''}</p>
                  <p className={`text-sm ${textMuted}`}>{approveDialog.from_date} → {approveDialog.to_date}</p>
                  {approveDialog.reason && <p className={`text-xs ${textMuted} mt-1`}>Reason: {approveDialog.reason}</p>}
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Remarks (optional)</Label>
                  <Input value={approveRemarks} onChange={e => setApproveRemarks(e.target.value)} className={inputCls} placeholder="Add a note..." />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => handleApprove('rejected')} variant="outline" className="border-red-500/30 text-red-400">Reject</Button>
              <Button onClick={() => handleApprove('approved')} className="bg-green-600 hover:bg-green-700 text-white" data-testid="confirm-approve-btn">Approve</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
