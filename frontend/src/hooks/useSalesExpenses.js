import { useState, useEffect, useRef } from 'react';
import { expenses as expensesApi, visits as visitsApi } from '../lib/api';
import { toast } from 'sonner';

const KM_RATES = { two_wheeler: 5, four_wheeler: 10 };

export const isKmBased = (category) =>
  category === 'two_wheeler' || category === 'four_wheeler';

export const defaultForm = () => ({
  expense_type: 'travel',
  date: new Date().toISOString().split('T')[0],
  category: 'cab',
  from_location: '',
  from_lat: null,
  from_lng: null,
  to_location: '',
  to_lat: null,
  to_lng: null,
  distance_km: '',
  amount: '',
  description: '',
  notes: '',
  receipt_base64: null,
  receipt_filename: null,
});

export function useSalesExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [visits, setVisits] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [receiptPreview, setReceiptPreview] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { fetchData(); }, [currentMonth]); // eslint-disable-line

  const fetchData = async () => {
    try {
      const [expRes, visitsRes] = await Promise.all([
        expensesApi.getAll(currentMonth),
        visitsApi.getAll(),
      ]);
      setExpenses(expRes.data);
      setVisits(visitsRes.data.filter(v => v.status === 'visited'));
    } catch (err) {
      console.error(err);
    }
  };

  const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const handleSelectVisit = (field, visit) => {
    const next = { ...form };
    next[`${field}_location`] = visit.school_name;
    next[`${field}_lat`] = visit.visited_lat || visit.planned_lat;
    next[`${field}_lng`] = visit.visited_lng || visit.planned_lng;
    if (next.from_lat && next.from_lng && next.to_lat && next.to_lng) {
      next.distance_km = String(
        Math.round(
          haversineDistance(next.from_lat, next.from_lng, next.to_lat, next.to_lng) * 10
        ) / 10
      );
    }
    setForm(next);
  };

  const handleReceiptUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast.error('File too large. Max 3 MB.'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm(f => ({ ...f, receipt_base64: ev.target.result, receipt_filename: file.name }));
      setReceiptPreview(file.type.startsWith('image/') ? ev.target.result : null);
    };
    reader.readAsDataURL(file);
  };

  const clearReceipt = () => {
    setForm(f => ({ ...f, receipt_base64: null, receipt_filename: null }));
    setReceiptPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const calcAmount = () => {
    if (form.expense_type === 'travel' && isKmBased(form.category)) {
      return (parseFloat(form.distance_km) || 0) * KM_RATES[form.category];
    }
    return parseFloat(form.amount) || 0;
  };

  const handleTypeChange = (type) => {
    setForm({
      ...defaultForm(),
      expense_type: type,
      date: form.date,
      category: type === 'travel' ? 'cab' : type === 'food' ? 'lunch' : '',
    });
    setReceiptPreview(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = calcAmount();
    if (amt <= 0) { toast.error('Amount must be greater than 0'); return; }
    try {
      await expensesApi.create({
        ...form,
        distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
        amount: amt,
        transport_mode: form.expense_type === 'travel' ? form.category : null,
      });
      toast.success('Expense added!');
      setDialogOpen(false);
      setForm(defaultForm());
      setReceiptPreview(null);
      fetchData();
    } catch {
      toast.error('Failed to add expense');
    }
  };

  const monthlyStats = {
    total_km: expenses
      .filter(e => isKmBased(e.transport_mode || e.category))
      .reduce((s, e) => s + (e.distance_km || 0), 0),
    total_amount: expenses.reduce((s, e) => s + e.amount, 0),
    pending_amount: expenses
      .filter(e => e.status === 'pending')
      .reduce((s, e) => s + e.amount, 0),
  };

  return {
    expenses, visits, currentMonth, setCurrentMonth,
    dialogOpen, setDialogOpen,
    form, setForm,
    receiptPreview, fileInputRef,
    monthlyStats,
    handleSelectVisit,
    handleReceiptUpload,
    clearReceipt,
    calcAmount,
    handleTypeChange,
    handleSubmit,
    KM_RATES,
  };
}
