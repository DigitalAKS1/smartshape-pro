import React, { useState, useEffect, useRef } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { expenses as expensesApi, visits as visitsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Plus, ArrowRight, Upload, FileText, Car, Utensils, ReceiptText } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

const KM_RATES = { two_wheeler: 5, four_wheeler: 10 };

const TRAVEL_CATEGORIES = [
  { value: 'cab', label: 'Cab', icon: '🚕' },
  { value: 'auto', label: 'Auto', icon: '🛺' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'train', label: 'Train', icon: '🚂' },
  { value: 'two_wheeler', label: 'Two Wheeler', icon: '🏍️' },
  { value: 'four_wheeler', label: 'Four Wheeler', icon: '🚗' },
];

const FOOD_CATEGORIES = [
  { value: 'breakfast', label: 'Breakfast', icon: '🌅' },
  { value: 'lunch', label: 'Lunch', icon: '🍱' },
  { value: 'dinner', label: 'Dinner', icon: '🌙' },
  { value: 'tea_snacks', label: 'Tea & Snacks', icon: '☕' },
];

const EXPENSE_TYPES = [
  { value: 'travel', label: 'Travel', Icon: Car },
  { value: 'food', label: 'Food', Icon: Utensils },
  { value: 'other', label: 'Other', Icon: ReceiptText },
];

const isKmBased = (category) => category === 'two_wheeler' || category === 'four_wheeler';

