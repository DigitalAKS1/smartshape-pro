import { useState, useEffect } from 'react';
import { orders as ordersApi, holds as holdsApi, quotations as quotApi, dispatches as dispatchesApi, dispatchApi, dies as diesApi, downloadBlob } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

export default function useOrdersManagement() {
  const { user } = useAuth();

  // ── Lists ────────────────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState('orders');
  const [ordersList,   setOrdersList]   = useState([]);
  const [holdsList,    setHoldsList]    = useState([]);
  const [dispatchList, setDispatchList] = useState([]);
  const [diesList,     setDiesList]     = useState([]);
  const [loading,      setLoading]      = useState(true);

  // ── Search / filter ──────────────────────────────────────────────────────
  const [searchTerm,   setSearchTerm]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // ── Create order dialog ──────────────────────────────────────────────────
  const [createOpen,      setCreateOpen]      = useState(false);
  const [pendingQuots,    setPendingQuots]    = useState([]);
  const [selectedQuotId,  setSelectedQuotId]  = useState('');

  // ── Detail dialog ────────────────────────────────────────────────────────
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailOpen,  setDetailOpen]  = useState(false);

  // ── Status update dialog ─────────────────────────────────────────────────
  const [statusOpen,   setStatusOpen]   = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [newStatus,    setNewStatus]    = useState('');
  const [statusNote,   setStatusNote]   = useState('');

  // ── WhatsApp tracking ────────────────────────────────────────────────────
  const [waDispatchOpen, setWaDispatchOpen] = useState(false);
  const [waDispatch,     setWaDispatch]     = useState(null);

  // ── Bulk hold release ────────────────────────────────────────────────────
  const [selectedHolds,    setSelectedHolds]    = useState(new Set());
  const [holdSchoolFilter, setHoldSchoolFilter] = useState('all');
  const [bulkReleasing,    setBulkReleasing]    = useState(false);

  // ── Tracking dialog ──────────────────────────────────────────────────────
  const [trackingDialog,  setTrackingDialog]  = useState({ open: false, dispatch: null });
  const [trackingForm,    setTrackingForm]    = useState({ courier_name: '', tracking_number: '' });
  const [trackingSaving,  setTrackingSaving]  = useState(false);

  // ── Dispatch dialog ──────────────────────────────────────────────────────
  const [dispatchOpen,   setDispatchOpen]   = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState(null);
  const [dispatchForm,   setDispatchForm]   = useState({ courier_name: '', tracking_number: '', notes: '' });

  // ── Payment dialog ───────────────────────────────────────────────────────
  const [paymentOpen,       setPaymentOpen]       = useState(false);
  const [paymentTarget,     setPaymentTarget]     = useState(null);
  const [paymentHistory,    setPaymentHistory]    = useState([]);
  const [paymentForm,       setPaymentForm]       = useState({
    amount: '', method: 'neft', reference: '', notes: '',
    payment_date: new Date().toISOString().split('T')[0],
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [or, hr, dr, di] = await Promise.all([
        ordersApi.getAll(), holdsApi.getAll(), dispatchesApi.getAll(), diesApi.getAll(),
      ]);
      setOrdersList(or.data);
      setHoldsList(hr.data);
      setDispatchList(dr.data);
      setDiesList((di.data || []).filter(d => d.is_active !== false));
    } catch { toast.error('Failed to load orders'); }
    finally { setLoading(false); }
  };

  // Refetch a single open order's detail (after a Manage Selection edit).
  const reloadDetail = async (orderId) => {
    try {
      const res = await ordersApi.get(orderId);
      setDetailOrder(res.data);
    } catch { /* keep stale detail on failure */ }
  };

  // ── Manage Selection (add/remove/change qty on a submitted order) ──────────
  const handleAddItem = async (orderId, dieId, quantity) => {
    try {
      await ordersApi.addItem(orderId, { die_id: dieId, quantity });
      toast.success('Item added');
      await reloadDetail(orderId);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to add item'); }
  };

  const handleUpdateItemQty = async (orderId, itemId, quantity) => {
    try {
      await ordersApi.updateItemQty(orderId, itemId, quantity);
      await reloadDetail(orderId);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update quantity'); }
  };

  const handleRemoveItem = async (orderId, itemId) => {
    if (!window.confirm('Remove this die from the order? Its reserved stock will be released.')) return;
    try {
      await ordersApi.removeItem(orderId, itemId);
      toast.success('Item removed');
      await reloadDetail(orderId);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to remove item'); }
  };

  useEffect(() => { fetchData(); }, []);

  // ── Create order ─────────────────────────────────────────────────────────
  const openCreate = async () => {
    try {
      const res = await quotApi.getAll();
      const existing = ordersList.map(o => o.quotation_id);
      setPendingQuots(res.data.filter(q =>
        (q.catalogue_status === 'submitted' || q.quotation_status === 'pending' || q.quotation_status === 'confirmed') &&
        !existing.includes(q.quotation_id)
      ));
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

  // ── Detail view ──────────────────────────────────────────────────────────
  const openDetail = async (order) => {
    try {
      const res = await ordersApi.get(order.order_id);
      setDetailOrder(res.data);
      setDetailOpen(true);
    } catch { toast.error('Failed to load order details'); }
  };

  // ── Status change ────────────────────────────────────────────────────────
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

  // ── Holds ────────────────────────────────────────────────────────────────
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

  // ── Sales Order export (Tally XML / JSON) ──
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const toggleOrderSelect = (orderId) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };
  const clearOrderSelection = () => setSelectedOrders(new Set());

  const handleExportOne = async (order, fmt) => {
    try {
      const res = await ordersApi.exportOne(order.order_id, fmt);
      downloadBlob(res, `SO_${order.order_number}.${fmt}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Export failed');
    }
  };

  const handleExportSelected = async (fmt) => {
    const ids = [...selectedOrders];
    if (ids.length === 0) { toast.info('Select at least one order'); return; }
    setExporting(true);
    try {
      const res = await ordersApi.exportBulk(ids, fmt);
      downloadBlob(res, fmt === 'json' ? 'sales_orders.json' : 'sales_orders_tally.xml');
      toast.success(`Exported ${ids.length} order${ids.length !== 1 ? 's' : ''} as ${fmt.toUpperCase()}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Export failed');
    } finally {
      setExporting(false);
    }
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

  // ── Dispatch (supports partial — per-line quantities) ─────────────────────
  const [dispatchItems,   setDispatchItems]   = useState([]); // [{order_item_id, die_name, die_code, remaining}]
  const [dispatchLineQty, setDispatchLineQty] = useState({});  // order_item_id -> qty to ship now

  const openDispatchDialog = async (order) => {
    setDispatchTarget(order);
    setDispatchForm({ courier_name: '', tracking_number: '', notes: '' });
    setDispatchItems([]);
    setDispatchLineQty({});
    setDispatchOpen(true);
    try {
      const res = await ordersApi.get(order.order_id);
      const open = (res.data.items || [])
        .filter(i => ['on_hold', 'confirmed', 'partially_dispatched'].includes(i.status))
        .map(i => ({
          order_item_id: i.order_item_id,
          die_name: i.die_name, die_code: i.die_code,
          remaining: Math.max(0, (i.quantity || 1) - (i.dispatched_qty || 0)),
        }))
        .filter(i => i.remaining > 0);
      setDispatchItems(open);
      setDispatchLineQty(Object.fromEntries(open.map(i => [i.order_item_id, i.remaining])));
    } catch { toast.error('Failed to load order items'); }
  };

  const handleCreateDispatch = async () => {
    if (!dispatchTarget) return;
    const lines = dispatchItems
      .map(i => ({ order_item_id: i.order_item_id, quantity: Math.max(0, parseInt(dispatchLineQty[i.order_item_id], 10) || 0) }))
      .filter(l => l.quantity > 0);
    if (dispatchItems.length > 0 && lines.length === 0) { toast.error('Enter a quantity to dispatch'); return; }
    try {
      await dispatchesApi.create({ order_id: dispatchTarget.order_id, ...dispatchForm, lines });
      const total = lines.reduce((s, l) => s + l.quantity, 0);
      toast.success(`Dispatch created — ${total} unit(s) shipped, stock deducted.`);
      setDispatchOpen(false);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const handleMarkDelivered = async (dispatchId) => {
    try { await dispatchesApi.markDelivered(dispatchId); toast.success('Marked as delivered'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  // ── Payment ──────────────────────────────────────────────────────────────
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

  // ── Tracking update (from tracking dialog) ───────────────────────────────
  const handleUpdateTracking = async () => {
    setTrackingSaving(true);
    try {
      await dispatchesApi.updateTracking(trackingDialog.dispatch.dispatch_id, trackingForm);
      toast.success('Tracking updated');
      setTrackingDialog({ open: false, dispatch: null });
      fetchData();
    } catch { toast.error('Update failed'); }
    finally { setTrackingSaving(false); }
  };

  // ── Filtered / computed ──────────────────────────────────────────────────
  const filteredOrders = ordersList.filter(o => {
    if (statusFilter !== 'all' && o.order_status !== statusFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        (o.school_name   || '').toLowerCase().includes(s) ||
        (o.order_number  || '').toLowerCase().includes(s) ||
        (o.quote_number  || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  const stats = {
    total:       ordersList.length,
    pending:     ordersList.filter(o => o.order_status === 'pending').length,
    confirmed:   ordersList.filter(o => o.order_status === 'confirmed').length,
    dispatched:  ordersList.filter(o => o.order_status === 'dispatched').length,
    delivered:   ordersList.filter(o => o.order_status === 'delivered').length,
    activeHolds: holdsList.length,
  };

  return {
    // auth
    user,
    // lists
    activeTab, setActiveTab,
    ordersList, holdsList, dispatchList, loading,
    // search
    searchTerm, setSearchTerm,
    statusFilter, setStatusFilter,
    // create
    createOpen, setCreateOpen,
    pendingQuots, selectedQuotId, setSelectedQuotId,
    // detail
    detailOrder, detailOpen, setDetailOpen,
    diesList,
    handleAddItem, handleUpdateItemQty, handleRemoveItem,
    // status
    statusOpen, setStatusOpen,
    statusTarget,
    newStatus, setNewStatus,
    statusNote, setStatusNote,
    // whatsapp
    waDispatchOpen, setWaDispatchOpen,
    waDispatch, setWaDispatch,
    // holds
    selectedHolds, setSelectedHolds,
    holdSchoolFilter, setHoldSchoolFilter,
    bulkReleasing,
    // sales-order export (Tally)
    selectedOrders, toggleOrderSelect, clearOrderSelection, exporting,
    handleExportOne, handleExportSelected,
    // tracking
    trackingDialog, setTrackingDialog,
    trackingForm, setTrackingForm,
    trackingSaving,
    // dispatch
    dispatchOpen, setDispatchOpen,
    dispatchTarget,
    dispatchForm, setDispatchForm,
    dispatchItems, dispatchLineQty, setDispatchLineQty,
    // payment
    paymentOpen, setPaymentOpen,
    paymentTarget,
    paymentHistory,
    paymentForm, setPaymentForm,
    paymentSubmitting,
    // computed
    filteredOrders, stats,
    // handlers
    openCreate, handleCreate,
    openDetail,
    openStatusChange, handleStatusChange,
    handleReleaseHold, handleBulkRelease,
    toggleHoldSelect, selectAllVisibleHolds, selectSchoolHolds,
    handleConfirmHold,
    openDispatchDialog, handleCreateDispatch,
    handleMarkDelivered,
    openPaymentDialog, handleRecordPayment,
    handleUpdateTracking,
    fetchData,
    dispatchApi,
  };
}
