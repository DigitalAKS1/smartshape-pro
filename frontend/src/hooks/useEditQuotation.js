import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API, { quotations, companySettings } from '../lib/api';
import { toast } from 'sonner';

export function useEditQuotation() {
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
      } catch {
        toast.error('Failed to load quotation');
      } finally {
        setLoading(false);
      }
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
    lines[idx] = {
      ...lines[idx],
      [field]: field === 'description' ? value : parseFloat(value) || 0,
    };
    lines[idx] = recalcLine(lines[idx]);
    setQuot({ ...quot, lines });
  };

  const addLine = () => {
    setQuot({
      ...quot,
      lines: [
        ...(quot.lines || []),
        recalcLine({ description: '', qty: 1, unit_price: 0, gst_pct: 18, product_type: 'custom' }),
      ],
    });
  };

  const removeLine = (idx) => {
    setQuot({ ...quot, lines: (quot.lines || []).filter((_, i) => i !== idx) });
  };

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

  const isSent = ['sent', 'pending', 'confirmed'].includes(quot?.quotation_status);

  return {
    id, quot, setQuot, company,
    loading, sending,
    showEmailDialog, setShowEmailDialog,
    editReason, setEditReason,
    history, showHistory, setShowHistory,
    isSent,
    updateLine, addLine, removeLine,
    calcTotals,
    handleSave, handleSendEmail,
    navigate,
    quotations,
  };
}