const defaultForm = () => ({
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

export default function SalesExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [visits, setVisits] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7));
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
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const handleSelectVisit = (field, visit) => {
    const next = { ...form };
    next[`${field}_location`] = visit.school_name;
    next[`${field}_lat`] = visit.visited_lat || visit.planned_lat;
    next[`${field}_lng`] = visit.visited_lng || visit.planned_lng;
    if (next.from_lat && next.from_lng && next.to_lat && next.to_lng) {
      next.distance_km = String(Math.round(haversineDistance(next.from_lat, next.from_lng, next.to_lat, next.to_lng) * 10) / 10);
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
    } catch (err) {
      toast.error('Failed to add expense');
    }
  };

  const monthlyStats = {
    total_km: expenses.filter(e => isKmBased(e.transport_mode || e.category)).reduce((s, e) => s + (e.distance_km || 0), 0),
    total_amount: expenses.reduce((s, e) => s + e.amount, 0),
    pending_amount: expenses.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0),
  };

  const expenseIcon = (expense) => {
    if (expense.expense_type === 'food') {
      const icons = { breakfast: '🌅', lunch: '🍱', dinner: '🌙', tea_snacks: '☕' };
      return icons[expense.category] || '🍽️';
    }
    if (expense.expense_type === 'other') return '📋';
    const icons = { cab: '🚕', auto: '🛺', bus: '🚌', train: '🚂', two_wheeler: '🏍️', four_wheeler: '🚗' };
    return icons[expense.transport_mode || expense.category] || '🚗';
  };

  const expenseLabel = (expense) => {
    if (expense.expense_type === 'food') {
      const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', tea_snacks: 'Tea & Snacks' };
      return labels[expense.category] || expense.category;
    }
    if (expense.expense_type === 'other') return expense.description || 'Other';
    const labels = { cab: 'Cab', auto: 'Auto', bus: 'Bus', train: 'Train', two_wheeler: 'Two Wheeler', four_wheeler: 'Four Wheeler' };
    return labels[expense.transport_mode || expense.category] || (expense.transport_mode || expense.category);
  };

  return (
    <SalesLayout title="Expenses" showBack>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="expenses-title">Expenses</h1>
            <p className="text-[var(--text-secondary)] mt-1">Log your daily expenses</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="log-trip-button">
                <Plus className="mr-2 h-4 w-4" /> Add Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--text-primary)]">Add Expense</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Expense Type Tabs */}
                <div className="grid grid-cols-3 gap-2">
                  {EXPENSE_TYPES.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleTypeChange(value)}
                      className={`flex flex-col items-center py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                        form.expense_type === value
                          ? 'bg-[#e94560] border-[#e94560] text-white'
                          : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Icon className="h-4 w-4 mb-1" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Date */}
                <div>
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    required
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                  />
                </div>

                {/* ── Travel Form ── */}
                {form.expense_type === 'travel' && (<>
                  <div>
                    <Label>Transport Type</Label>
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      {TRAVEL_CATEGORIES.map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setForm({ ...form, category: c.value, distance_km: '', amount: '' })}
                          className={`py-1.5 px-2 rounded border text-xs font-medium transition-colors ${
                            form.category === c.value
                              ? 'bg-[#e94560] border-[#e94560] text-white'
                              : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {c.icon} {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-[#10b981]">From Location</Label>
                    <Input
                      value={form.from_location}
                      onChange={e => setForm({ ...form, from_location: e.target.value })}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2"
                      placeholder="Enter address"
                    />
                    <select
                      onChange={e => e.target.value && handleSelectVisit('from', visits.find(v => v.visit_id === e.target.value))}
                      className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md"
                    >
                      <option value="">Or pick from recent visits</option>
                      {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
                    </select>
                  </div>

                  <div>
                    <Label className="text-[#ef4444]">To Location</Label>
                    <Input
                      value={form.to_location}
                      onChange={e => setForm({ ...form, to_location: e.target.value })}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2"
                      placeholder="Enter address"
                    />
                    <select
                      onChange={e => e.target.value && handleSelectVisit('to', visits.find(v => v.visit_id === e.target.value))}
                      className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md"
                    >
                      <option value="">Or pick from recent visits</option>
                      {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
                    </select>
                  </div>

                  {isKmBased(form.category) ? (
                    <div>
                      <Label>Distance (KM)</Label>
                      <Input
                        type="number" step="0.1" min="0"
                        value={form.distance_km}
                        onChange={e => setForm({ ...form, distance_km: e.target.value })}
                        required
                        className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                      />
                      <p className="text-xs text-[var(--text-muted)] mt-1">₹{KM_RATES[form.category]}/km</p>
                    </div>
                  ) : (
                    <div>
                      <Label>Amount (₹)</Label>
                      <Input
                        type="number" step="1" min="0"
                        value={form.amount}
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        required
                        placeholder="Enter fare paid"
                        className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                      />
                    </div>
                  )}
                </>)}

                {/* ── Food Form ── */}
                {form.expense_type === 'food' && (<>
                  <div>
                    <Label>Meal Type</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {FOOD_CATEGORIES.map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setForm({ ...form, category: c.value })}
                          className={`py-2 px-3 rounded border text-sm font-medium transition-colors ${
                            form.category === c.value
                              ? 'bg-[#e94560] border-[#e94560] text-white'
                              : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {c.icon} {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number" step="1" min="0"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      required
                      placeholder="Enter amount"
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    />
                  </div>
                </>)}

                {/* ── Other Form ── */}
                {form.expense_type === 'other' && (<>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      required
                      placeholder="What was this expense for?"
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number" step="1" min="0"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      required
                      placeholder="Enter amount"
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    />
                  </div>
                </>)}

                {/* Notes (all types) */}
                <div>
                  <Label>Notes (optional)</Label>
                  <Input
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Any additional notes..."
                    className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                  />
                </div>

                {/* Amount Summary */}
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 flex justify-between items-center">
                  <span className="text-[var(--text-secondary)] text-sm">Total Amount</span>
                  <span className="text-xl font-mono font-bold text-[#e94560]">{formatCurrency(calcAmount())}</span>
                </div>

                {/* Receipt Upload */}
                <div>
                  <Label>Receipt / Bill</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleReceiptUpload}
                    className="hidden"
                  />
                  {!form.receipt_filename ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1 w-full flex flex-col items-center justify-center py-5 border-2 border-dashed border-[var(--border-color)] rounded-md text-[var(--text-secondary)] hover:border-[#e94560] hover:text-[#e94560] transition-colors"
                    >
                      <Upload className="h-6 w-6 mb-1" />
                      <span className="text-sm font-medium">Click to upload receipt / bill</span>
                      <span className="text-xs mt-0.5 text-[var(--text-muted)]">Photo or PDF, max 3 MB</span>
                    </button>
                  ) : (
                    <div className="mt-1 border border-[var(--border-color)] rounded-md p-3">
                      {receiptPreview ? (
                        <img src={receiptPreview} alt="Receipt" className="w-full max-h-40 object-contain rounded mb-2" />
                      ) : (
                        <div className="flex items-center space-x-2 mb-2">
                          <FileText className="h-5 w-5 text-[#e94560]" />
                          <span className="text-sm text-[var(--text-primary)] truncate">{form.receipt_filename}</span>
                        </div>
                      )}
                      <div className="flex space-x-3 text-xs">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Change</button>
                        <button type="button" onClick={clearReceipt} className="text-[#ef4444]">Remove</button>
                      </div>
                    </div>
                  )}
                </div>

                <Button type="submit" className="w-full bg-[#e94560] hover:bg-[#f05c75]">Add Expense</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Month Selector */}
        <div>
          <Input
            type="month"
            value={currentMonth}
            onChange={e => setCurrentMonth(e.target.value)}
            className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-48"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
            <div className="text-2xl font-mono font-bold text-[var(--text-primary)]">{monthlyStats.total_km.toFixed(1)}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Travel KM</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
            <div className="text-xl font-mono font-bold text-[var(--text-primary)]">{formatCurrency(monthlyStats.total_amount)}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Total Amount</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
            <div className="text-xl font-mono font-bold text-[#f59e0b]">{formatCurrency(monthlyStats.pending_amount)}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Pending</p>
          </div>
        </div>

        {/* Expense List */}
        <div className="space-y-3">
          {expenses.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">No expenses for this month</div>
          )}
          {expenses.map(expense => (
            <div key={expense.expense_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`expense-card-${expense.expense_id}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start space-x-2">
                  <span className="text-xl mt-0.5">{expenseIcon(expense)}</span>
                  <div>
                    <div className="font-medium text-[var(--text-primary)] text-sm">{expenseLabel(expense)}</div>
                    {expense.expense_type === 'travel' && expense.from_location && (
                      <div className="flex items-center space-x-1 text-xs text-[var(--text-muted)] mt-0.5">
                        <span className="text-[#10b981]">{expense.from_location}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="text-[#ef4444]">{expense.to_location}</span>
                      </div>
                    )}
                    {expense.notes && <div className="text-xs text-[var(--text-muted)] mt-0.5">{expense.notes}</div>}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-mono font-bold text-[var(--text-primary)]">{formatCurrency(expense.amount)}</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">{expense.date}</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center space-x-2">
                  {expense.distance_km > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">{expense.distance_km} km</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    expense.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'
                  }`}>{expense.status}</span>
                  {expense.receipt_filename && (
                    <span className="text-xs text-[#e94560]">📎 {expense.receipt_filename}</span>
                  )}
                </div>
                {expense.from_lat && expense.from_lng && expense.to_lat && expense.to_lng && (
                  <a
                    href={`https://www.google.com/maps/dir/${expense.from_lat},${expense.from_lng}/${expense.to_lat},${expense.to_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#e94560] hover:text-[#f05c75]"
                  >
                    Map →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SalesLayout>
  );
}
