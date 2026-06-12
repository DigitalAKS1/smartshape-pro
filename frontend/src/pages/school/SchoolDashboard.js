import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { schoolAuth, schoolDocUrl } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Package, Truck, CheckCircle, Clock, Bell, LogOut, FileText, Eye, GraduationCap, ShoppingCart, XCircle, CreditCard, Download, User, Upload, Plus, RefreshCw } from 'lucide-react';

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', label: 'Pending' },
  confirmed: { icon: CheckCircle, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', label: 'Confirmed' },
  dispatched: { icon: Truck, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', label: 'Dispatched' },
  delivered: { icon: CheckCircle, color: 'text-green-400 bg-green-500/10 border-green-500/30', label: 'Delivered' },
  cancelled: { icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Cancelled' },
};

const ITEM_STATUS = {
  on_hold: { color: 'bg-orange-500/20 text-orange-400', label: 'On Hold' },
  confirmed: { color: 'bg-blue-500/20 text-blue-400', label: 'Confirmed' },
  dispatched: { color: 'bg-purple-500/20 text-purple-400', label: 'Dispatched' },
  delivered: { color: 'bg-green-500/20 text-green-400', label: 'Delivered' },
  released: { color: 'bg-gray-500/20 text-gray-400', label: 'Released' },
  cancelled: { color: 'bg-red-500/20 text-red-400', label: 'Cancelled' },
};

export default function SchoolDashboard() {
  const navigate = useNavigate();
  const [school, setSchool] = useState(null);
  const [orders, setOrders] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('orders');
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [payments, setPayments] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [profileForm, setProfileForm] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '', designation: '' });
  const [reorderMsg, setReorderMsg] = useState('');

  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [me, ord, quot, notif, pay, docs] = await Promise.all([
          schoolAuth.me(), schoolAuth.orders(), schoolAuth.quotations(), schoolAuth.notifications(),
          schoolAuth.payments().catch(() => ({ data: null })),
          schoolAuth.documents().catch(() => ({ data: [] })),
        ]);
        setSchool(me.data);
        setOrders(ord.data);
        setQuotations(quot.data);
        setNotifications(notif.data);
        setPayments(pay.data);
        setDocuments(docs.data || []);
        setProfileForm(me.data || {});
      } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
          navigate('/school/login');
        }
      } finally { setLoading(false); }
    };
    fetchAll();
  }, [navigate]);

  const openDetail = async (order) => {
    try {
      const res = await schoolAuth.orderDetail(order.order_id);
      setDetailOrder(res.data);
      setDetailOpen(true);
    } catch { toast.error('Failed to load'); }
  };

  const markNotificationsRead = async () => {
    await schoolAuth.markRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const r = await schoolAuth.updateProfile(profileForm);
      setSchool(r.data);
      toast.success('Profile saved');
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSavingProfile(false); }
  };

  const addContact = async () => {
    if (!newContact.name.trim()) return toast.error('Contact name required');
    try {
      await schoolAuth.addContact(newContact);
      setNewContact({ name: '', phone: '', designation: '' });
      toast.success('Contact submitted — our team will verify it.');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const requestReorder = async () => {
    if (!reorderMsg.trim()) return toast.error('Tell us what you need');
    try {
      await schoolAuth.reorder({ message: reorderMsg });
      setReorderMsg('');
      toast.success('Request sent — our team will get back to you.');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const uploadPO = async (quotationId, file) => {
    if (!file) return;
    try {
      await schoolAuth.uploadPO(quotationId, file);
      toast.success('PO uploaded — pending review.');
    } catch (e) { toast.error(e.response?.data?.detail || 'Upload failed'); }
  };

  const handleLogout = () => {
    document.cookie = 'access_token=; path=/; max-age=0';
    document.cookie = 'refresh_token=; path=/; max-age=0';
    navigate('/school/login');
  };

  if (loading) return <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>;

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-[#e94560]" />
            <div>
              <h1 className={`text-lg font-bold ${textPri}`} data-testid="school-dashboard-title">{school?.school_name || 'School Portal'}</h1>
              <p className={`text-xs ${textMuted}`}>{school?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setActiveTab('notifications'); markNotificationsRead(); }}
              className={`relative p-2 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`} data-testid="school-notifications-btn">
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#e94560] rounded-full text-[10px] text-white flex items-center justify-center font-bold">{unread}</span>}
            </button>
            <Button onClick={handleLogout} variant="ghost" size="sm" className={textSec} data-testid="school-logout-btn">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`${card} border rounded-md p-4 text-center`}><div className={`text-2xl font-mono font-bold ${textPri}`}>{orders.length}</div><p className={`text-xs ${textMuted}`}>Total Orders</p></div>
          <div className={`${card} border rounded-md p-4 text-center`}><div className="text-2xl font-mono font-bold text-yellow-400">{orders.filter(o => o.order_status === 'pending' || o.order_status === 'confirmed').length}</div><p className={`text-xs ${textMuted}`}>In Progress</p></div>
          <div className={`${card} border rounded-md p-4 text-center`}><div className="text-2xl font-mono font-bold text-purple-400">{orders.filter(o => o.order_status === 'dispatched').length}</div><p className={`text-xs ${textMuted}`}>Dispatched</p></div>
          <div className={`${card} border rounded-md p-4 text-center`}><div className="text-2xl font-mono font-bold text-green-400">{orders.filter(o => o.order_status === 'delivered').length}</div><p className={`text-xs ${textMuted}`}>Delivered</p></div>
        </div>

        {/* Tabs */}
        <div className={`flex flex-wrap gap-1 ${card} border rounded-md p-1`}>
          {['orders', 'quotations', 'payments', 'documents', 'profile', 'notifications'].map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'notifications') markNotificationsRead(); }}
              className={`flex-1 min-w-[90px] px-3 py-2 rounded text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`school-tab-${tab}`}>
              {tab === 'orders' ? `Orders (${orders.length})`
                : tab === 'quotations' ? `Quotations (${quotations.length})`
                : tab === 'payments' ? 'Payments'
                : tab === 'documents' ? `Documents (${documents.length})`
                : tab === 'profile' ? 'Profile'
                : `Notifications ${unread > 0 ? `(${unread})` : ''}`}
            </button>
          ))}
        </div>

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="space-y-3" data-testid="school-orders-list">
            {orders.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <ShoppingCart className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No orders yet</p>
              </div>
            ) : orders.map(order => {
              const sc = STATUS_CONFIG[order.order_status] || STATUS_CONFIG.pending;
              const Icon = sc.icon;
              return (
                <div key={order.order_id} className={`${card} border rounded-md p-4 cursor-pointer hover:border-[#e94560]/40 transition-all`}
                  onClick={() => openDetail(order)} data-testid={`school-order-${order.order_number}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-[#e94560] font-medium">{order.order_number}</span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${sc.color}`}><Icon className="inline h-3 w-3 mr-1" />{sc.label}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm ${textSec}`}>{order.package_name} • {order.total_items} items</p>
                      <p className={`text-xs ${textMuted}`}>{formatDate(order.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold ${textPri}`}>{formatCurrency(order.grand_total)}</span>
                      <Eye className={`h-4 w-4 ${textMuted}`} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* QUOTATIONS TAB */}
        {activeTab === 'quotations' && (
          <div className="space-y-3" data-testid="school-quotations-list">
            {quotations.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <FileText className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No quotations</p>
              </div>
            ) : quotations.map(q => (
              <div key={q.quotation_id} className={`${card} border rounded-md p-4`} data-testid={`school-quot-${q.quote_number}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm text-[#e94560] font-medium">{q.quote_number}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(q.quotation_status)}`}>{q.quotation_status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className={`text-sm ${textSec}`}>{q.package_name}</p>
                  <span className={`font-mono font-bold ${textPri}`}>{formatCurrency(q.grand_total)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className={`text-xs ${textMuted}`}>{formatDate(q.created_at)}</p>
                  <label className="text-xs text-[#e94560] hover:underline cursor-pointer flex items-center gap-1">
                    <Upload className="h-3 w-3" /> {q.po_file_url ? 'Replace PO' : 'Upload PO'}
                    <input type="file" accept=".pdf,image/*" className="hidden"
                      onChange={e => uploadPO(q.quotation_id, e.target.files?.[0])} />
                  </label>
                </div>
                {q.po_status && <p className={`text-[10px] ${textMuted} mt-1`}>PO: {q.po_status.replace('_', ' ')}</p>}
              </div>
            ))}
          </div>
        )}

        {/* NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <div className="space-y-2" data-testid="school-notifications-list">
            {notifications.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <Bell className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No notifications</p>
              </div>
            ) : notifications.map(n => (
              <div key={n.notification_id} className={`${card} border rounded-md p-4 ${!n.read ? 'border-l-2 border-l-[#e94560]' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  {n.type === 'dispatch' ? <Truck className="h-4 w-4 text-purple-400" /> : n.type === 'delivered' ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Bell className="h-4 w-4 text-[#e94560]" />}
                  <p className={`text-sm font-medium ${textPri}`}>{n.title}</p>
                </div>
                <p className={`text-sm ${textSec}`}>{n.message}</p>
                <p className={`text-xs ${textMuted} mt-1`}>{formatDate(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}

        {/* PAYMENTS TAB */}
        {activeTab === 'payments' && (
          <div className="space-y-3" data-testid="school-payments">
            <div className={`${card} border rounded-md p-4 flex items-center justify-between`}>
              <span className={`flex items-center gap-2 ${textSec}`}><CreditCard className="h-4 w-4" /> Total outstanding</span>
              <span className="font-mono font-bold text-xl text-[#e94560]">{formatCurrency(payments?.totals?.total_outstanding || 0)}</span>
            </div>
            {(payments?.orders || []).length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <CreditCard className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No billable orders yet</p>
              </div>
            ) : (payments.orders).map(o => (
              <div key={o.order_id} className={`${card} border rounded-md p-4`}>
                <div className="flex justify-between mb-2">
                  <span className="font-mono text-sm text-[#e94560] font-medium">{o.order_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${o.payment_status === 'paid' ? 'bg-green-500/15 text-green-400' : o.payment_status === 'partial' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'}`}>{o.payment_status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className={`text-[10px] ${textMuted}`}>Total</p><p className={textPri}>{formatCurrency(o.grand_total)}</p></div>
                  <div><p className={`text-[10px] ${textMuted}`}>Paid</p><p className="text-green-400">{formatCurrency(o.payment_received)}</p></div>
                  <div><p className={`text-[10px] ${textMuted}`}>Balance</p><p className="text-[#e94560] font-medium">{formatCurrency(o.balance_due)}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === 'documents' && (
          <div className="space-y-2" data-testid="school-documents">
            {documents.length === 0 ? (
              <div className={`${card} border rounded-md p-12 text-center`}>
                <FileText className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No documents yet</p>
              </div>
            ) : documents.map((d, i) => (
              <a key={`${d.doc_type}-${d.ref_id}-${i}`} href={schoolDocUrl(d.download_url)} target="_blank" rel="noopener noreferrer"
                className={`${card} border rounded-md p-4 flex items-center justify-between hover:border-[#e94560]/40 transition-all`}>
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-[#e94560]" />
                  <div>
                    <p className={`text-sm ${textPri}`}>{d.label}</p>
                    <p className={`text-[10px] ${textMuted} capitalize`}>{d.doc_type} • {formatDate(d.date)}</p>
                  </div>
                </div>
                <Download className={`h-4 w-4 ${textMuted}`} />
              </a>
            ))}
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div className="space-y-4" data-testid="school-profile">
            <div className={`${card} border rounded-md p-4 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><User className="h-4 w-4" /> Your details</h3>
              {[['primary_contact_name', 'Contact name'], ['phone', 'Phone'], ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['pincode', 'Pincode'], ['website', 'Website']].map(([k, label]) => (
                <div key={k}>
                  <label className={`text-xs ${textMuted}`}>{label}</label>
                  <Input value={profileForm[k] || ''} onChange={e => setProfileForm({ ...profileForm, [k]: e.target.value })}
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
              ))}
              <Button onClick={saveProfile} disabled={savingProfile} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                {savingProfile ? 'Saving…' : 'Save profile'}
              </Button>
            </div>

            <div className={`${card} border rounded-md p-4 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><Plus className="h-4 w-4" /> Add a contact</h3>
              <Input placeholder="Name" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })}
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Phone" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                <Input placeholder="Designation" value={newContact.designation} onChange={e => setNewContact({ ...newContact, designation: e.target.value })}
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
              </div>
              <Button onClick={addContact} variant="outline" className="w-full">Submit contact</Button>
            </div>

            <div className={`${card} border rounded-md p-4 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><RefreshCw className="h-4 w-4" /> Request a reorder / new quote</h3>
              <textarea value={reorderMsg} onChange={e => setReorderMsg(e.target.value)} rows={3}
                placeholder="Tell us what you'd like to reorder…"
                className="w-full rounded-md p-2 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]" />
              <Button onClick={requestReorder} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Send request</Button>
            </div>
          </div>
        )}
      </div>

      {/* ORDER DETAIL DIALOG */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[88dvh] overflow-y-auto`}>
          {detailOrder && (
            <>
              <DialogHeader>
                <DialogTitle className={textPri}>
                  <span className="font-mono text-[#e94560]">{detailOrder.order_number}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><p className={`text-xs ${textMuted}`}>Status</p><span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${(STATUS_CONFIG[detailOrder.order_status] || STATUS_CONFIG.pending).color}`}>{detailOrder.order_status}</span></div>
                  <div><p className={`text-xs ${textMuted}`}>Total</p><p className={`font-mono font-bold ${textPri}`}>{formatCurrency(detailOrder.grand_total)}</p></div>
                  <div><p className={`text-xs ${textMuted}`}>Items</p><p className={`font-mono ${textPri}`}>{detailOrder.total_items}</p></div>
                  <div><p className={`text-xs ${textMuted}`}>Date</p><p className={`text-sm ${textSec}`}>{formatDate(detailOrder.created_at)}</p></div>
                </div>

                <div>
                  <h3 className={`text-sm font-medium ${textPri} mb-2`}>Items & Status</h3>
                  <div className="space-y-2">
                    {(detailOrder.items || []).map(item => {
                      const is = ITEM_STATUS[item.status] || ITEM_STATUS.on_hold;
                      return (
                        <div key={item.order_item_id} className="flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3">
                          <div className="w-10 h-10 rounded bg-[var(--bg-hover)] flex items-center justify-center flex-shrink-0">
                            {item.die_image_url ? <img src={`${process.env.REACT_APP_BACKEND_URL}${item.die_image_url}`} alt="" className="w-full h-full object-cover rounded" /> : <Package className={`h-4 w-4 ${textMuted}`} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${textPri}`}>{item.die_name}</p>
                            <p className={`text-xs font-mono ${textMuted}`}>{item.die_code}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${is.color}`}>{is.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

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
                            <p className={`text-[10px] ${textMuted}`}>{formatDate(tl.timestamp)}</p>
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
    </div>
  );
}
