import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { physicalDispatches as dispatchApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';
import { Search, Package, ExternalLink, Copy, MessageSquare, CheckCircle, RefreshCw, Pencil, Save, X } from 'lucide-react';
import WhatsAppSendDialog from '../../components/WhatsAppSendDialog';

const COURIERS = ['Delhivery', 'Blue Dart', 'DTDC', 'Other'];

function buildTrackingUrl(courierName, trackingNumber) {
  if (!trackingNumber) return '';
  const key = (courierName || '').toLowerCase().trim();
  if (key === 'delhivery') return `https://www.delhivery.com/track/package/${trackingNumber}`;
  if (key === 'blue dart' || key === 'bluedart') return `https://bluedart.com/track-consignment?trackFor=0&HAWB=${trackingNumber}`;
  if (key === 'dtdc') return `https://tracking.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCustInter&cType=Consignment&cnNo=${trackingNumber}`;
  return '';
}

function buildDispatchMessage(d) {
  const trackingUrl = buildTrackingUrl(d.courier_name, d.tracking_number);
  let msg = `Dear ${d.contact_name || d.lead_name || 'Sir/Madam'}, your ${d.material_type || 'material'} from SmartShape has been dispatched via ${d.courier_name || 'courier'}.`;
  if (d.tracking_number) msg += `\nTracking No: ${d.tracking_number}`;
  if (trackingUrl) msg += `\nTrack here: ${trackingUrl}`;
  msg += '\n\nRegards,\nSmartShape Team';
  return msg;
}

export default function DispatchTracking() {
  const { isDark } = useTheme();
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCourier, setFilterCourier] = useState('');
  const [filterReceived, setFilterReceived] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ courier_name: '', tracking_number: '', dispatched_without_payment: false, payment_pending_reason: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx] = useState({ module: 'dispatch', context: {}, title: 'Send WhatsApp', initialBody: '' });

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const fetchDispatches = async () => {
    try {
      const res = await dispatchApi.getAll();
      setDispatches(Array.isArray(res.data) ? res.data : []);
    } catch { toast.error('Failed to load dispatches'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDispatches(); }, []);

  const markReceived = async (dispatch_id) => {
    try {
      await dispatchApi.update(dispatch_id, { received_confirmed: true });
      setDispatches(prev => prev.map(d => d.dispatch_id === dispatch_id ? { ...d, received_confirmed: true } : d));
      toast.success('Marked as received');
    } catch { toast.error('Failed to update'); }
  };

  const startEdit = (d) => {
    setEditingId(d.dispatch_id);
    setEditForm({
      courier_name: d.courier_name || '',
      tracking_number: d.tracking_number || '',
      dispatched_without_payment: !!d.dispatched_without_payment,
      payment_pending_reason: d.payment_pending_reason || '',
    });
  };

  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async (dispatch_id) => {
    if (editForm.dispatched_without_payment && !editForm.payment_pending_reason.trim()) {
      toast.error('Please add a reason for dispatching without payment');
      return;
    }
    setSavingEdit(true);
    try {
      await dispatchApi.update(dispatch_id, { ...editForm });
      setDispatches(prev => prev.map(d => d.dispatch_id === dispatch_id ? { ...d, ...editForm } : d));
      setEditingId(null);
      toast.success('Dispatch updated');
    } catch { toast.error('Failed to update'); }
    finally { setSavingEdit(false); }
  };

  const copyLink = (url) => {
    if (!url) { toast.error('No tracking URL available for this courier'); return; }
    navigator.clipboard.writeText(url).then(() => toast.success('Tracking link copied!')).catch(() => toast.error('Copy failed'));
  };

  const openWa = (d) => {
    setWaCtx({
      module: 'dispatch',
      title: `Dispatch Notification — ${d.lead_name || d.contact_name || ''}`,
      context: { phone: d.contact_phone, contact_name: d.contact_name || d.lead_name, lead_id: d.lead_id },
      initialBody: buildDispatchMessage(d),
    });
    setWaOpen(true);
  };

  const filtered = dispatches.filter(d => {
    if (filterCourier && (d.courier_name || '').toLowerCase() !== filterCourier.toLowerCase()) return false;
    if (filterReceived === 'received' && !d.received_confirmed) return false;
    if (filterReceived === 'pending' && d.received_confirmed) return false;
    if (filterPayment === 'unpaid' && !d.dispatched_without_payment) return false;
    if (filterPayment === 'paid' && d.dispatched_without_payment) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      if (!((d.lead_name || '').toLowerCase().includes(s) || (d.tracking_number || '').toLowerCase().includes(s) || (d.contact_name || '').toLowerCase().includes(s))) return false;
    }
    return true;
  });

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-96">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`}>Dispatch Tracking</h1>
            <p className={`${textSec} mt-1 text-sm`}>{dispatches.length} dispatches • {dispatches.filter(d => !d.received_confirmed).length} pending delivery</p>
          </div>
          <Button onClick={fetchDispatches} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]">
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search lead name, tracking number..." className={`pl-10 ${inputCls}`} />
          </div>
          <select value={filterCourier} onChange={e => setFilterCourier(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`}>
            <option value="">All Couriers</option>
            {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterReceived} onChange={e => setFilterReceived(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`}>
            <option value="all">All Status</option>
            <option value="pending">Pending Delivery</option>
            <option value="received">Received</option>
          </select>
          <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className={`h-10 px-3 rounded-md text-sm ${inputCls}`}>
            <option value="all">All Payments</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className={`${card} border rounded-md p-12 text-center`}>
            <Package className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
            <p className={textMuted}>No dispatches found</p>
          </div>
        ) : (
          <div className={`${card} border rounded-md overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-primary)]">
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Date</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Lead / Contact</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden sm:table-cell`}>Material</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden md:table-cell`}>Courier</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden md:table-cell`}>Tracking #</th>
                    <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted} hidden lg:table-cell`}>Tracking Link</th>
                    <th className={`text-center text-xs uppercase py-3 px-4 ${textMuted}`}>Status</th>
                    <th className={`text-right text-xs uppercase py-3 px-4 ${textMuted}`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(d => {
                    const trackingUrl = buildTrackingUrl(d.courier_name, d.tracking_number);
                    const editing = editingId === d.dispatch_id;
                    return (
                      <tr key={d.dispatch_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]`}>
                        <td className={`py-3 px-4 text-xs ${textMuted} whitespace-nowrap`}>{d.sent_date || d.created_at?.slice(0, 10) || '—'}</td>
                        <td className="py-3 px-4">
                          <p className={`${textPri} font-medium text-sm`}>{d.lead_name || '—'}</p>
                          {d.contact_name && <p className={`text-xs ${textMuted}`}>{d.contact_name}</p>}
                        </td>
                        <td className={`py-3 px-4 hidden sm:table-cell text-sm ${textSec} capitalize`}>{d.material_type || '—'}</td>
                        <td className={`py-3 px-4 hidden md:table-cell text-sm ${textSec}`}>
                          {editing ? (
                            <select value={editForm.courier_name} onChange={e => setEditForm({ ...editForm, courier_name: e.target.value })} className={`h-8 px-2 rounded text-xs ${inputCls}`}>
                              <option value="">— Courier —</option>
                              {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (d.courier_name || '—')}
                        </td>
                        <td className={`py-3 px-4 hidden md:table-cell font-mono text-xs ${textPri}`}>
                          {editing ? (
                            <Input value={editForm.tracking_number} onChange={e => setEditForm({ ...editForm, tracking_number: e.target.value })} placeholder="Tracking #" className={`${inputCls} h-8 text-xs w-36`} />
                          ) : (d.tracking_number || '—')}
                        </td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          {trackingUrl ? (
                            <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#e94560] hover:underline flex items-center gap-1 max-w-[180px] truncate">
                              <ExternalLink className="h-3 w-3 flex-shrink-0" /> Track
                            </a>
                          ) : d.tracking_number ? (
                            <span className={`text-xs ${textMuted}`}>No URL (manual courier)</span>
                          ) : (
                            <span className={`text-xs ${textMuted}`}>—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {editing ? (
                            <div className="flex flex-col gap-1 items-start text-left min-w-[170px]">
                              <label className={`flex items-center gap-1 text-[11px] ${textSec} cursor-pointer select-none`}>
                                <input type="checkbox" checked={editForm.dispatched_without_payment} onChange={e => setEditForm({ ...editForm, dispatched_without_payment: e.target.checked })} className="accent-[#e94560]" />
                                Dispatch without payment
                              </label>
                              {editForm.dispatched_without_payment && (
                                <Input value={editForm.payment_pending_reason} onChange={e => setEditForm({ ...editForm, payment_pending_reason: e.target.value })} placeholder="Reason (required)" className={`${inputCls} h-7 text-[11px]`} />
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              {d.received_confirmed ? (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium flex items-center justify-center gap-1 whitespace-nowrap">
                                  <CheckCircle className="h-3 w-3" /> Received
                                </span>
                              ) : (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">In Transit</span>
                              )}
                              {d.dispatched_without_payment && (
                                <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-medium whitespace-nowrap" title={d.payment_pending_reason || ''}>Unpaid</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {editing ? (
                            <>
                              <Button size="sm" variant="ghost" disabled={savingEdit} onClick={() => saveEdit(d.dispatch_id)} className="text-green-500 h-7 px-2" title="Save changes">
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" disabled={savingEdit} onClick={cancelEdit} className={`${textSec} h-7 px-2`} title="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => startEdit(d)} className={`${textSec} h-7 px-2`} title="Edit courier / tracking / payment">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => copyLink(trackingUrl)} className={`${textSec} h-7 px-2`} title="Copy tracking link">
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              {trackingUrl && (
                                <Button size="sm" variant="ghost" asChild className={`${textSec} h-7 px-2`} title="Open tracking page">
                                  <a href={trackingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => openWa(d)} className="text-green-500 h-7 px-2" title="Send WhatsApp notification">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                              {!d.received_confirmed && (
                                <Button size="sm" variant="ghost" onClick={() => markReceived(d.dispatch_id)} className="text-[#e94560] h-7 px-2" title="Mark as received">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <WhatsAppSendDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        module={waCtx.module}
        context={waCtx.context}
        title={waCtx.title}
        initialBody={waCtx.initialBody}
      />
    </AdminLayout>
  );
}
