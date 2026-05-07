import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { expenses as expensesApi, visits as visitsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Plus, MapPin, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

const TRANSPORT_RATES = {
  two_wheeler: 5,
  four_wheeler: 10,
  public_transport: 3,
  other: 4
};

export default function SalesExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [visits, setVisits] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().split('T')[0],
    from_location: '',
    from_lat: null,
    from_lng: null,
    to_location: '',
    to_lat: null,
    to_lng: null,
    distance_km: 0,
    transport_mode: 'two_wheeler',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  const fetchData = async () => {
    try {
      const [expRes, visitsRes] = await Promise.all([
        expensesApi.getAll(currentMonth),
        visitsApi.getAll()
      ]);
      setExpenses(expRes.data);
      setVisits(visitsRes.data.filter(v => v.status === 'visited'));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    try {
      await expensesApi.create(expenseForm);
      toast.success('Expense logged successfully!');
      setDialogOpen(false);
      setExpenseForm({
        date: new Date().toISOString().split('T')[0],
        from_location: '',
        from_lat: null,
        from_lng: null,
        to_location: '',
        to_lat: null,
        to_lng: null,
        distance_km: 0,
        transport_mode: 'two_wheeler',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error creating expense:', error);
      toast.error('Failed to log expense');
    }
  };

  const handleSelectVisit = (field, visit) => {
    const newForm = { ...expenseForm };
    newForm[`${field}_location`] = visit.school_name;
    newForm[`${field}_lat`] = visit.visited_lat || visit.planned_lat;
    newForm[`${field}_lng`] = visit.visited_lng || visit.planned_lng;
    
    // Calculate distance if both locations have coordinates
    if (newForm.from_lat && newForm.from_lng && newForm.to_lat && newForm.to_lng) {
      const distance = haversineDistance(newForm.from_lat, newForm.from_lng, newForm.to_lat, newForm.to_lng);
      newForm.distance_km = Math.round(distance * 10) / 10;
    }
    
    setExpenseForm(newForm);
  };

  const calculateAmount = () => {
    return expenseForm.distance_km * TRANSPORT_RATES[expenseForm.transport_mode];
  };

  const monthlyStats = {
    total_km: expenses.reduce((sum, e) => sum + e.distance_km, 0),
    total_amount: expenses.reduce((sum, e) => sum + e.amount, 0),
    pending_amount: expenses.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0)
  };

  return (
    <SalesLayout title="Expenses" showBack>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="expenses-title">Travel Expenses</h1>
            <p className="text-[var(--text-secondary)] mt-1">Log your travel expenses</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="log-trip-button">
                <Plus className="mr-2 h-4 w-4" /> Log Trip
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-md">
              <DialogHeader>
                <DialogTitle className="text-[var(--text-primary)]">Log Travel Expense</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateExpense} className="space-y-4">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({...expenseForm, date: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label className="text-[#10b981]">FROM Location</Label>
                  <Input value={expenseForm.from_location} onChange={(e) => setExpenseForm({...expenseForm, from_location: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2" placeholder="Enter address or select visit" />
                  <select onChange={(e) => e.target.value && handleSelectVisit('from', visits.find(v => v.visit_id === e.target.value))} className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md">
                    <option value="">Or select from recent visits</option>
                    {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-[#ef4444]">TO Location</Label>
                  <Input value={expenseForm.to_location} onChange={(e) => setExpenseForm({...expenseForm, to_location: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2" placeholder="Enter address or select visit" />
                  <select onChange={(e) => e.target.value && handleSelectVisit('to', visits.find(v => v.visit_id === e.target.value))} className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md">
                    <option value="">Or select from recent visits</option>
                    {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Distance (KM)</Label>
                  <Input type="number" step="0.1" value={expenseForm.distance_km} onChange={(e) => setExpenseForm({...expenseForm, distance_km: parseFloat(e.target.value)})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label>Transport Mode</Label>
                  <select value={expenseForm.transport_mode} onChange={(e) => setExpenseForm({...expenseForm, transport_mode: e.target.value})} className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md">
                    <option value="two_wheeler">Two Wheeler (₹5/km)</option>
                    <option value="four_wheeler">Four Wheeler (₹10/km)</option>
                    <option value="public_transport">Public Transport (₹3/km)</option>
                    <option value="other">Other (₹4/km)</option>
                  </select>
                </div>
                <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-secondary)]">Amount</span>
                    <span className="text-2xl font-mono font-bold text-[#e94560]">{formatCurrency(calculateAmount())}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{expenseForm.distance_km} km × ₹{TRANSPORT_RATES[expenseForm.transport_mode]}/km</p>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={expenseForm.notes} onChange={(e) => setExpenseForm({...expenseForm, notes: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <Button type="submit" className="w-full bg-[#e94560] hover:bg-[#f05c75]">Log Expense</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Month Selector */}
        <div>
          <Input type="month" value={currentMonth} onChange={(e) => setCurrentMonth(e.target.value)} className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-48" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
            <div className="text-2xl font-mono font-bold text-[var(--text-primary)]">{monthlyStats.total_km.toFixed(1)}</div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Total KM</p>
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

        {/* Expenses List */}
        <div className="space-y-3">
          {expenses.map((expense) => (
            <div key={expense.expense_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`expense-card-${expense.expense_id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2 text-sm">
                  <span className="text-[#10b981]">{expense.from_location}</span>
                  <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
                  <span className="text-[#ef4444]">{expense.to_location}</span>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">{expense.date}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--text-muted)]">
                  {expense.distance_km} km • {expense.transport_mode.replace('_', ' ')}
                </div>
                <div className="font-mono font-bold text-[var(--text-primary)]">{formatCurrency(expense.amount)}</div>
              </div>
              {expense.from_lat && expense.from_lng && expense.to_lat && expense.to_lng && (
                <a
                  href={`https://www.google.com/maps/dir/${expense.from_lat},${expense.from_lng}/${expense.to_lat},${expense.to_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#e94560] hover:text-[#f05c75] mt-2 inline-block"
                >
                  View route on Google Maps →
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </SalesLayout>
  );
}