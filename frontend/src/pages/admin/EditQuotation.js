import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import API, { quotations, companySettings } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ArrowLeft, Save, Download, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

export default function EditQuotation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quot, setQuot] = useState(null);
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(true);

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

  const calcTotals = () => {
    if (!quot) return {};
    const lines = quot.lines || [];
    const subtotal = lines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
    const gst_amount = lines.reduce((s, l) => s + (l.line_gst || 0), 0);
    const total_with_gst = subtotal + gst_amount;
    const d1 = quot.discount1_pct || 0;
    const d2 = quot.discount2_pct || 0;
    const fr = quot.freight_amount || 0;
    const disc1 = total_with_gst * (d1 / 100);
    const after1 = total_with_gst - disc1;
    const disc2 = after1 * (d2 / 100);
    const after2 = after1 - disc2;
    const freight_total = fr * 1.18;
    return { subtotal, gst_amount, total_with_gst, disc1, after1, disc2, after2, freight_total, grand_total: after2 + freight_total };
  };

  const handleSave = async (status) => {
    try {
      const t = calcTotals();
      await quotations.update(id, {
        ...quot,
        quotation_status: status || quot.quotation_status,
        subtotal: t.subtotal, gst_amount: t.gst_amount, total_with_gst: t.total_with_gst,
        disc1_amount: t.disc1, after_disc1: t.after1, disc2_amount: t.disc2, after_disc2: t.after2,
        freight_total: t.freight_total, grand_total: t.grand_total,
      });
      toast.success(status === 'sent' ? 'Quotation sent!' : 'Quotation saved');
      navigate('/quotations');
    } catch { toast.error('Failed to save'); }
  };

  if (loading || !quot) {
    return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;
  }

  const t = calcTotals();

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {company.logo_url && <img src={company.logo_url} alt="Logo" className="h-10 object-contain" />}
            <div>
              <h1 className="text-3xl font-semibold text-[var(--text-primary)]" data-testid="edit-quotation-title">Edit Quotation</h1>
              <p className="text-sm text-[var(--text-secondary)]">{quot.quote_number} — {quot.school_name}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/quotations')} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)]"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <Button onClick={() => quotations.downloadPdf(id)} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" data-testid="download-pdf-btn"><Download className="mr-2 h-4 w-4" /> PDF</Button>
            <Button onClick={() => handleSave('draft')} variant="outline" className="border-[var(--border-color)] text-[var(--text-primary)]" data-testid="save-draft-btn"><Save className="mr-2 h-4 w-4" /> Save Draft</Button>
            <Button onClick={() => handleSave('sent')} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="send-quotation-btn">Send Quotation</Button>
          </div>
        </div>

        {/* Customer Info */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label className="text-[var(--text-secondary)] text-xs">Principal</Label><Input value={quot.principal_name || ''} onChange={(e) => setQuot({...quot, principal_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">School</Label><Input value={quot.school_name || ''} onChange={(e) => setQuot({...quot, school_name: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Address</Label><Input value={quot.address || ''} onChange={(e) => setQuot({...quot, address: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
          </div>
        </div>

        {/* Product Lines */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Product Lines</h3>
            <Button size="sm" onClick={addLine} className="bg-[#e94560]/10 text-[#e94560] border border-[#e94560]/30" data-testid="add-line-btn"><Plus className="mr-1 h-3 w-3" /> Add Item</Button>
          </div>
          <div className="border border-[var(--border-color)] rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-[var(--bg-primary)]">
                <th className="text-left text-xs text-[var(--text-muted)] py-2 px-3">Item</th>
                <th className="text-center text-xs text-[var(--text-muted)] py-2 px-3 w-20">Qty</th>
                <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 w-24">Unit Price</th>
                <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 w-24">Subtotal</th>
                <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 w-20">GST</th>
                <th className="text-right text-xs text-[var(--text-muted)] py-2 px-3 w-24">Total</th>
                <th className="w-8"></th>
              </tr></thead>
              <tbody>
                {(quot.lines || []).map((line, idx) => (
                  <tr key={idx} className="border-t border-[var(--border-color)]">
                    <td className="py-2 px-3"><Input value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm" /></td>
                    <td className="py-2 px-3"><Input type="number" value={line.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-center" /></td>
                    <td className="py-2 px-3"><Input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', e.target.value)} className="bg-transparent border-none text-[var(--text-primary)] h-7 p-0 text-sm text-right" /></td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-primary)]">{formatCurrency(line.line_subtotal)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-secondary)]">{formatCurrency(line.line_gst)}</td>
                    <td className="py-2 px-3 text-right font-mono text-[var(--text-primary)] font-medium">{formatCurrency(line.line_total)}</td>
                    <td className="py-2 px-1"><button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-300"><X className="h-3 w-3" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pricing */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-5 space-y-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide">Discounts & Freight</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[var(--text-muted)] text-xs">Primary Discount (%)</Label><Input type="number" value={quot.discount1_pct || 0} onChange={(e) => setQuot({...quot, discount1_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
              <div><Label className="text-[var(--text-muted)] text-xs">Addl. Discount (%)</Label><Input type="number" value={quot.discount2_pct || 0} onChange={(e) => setQuot({...quot, discount2_pct: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /><p className="text-[10px] text-[var(--text-muted)] mt-1">Applied after primary</p></div>
            </div>
            <div><Label className="text-[var(--text-muted)] text-xs">Freight (excl. GST)</Label><Input type="number" value={quot.freight_amount || 0} onChange={(e) => setQuot({...quot, freight_amount: parseFloat(e.target.value) || 0})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" /></div>
          </div>

          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-5 space-y-2">
            <h3 className="text-sm font-medium text-[var(--text-primary)] uppercase tracking-wide mb-3">Price Summary</h3>
            <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Items Subtotal</span><span className="font-mono text-[var(--text-primary)]">{formatCurrency(t.subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">GST</span><span className="font-mono text-[var(--text-secondary)]">{formatCurrency(t.gst_amount)}</span></div>
            <div className="flex justify-between text-sm border-t border-[var(--border-color)] pt-1"><span className="text-[var(--text-primary)]">Total (incl GST)</span><span className="font-mono text-[var(--text-primary)]">{formatCurrency(t.total_with_gst)}</span></div>
            {(quot.discount1_pct || 0) > 0 && <div className="flex justify-between text-sm text-green-400"><span>Disc 1 ({quot.discount1_pct}%)</span><span className="font-mono">-{formatCurrency(t.disc1)}</span></div>}
            {(quot.discount2_pct || 0) > 0 && <div className="flex justify-between text-sm text-green-400"><span>Disc 2 ({quot.discount2_pct}%)</span><span className="font-mono">-{formatCurrency(t.disc2)}</span></div>}
            {(quot.freight_amount || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">Freight + GST</span><span className="font-mono text-[var(--text-secondary)]">{formatCurrency(t.freight_total)}</span></div>}
            <div className="flex justify-between text-xl font-bold border-t-2 border-[#e94560] pt-3 mt-2">
              <span className="text-[var(--text-primary)]">Total Payable</span><span className="font-mono text-[#e94560]">{formatCurrency(t.grand_total)}</span>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
