import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { orders as ordersApi, holds as holdsApi, quotations as quotApi, dispatches as dispatchesApi, dispatchApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import EmptyState, { EMPTY_STATES } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Package, Truck, CheckCircle, Clock, XCircle, Search, Eye, ArrowRight, Lock, Unlock, ShieldCheck, AlertTriangle, MessageSquare, CreditCard, DollarSign, Square, CheckSquare, Layers, Smartphone, Monitor } from 'lucide-react';
import KanbanBoard from '../../components/KanbanBoard';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

// WhatsApp picker: shows Mobile App vs Web options
function WaPickerButton({ phone, message, label = 'Send via WhatsApp', className = '', testId = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const num = (phone || '').replace(/\D/g, '');
  const e164 = num ? (num.startsWith('91') ? num : '91' + num) : '';
  const encoded = encodeURIComponent(message || '');

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const send = (type) => {
    setOpen(false);
    if (!e164) {
      navigator.clipboard?.writeText(message || '');
      toast.success('No phone found — message copied to clipboard');
      return;
    }
    const url = type === 'web'
      ? `https://web.whatsapp.com/send?phone=${e164}&text=${encoded}`
      : `https://wa.me/${e164}?text=${encoded}`;
    window.open(url, '_blank');
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)}
        className={`border-green-600/50 text-green-500 hover:bg-green-500/10 ${className}`}
        data-testid={testId}>
        <MessageSquare className="mr-1 h-3 w-3" /> {label}
      </Button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xl overflow-hidden">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold px-3 pt-2.5 pb-1">Open in</p>
          <button onClick={() => send('mobile')}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Smartphone className="h-4 w-4 text-green-400 flex-shrink-0" />
            <div className="text-left">
              <p className="font-medium leading-tight">WhatsApp App</p>
              <p className="text-[10px] text-[var(--text-muted)]">Mobile / Desktop app</p>
            </div>
          </button>
          <button onClick={() => send('web')}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border-t border-[var(--border-color)]">
            <Monitor className="h-4 w-4 text-blue-400 flex-shrink-0" />
            <div className="text-left">
              <p className="font-medium leading-tight">WhatsApp Web</p>
              <p className="text-[10px] text-[var(--text-muted)]">web.whatsapp.com</p>
            </div>
          </button>
          {!e164 && (
            <div className="px-3 py-2 border-t border-[var(--border-color)]">
              <p className="text-[10px] text-amber-400">No phone — will copy message</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PROD_STAGES = [
  { id: 'order_created', label: 'Order Created', color: 'border-yellow-500/40' },
  { id: 'in_production', label: 'In Production', color: 'border-blue-500/40' },
  { id: 'ready_to_dispatch', label: 'Ready to Dispatch', color: 'border-purple-500/40' },
  { id: 'dispatched', label: 'Dispatched', color: 'border-green-500/40' },
];

const ORDER_STATUSES = [
  { id: 'pending', label: 'Pending', icon: Clock, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  { id: 'confirmed', label: 'Confirmed', icon: ShieldCheck, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { id: 'dispatched', label: 'Dispatched', icon: Truck, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/30' },
];

export default function OrdersManagement() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('orders');
  const [ordersList, setOrdersList] = useState([]);
  const [holdsList, setHoldsList] = useState([]);
  const [dispatchList, setDispatchList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // Create order
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingQuots, setPendingQuots] = useState([]);
  const [selectedQuotId, setSelectedQuotId] = useState('');
  // Detail view
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Status update
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  // FMS Phase 5.4: WhatsApp tracking share
  const [waDispatchOpen, setWaDispatchOpen] = useState(false);
  const [waDispatch, setWaDispatch] = useState(null);
  const [statusNote, setStatusNote] = useState('');
  // Bulk hold release
  const [selectedHolds, setSelectedHolds] = useState(new Set());
  const [holdSchoolFilter, setHoldSchoolFilter] = useState('all');
  const [bulkReleasing, setBulkReleasing] = useState(false);
  // Tracking dialog
  const [trackingDialog, setTrackingDialog] = useState({ open: false, dispatch: null });
  const [trackingForm, setTrackingForm] = useState({ courier_name: '', tracking_number: '' });
  const [trackingSaving, setTrackingSaving] = useState(false);

  // Dispatch dialog
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({ courier_name: '', tracking_number: '', notes: '' });
  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'neft', reference: '', notes: '', payment_date: new Date().toISOString().split('T')[0] });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const fetchData = async () => {
    try {
      const [or, hr, dr] = await Promise.all([ordersApi.getAll(), holdsApi.getAll(), dispatchesApi.getAll()]);
      setOrdersList(or.data);
      setHoldsList(hr.data);
      setDispatchList(dr.data);
    } catch { toast.error('Failed to load orders'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const openCreate = async () => {
    try {
      const res = await quotApi.getAll();
      const existing = ordersList.map(o => o.quotation_id);
      setPendingQuots(res.data.filter(q => (q.catalogue_status === 'submitted' || q.quotation_status === 'pending' || q.quotation_status === 'confirmed') && !existing.includes(q.quotation_id)));
      setSelectedQuotId('');
      setCreateOpen(true);
    } catch { toast.error('Failed to load quotations'); }
  };

  const handleCreate = async () => {
    if (!selectedQuotId) { toast.error('Select a quotation'); return; }
    try {
      await ordersApi.create({ quotation_id: selectedQuotId });
      toast.success('Order created!');
      setCreateOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create order'); }
  };

  const openDetail = async (order) => {
    try {
      const res = await ordersApi.get(order.order_id);
      setDetailOrder(res.data);
      setDetailOpen(true);
    } catch { toast.error('Failed to load order details'); }
  };

  const openStatusChange = (order) => {
    setStatusTarget(order);
    setNewStatus('');
    setStatusNote('');
    setStatusOpen(true);
  };

  const handleStatusChange = async () => {
    if (!newStatus) { toast.error('Select a status'); return; }
    try {
      await ordersApi.updateStatus(statusTarget.order_id, { status: newStatus, note: statusNote });
      toast.success(`Order ${newStatus}`);
      setStatusOpen(false);
      fetchData();
      if (detailOrder?.order_id === statusTarget.order_id) {
        const res = await ordersApi.get(statusTarget.order_id);
        setDetailOrder(res.data);
      }
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleReleaseHold = async (itemId) => {
    if (!window.confirm('Release this hold? Stock will become available again.')) return;
    try { await holdsApi.release(itemId); toast.success('Hold released'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleBulkRelease = async () => {
    if (selectedHolds.size === 0) return;
    if (!window.confirm(`Release ${selectedHolds.size} hold(s)? Stock will become available again.`)) return;
    setBulkReleasing(true);
    try {
      const res = await holdsApi.bulkRelease([...selectedHolds]);
      toast.success(`Released ${res.data.released} hold(s)${res.data.skipped > 0 ? `, ${res.data.skipped} skipped` : ''}`);
      setSelectedHolds(new Set());
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Bulk release failed'); }
    finally { setBulkReleasing(false); }
  };

  const toggleHoldSelect = (itemId) => {
    setSelectedHolds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const selectAllVisibleHolds = (visibleIds) => {
    setSelectedHolds(prev => {
      const allSelected = visibleIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };

  const selectSchoolHolds = (schoolName) => {
    const schoolItems = holdsList.filter(h => h.school_name === schoolName).map(h => h.order_item_id);
    setSelectedHolds(new Set(schoolItems));
  };

  const handleConfirmHold = async (itemId) => {
    try { await holdsApi.confirm(itemId); toast.success('Hold confirmed'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const openDispatchDialog = (order) => {
    setDispatchTarget(order);
    setDispatchForm({ courier_name: '', tracking_number: '', notes: '' });
    setDispatchOpen(true);
  };

  const handleCreateDispatch = async () => {
    if (!dispatchTarget) return;
    try {
      await dispatchesApi.create({ order_id: dispatchTarget.order_id, ...dispatchForm });
      toast.success('Dispatch created! Stock auto-deducted.');
      setDispatchOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleMarkDelivered = async (dispatchId) => {
    try { await dispatchesApi.markDelivered(dispatchId); toast.success('Marked as delivered'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const openPaymentDialog = async (order) => {
    setPaymentTarget(order);
    setPaymentForm({ amount: '', method: 'neft', reference: '', notes: '', payment_date: new Date().toISOString().split('T')[0] });
    setPaymentOpen(true);
    try {
      const res = await ordersApi.getPayments(order.order_id);
      setPaymentHistory(res.data.payments || []);
    } catch { setPaymentHistory([]); }
  };

  const handleRecordPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    setPaymentSubmitting(true);
    try {
      const res = await ordersApi.recordPayment(paymentTarget.order_id, { ...paymentForm, amount: parseFloat(paymentForm.amount) });
      toast.success(`Payment of ₹${parseFloat(paymentForm.amount).toLocaleString('en-IN')} recorded — Status: ${res.data.payment_status}`);
      setPaymentOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to record payment'); }
    finally { setPaymentSubmitting(false); }
  };

  const filteredOrders = ordersList.filter(o => {
    if (statusFilter !== 'all' && o.order_status !== statusFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (o.school_name || '').toLowerCase().includes(s) || (o.order_number || '').toLowerCase().includes(s) || (o.quote_number || '').toLowerCase().includes(s);
    }
    return true;
  });

  const stats = {
    total: ordersList.length,
    pending: ordersList.filter(o => o.order_status === 'pending').length,
    confirmed: ordersList.filter(o => o.order_status === 'confirmed').length,
    dispatched: ordersList.filter(o => o.order_status === 'dispatched').length,
    delivered: ordersList.filter(o => o.order_status === 'delivered').length,
    activeHolds: holdsList.length,
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="orders-title">Orders & Holds</h1>
            <p className={`${textSec} mt-1 text-sm`}>{stats.total} orders • {stats.activeHolds} active holds</p>
          </div>
          <Button onClick={openCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-order-btn">
            <Package className="mr-1 h-3 w-3" /> Create Order
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: stats.total, color: textPri },
            { label: 'Pending', value: stats.pending, color: 'text-yellow-400' },
            { label: 'Confirmed', value: stats.confirmed, color: 'text-blue-400' },
            { label: 'Dispatched', value: stats.dispatched, color: 'text-purple-400' },
            { label: 'Delivered', value: stats.delivered, color: 'text-green-400' },
            { label: 'Holds', value: stats.activeHolds, color: 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-md p-3 text-center`}>
              <div className={`text-2xl font-mono font-bold ${s.color}`}>{s.value}</div>
              <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {['orders', 'kanban', 'holds', 'dispatches'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-all ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`tab-${tab}`}>
              {tab === 'orders' ? `Orders (${ordersList.length})` : tab === 'kanban' ? 'Production Pipeline' : tab === 'holds' ? `Hold Monitor (${holdsList.length})` : `Dispatches (${dispatchList.length})`}
            </button>
          ))}
        </div>

        {/* PRODUCTION KANBAN (FMS Phase 5.3) */}
        {activeTab === 'kanban' && (
          <KanbanBoard
            columns={PROD_STAGES}
            items={ordersList}
            getItemId={(o) => o.order_id}
            getItemColumnId={(o) => o.production_stage || 'order_created'}
            onMove={async ({ itemId, to, item }) => {
              // Stock + payment guards surfaced by backend
              try {
                await ordersApi.updateProductionStage(itemId, to);
                toast.success(`Moved to ${PROD_STAGES.find(s => s.id === to)?.label}`);
                fetchData();
              } catch (e) {
                toast.error(e?.response?.data?.detail || 'Move blocked');
              }
            }}
            emptyText="Drop orders here"
            renderCard={(order) => (
              <div className={`${card} border rounded-md p-2.5`} data-testid={`prod-kanban-${order.order_number}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#e94560] font-medium">{order.order_number}</span>
                  <span className={`text-[10px] ${textMuted}`}>{formatCurrency(order.grand_total)}</span>
                </div>
                <p className={`text-sm ${textPri} truncate mt-1`}>{order.school_name}</p>
                <p className={`text-[10px] ${textMuted}`}>Items: {order.total_items}</p>
                <p className={`text-[10px] ${textMuted}`}>Paid: {order.payment_received || 0} / {order.grand_total} ({order.payment_threshold_pct || 50}% req)</p>
              </div>
            )}
          />
        )}

        {/* Search */}
        {activeTab === 'orders' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
              <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search order, school, quote..." className={`pl-10 ${inputCls}`} data-testid="order-search" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="order-status-filter">
              <option value="all">All Status</option>
              {ORDER_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}

        {/* ORDERS LIST */}
        {activeTab === 'orders' && (
          <div className="space-y-3" data-testid="orders-list">
            {filteredOrders.length === 0 ? (
              <EmptyState {...EMPTY_STATES.orders} desc="Accepted quotations will show up here as confirmed orders." />
            ) : (
              filteredOrders.map(order => {
                const statusObj = ORDER_STATUSES.find(s => s.id === order.order_status) || ORDER_STATUSES[0];
                const StatusIcon = statusObj.icon;
                return (
                  <div key={order.order_id} className={`${card} border rounded-md p-4`} data-testid={`order-card-${order.order_number}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm text-[#e94560] font-medium">{order.order_number}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusObj.color}`}>
                            <StatusIcon className="inline h-3 w-3 mr-0.5" />{statusObj.label}
                          </span>
                        </div>
                        <h3 className={`text-base font-medium ${textPri} truncate`}>{order.school_name}</h3>
                        <div className={`flex flex-wrap items-center gap-3 mt-1 text-xs ${textMuted}`}>
                          <span>Quote: {order.quote_number}</span>
                          <span>Package: {order.package_name}</span>
                          <span>{order.total_items} items</span>
                          <span>{formatDate(order.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`font-mono text-lg font-bold ${textPri}`}>{formatCurrency(order.grand_total)}</span>
                        <Button variant="outline" size="sm" onClick={() => openDetail(order)} className={`border-[var(--border-color)] ${textSec}`} data-testid={`view-order-${order.order_number}`}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {(order.order_status === 'confirmed' || order.order_status === 'pending') && (
                          <Button size="sm" onClick={() => openDispatchDialog(order)} className="bg-purple-600 hover:bg-purple-700 text-white" data-testid={`dispatch-order-${order.order_number}`}>
                            <Truck className="h-3 w-3 mr-1" /> Dispatch
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openPaymentDialog(order)}
                          className={`border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981]/10 ${order.payment_status === 'paid' ? 'opacity-50' : ''}`}
                          title="Record payment"
                          data-testid={`payment-order-${order.order_number}`}
                        >
                          <CreditCard className="h-3 w-3 mr-1" />
                          {order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'partial' ? 'Partial' : 'Record Payment'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openStatusChange(order)} className={`border-[var(--border-color)] ${textSec}`} data-testid={`status-order-${order.order_number}`}>
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* HOLDS MONITOR */}
        {activeTab === 'holds' && (() => {
          const schools = [...new Set(holdsList.map(h => h.school_name).filter(Boolean))].sort();
          const filtered = holdSchoolFilter === 'all' ? holdsList : holdsList.filter(h => h.school_name === holdSchoolFilter);
          const filteredIds = filtered.map(h => h.order_item_id);
          const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedHolds.has(id));
          return (
          <div className="space-y-3" data-testid="holds-list">
            {holdsList.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <Lock className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No active holds</p>
              </div>
            ) : (
              <>
                {/* Toolbar: school filter + bulk actions */}
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Layers className={`h-3.5 w-3.5 ${textMuted}`} />
                      <span className={`text-xs ${textMuted}`}>Select by school:</span>
                    </div>
                    <select
                      value={holdSchoolFilter}
                      onChange={e => { setHoldSchoolFilter(e.target.value); setSelectedHolds(new Set()); }}
                      className={`h-8 px-2 rounded-md text-xs ${inputCls}`}
                      data-testid="hold-school-filter"
                    >
                      <option value="all">All Schools ({holdsList.length})</option>
                      {schools.map(s => {
                        const cnt = holdsList.filter(h => h.school_name === s).length;
                        return <option key={s} value={s}>{s} ({cnt})</option>;
                      })}
                    </select>
                    {holdSchoolFilter !== 'all' && (
                      <Button size="sm" variant="outline" onClick={() => selectSchoolHolds(holdSchoolFilter)}
                        className={`h-7 text-xs border-[var(--border-color)] ${textSec}`}>
                        Select all for school
                      </Button>
                    )}
                  </div>
                  {selectedHolds.size > 0 && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-orange-400 font-medium">{selectedHolds.size} selected</span>
                      <Button size="sm" variant="outline" onClick={() => setSelectedHolds(new Set())}
                        className={`h-7 text-xs border-[var(--border-color)] ${textSec}`}>
                        Clear
                      </Button>
                      <Button size="sm" onClick={handleBulkRelease} disabled={bulkReleasing}
                        className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white"
                        data-testid="bulk-release-btn">
                        <Unlock className="mr-1 h-3 w-3" />
                        {bulkReleasing ? 'Releasing…' : `Release ${selectedHolds.size}`}
                      </Button>
                    </div>
                  )}
                </div>

                <div className={`${card} border rounded-md overflow-hidden`}>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-[var(--bg-primary)]">
                        <th className="py-3 px-4 w-10">
                          <button onClick={() => selectAllVisibleHolds(filteredIds)} className={textMuted}>
                            {allFilteredSelected
                              ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                              : <Square className="h-4 w-4" />}
                          </button>
                        </th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Die</th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>School</th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Order</th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Stock</th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Hold Date</th>
                        <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Actions</th>
                      </tr></thead>
                      <tbody>
                        {filtered.map(h => (
                          <tr key={h.order_item_id}
                            className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer ${selectedHolds.has(h.order_item_id) ? 'bg-red-500/5' : ''}`}
                            data-testid={`hold-row-${h.order_item_id}`}
                            onClick={() => toggleHoldSelect(h.order_item_id)}
                          >
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <button onClick={() => toggleHoldSelect(h.order_item_id)} className={textMuted}>
                                {selectedHolds.has(h.order_item_id)
                                  ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                                  : <Square className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <p className={`${textPri} font-medium`}>{h.die_name}</p>
                              <p className={`text-xs font-mono ${textMuted}`}>{h.die_code}</p>
                            </td>
                            <td className={`px-4 py-3 ${textSec}`}>{h.school_name}</td>
                            <td className="px-4 py-3"><span className="font-mono text-xs text-[#e94560]">{h.order_number}</span></td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono ${textPri}`}>{h.stock_qty}</span>
                                <span className={`text-xs ${textMuted}`}>/ {h.reserved_qty} held</span>
                                {h.available < 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-xs ${textMuted}`}>{formatDate(h.hold_date)}</td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" onClick={() => handleConfirmHold(h.order_item_id)} className="border-green-500/30 text-green-400 hover:bg-green-500/10 h-7 text-xs" data-testid={`confirm-hold-${h.order_item_id}`}>
                                  <ShieldCheck className="mr-1 h-3 w-3" /> Confirm
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleReleaseHold(h.order_item_id)} className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-7 text-xs" data-testid={`release-hold-${h.order_item_id}`}>
                                  <Unlock className="mr-1 h-3 w-3" /> Release
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-[var(--border-color)]">
                    {filtered.map(h => (
                      <div key={h.order_item_id}
                        className={`p-4 space-y-2 ${selectedHolds.has(h.order_item_id) ? 'bg-red-500/5' : ''}`}
                        data-testid={`hold-card-${h.order_item_id}`}
                        onClick={() => toggleHoldSelect(h.order_item_id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <button onClick={e => { e.stopPropagation(); toggleHoldSelect(h.order_item_id); }} className={`flex-shrink-0 ${textMuted}`}>
                              {selectedHolds.has(h.order_item_id)
                                ? <CheckSquare className="h-4 w-4 text-[#e94560]" />
                                : <Square className="h-4 w-4" />}
                            </button>
                            <div className="min-w-0">
                              <p className={`${textPri} font-medium text-sm`}>{h.die_name} <span className={`font-mono text-xs ${textMuted}`}>({h.die_code})</span></p>
                              <p className={`text-xs ${textMuted}`}>{h.school_name} • {h.order_number}</p>
                            </div>
                          </div>
                          {h.available < 0 && <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />}
                        </div>
                        <div className={`flex items-center gap-3 text-xs ${textMuted}`}>
                          <span>Stock: {h.stock_qty}</span><span>Held: {h.reserved_qty}</span><span>Avail: <span className={h.available < 0 ? 'text-red-400' : 'text-green-400'}>{h.available}</span></span>
                        </div>
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" onClick={() => handleConfirmHold(h.order_item_id)} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs h-8"><ShieldCheck className="mr-1 h-3 w-3" /> Confirm</Button>
                          <Button size="sm" variant="outline" onClick={() => handleReleaseHold(h.order_item_id)} className="flex-1 border-red-500/30 text-red-400 text-xs h-8"><Unlock className="mr-1 h-3 w-3" /> Release</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          );
        })()}

        {/* DISPATCHES TAB */}
        {activeTab === 'dispatches' && (
          <div className="space-y-3" data-testid="dispatches-list">
            {dispatchList.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <Truck className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No dispatches yet. Create a dispatch from a confirmed order.</p>
              </div>
            ) : dispatchList.map(d => (
              <div key={d.dispatch_id} className={`${card} border rounded-md p-4`} data-testid={`dispatch-${d.dispatch_number}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-sm text-[#e94560] font-medium">{d.dispatch_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${d.status === 'delivered' ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-purple-400 bg-purple-500/10 border-purple-500/30'}`}>{d.status}</span>
                    </div>
                    <p className={`text-sm font-medium ${textPri}`}>{d.school_name}</p>
                    <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${textMuted} mt-1`}>
                      <span>Order: <span className="font-mono text-[#e94560]">{d.order_number}</span></span>
                      {d.courier_name && <span>Courier: <span className={textSec}>{d.courier_name}</span></span>}
                      {d.tracking_number && <span>Tracking: <span className={`font-mono ${textSec}`}>{d.tracking_number}</span></span>}
                      <span>{formatDate(d.dispatch_date)}</span>
                    </div>
                    {d.phone && (
                      <p className={`text-xs ${textMuted} mt-0.5`}>
                        Phone: <a href={`tel:${d.phone}`} className="text-[#e94560] hover:underline">{d.phone}</a>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                    <Button variant="outline" size="sm" onClick={() => {
                      setTrackingForm({ courier_name: d.courier_name || '', tracking_number: d.tracking_number || '' });
                      setTrackingDialog({ open: true, dispatch: d });
                    }} className={`border-[var(--border-color)] ${textSec}`} data-testid={`edit-tracking-${d.dispatch_number}`}>
                      <Truck className="mr-1 h-3 w-3" /> Tracking
                    </Button>
                    {(d.tracking_number || d.courier_name) && (() => {
                      const dateStr = d.dispatch_date ? new Date(d.dispatch_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                      const msg = `Hello,\n\nYour order has been dispatched! Here are the details:\n\n🏫 School: ${d.school_name}\n📦 Order: ${d.order_number}\n🚚 Courier: ${d.courier_name || 'N/A'}\n🔖 Tracking: ${d.tracking_number || 'N/A'}\n📅 Date: ${dateStr}\n\nPlease track your shipment using the tracking number above.\n\nThank you!\nSmartShape Pro`;
                      return <WaPickerButton phone={d.phone} message={msg} label="Send via WhatsApp" testId={`wa-tracking-${d.dispatch_number}`} />;
                    })()}
                    <Button variant="outline" size="sm" onClick={() => dispatchApi.downloadPdf(d.dispatch_id)} className={`border-[var(--border-color)] ${textSec}`} data-testid={`dispatch-pdf-${d.dispatch_number}`}>
                      PDF
                    </Button>
                    {d.status === 'dispatched' && (
                      <Button size="sm" onClick={() => handleMarkDelivered(d.dispatch_id)} className="bg-green-600 hover:bg-green-700 text-white" data-testid={`deliver-${d.dispatch_number}`}>
                        <CheckCircle className="mr-1 h-3 w-3" /> Delivered
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CREATE DISPATCH DIALOG */}
        <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Create Dispatch</DialogTitle></DialogHeader>
            {dispatchTarget && (
              <div className="space-y-3 py-2">
                <p className={`text-sm ${textSec}`}>{dispatchTarget.order_number} — {dispatchTarget.school_name}</p>
                <div><Label className={`${textSec} text-xs`}>Courier Name</Label><Input value={dispatchForm.courier_name} onChange={e => setDispatchForm({...dispatchForm, courier_name: e.target.value})} className={inputCls} placeholder="e.g. BlueDart, FedEx" /></div>
                <div><Label className={`${textSec} text-xs`}>Tracking Number</Label><Input value={dispatchForm.tracking_number} onChange={e => setDispatchForm({...dispatchForm, tracking_number: e.target.value})} className={inputCls} placeholder="Tracking ID" /></div>
                <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={dispatchForm.notes} onChange={e => setDispatchForm({...dispatchForm, notes: e.target.value})} className={inputCls} placeholder="Optional notes" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDispatchOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleCreateDispatch} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-dispatch">
                <Truck className="mr-1.5 h-4 w-4" /> Create Dispatch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PAYMENT DIALOG */}
        <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader>
              <DialogTitle className={textPri}>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-[#10b981]" />
                  Record Payment
                </div>
              </DialogTitle>
            </DialogHeader>
            {paymentTarget && (
              <div className="space-y-4 py-2">
                <div className="bg-[var(--bg-primary)] rounded-md p-3 text-sm">
                  <p className={textSec}>{paymentTarget.order_number} — {paymentTarget.school_name}</p>
                  <p className={`font-mono font-bold ${textPri} mt-1`}>Order Total: {formatCurrency(paymentTarget.grand_total || 0)}</p>
                  {paymentTarget.total_paid > 0 && (
                    <p className="text-[#10b981] text-xs mt-1">Paid so far: {formatCurrency(paymentTarget.total_paid)}</p>
                  )}
                </div>
                {paymentHistory.length > 0 && (
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${textMuted} mb-2`}>Payment History</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {paymentHistory.map(p => (
                        <div key={p.payment_id} className="flex justify-between text-xs bg-[var(--bg-primary)] rounded px-3 py-2">
                          <span className={textSec}>{p.payment_date} · {p.method.toUpperCase()}</span>
                          <span className="font-mono font-semibold text-[#10b981]">{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <Label className={`${textSec} text-xs`}>Amount (₹) *</Label>
                  <Input type="number" min="1" value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} className={`${inputCls} font-mono`} placeholder="0.00" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={`${textSec} text-xs`}>Payment Method</Label>
                    <select value={paymentForm.method} onChange={e => setPaymentForm({...paymentForm, method: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                      <option value="neft">NEFT / RTGS</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Payment Date</Label>
                    <Input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm({...paymentForm, payment_date: e.target.value})} className={inputCls} />
                  </div>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Reference / UTR / Cheque No.</Label>
                  <Input value={paymentForm.reference} onChange={e => setPaymentForm({...paymentForm, reference: e.target.value})} className={inputCls} placeholder="Optional reference number" />
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Notes</Label>
                  <Input value={paymentForm.notes} onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} className={inputCls} placeholder="Optional notes" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaymentOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleRecordPayment} disabled={paymentSubmitting || !paymentForm.amount} className="bg-[#10b981] hover:bg-[#059669] text-white" data-testid="confirm-payment">
                <DollarSign className="mr-1.5 h-4 w-4" />
                {paymentSubmitting ? 'Recording…' : 'Record Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CREATE ORDER DIALOG */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Create Order from Quotation</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              {pendingQuots.length === 0 ? (
                <p className={`${textMuted} text-sm text-center py-4`}>No eligible quotations. Quotation must have catalogue submitted.</p>
              ) : (
                <>
                  <Label className={`${textSec} text-xs`}>Select Quotation</Label>
                  <select value={selectedQuotId} onChange={e => setSelectedQuotId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="select-quotation-for-order">
                    <option value="">-- Select --</option>
                    {pendingQuots.map(q => (
                      <option key={q.quotation_id} value={q.quotation_id}>{q.quote_number} — {q.school_name} ({formatCurrency(q.grand_total)})</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!selectedQuotId} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-create-order">Create Order</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ORDER DETAIL DIALOG */}
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
            {detailOrder && (
              <>
                <DialogHeader>
                  <DialogTitle className={textPri}>
                    <span className="font-mono text-[#e94560]">{detailOrder.order_number}</span> — {detailOrder.school_name}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {/* Info */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><p className={`text-xs ${textMuted}`}>Status</p><span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${(ORDER_STATUSES.find(s => s.id === detailOrder.order_status) || ORDER_STATUSES[0]).color}`}>{detailOrder.order_status}</span></div>
                    <div><p className={`text-xs ${textMuted}`}>Total</p><p className={`font-mono font-bold ${textPri}`}>{formatCurrency(detailOrder.grand_total)}</p></div>
                    <div><p className={`text-xs ${textMuted}`}>Items</p><p className={`font-mono ${textPri}`}>{detailOrder.total_items}</p></div>
                    <div><p className={`text-xs ${textMuted}`}>Date</p><p className={`text-sm ${textSec}`}>{formatDate(detailOrder.created_at)}</p></div>
                  </div>

                  {/* Items */}
                  <div>
                    <h3 className={`text-sm font-medium ${textPri} mb-2`}>Order Items</h3>
                    <div className="space-y-2">
                      {(detailOrder.items || []).map(item => (
                        <div key={item.order_item_id} className={`flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3`}>
                          <div className="w-10 h-10 rounded bg-[var(--bg-hover)] flex items-center justify-center flex-shrink-0">
                            {item.die_image_url ? <img src={`${process.env.REACT_APP_BACKEND_URL}${item.die_image_url}`} alt="" className="w-full h-full object-cover rounded" /> : <Package className={`h-4 w-4 ${textMuted}`} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${textPri}`}>{item.die_name}</p>
                            <p className={`text-xs font-mono ${textMuted}`}>{item.die_code} • {item.die_type}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            item.status === 'on_hold' ? 'bg-orange-500/20 text-orange-400' :
                            item.status === 'confirmed' ? 'bg-blue-500/20 text-blue-400' :
                            item.status === 'dispatched' ? 'bg-purple-500/20 text-purple-400' :
                            item.status === 'delivered' ? 'bg-green-500/20 text-green-400' :
                            item.status === 'released' ? 'bg-gray-500/20 text-gray-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>{item.status?.replace('_', ' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Timeline */}
                  {(detailOrder.timeline || []).length > 0 && (
                    <div>
                      <h3 className={`text-sm font-medium ${textPri} mb-2`}>Timeline</h3>
                      <div className="space-y-2">
                        {detailOrder.timeline.map((tl, i) => (
                          <div key={tl.timeline_id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`w-2.5 h-2.5 rounded-full ${i === detailOrder.timeline.length - 1 ? 'bg-[#e94560]' : 'bg-[var(--border-color)]'}`} />
                              {i < detailOrder.timeline.length - 1 && <div className="w-px flex-1 bg-[var(--border-color)]" />}
                            </div>
                            <div className="pb-3">
                              <p className={`text-sm ${textPri} capitalize`}>{tl.status}</p>
                              <p className={`text-xs ${textMuted}`}>{tl.note}</p>
                              <p className={`text-[10px] ${textMuted}`}>{formatDate(tl.timestamp)} • {tl.updated_by}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* STATUS CHANGE DIALOG */}
        <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>Update Order Status</DialogTitle></DialogHeader>
            {statusTarget && (
              <div className="space-y-3 py-2">
                <p className={`text-sm ${textSec}`}>{statusTarget.order_number} — {statusTarget.school_name}</p>
                <p className={`text-xs ${textMuted}`}>Current: <span className="capitalize font-medium">{statusTarget.order_status}</span></p>
                <div>
                  <Label className={`${textSec} text-xs`}>New Status</Label>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="new-status-select">
                    <option value="">Select</option>
                    {ORDER_STATUSES.filter(s => s.id !== statusTarget.order_status).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Note</Label><Input value={statusNote} onChange={e => setStatusNote(e.target.value)} className={inputCls} placeholder="Optional note..." /></div>
                {newStatus === 'dispatched' && <p className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Stock will be auto-deducted on dispatch.</p>}
                {newStatus === 'cancelled' && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> All holds will be released.</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleStatusChange} disabled={!newStatus} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-status-change">Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* TRACKING DIALOG */}
        <Dialog open={trackingDialog.open} onOpenChange={o => !trackingSaving && setTrackingDialog(d => ({ ...d, open: o }))}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Update Tracking — {trackingDialog.dispatch?.dispatch_number}</DialogTitle></DialogHeader>
            {trackingDialog.dispatch && (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={`${textSec} text-xs`}>Courier Name</Label>
                    <Input value={trackingForm.courier_name} onChange={e => setTrackingForm(f => ({ ...f, courier_name: e.target.value }))} className={inputCls} placeholder="e.g. BlueDart, FedEx" />
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Tracking Number</Label>
                    <Input value={trackingForm.tracking_number} onChange={e => setTrackingForm(f => ({ ...f, tracking_number: e.target.value }))} className={inputCls} placeholder="Tracking ID" />
                  </div>
                </div>
                {/* Message preview */}
                <div>
                  <Label className={`${textSec} text-xs mb-1.5 block`}>WhatsApp Message Preview</Label>
                  <div className={`rounded-md p-3 text-xs font-mono whitespace-pre-wrap bg-[var(--bg-primary)] border border-[var(--border-color)] ${textSec} max-h-48 overflow-y-auto`}>
                    {`Hello,\n\nYour order has been dispatched! Here are the details:\n\n🏫 School: ${trackingDialog.dispatch.school_name}\n📦 Order: ${trackingDialog.dispatch.order_number}\n🚚 Courier: ${trackingForm.courier_name || 'N/A'}\n🔖 Tracking: ${trackingForm.tracking_number || 'N/A'}\n📅 Date: ${trackingDialog.dispatch.dispatch_date ? new Date(trackingDialog.dispatch.dispatch_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}\n\nPlease track your shipment using the tracking number above.\n\nThank you!\nSmartShape Pro`}
                  </div>
                  {trackingDialog.dispatch.phone && (
                    <p className={`text-xs ${textMuted} mt-1`}>Will send to: <span className="text-green-400">{trackingDialog.dispatch.phone}</span></p>
                  )}
                  {!trackingDialog.dispatch.phone && (
                    <p className="text-xs text-amber-400 mt-1">No phone number found — message will be copied to clipboard.</p>
                  )}
                </div>
              </div>
            )}
            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setTrackingDialog({ open: false, dispatch: null })} className={`border-[var(--border-color)] ${textSec}`} disabled={trackingSaving}>Cancel</Button>
              {trackingDialog.dispatch && (() => {
                const d = trackingDialog.dispatch;
                const dateStr = d.dispatch_date ? new Date(d.dispatch_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                const msg = `Hello,\n\nYour order has been dispatched! Here are the details:\n\n🏫 School: ${d.school_name}\n📦 Order: ${d.order_number}\n🚚 Courier: ${trackingForm.courier_name || 'N/A'}\n🔖 Tracking: ${trackingForm.tracking_number || 'N/A'}\n📅 Date: ${dateStr}\n\nPlease track your shipment using the tracking number above.\n\nThank you!\nSmartShape Pro`;
                return <WaPickerButton phone={d.phone} message={msg} label="Send WhatsApp" className="flex-1 justify-center" />;
              })()}
              <Button onClick={async () => {
                setTrackingSaving(true);
                try {
                  await dispatchesApi.updateTracking(trackingDialog.dispatch.dispatch_id, trackingForm);
                  toast.success('Tracking updated');
                  setTrackingDialog({ open: false, dispatch: null });
                  fetchData();
                } catch { toast.error('Update failed'); }
                finally { setTrackingSaving(false); }
              }} disabled={trackingSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white flex-1">
                <Truck className="mr-1.5 h-4 w-4" />{trackingSaving ? 'Saving…' : 'Save Tracking'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* WhatsApp dispatch tracking dialog (FMS Phase 5.4) */}
        <WhatsAppSendDialog
          open={waDispatchOpen}
          onOpenChange={setWaDispatchOpen}
          module="dispatch"
          context={waDispatch ? {
            order_id: waDispatch.order_id, school_id: waDispatch.school_id,
            phone: waDispatch.phone || '', school_name: waDispatch.school_name,
            contact_name: waDispatch.school_name,
          } : {}}
          title={`Tracking - ${waDispatch?.dispatch_number || ''}`}
        />
      </div>
    </AdminLayout>
  );
}
