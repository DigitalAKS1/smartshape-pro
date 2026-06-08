import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import {
  Plus, FileText, ShoppingCart, Trash2, Check, X, Send, Download,
  ArrowRight, ImageOff, PackageCheck, RotateCcw,
  LayoutDashboard, IndianRupee, ClipboardCheck, AlertTriangle, Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';
import ItemPicker from '../../components/procurement/ItemPicker';
import DemandPanel from '../../components/procurement/DemandPanel';
import { ReceivingTab, ReturnsTab } from '../../components/procurement/ReceivingQC';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';
const imgSrc = (u) => (u ? (u.startsWith('http') ? u : `${BACKEND}${u}`) : '');
const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

const REQ_STATUS = {
  draft: 'bg-gray-500/15 text-gray-300', submitted: 'bg-blue-500/15 text-blue-300',
  approved: 'bg-green-500/15 text-green-400', rejected: 'bg-red-500/15 text-red-400',
  converting: 'bg-amber-500/15 text-amber-300', converted: 'bg-teal-500/15 text-teal-300',
};
const PO_STATUS = {
  draft: 'bg-gray-500/15 text-gray-300', approved: 'bg-green-500/15 text-green-400',
  sent: 'bg-indigo-500/15 text-indigo-300', partially_received: 'bg-amber-500/15 text-amber-300',
  received: 'bg-teal-500/15 text-teal-300', closed: 'bg-gray-500/15 text-gray-400',
  cancelled: 'bg-red-500/15 text-red-400',
};
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Thumb({ url, size = 36 }) {
  if (!url) return (
    <div className="flex items-center justify-center rounded bg-[var(--bg-primary)] border border-[var(--border-color)]"
      style={{ width: size, height: size }}><ImageOff className="h-4 w-4 text-[var(--text-muted)]" /></div>
  );
  return <img src={imgSrc(url)} alt="" className="rounded object-cover border border-[var(--border-color)]" style={{ width: size, height: size }} />;
}
function Badge({ map, value }) {
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${map[value] || 'bg-gray-500/15 text-gray-300'}`}>{(value || '').replace('_', ' ')}</span>;
}

function useSorted(rows, initialKey) {
  const [sort, setSort] = React.useState({ key: initialKey, dir: 'desc' });
  const sorted = React.useMemo(() => {
    const r = [...(rows || [])];
    r.sort((a, b) => {
      const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
      const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [rows, sort]);
  const toggle = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  return { sorted, sort, toggle };
}

export default function Procurement() {
  const [tab, setTab] = useState('dashboard');
  const [vendors, setVendors] = useState([]);

  useEffect(() => { procurement.vendors.getAll().then(r => setVendors(r.data || [])).catch(() => {}); }, []);

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="procurement-title">Procurement</h1>
          <p className={`${textSec} mt-1 text-sm`}>Raise requisitions, plan orders, and issue GST purchase orders to your vendors.</p>
        </div>

        <div className={`${card} border rounded-md p-1 flex gap-1 flex-wrap`}>
          {[['dashboard', 'Dashboard', LayoutDashboard], ['requisitions', 'Requisitions', FileText], ['orders', 'Purchase Orders', ShoppingCart], ['receiving', 'Receiving & QC', PackageCheck], ['returns', 'Returns', RotateCcw]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} data-testid={`ptab-${id}`}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${tab === id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && <DashboardTab onJump={setTab} />}
        {tab === 'requisitions' && <RequisitionsTab vendors={vendors} />}
        {tab === 'orders' && <PurchaseOrdersTab vendors={vendors} />}
        {tab === 'receiving' && <ReceivingTab />}
        {tab === 'returns' && <ReturnsTab />}
      </div>
    </AdminLayout>
  );
}

/* ── Shared line editor (qty + optional rate) ─────────────────────────────── */
function LineRows({ lines, setLines, withRate }) {
  const update = (i, patch) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const remove = (i) => setLines(lines.filter((_, j) => j !== i));
  if (lines.length === 0) return <p className={`text-xs ${textMuted} text-center py-6`}>No items yet — click “Add Items”.</p>;
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => (
        <div key={i} className={`flex items-center gap-2 ${card} border rounded-md p-2`} data-testid={`line-${i}`}>
          <Thumb url={l.image_url} />
          <div className="min-w-0 flex-1">
            <p className={`${textPri} text-sm font-medium truncate`}>{l.name}{l.code ? <span className="ml-2 text-[11px] font-mono text-[#e94560]">{l.code}</span> : null}</p>
            <p className={`${textMuted} text-[11px]`}>{l.item_ref?.source === 'die' ? 'Product' : 'Material'} · {l.uom || 'pcs'}{l.gst_pct ? ` · GST ${l.gst_pct}%` : ''}{(l.stock_qty != null) ? ` · Phys ${l.stock_qty}/Avail ${l.available_qty ?? l.stock_qty}` : ''}</p>
          </div>
          <div>
            <span className={`text-[10px] ${textMuted} block`}>Qty</span>
            <Input type="number" min="1" value={l.qty} onChange={e => update(i, { qty: e.target.value })} className={`${inputCls} h-8 w-20 text-sm`} />
          </div>
          {withRate && (
            <div>
              <span className={`text-[10px] ${textMuted} block`}>Rate ₹</span>
              <Input type="number" min="0" value={l.rate ?? l.default_rate ?? 0} onChange={e => update(i, { rate: e.target.value })} className={`${inputCls} h-8 w-24 text-sm`} />
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => remove(i)} className="text-red-400 h-8 px-1.5 self-end"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
    </div>
  );
}

/* ── Dashboard ────────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, tone = 'text-[#e94560]', onClick, testId }) {
  return (
    <button onClick={onClick} disabled={!onClick} data-testid={testId}
      className={`${card} border rounded-md p-4 text-left ${onClick ? 'hover:bg-[var(--bg-hover)] cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className={`text-xs ${textMuted}`}>{label}</span>
      </div>
      <p className={`text-2xl font-semibold ${textPri} mt-1`}>{value}</p>
      {sub ? <p className={`text-[11px] ${textMuted} mt-0.5`}>{sub}</p> : null}
    </button>
  );
}

function DashboardTab({ onJump }) {
  const [s, setS] = useState(null);
  useEffect(() => { procurement.summary().then(r => setS(r.data)).catch(() => setS(null)); }, []);
  const [report, setReport] = useState([]);
  useEffect(() => { procurement.poReport().then(r => setReport(r.data || [])).catch(() => {}); }, []);

  if (!s) return <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" /></div>;

  const po = s.purchase_orders || {};
  const poStatuses = ['draft', 'approved', 'sent', 'partially_received', 'received', 'cancelled'];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={IndianRupee} label="Committed spend" value={inr(po.committed_value)} sub="approved & beyond" tone="text-emerald-400" />
        <KpiCard icon={ShoppingCart} label="Open PO value" value={inr(po.open_value)} sub={`${po.total || 0} POs total`} onClick={() => onJump('orders')} testId="kpi-open-po" />
        <KpiCard icon={ClipboardCheck} label="Pending QC" value={s.pending_qc || 0} sub="receipts to verify" tone="text-amber-400" onClick={() => onJump('receiving')} testId="kpi-pending-qc" />
        <KpiCard icon={RotateCcw} label="Vendor returns" value={s.returns?.count || 0} sub={inr(s.returns?.value)} tone="text-red-400" onClick={() => onJump('returns')} testId="kpi-returns" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={FileText} label="Requisitions to approve" value={s.requisitions?.needs_approval || 0} sub={`${s.requisitions?.total || 0} total`} tone="text-blue-400" onClick={() => onJump('requisitions')} testId="kpi-req-approve" />
        <KpiCard icon={AlertTriangle} label="POs awaiting approval" value={po.awaiting_approval || 0} sub="draft POs" tone="text-amber-400" onClick={() => onJump('orders')} />
        <KpiCard icon={Truck} label="Active vendors" value={s.vendors_active || 0} />
        <KpiCard icon={PackageCheck} label="Received POs" value={(po.by_status || {}).received || 0} tone="text-teal-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* PO status breakdown */}
        <div className={`${card} border rounded-md p-4`}>
          <h3 className={`text-sm font-medium ${textPri} mb-3`}>Purchase Orders by status</h3>
          <div className="space-y-2">
            {poStatuses.map(st => {
              const n = (po.by_status || {})[st] || 0;
              const pct = po.total ? Math.round((n / po.total) * 100) : 0;
              return (
                <div key={st}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className={textSec}>{st.replace('_', ' ')}</span>
                    <span className={textMuted}>{n}</span>
                  </div>
                  <div className="h-1.5 rounded bg-[var(--bg-primary)] overflow-hidden">
                    <div className="h-full rounded bg-[#e94560]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!po.total && <p className={`text-xs ${textMuted} text-center py-3`}>No purchase orders yet.</p>}
          </div>
        </div>

        {/* Top vendors */}
        <div className={`${card} border rounded-md p-4`}>
          <h3 className={`text-sm font-medium ${textPri} mb-3`}>Top vendors by spend</h3>
          <div className="space-y-2">
            {(s.top_vendors || []).map((v, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className={`${textSec} truncate`}>{v.vendor}</span>
                <span className={`${textPri} font-medium`}>{inr(v.spend)} <span className={`${textMuted} text-xs`}>· {v.orders}</span></span>
              </div>
            ))}
            {(s.top_vendors || []).length === 0 && <p className={`text-xs ${textMuted} text-center py-3`}>No committed orders yet.</p>}
          </div>
        </div>

        {/* Recent POs */}
        <div className={`${card} border rounded-md p-4`}>
          <h3 className={`text-sm font-medium ${textPri} mb-3`}>Recent purchase orders</h3>
          <div className="space-y-2">
            {(s.recent_pos || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <span className={`${textPri} font-medium`}>{p.po_no}</span>
                  <span className={`${textMuted} text-xs ml-2 truncate`}>{p.vendor_name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge map={PO_STATUS} value={p.status} />
                  <span className={`${textSec} text-xs`}>{inr(p.grand_total)}</span>
                </div>
              </div>
            ))}
            {(s.recent_pos || []).length === 0 && <p className={`text-xs ${textMuted} text-center py-3`}>No purchase orders yet.</p>}
          </div>
        </div>
      </div>

      <div className={`${card} border rounded-md p-4`}>
        <h3 className={`text-sm font-medium ${textPri} mb-3`}>Open PO balances ({report.length} lines)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-[var(--bg-primary)]">{['PO', 'Vendor', 'Item', 'Code', 'Ordered', 'Received', 'Balance', 'Status'].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
            <tbody>
              {report.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-color)]">
                  <td className={`py-2 px-2 ${textPri}`}>{r.po_no}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.vendor_name}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.name}</td>
                  <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{r.code || '—'}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.ordered_qty}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.received_qty}</td>
                  <td className={`py-2 px-2 font-medium ${r.balance_qty > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{r.balance_qty}</td>
                  <td className="py-2 px-2"><Badge map={PO_STATUS} value={r.status} /></td>
                </tr>
              ))}
              {report.length === 0 && <tr><td colSpan={8} className={`py-6 text-center ${textMuted}`}>No open PO balances.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Requisitions ─────────────────────────────────────────────────────────── */
function RequisitionsTab({ vendors }) {
  const [list, setList] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [convertFor, setConvertFor] = useState(null); // requisition being converted
  const [convVendor, setConvVendor] = useState('');
  const [convTerms, setConvTerms] = useState('');

  const load = useCallback(() => { procurement.requisitions.getAll().then(r => setList(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditingId(null); setNotes(''); setLines([]); setFormOpen(true); };
  const openEdit = (req) => {
    setEditingId(req.requisition_id);
    setNotes(req.notes || '');
    setLines((req.lines || []).map(l => ({
      item_ref: l.item_ref, name: l.name, code: l.code, image_url: l.image_url,
      uom: l.uom, qty: l.qty, default_rate: l.est_rate,
    })));
    setFormOpen(true);
  };
  const addPicked = (picked) => setLines(prev => [...prev, ...picked]);

  const save = async () => {
    if (lines.length === 0) { toast.error('Add at least one item'); return; }
    const payload = {
      notes,
      lines: lines.map(l => ({ item_ref: l.item_ref, qty: Number(l.qty) || 1, uom: l.uom, name: l.name, code: l.code, est_rate: l.default_rate })),
    };
    try {
      if (editingId) await procurement.requisitions.update(editingId, payload);
      else await procurement.requisitions.create(payload);
      toast.success(editingId ? 'Requisition updated' : 'Requisition created');
      setFormOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };

  const act = async (fn, okMsg) => { try { await fn(); toast.success(okMsg); load(); } catch (e) { toast.error(e?.response?.data?.detail || 'Action failed'); } };

  const doConvert = async () => {
    if (!convVendor) { toast.error('Pick a vendor'); return; }
    try {
      const r = await procurement.requisitions.convertToPo(convertFor.requisition_id, { vendor_id: convVendor, terms: convTerms });
      toast.success(`Purchase Order ${r.data?.po_no} created (draft)`); setConvertFor(null); setConvVendor(''); setConvTerms(''); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Convert failed'); }
  };

  return (
    <div className={`${card} border rounded-md p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-medium ${textPri}`}>Requisitions ({list.length})</h2>
        <Button onClick={openNew} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="new-requisition-btn">
          <Plus className="mr-1 h-3 w-3" /> New Requisition
        </Button>
      </div>

      <div className="space-y-2">
        {list.map(req => (
          <div key={req.requisition_id} className={`${card} border rounded-md p-3`} data-testid={`req-row-${req.requisition_id}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className={`${textPri} font-medium`}>{req.req_no}</span>
                <Badge map={REQ_STATUS} value={req.status} />
                <span className={`text-xs ${textMuted}`}>{req.lines?.length || 0} items · {req.requested_by}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {(req.status === 'draft' || req.status === 'rejected') &&
                  <Button size="sm" variant="outline" onClick={() => openEdit(req)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7" data-testid={`edit-req-${req.requisition_id}`}>Edit</Button>}
                {req.status === 'draft' && <Button size="sm" variant="outline" onClick={() => act(() => procurement.requisitions.submit(req.requisition_id), 'Submitted')} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><Send className="h-3 w-3 mr-1" />Submit</Button>}
                {req.status === 'submitted' && <>
                  <Button size="sm" onClick={() => act(() => procurement.requisitions.approve(req.requisition_id), 'Approved')} className="bg-green-600 hover:bg-green-700 text-white h-7"><Check className="h-3 w-3 mr-1" />Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => procurement.requisitions.reject(req.requisition_id, 'Rejected'), 'Rejected')} className="text-red-400 h-7"><X className="h-3 w-3 mr-1" />Reject</Button>
                </>}
                {req.status === 'approved' && <Button size="sm" onClick={() => { setConvertFor(req); }} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-7" data-testid={`convert-${req.requisition_id}`}>Create PO <ArrowRight className="h-3 w-3 ml-1" /></Button>}
              </div>
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {(req.lines || []).map((l, i) => <Thumb key={i} url={l.image_url} size={28} />)}
            </div>
          </div>
        ))}
        {list.length === 0 && <p className={`text-sm ${textMuted} text-center py-10`}>No requisitions yet.</p>}
      </div>

      {/* New requisition dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>{editingId ? 'Edit Requisition' : 'New Requisition'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="Why is this needed?" /></div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7" data-testid="req-add-items"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
            </div>
            <LineRows lines={lines} setLines={setLines} withRate={false} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={save} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="req-save">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert-to-PO dialog */}
      <Dialog open={!!convertFor} onOpenChange={(o) => { if (!o) setConvertFor(null); }}>
        <DialogContent className={`${dlgCls} max-w-md`}>
          <DialogHeader><DialogTitle className={textPri}>Create Purchase Order</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className={`text-xs ${textMuted}`}>Choose the vendor to raise {convertFor?.req_no} against. Rates auto-fill from the vendor price list.</p>
            <div>
              <Label className={`${textSec} text-xs`}>Vendor *</Label>
              <select value={convVendor} onChange={e => setConvVendor(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`} data-testid="convert-vendor">
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
              </select>
            </div>
            <div><Label className={`${textSec} text-xs`}>Terms</Label><Input value={convTerms} onChange={e => setConvTerms(e.target.value)} className={inputCls} placeholder="e.g. 30 days credit" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertFor(null)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={doConvert} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Create PO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={addPicked} />
    </div>
  );
}

/* ── Purchase Orders / Direct Order Planning ──────────────────────────────── */
function PurchaseOrdersTab({ vendors }) {
  const [list, setList] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [demandOpen, setDemandOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [terms, setTerms] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState([]);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editPo, setEditPo] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [editTerms, setEditTerms] = useState('');
  const [editExpected, setEditExpected] = useState('');
  const [editPickerOpen, setEditPickerOpen] = useState(false);

  const load = useCallback(() => { procurement.purchaseOrders.getAll().then(r => setList(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const { sorted: sortedPos, sort, toggle } = useSorted(list, 'created_at');

  const openNew = () => { setVendorId(''); setTerms(''); setExpected(''); setLines([]); setFormOpen(true); };
  const addPicked = (picked) => setLines(prev => [...prev, ...picked]);

  // live preview totals (server is source of truth; this is just guidance)
  const preview = useMemo(() => {
    const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate ?? l.default_rate) || 0), 0);
    const tax = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate ?? l.default_rate) || 0) * (Number(l.gst_pct) || 0) / 100, 0);
    return { sub, tax, grand: sub + tax };
  }, [lines]);

  const save = async () => {
    if (!vendorId) { toast.error('Select a vendor'); return; }
    if (lines.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      const r = await procurement.purchaseOrders.create({
        vendor_id: vendorId, origin: 'direct', terms, expected_date: expected || null,
        lines: lines.map(l => ({ item_ref: l.item_ref, qty: Number(l.qty) || 1, rate: Number(l.rate ?? l.default_rate) || 0, gst_pct: l.gst_pct, uom: l.uom, name: l.name })),
      });
      toast.success(`Purchase Order ${r.data?.po_no} created`); setFormOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const act = async (fn, okMsg) => { try { await fn(); toast.success(okMsg); load(); if (detail) { const d = await procurement.purchaseOrders.get(detail.po_id); setDetail(d.data); } } catch (e) { toast.error(e?.response?.data?.detail || 'Action failed'); } };

  const openEdit = (po) => {
    setEditPo(po);
    setEditTerms(po.terms || '');
    setEditExpected(po.expected_date ? String(po.expected_date).slice(0, 10) : '');
    setEditLines((po.lines || []).map(l => ({
      item_ref: l.item_ref, name: l.name, code: l.code, image_url: l.image_url,
      uom: l.uom, gst_pct: l.gst_pct, qty: l.qty, rate: l.rate, default_rate: l.rate,
    })));
  };
  const saveEdit = async () => {
    if (editLines.length === 0) { toast.error('Add at least one item'); return; }
    try {
      await procurement.purchaseOrders.update(editPo.po_id, {
        terms: editTerms, expected_date: editExpected || null,
        lines: editLines.map(l => ({ item_ref: l.item_ref, qty: Number(l.qty) || 1, rate: Number(l.rate ?? l.default_rate) || 0, gst_pct: l.gst_pct, uom: l.uom, name: l.name, code: l.code })),
      });
      toast.success('Purchase order updated');
      setEditPo(null);
      const d = await procurement.purchaseOrders.get(detail.po_id); setDetail(d.data);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
  };

  return (
    <div className={`${card} border rounded-md p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-medium ${textPri}`}>Purchase Orders ({list.length})</h2>
        <Button onClick={openNew} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="new-po-btn">
          <Plus className="mr-1 h-3 w-3" /> Direct Order Planning
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)]">
            {[['po_no', 'PO No'], ['vendor_name', 'Vendor'], [null, 'Items'], ['grand_total', 'Total'], ['status', 'Status'], ['created_at', 'Date']].map(([key, label]) => (
              <th key={label} onClick={() => key && toggle(key)} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted} ${key ? 'cursor-pointer select-none' : ''}`}>
                {label}{key && sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}></th>
          </tr></thead>
          <tbody>
            {sortedPos.map(po => (
              <tr key={po.po_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => setDetail(po)} data-testid={`po-row-${po.po_id}`}>
                <td className={`py-2.5 px-3 ${textPri} font-medium`}>{po.po_no}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{po.vendor_name}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{po.lines?.length || 0}</td>
                <td className={`py-2.5 px-3 ${textPri}`}>{inr(po.grand_total)}</td>
                <td className="py-2.5 px-3"><Badge map={PO_STATUS} value={po.status} /></td>
                <td className={`py-2.5 px-3 ${textMuted} text-xs`}>{(po.created_at || '').slice(0, 10)}</td>
                <td className="py-2.5 px-3 text-right"><ArrowRight className="h-4 w-4 inline text-[var(--text-muted)]" /></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className={`py-10 text-center ${textMuted}`}>No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* New PO (Direct Order Planning) dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>Direct Order Planning — New PO</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <Label className={`${textSec} text-xs`}>Vendor *</Label>
                <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`} data-testid="po-vendor">
                  <option value="">Select…</option>
                  {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                </select>
              </div>
              <div><Label className={`${textSec} text-xs`}>Expected Date</Label><Input type="date" value={expected} onChange={e => setExpected(e.target.value)} className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Terms</Label><Input value={terms} onChange={e => setTerms(e.target.value)} className={inputCls} placeholder="30 days" /></div>
            </div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7" data-testid="po-add-items"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
              <Button size="sm" variant="outline" onClick={() => setDemandOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7 ml-2">From Sales Orders</Button>
            </div>
            <LineRows lines={lines} setLines={setLines} withRate />
            {lines.length > 0 && (
              <div className={`${card} border rounded-md p-3 text-sm`}>
                <div className="flex justify-between"><span className={textSec}>Subtotal</span><span className={textPri}>{inr(preview.sub)}</span></div>
                <div className="flex justify-between"><span className={textSec}>GST</span><span className={textPri}>{inr(preview.tax)}</span></div>
                <div className="flex justify-between font-medium mt-1 pt-1 border-t border-[var(--border-color)]"><span className={textPri}>Grand Total</span><span className={textPri}>{inr(preview.grand)}</span></div>
                <p className={`text-[10px] ${textMuted} mt-1`}>Estimate — CGST/SGST vs IGST and final rounding are calculated on save from the vendor’s state.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="po-save">{saving ? 'Saving…' : 'Create PO'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90dvh] overflow-y-auto`}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className={`${textPri} flex items-center gap-3`}>{detail.po_no} <Badge map={PO_STATUS} value={detail.status} />
                  <span className={`text-xs font-normal ${textMuted}`}>{detail.tax_mode === 'intra' ? 'CGST+SGST' : 'IGST'}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <p className={`text-sm ${textSec}`}>Vendor: <span className={textPri}>{detail.vendor_name}</span>{detail.expected_date ? ` · Expected ${String(detail.expected_date).slice(0, 10)}` : ''}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-[var(--bg-primary)]">{['', 'Item', 'Code', 'HSN', 'Qty', 'Recv', 'Rate', 'Taxable', detail.tax_mode === 'intra' ? 'CGST' : 'IGST', detail.tax_mode === 'intra' ? 'SGST' : '', 'Total'].filter(Boolean).map((h, hi) => <th key={`${h}-${hi}`} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {detail.lines.map((l, i) => (
                        <tr key={i} className="border-t border-[var(--border-color)]">
                          <td className="py-2 px-2"><Thumb url={l.image_url} size={32} /></td>
                          <td className={`py-2 px-2 ${textPri}`}>{l.name}</td>
                          <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{l.code || '—'}</td>
                          <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{l.hsn || '—'}</td>
                          <td className={`py-2 px-2 ${textSec}`}>{l.qty} {l.uom}</td>
                          <td className={`py-2 px-2 ${(l.received_qty || 0) >= l.qty ? 'text-emerald-400' : 'text-amber-400'}`}>{l.received_qty || 0}</td>
                          <td className={`py-2 px-2 ${textSec}`}>{inr(l.rate)}</td>
                          <td className={`py-2 px-2 ${textSec}`}>{inr(l.taxable)}</td>
                          {detail.tax_mode === 'intra'
                            ? <><td className={`py-2 px-2 ${textSec}`}>{inr(l.cgst)}</td><td className={`py-2 px-2 ${textSec}`}>{inr(l.sgst)}</td></>
                            : <td className={`py-2 px-2 ${textSec}`}>{inr(l.igst)}</td>}
                          <td className={`py-2 px-2 ${textPri} font-medium`}>{inr(l.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <div className="w-56 text-sm space-y-1">
                    <div className="flex justify-between"><span className={textSec}>Subtotal</span><span className={textPri}>{inr(detail.subtotal)}</span></div>
                    <div className="flex justify-between"><span className={textSec}>Tax</span><span className={textPri}>{inr(detail.tax_total)}</span></div>
                    <div className="flex justify-between font-medium pt-1 border-t border-[var(--border-color)]"><span className={textPri}>Grand Total</span><span className={textPri}>{inr(detail.grand_total)}</span></div>
                  </div>
                </div>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => procurement.purchaseOrders.downloadPdf(detail.po_id, detail.po_no).catch(() => toast.error('Download failed'))} className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="po-pdf"><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
                <Button variant="outline" onClick={() => procurement.purchaseOrders.downloadPackingList(detail.po_id, detail.po_no).catch(() => toast.error('Download failed'))} className="border-[var(--border-color)] text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5 mr-1" />Packing List</Button>
                {detail.status === 'draft' && <Button variant="outline" onClick={() => openEdit(detail)} className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="po-edit">Edit</Button>}
                {detail.status === 'draft' && <Button onClick={() => act(() => procurement.purchaseOrders.approve(detail.po_id), 'PO approved')} className="bg-green-600 hover:bg-green-700 text-white"><Check className="h-3.5 w-3.5 mr-1" />Approve</Button>}
                {detail.status === 'approved' && <Button onClick={() => act(() => procurement.purchaseOrders.send(detail.po_id), 'Marked sent')} className="bg-indigo-600 hover:bg-indigo-700 text-white"><Send className="h-3.5 w-3.5 mr-1" />Mark Sent</Button>}
                {detail.status === 'partially_received' && <Button onClick={() => act(() => procurement.purchaseOrders.close(detail.po_id), 'PO closed')} className="bg-gray-600 hover:bg-gray-700 text-white"><Check className="h-3.5 w-3.5 mr-1" />Close (settle remainder)</Button>}
                {['draft', 'approved', 'sent'].includes(detail.status) && <Button variant="ghost" onClick={() => act(() => procurement.purchaseOrders.cancel(detail.po_id), 'PO cancelled')} className="text-red-400"><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPo} onOpenChange={(o) => { if (!o) setEditPo(null); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>Edit PO {editPo?.po_no}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className={`${textSec} text-xs`}>Expected Date</Label><Input type="date" value={editExpected} onChange={e => setEditExpected(e.target.value)} className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Terms</Label><Input value={editTerms} onChange={e => setEditTerms(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setEditPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
            </div>
            <LineRows lines={editLines} setLines={setEditLines} withRate />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPo(null)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={saveEdit} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ItemPicker open={editPickerOpen} onClose={() => setEditPickerOpen(false)} onConfirm={(p) => setEditLines(prev => [...prev, ...p])} />
      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={addPicked} />
      <DemandPanel open={demandOpen} onClose={() => setDemandOpen(false)} onAdd={(line) => setLines(prev => [...prev, line])} />
    </div>
  );
}
