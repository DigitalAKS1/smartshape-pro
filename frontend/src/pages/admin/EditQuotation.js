import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import API, { quotations, companySettings } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ArrowLeft, Save, Download, Plus, X, Loader2, Clock, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import SendEmailDialog from '../../components/SendEmailDialog';

export default function EditQuotation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quot, setQuot] = useState(null);
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [quotRes, compRes] = await Promise.all([
          API.get(`/quotations`),
          companySettings.get(),
        ]);
        const found = quotRes.data.find(q => q.quotation_id === id);
        if (found) setQuot(found);
        setCompany(compRes.data || {});
      } catch { toast.error('Failed to load quotation'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    API.get(`/quotations/${id}/history`)
      .then(res => setHistory(res.data || []))
      .catch(() => {});
  }, [id]);

  const recalcLine = (line) => {
    const sub = (line.qty || 0) * (line.unit_price || 0);
    const gst = sub * ((line.gst_pct || 18) / 100);
    return { ...line, line_subtotal: sub, line_gst: gst, line_total: sub + gst };
  };

  const updateLine = (idx, field, value) => {
    const lines = [...(quot.lines || [])];
    lines[idx] = { ...lines[idx], [field]: field === 'description' ? value : parseFloat(value) || 0 };
    lines[idx] = recalcLine(lines[idx]);
    setQuot({ ...quot, lines });
  };

  const addLine = () => {
    setQuot({ ...quot, lines: [...(quot.lines || []), recalcLine({ description: '', qty: 1, unit_price: 0, gst_pct: 18, product_type: 'custom' })] });
  };

  const removeLine = (idx) => {
    setQuot({ ...quot, lines: (quot.lines || []).filter((_, i) => i !== idx) });
  };

  // New formula: freight in sub-total, per-line GST rates, combined GST line
  const calcTotals = () => {
    if (!quot) return {};
    const lines       = quot.lines || [];
    const items_total = lines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
    const d1          = quot.discount1_pct || 0;
    const d2          = quot.discount2_pct || 0;
    const fr          = quot.freight_amount || 0;
    const disc1       = items_total * (d1 / 100);
    const after1      = items_total - disc1;
    const disc2       = after1 * (d2 / 100);
    const after_disc  = after1 - disc2;
    const freight_base = Number(fr);
    const sub_total   = after_disc + freight_base;

    const discount_factor = items_total > 0 ? after_disc / items_total : 1;
    const raw_items_gst   = lines.reduce((s, l) => s + (l.line_subtotal || 0) * ((l.gst_pct || 18) / 100), 0);
    const items_gst       = raw_items_gst * discount_factor;
    const freight_gst     = freight_base * 0.18;
    const total_gst       = items_gst + freight_gst;
    const grand_total     = sub_total + total_gst;

    return { items_total, disc1, after1, disc2, after_disc, freight_base, sub_total, items_gst, freight_gst, total_gst, grand_total };
  };

  const doSave = async (status) => {
    const t = calcTotals();
    const isSent = ['sent', 'pending', 'confirmed'].includes(quot.quotation_status);
    await quotations.update(id, {
      ...quot,
      quotation_status: status || quot.quotation_status,
      edit_reason: isSent ? editReason : undefined,
      subtotal: t.items_total,
      disc1_amount: t.disc1, after_disc1: t.after1,
      disc2_amount: t.disc2, after_disc2: t.after_disc,
      subtotal_after_disc: t.after_disc,
      sub_total: t.sub_total,
      items_gst: t.items_gst,
      gst_amount: t.total_gst,
      freight_gst: t.freight_gst,
      freight_with_gst: t.freight_base + t.freight_gst,
      freight_total: t.freight_base + t.freight_gst,
      grand_total: t.grand_total,
    });
  };

  const handleSave = async (status) => {
    const isSent = ['sent', 'pending', 'confirmed'].includes(quot?.quotation_status);
    if (isSent && !editReason.trim()) {
      toast.error('Please provide a reason for editing this sent quotation');
      return;
    }
    try {
      await doSave(status);
      if (status === 'sent') {
        setShowEmailDialog(true);
      } else {
        toast.success('Quotation saved');
        navigate('/quotations');
      }
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleSendEmail = async ({ extraTo, extraCc }) => {
    setSending(true);
    try {
      await API.post(`/quotations/${id}/send-quotation-email`, { extra_to: extraTo, extra_cc: extraCc });
      toast.success('Quotation emailed with PDF attachment!');
      setShowEmailDialog(false);
      navigate('/quotations');
    } catch (err) {
      const detail = err.response?.data?.detail || '';
      if (detail.includes('not configured') || detail.includes('App Password')) {
        toast.warning('Quotation saved. Email not sent — configure Gmail SMTP in Settings → Email.');
        setShowEmailDialog(false);
        navigate('/quotations');
      } else {
        toast.error(detail || 'Email failed — check Settings → Email');
      }
    } finally {
      setSending(false);
    }
  };

  if (loading || !quot) {
    return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;
  }

  const t = calcTotals();
  const isSent = ['sent', 'pending', 'confirmed'].includes(quot.quotation_status);
  const sym = quot.currency_symbol || '₹';
  const fmt = (n) => `${sym} ${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CURRENCIES = ['₹', '$', '€', '£', 'AED', '¥'];

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            {company.logo_url && <img src={company.logo_url} alt="Logo" className="h-10 object-contain" />}
            <div>
              <h1 className="text-2xl font-semibold text-[var(--text-primary)]" data-testid="edit-quotation-title">Edit Quotation</h1>
              <p className="text-sm text-[var(--text-secondary)]">{quot.quote_number} — {quot.school_name}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => navigate('/quotations')} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)]"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button onClick={() => quotations.downloadPdf(id)} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" data-testid="download-pdf-btn"><Download className="mr-2 h-4 w-4" /> PDF</Button>
            <Button onClick={() => handleSave('draft')} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]" data-testid="save-draft-btn"><Save className="mr-2 h-4 w-4" /> Save Draft</Button>
            <Button onClick={() => handleSave('sent')} disabled={sending} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="send-quotation-btn">
              {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Send Quotation'}
            </Button>
          </div>
        </div>

        {/* Edit reason — required when quotation was already sent */}
        {isSent && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-amber-300 font-semibold text-sm">Editing a sent quotation</p>
                <p className="text-amber-400/70 text-xs mt-0.5 mb-3">This quotation has been sent to the customer. Please provide a reason for your changes — it will be saved in the edit history.</p>
                <textarea
                  rows={2}
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="e.g. Customer requested price revision for item 2"
                  className="w-full px-3 py-2 border border-amber-500/30 bg-[var(--bg-primary)] text-[var(--text-primary)] rounded-lg text-sm resize-none focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>
          </div>
        )}

        {/* Customer Info */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide">Customer Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label className="text-[var(--text-secondary)] text-xs">Principal</Label><Input value={quot.principal_name || ''} onChange={(e) => setQuot({...quot, principal_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">School</Label><Input value={quot.school_name || ''} onChange={(e) => setQuot({...quot, school_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Address</Label><Input value={quot.address || ''} onChange={(e) => setQuot({...quot, address: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label className="text-[var(--text-secondary)] text-xs">Phone</Label><Input type="tel" value={quot.customer_phone || ''} onChange={(e) => setQuot({...quot, customer_phone: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Email</Label><Input type="email" value={quot.customer_email || ''} onChange={(e) => setQuot({...quot, customer_email: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
          </div>
        </div>

        {/* Product Lines */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide">Product Lines</h3>
            <Button size="sm" onClick={addLine} className="bg-[#e94560]/10 text-[#e94560] border border-[#e94560]/30" data-testid="add-line-btn"><Plus className="mr-1 h-3 w-3" /> Add Item</Button>
          </div>
          <div className="border border-[var(--border-color)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1a1a2e] text-white">
                  <th className="text-left text-xs py-2.5 px-3 font-semibold">Item</th>
                  <th className="text-center text-xs py-2.5 px-3 font-semibold w-20">Qty</th>
                  <th className="text-right text-xs py-2.5 px-3 font-semibold w-28">Unit Price</th>
                  <th className="text-right text-xs py-2.5 px-3 font-semibold w-24">Subtotal</th>
                  <th className="text-center text-xs py-2.5 px-3 font-semibold w-20">GST %</th>
                  <th className="text-right text-xs py-2.5 px-3 font-semibold w-28">Total (incl. GST)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {(quot.lines || []).map((line, idx) => (
                  <tr key={idx} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="py-2 px-3"><Input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm" /></td>
                    <td className="py-2 px-3"><Input type="number" value={line.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-center" /></td>
                    <td className="py-2 px-3"><Input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-right" /></td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)] text-xs">{formatCurrency(line.line_subtotal)}</td>
                    <td className="py-2 px-3 text-center"><Input type="number" value={line.gst_pct ?? 18} onChange={(e) => updateLine(idx, 'gst_pct', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-center w-12 mx-auto" min="0" max="28" /></td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-primary)] font-semibold">{formatCurrency(line.line_total)}</td>
                    <td className="py-2 px-1"><button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-300"><X className="h-3 w-3" /></button></td>
                  </tr>
                ))}
                {(quot.lines || []).length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-[var(--text-muted)]">No items — click Add Item</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pricing inputs + Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Discounts, Freight, Currency */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide">Discounts & Freight</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[var(--text-muted)] text-xs">Primary Discount (%)</Label>
                <Input type="number" value={quot.discount1_pct || 0} onChange={(e) => setQuot({...quot, discount1_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mt-1" /></div>
              <div><Label className="text-[var(--text-muted)] text-xs">Additional Discount (%)</Label>
                <Input type="number" value={quot.discount2_pct || 0} onChange={(e) => setQuot({...quot, discount2_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mt-1" /></div>
            </div>
            <div>
              <Label className="text-[var(--text-muted)] text-xs">Freight (base, excl. GST)</Label>
              <Input type="number" value={quot.freight_amount || 0} onChange={(e) => setQuot({...quot, freight_amount: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mt-1" />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Freight appears in Sub Total. GST @ 18% added to combined GST line.</p>
            </div>
            <div>
              <Label className="text-[var(--text-muted)] text-xs">Currency Symbol</Label>
              <div className="flex gap-2 flex-wrap mt-1">
                {CURRENCIES.map(s => (
                  <button key={s} type="button"
                    onClick={() => setQuot({...quot, currency_symbol: s})}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${sym === s ? 'bg-[#e94560] text-white border-[#e94560]' : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#e94560]/40'}`}>
                    {s}
                  </button>
                ))}
                <Input
                  value={CURRENCIES.includes(sym) ? '' : sym}
                  onChange={e => setQuot({...quot, currency_symbol: e.target.value || '₹'})}
                  placeholder="Other"
                  className="h-9 w-20 text-sm text-center bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                />
              </div>
            </div>
          </div>

          {/* Right: Price Summary */}
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide mb-4">Price Summary</h3>
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Item Total</span>
                <span className="font-mono text-[var(--text-primary)] font-semibold">{fmt(t.items_total)}</span>
              </div>
              {(quot.discount1_pct || 0) > 0 && (
                <div className="flex justify-between text-sm text-green-400">
                  <span>Discount ({quot.discount1_pct}%)</span>
                  <span className="font-mono">− {fmt(t.disc1)}</span>
                </div>
              )}
              {(quot.discount2_pct || 0) > 0 && (
                <div className="flex justify-between text-sm text-green-400">
                  <span>Additional Discount ({quot.discount2_pct}%)</span>
                  <span className="font-mono">− {fmt(t.disc2)}</span>
                </div>
              )}
              {(quot.freight_amount || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">Freight</span>
                  <span className="font-mono text-[var(--text-secondary)]">+ {fmt(t.freight_base)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold border-t border-b border-[var(--border-color)] py-2">
                <span className="text-[var(--text-primary)]">Sub Total</span>
                <span className="font-mono text-[var(--text-primary)]">{fmt(t.sub_total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">GST</span>
                <span className="font-mono text-[var(--text-secondary)]">{fmt(t.total_gst)}</span>
              </div>
              <div className="flex justify-between text-xl font-bold border-t-2 border-[#e94560] pt-3 mt-1">
                <span className="text-[var(--text-primary)]">Total Payable</span>
                <span className="font-mono text-[#e94560]">{fmt(t.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Edit History */}
        {history.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#e94560]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">Edit History</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560] font-medium">{history.length}</span>
              </div>
              {showHistory ? <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />}
            </button>
            {showHistory && (
              <div className="divide-y divide-[var(--border-color)]">
                {history.map((h, i) => (
                  <div key={h.history_id || i} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{h.edited_by_name || h.edited_by}</span>
                      <span className="text-xs text-[var(--text-muted)]">{new Date(h.edited_at).toLocaleString('en-IN')}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      <span className="font-medium text-amber-400">Reason:</span> {h.edit_reason}
                    </p>
                    {h.previous_snapshot && (
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">
                        Previous total: {sym} {(h.previous_snapshot.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <SendEmailDialog
        open={showEmailDialog}
        onClose={() => { setShowEmailDialog(false); navigate('/quotations'); }}
        onSend={handleSendEmail}
        title="Send Quotation"
        defaultTo={quot?.customer_email || ''}
        defaultCc={quot?.sales_person_email || ''}
        sending={sending}
      />
    </AdminLayout>
  );
}
