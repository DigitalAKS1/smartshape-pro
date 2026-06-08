import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { PackageCheck, ImageOff, Download, RotateCcw, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';
const imgSrc = (u) => (u ? (u.startsWith('http') ? u : `${BACKEND}${u}`) : '');
const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

const QC_REASONS = ['', 'Looks good', 'Minor damage', 'Wrong specification', 'Short quantity',
  'Damaged in transit', 'Quality not as per sample', 'Other'];
const QC_STATUS = {
  pending: 'bg-gray-500/15 text-gray-300', ok: 'bg-green-500/15 text-green-400',
  hold: 'bg-amber-500/15 text-amber-300', return: 'bg-red-500/15 text-red-400',
};
const GRN_STATUS = { pending_qc: 'bg-amber-500/15 text-amber-300', qc_done: 'bg-green-500/15 text-green-400' };

function Thumb({ url, size = 36 }) {
  if (!url) return <div className="flex items-center justify-center rounded bg-[var(--bg-primary)] border border-[var(--border-color)]" style={{ width: size, height: size }}><ImageOff className="h-4 w-4 text-[var(--text-muted)]" /></div>;
  return <img src={imgSrc(url)} alt="" className="rounded object-cover border border-[var(--border-color)]" style={{ width: size, height: size }} />;
}
function Pill({ map, value }) {
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${map[value] || 'bg-gray-500/15 text-gray-300'}`}>{(value || '').replace('_', ' ')}</span>;
}

/* ── Receiving & QC tab ───────────────────────────────────────────────────── */
export function ReceivingTab() {
  const [pos, setPos] = useState([]);
  const [grns, setGrns] = useState([]);
  const [qcGrn, setQcGrn] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      procurement.purchaseOrders.getAll(),
      procurement.goodsReceipts.getAll(),
    ]).then(([poR, grnR]) => {
      setPos((poR.data || []).filter(p => ['approved', 'sent', 'partially_received'].includes(p.status)));
      setGrns(grnR.data || []);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const startReceive = async (po) => {
    try {
      const r = await procurement.purchaseOrders.receive(po.po_id);
      toast.success(`Receipt ${r.data?.grn_no} opened`);
      load(); setQcGrn(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not open receipt'); }
  };
  const openGrn = async (grn) => { try { const r = await procurement.goodsReceipts.get(grn.grn_id); setQcGrn(r.data); } catch { /* noop */ } };

  return (
    <div className="space-y-4">
      {/* POs awaiting receipt */}
      <div className={`${card} border rounded-md p-5`}>
        <h2 className={`text-lg font-medium ${textPri} mb-3`}>Awaiting Receipt ({pos.length})</h2>
        <div className="space-y-2">
          {pos.map(po => (
            <div key={po.po_id} className={`${card} border rounded-md p-3 flex items-center justify-between flex-wrap gap-2`}>
              <div className="flex items-center gap-3">
                <span className={`${textPri} font-medium`}>{po.po_no}</span>
                <span className={`text-xs ${textMuted}`}>{po.vendor_name} · {po.lines?.length || 0} items</span>
              </div>
              <Button size="sm" onClick={() => startReceive(po)} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-7" data-testid={`receive-${po.po_id}`}>
                <PackageCheck className="h-3.5 w-3.5 mr-1" />Receive & Verify
              </Button>
            </div>
          ))}
          {pos.length === 0 && <p className={`text-sm ${textMuted} text-center py-6`}>No approved/sent POs awaiting receipt.</p>}
        </div>
      </div>

      {/* Goods receipts */}
      <div className={`${card} border rounded-md p-5`}>
        <h2 className={`text-lg font-medium ${textPri} mb-3`}>Goods Receipts ({grns.length})</h2>
        <div className="space-y-2">
          {(() => {
            const sortedGrns = [...grns].sort((a, b) => String(b.received_date || b.created_at || '').localeCompare(String(a.received_date || a.created_at || '')));
            return sortedGrns.map(grn => (
            <div key={grn.grn_id} className={`${card} border rounded-md p-3 flex items-center justify-between flex-wrap gap-2 cursor-pointer hover:bg-[var(--bg-hover)]`} onClick={() => openGrn(grn)} data-testid={`grn-row-${grn.grn_id}`}>
              <div className="flex items-center gap-3">
                <span className={`${textPri} font-medium`}>{grn.grn_no}</span>
                <Pill map={GRN_STATUS} value={grn.status} />
                <span className={`text-xs ${textMuted}`}>{grn.po_no} · {grn.vendor_name} · {grn.received_date || ''}</span>
              </div>
              <span className={`text-xs ${textSec}`}>{grn.status === 'pending_qc' ? 'Open QC →' : 'View'}</span>
            </div>
          ));
          })()}
          {grns.length === 0 && <p className={`text-sm ${textMuted} text-center py-6`}>No goods receipts yet.</p>}
        </div>
      </div>

      <QCDialog grn={qcGrn} onClose={() => setQcGrn(null)} onChanged={load} />
    </div>
  );
}

/* ── QC checklist dialog (the bulk verification table) ────────────────────── */
function QCDialog({ grn, onClose, onChanged }) {
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const done = grn?.status === 'qc_done';
  const hasReturns = (grn?.lines || []).some(l => l.qc_status === 'return');
  const [recvDate, setRecvDate] = useState('');
  useEffect(() => { setRecvDate(grn?.received_date || ''); }, [grn]);

  useEffect(() => {
    setLines((grn?.lines || []).map(l => ({
      po_line_index: l.po_line_index, name: l.name, image_url: l.image_url,
      ordered_qty: l.ordered_qty, received_qty: l.received_qty,
      qc_status: l.qc_status === 'pending' ? 'ok' : l.qc_status, remark: l.remark || '',
    })));
  }, [grn]);

  const upd = (i, patch) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  const submit = async () => {
    setSaving(true);
    try {
      if (!done && recvDate && recvDate !== grn.received_date) {
        await procurement.goodsReceipts.update(grn.grn_id, { received_date: recvDate, lines: [] });
      }
      const r = await procurement.goodsReceipts.submitQc(grn.grn_id, {
        lines: lines.map(l => ({ po_line_index: l.po_line_index, qc_status: l.qc_status, received_qty: Number(l.received_qty) || 0, remark: l.remark })),
      });
      const stocked = r.data.lines.filter(l => l.qc_status === 'ok').length;
      const ret = r.data.lines.filter(l => l.qc_status === 'return').length;
      toast.success(`QC done — ${stocked} stocked in${ret ? `, ${ret} for return` : ''}`);
      onChanged();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'QC submit failed'); }
    finally { setSaving(false); }
  };

  const makeReturn = async () => {
    try {
      const r = await procurement.goodsReceipts.createReturn(grn.grn_id);
      toast.success(`Return note ${r.data?.return_no} created`);
      if (r.data?.return_id) {
        await procurement.vendorReturns.downloadPdf(r.data.return_id, r.data.return_no).catch(() => toast.error('Return saved — PDF download failed'));
      }
      onChanged();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not create return'); }
  };

  return (
    <Dialog open={!!grn} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-4xl max-h-[90dvh] overflow-y-auto`}>
        {grn && (
          <>
            <DialogHeader>
              <DialogTitle className={`${textPri} flex items-center gap-3`}>
                <ClipboardCheck className="h-5 w-5" /> {grn.grn_no} <Pill map={GRN_STATUS} value={grn.status} />
                <span className={`text-xs font-normal ${textMuted}`}>{grn.po_no} · {grn.vendor_name}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs ${textMuted}`}>Receiving date</span>
              {done ? <span className={`text-sm ${textSec}`}>{recvDate || '—'}</span> :
                <Input type="date" value={recvDate} onChange={e => setRecvDate(e.target.value)} className={`${inputCls} h-8 w-44 text-sm`} />}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">
                  {['', 'Item', 'Ordered', 'Received', 'QC Status', 'Remark'].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-[var(--border-color)]" data-testid={`qc-line-${i}`}>
                      <td className="py-2 px-2"><Thumb url={l.image_url} /></td>
                      <td className={`py-2 px-2 ${textPri} font-medium`}>{l.name}</td>
                      <td className={`py-2 px-2 ${textSec}`}>{l.ordered_qty}</td>
                      <td className="py-2 px-2">
                        {done ? <span className={textSec}>{l.received_qty}</span> :
                          <Input type="number" min="0" value={l.received_qty} onChange={e => upd(i, { received_qty: e.target.value })} className={`${inputCls} h-8 w-20 text-sm`} />}
                      </td>
                      <td className="py-2 px-2">
                        {done ? <Pill map={QC_STATUS} value={l.qc_status} /> :
                          <select value={l.qc_status} onChange={e => upd(i, { qc_status: e.target.value })} className={`h-8 px-2 rounded text-sm ${inputCls}`} data-testid={`qc-status-${i}`}>
                            <option value="ok">OK</option>
                            <option value="hold">Hold</option>
                            <option value="return">Return</option>
                          </select>}
                      </td>
                      <td className="py-2 px-2">
                        {done ? <span className={textSec}>{l.remark || '—'}</span> :
                          <select value={QC_REASONS.includes(l.remark) ? l.remark : 'Other'} onChange={e => upd(i, { remark: e.target.value })} className={`h-8 px-2 rounded text-sm ${inputCls} w-44`} data-testid={`qc-remark-${i}`}>
                            {QC_REASONS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                          </select>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!done && <p className={`text-xs ${textMuted} mt-2`}>OK → stocked into inventory · Hold → kept aside · Return → kept aside &amp; eligible for a vendor return note.</p>}

            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={onClose} className="border-[var(--border-color)] text-[var(--text-secondary)]">Close</Button>
              {!done && <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="qc-submit">{saving ? 'Saving…' : 'Submit QC'}</Button>}
              {done && hasReturns && <Button onClick={makeReturn} className="bg-red-600 hover:bg-red-700 text-white" data-testid="qc-create-return"><RotateCcw className="h-3.5 w-3.5 mr-1" />Create Return Note</Button>}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Returns tab ──────────────────────────────────────────────────────────── */
export function ReturnsTab() {
  const [list, setList] = useState([]);
  useEffect(() => { procurement.vendorReturns.getAll().then(r => setList(r.data || [])).catch(() => {}); }, []);
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  return (
    <div className={`${card} border rounded-md p-5`}>
      <h2 className={`text-lg font-medium ${textPri} mb-3`}>Vendor Returns / Debit Notes ({list.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)]">{['Return No', 'Vendor', 'Ref GRN', 'Items', 'Total', ''].map(h => <th key={h} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.return_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                <td className={`py-2.5 px-3 ${textPri} font-medium`}>{r.return_no}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{r.vendor_name}</td>
                <td className={`py-2.5 px-3 ${textMuted} font-mono text-xs`}>{r.grn_no}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{r.lines?.length || 0}</td>
                <td className={`py-2.5 px-3 ${textPri}`}>{inr(r.grand_total)}</td>
                <td className="py-2.5 px-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => procurement.vendorReturns.downloadPdf(r.return_id, r.return_no).catch(() => toast.error('Download failed'))} className={`${textSec} h-7`}><Download className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className={`py-10 text-center ${textMuted}`}>No returns yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
