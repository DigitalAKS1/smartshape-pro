import React from 'react';
import AppShell from '../../components/layouts/AppShell';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import EmptyState, { EMPTY_STATES } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Package, Truck, CheckCircle, Search, Eye, ArrowRight,
  AlertTriangle, CreditCard, DollarSign, Download, FileCode, FileJson,
  CheckSquare, Square, X,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { useAuth } from '../../contexts/AuthContext';
import KanbanBoard from '../../components/KanbanBoard';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

import useOrdersManagement from '../../hooks/useOrdersManagement';
import { PROD_STAGES, ORDER_STATUSES, buildDispatchMessage } from '../../lib/ordersUtils';
import WaPickerButton from '../../components/orders/WaPickerButton';
import HoldsTab from '../../components/orders/HoldsTab';
import OrderDetailPanel from '../../components/orders/OrderDetailPanel';

export default function OrdersManagement() {
  const om = useOrdersManagement();
  const { user } = useAuth();
  const canExport = user?.role === 'admin' || user?.role === 'accounts';

  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri  = 'text-[var(--text-primary)]';
  const textSec  = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls   = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';
  const card     = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  if (om.loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="orders-title">Orders & Holds</h1>
            <p className={`${textSec} mt-1 text-sm`}>{om.stats.total} orders • {om.stats.activeHolds} active holds</p>
          </div>
          <Button onClick={om.openCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-order-btn">
            <Package className="mr-1 h-3 w-3" /> Create Order
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Total',      value: om.stats.total,       color: textPri },
            { label: 'Pending',    value: om.stats.pending,     color: 'text-yellow-400' },
            { label: 'Confirmed',  value: om.stats.confirmed,   color: 'text-blue-400' },
            { label: 'Dispatched', value: om.stats.dispatched,  color: 'text-purple-400' },
            { label: 'Delivered',  value: om.stats.delivered,   color: 'text-green-400' },
            { label: 'Holds',      value: om.stats.activeHolds, color: 'text-orange-400' },
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
            <button key={tab} onClick={() => om.setActiveTab(tab)}
              className={`flex-1 px-1 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-all ${om.activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`tab-${tab}`}>
              <span className="sm:hidden">
                {tab === 'orders' ? `Orders (${om.ordersList.length})` : tab === 'kanban' ? 'Pipeline' : tab === 'holds' ? `Holds (${om.holdsList.length})` : `Dispatch (${om.dispatchList.length})`}
              </span>
              <span className="hidden sm:inline">
                {tab === 'orders' ? `Orders (${om.ordersList.length})` : tab === 'kanban' ? 'Production Pipeline' : tab === 'holds' ? `Hold Monitor (${om.holdsList.length})` : `Dispatches (${om.dispatchList.length})`}
              </span>
            </button>
          ))}
        </div>

        {/* Production Kanban */}
        {om.activeTab === 'kanban' && (
          <KanbanBoard
            columns={PROD_STAGES}
            items={om.ordersList}
            getItemId={(o) => o.order_id}
            getItemColumnId={(o) => o.production_stage || 'order_created'}
            onMove={async ({ itemId, to }) => {
              try {
                const { orders: ordersApi } = await import('../../lib/api');
                await ordersApi.updateProductionStage(itemId, to);
                toast.success(`Moved to ${PROD_STAGES.find(s => s.id === to)?.label}`);
                om.fetchData();
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

        {/* Search bar (orders tab) */}
        {om.activeTab === 'orders' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
              <Input value={om.searchTerm} onChange={e => om.setSearchTerm(e.target.value)}
                placeholder="Search order, school, quote..." className={`pl-10 ${inputCls}`} data-testid="order-search" />
            </div>
            <select value={om.statusFilter} onChange={e => om.setStatusFilter(e.target.value)}
              className={`h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="order-status-filter">
              <option value="all">All Status</option>
              {ORDER_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}

        {/* Bulk Tally export toolbar */}
        {om.activeTab === 'orders' && canExport && om.selectedOrders.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#e94560]/10 border border-[#e94560]/30">
            <div className="flex items-center gap-3">
              <button onClick={om.clearOrderSelection} className={`p-1 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`} title="Clear selection">
                <X className="h-4 w-4" />
              </button>
              <span className={`text-sm font-semibold ${textPri}`}>{om.selectedOrders.size} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={om.exporting} onClick={() => om.handleExportSelected('xml')}
                className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8">
                <FileCode className="h-3.5 w-3.5 mr-1.5" /> Tally XML
              </Button>
              <Button size="sm" variant="outline" disabled={om.exporting} onClick={() => om.handleExportSelected('json')}
                className={`border-[var(--border-color)] ${textSec} h-8`}>
                <FileJson className="h-3.5 w-3.5 mr-1.5" /> JSON
              </Button>
            </div>
          </div>
        )}

        {/* Orders list */}
        {om.activeTab === 'orders' && (
          <div className="space-y-3" data-testid="orders-list">
            {om.filteredOrders.length === 0 ? (
              <EmptyState {...EMPTY_STATES.orders} desc="Accepted quotations will show up here as confirmed orders." />
            ) : (
              om.filteredOrders.map(order => {
                const statusObj = ORDER_STATUSES.find(s => s.id === order.order_status) || ORDER_STATUSES[0];
                const StatusIcon = statusObj.icon;
                return (
                  <div key={order.order_id} className={`${card} border rounded-md p-4`} data-testid={`order-card-${order.order_number}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      {canExport && (
                        <button onClick={() => om.toggleOrderSelect(order.order_id)}
                          className="shrink-0 self-start sm:self-center" title="Select for Tally export">
                          {om.selectedOrders.has(order.order_id)
                            ? <CheckSquare className="h-5 w-5 text-[#e94560]" />
                            : <Square className="h-5 w-5 text-[var(--text-muted)]" />}
                        </button>
                      )}
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
                      <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 mt-1 sm:mt-0">
                        <span className={`font-mono text-base sm:text-lg font-bold ${textPri}`}>{formatCurrency(order.grand_total)}</span>
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => om.openDetail(order)}
                            className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                            data-testid={`view-order-${order.order_number}`} title="View details">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {(order.order_status === 'confirmed' || order.order_status === 'pending') && (
                            <Button size="sm" onClick={() => om.openDispatchDialog(order)}
                              className="bg-purple-600 hover:bg-purple-700 text-white h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                              data-testid={`dispatch-order-${order.order_number}`} title="Create dispatch">
                              <Truck className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline ml-1">Dispatch</span>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => om.openPaymentDialog(order)}
                            className={`border-[#10b981]/40 text-[#10b981] hover:bg-[#10b981]/10 h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3 ${order.payment_status === 'paid' ? 'opacity-50' : ''}`}
                            title={order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'partial' ? 'Partial payment' : 'Record payment'}
                            data-testid={`payment-order-${order.order_number}`}>
                            <CreditCard className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline ml-1">
                              {order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'partial' ? 'Partial' : 'Payment'}
                            </span>
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => om.openStatusChange(order)}
                            className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                            data-testid={`status-order-${order.order_number}`} title="Change status">
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                          {canExport && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" title="Export for Tally"
                                  className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                                  data-testid={`export-order-${order.order_number}`}>
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className={dlgCls}>
                                <DropdownMenuItem onClick={() => om.handleExportOne(order, 'xml')} className="cursor-pointer">
                                  <FileCode className="mr-2 h-4 w-4" /> Tally XML
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => om.handleExportOne(order, 'json')} className="cursor-pointer">
                                  <FileJson className="mr-2 h-4 w-4" /> JSON
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Holds tab */}
        {om.activeTab === 'holds' && (
          <HoldsTab
            holdsList={om.holdsList}
            selectedHolds={om.selectedHolds}
            holdSchoolFilter={om.holdSchoolFilter}
            setHoldSchoolFilter={om.setHoldSchoolFilter}
            setSelectedHolds={om.setSelectedHolds}
            bulkReleasing={om.bulkReleasing}
            toggleHoldSelect={om.toggleHoldSelect}
            selectAllVisibleHolds={om.selectAllVisibleHolds}
            selectSchoolHolds={om.selectSchoolHolds}
            handleConfirmHold={om.handleConfirmHold}
            handleReleaseHold={om.handleReleaseHold}
            handleBulkRelease={om.handleBulkRelease}
            textPri={textPri} textSec={textSec} textMuted={textMuted}
            inputCls={inputCls} card={card}
          />
        )}

        {/* Dispatches tab */}
        {om.activeTab === 'dispatches' && (
          <div className="space-y-3" data-testid="dispatches-list">
            {om.dispatchList.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <Truck className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No dispatches yet. Create a dispatch from a confirmed order.</p>
              </div>
            ) : om.dispatchList.map(d => (
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
                      {d.courier_name    && <span>Courier: <span className={textSec}>{d.courier_name}</span></span>}
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
                    <Button variant="outline" size="sm"
                      onClick={() => { om.setTrackingForm({ courier_name: d.courier_name || '', tracking_number: d.tracking_number || '' }); om.setTrackingDialog({ open: true, dispatch: d }); }}
                      className={`border-[var(--border-color)] ${textSec}`}
                      data-testid={`edit-tracking-${d.dispatch_number}`}>
                      <Truck className="mr-1 h-3 w-3" /> Tracking
                    </Button>
                    {(d.tracking_number || d.courier_name) && (
                      <WaPickerButton
                        phone={d.phone}
                        message={buildDispatchMessage(d, d.courier_name, d.tracking_number)}
                        label="Send via WhatsApp"
                        testId={`wa-tracking-${d.dispatch_number}`}
                      />
                    )}
                    <Button variant="outline" size="sm"
                      onClick={() => om.dispatchApi.downloadPdf(d.dispatch_id)}
                      className={`border-[var(--border-color)] ${textSec}`}
                      data-testid={`dispatch-pdf-${d.dispatch_number}`}>
                      PDF
                    </Button>
                    {d.status === 'dispatched' && (
                      <Button size="sm" onClick={() => om.handleMarkDelivered(d.dispatch_id)}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        data-testid={`deliver-${d.dispatch_number}`}>
                        <CheckCircle className="mr-1 h-3 w-3" /> Delivered
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Dialogs ───────────────────────────────────────────────────── */}

        {/* Create Dispatch */}
        <Dialog open={om.dispatchOpen} onOpenChange={om.setDispatchOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Create Dispatch</DialogTitle></DialogHeader>
            {om.dispatchTarget && (
              <div className="space-y-3 py-2">
                <p className={`text-sm ${textSec}`}>{om.dispatchTarget.order_number} — {om.dispatchTarget.school_name}</p>
                <div><Label className={`${textSec} text-xs`}>Courier Name</Label><Input value={om.dispatchForm.courier_name} onChange={e => om.setDispatchForm({...om.dispatchForm, courier_name: e.target.value})} className={inputCls} placeholder="e.g. BlueDart, FedEx" /></div>
                <div><Label className={`${textSec} text-xs`}>Tracking Number</Label><Input value={om.dispatchForm.tracking_number} onChange={e => om.setDispatchForm({...om.dispatchForm, tracking_number: e.target.value})} className={inputCls} placeholder="Tracking ID" /></div>
                <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={om.dispatchForm.notes} onChange={e => om.setDispatchForm({...om.dispatchForm, notes: e.target.value})} className={inputCls} placeholder="Optional notes" /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => om.setDispatchOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={om.handleCreateDispatch} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-dispatch">
                <Truck className="mr-1.5 h-4 w-4" /> Create Dispatch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payment */}
        <Dialog open={om.paymentOpen} onOpenChange={om.setPaymentOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader>
              <DialogTitle className={textPri}>
                <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-[#10b981]" />Record Payment</div>
              </DialogTitle>
            </DialogHeader>
            {om.paymentTarget && (
              <div className="space-y-4 py-2">
                <div className="bg-[var(--bg-primary)] rounded-md p-3 text-sm">
                  <p className={textSec}>{om.paymentTarget.order_number} — {om.paymentTarget.school_name}</p>
                  <p className={`font-mono font-bold ${textPri} mt-1`}>Order Total: {formatCurrency(om.paymentTarget.grand_total || 0)}</p>
                  {om.paymentTarget.total_paid > 0 && (
                    <p className="text-[#10b981] text-xs mt-1">Paid so far: {formatCurrency(om.paymentTarget.total_paid)}</p>
                  )}
                </div>
                {om.paymentHistory.length > 0 && (
                  <div>
                    <p className={`text-xs uppercase tracking-wide ${textMuted} mb-2`}>Payment History</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {om.paymentHistory.map(p => (
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
                  <Input type="number" min="1" value={om.paymentForm.amount} onChange={e => om.setPaymentForm({...om.paymentForm, amount: e.target.value})} className={`${inputCls} font-mono`} placeholder="0.00" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={`${textSec} text-xs`}>Payment Method</Label>
                    <select value={om.paymentForm.method} onChange={e => om.setPaymentForm({...om.paymentForm, method: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                      <option value="neft">NEFT / RTGS</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Payment Date</Label>
                    <Input type="date" value={om.paymentForm.payment_date} onChange={e => om.setPaymentForm({...om.paymentForm, payment_date: e.target.value})} className={inputCls} />
                  </div>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Reference / UTR / Cheque No.</Label>
                  <Input value={om.paymentForm.reference} onChange={e => om.setPaymentForm({...om.paymentForm, reference: e.target.value})} className={inputCls} placeholder="Optional reference number" />
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>Notes</Label>
                  <Input value={om.paymentForm.notes} onChange={e => om.setPaymentForm({...om.paymentForm, notes: e.target.value})} className={inputCls} placeholder="Optional notes" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => om.setPaymentOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={om.handleRecordPayment} disabled={om.paymentSubmitting || !om.paymentForm.amount} className="bg-[#10b981] hover:bg-[#059669] text-white" data-testid="confirm-payment">
                <DollarSign className="mr-1.5 h-4 w-4" />
                {om.paymentSubmitting ? 'Recording…' : 'Record Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Order */}
        <Dialog open={om.createOpen} onOpenChange={om.setCreateOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>Create Order from Quotation</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              {om.pendingQuots.length === 0 ? (
                <p className={`${textMuted} text-sm text-center py-4`}>No eligible quotations. Quotation must have catalogue submitted.</p>
              ) : (
                <>
                  <Label className={`${textSec} text-xs`}>Select Quotation</Label>
                  <select value={om.selectedQuotId} onChange={e => om.setSelectedQuotId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="select-quotation-for-order">
                    <option value="">-- Select --</option>
                    {om.pendingQuots.map(q => (
                      <option key={q.quotation_id} value={q.quotation_id}>{q.quote_number} — {q.school_name} ({formatCurrency(q.grand_total)})</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => om.setCreateOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={om.handleCreate} disabled={!om.selectedQuotId} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-create-order">Create Order</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Order Detail */}
        <OrderDetailPanel
          detailOrder={om.detailOrder}
          detailOpen={om.detailOpen}
          setDetailOpen={om.setDetailOpen}
          textPri={textPri} textSec={textSec} textMuted={textMuted} dlgCls={dlgCls}
        />

        {/* Status Change */}
        <Dialog open={om.statusOpen} onOpenChange={om.setStatusOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>Update Order Status</DialogTitle></DialogHeader>
            {om.statusTarget && (
              <div className="space-y-3 py-2">
                <p className={`text-sm ${textSec}`}>{om.statusTarget.order_number} — {om.statusTarget.school_name}</p>
                <p className={`text-xs ${textMuted}`}>Current: <span className="capitalize font-medium">{om.statusTarget.order_status}</span></p>
                <div>
                  <Label className={`${textSec} text-xs`}>New Status</Label>
                  <select value={om.newStatus} onChange={e => om.setNewStatus(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="new-status-select">
                    <option value="">Select</option>
                    {ORDER_STATUSES.filter(s => s.id !== om.statusTarget.order_status).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div><Label className={`${textSec} text-xs`}>Note</Label><Input value={om.statusNote} onChange={e => om.setStatusNote(e.target.value)} className={inputCls} placeholder="Optional note..." /></div>
                {om.newStatus === 'dispatched' && <p className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Stock will be auto-deducted on dispatch.</p>}
                {om.newStatus === 'cancelled'  && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> All holds will be released.</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => om.setStatusOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={om.handleStatusChange} disabled={!om.newStatus} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="confirm-status-change">Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Tracking */}
        <Dialog open={om.trackingDialog.open} onOpenChange={o => !om.trackingSaving && om.setTrackingDialog(d => ({ ...d, open: o }))}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Update Tracking — {om.trackingDialog.dispatch?.dispatch_number}</DialogTitle></DialogHeader>
            {om.trackingDialog.dispatch && (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={`${textSec} text-xs`}>Courier Name</Label>
                    <Input value={om.trackingForm.courier_name} onChange={e => om.setTrackingForm(f => ({ ...f, courier_name: e.target.value }))} className={inputCls} placeholder="e.g. BlueDart, FedEx" />
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Tracking Number</Label>
                    <Input value={om.trackingForm.tracking_number} onChange={e => om.setTrackingForm(f => ({ ...f, tracking_number: e.target.value }))} className={inputCls} placeholder="Tracking ID" />
                  </div>
                </div>
                <div>
                  <Label className={`${textSec} text-xs mb-1.5 block`}>WhatsApp Message Preview</Label>
                  <div className={`rounded-md p-3 text-xs font-mono whitespace-pre-wrap bg-[var(--bg-primary)] border border-[var(--border-color)] ${textSec} max-h-48 overflow-y-auto`}>
                    {buildDispatchMessage(om.trackingDialog.dispatch, om.trackingForm.courier_name, om.trackingForm.tracking_number)}
                  </div>
                  {om.trackingDialog.dispatch.phone
                    ? <p className={`text-xs ${textMuted} mt-1`}>Will send to: <span className="text-green-400">{om.trackingDialog.dispatch.phone}</span></p>
                    : <p className="text-xs text-amber-400 mt-1">No phone number found — message will be copied to clipboard.</p>
                  }
                </div>
              </div>
            )}
            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => om.setTrackingDialog({ open: false, dispatch: null })} className={`border-[var(--border-color)] ${textSec}`} disabled={om.trackingSaving}>Cancel</Button>
              {om.trackingDialog.dispatch && (
                <WaPickerButton
                  phone={om.trackingDialog.dispatch.phone}
                  message={buildDispatchMessage(om.trackingDialog.dispatch, om.trackingForm.courier_name, om.trackingForm.tracking_number)}
                  label="Send WhatsApp"
                  className="flex-1 justify-center"
                />
              )}
              <Button onClick={om.handleUpdateTracking} disabled={om.trackingSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white flex-1">
                <Truck className="mr-1.5 h-4 w-4" />{om.trackingSaving ? 'Saving…' : 'Save Tracking'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* WhatsApp dispatch */}
        <WhatsAppSendDialog
          open={om.waDispatchOpen}
          onOpenChange={om.setWaDispatchOpen}
          module="dispatch"
          context={om.waDispatch ? {
            order_id: om.waDispatch.order_id, school_id: om.waDispatch.school_id,
            phone: om.waDispatch.phone || '', school_name: om.waDispatch.school_name,
            contact_name: om.waDispatch.school_name,
          } : {}}
          title={`Tracking - ${om.waDispatch?.dispatch_number || ''}`}
        />
      </div>
    </AppShell>
  );
}
