import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Plus, Upload, FileText, Car, Utensils, ReceiptText } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { isKmBased } from './ExpenseCard';

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

export function ExpenseFormDialog({
  open, onOpenChange,
  form, setForm,
  visits, fileInputRef,
  receiptPreview,
  handleTypeChange,
  handleSelectVisit,
  handleReceiptUpload,
  clearReceipt,
  calcAmount,
  handleSubmit,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="log-trip-button">
          <Plus className="mr-2 h-4 w-4" /> Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">Add Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Expense Type Tabs */}
          <div className="grid grid-cols-3 gap-2">
            {EXPENSE_TYPES.map(({ value, label, Icon }) => (
              <button key={value} type="button" onClick={() => handleTypeChange(value)}
                className={`flex flex-col items-center py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                  form.expense_type === value
                    ? 'bg-[#e94560] border-[#e94560] text-white'
                    : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                }`}>
                <Icon className="h-4 w-4 mb-1" />{label}
              </button>
            ))}
          </div>

          {/* Date */}
          <div>
            <Label>Date</Label>
            <Input type="date" value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })} required
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
          </div>

          {/* ── Travel Form ── */}
          {form.expense_type === 'travel' && (<>
            <div>
              <Label>Transport Type</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {TRAVEL_CATEGORIES.map(c => (
                  <button key={c.value} type="button"
                    onClick={() => setForm({ ...form, category: c.value, distance_km: '', amount: '' })}
                    className={`py-1.5 px-2 rounded border text-xs font-medium transition-colors ${
                      form.category === c.value
                        ? 'bg-[#e94560] border-[#e94560] text-white'
                        : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                    }`}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-[#10b981]">From Location</Label>
              <Input value={form.from_location}
                onChange={e => setForm({ ...form, from_location: e.target.value })}
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2"
                placeholder="Enter address" />
              <select
                onChange={e => e.target.value && handleSelectVisit('from', visits.find(v => v.visit_id === e.target.value))}
                className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md">
                <option value="">Or pick from recent visits</option>
                {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-[#ef4444]">To Location</Label>
              <Input value={form.to_location}
                onChange={e => setForm({ ...form, to_location: e.target.value })}
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] mb-2"
                placeholder="Enter address" />
              <select
                onChange={e => e.target.value && handleSelectVisit('to', visits.find(v => v.visit_id === e.target.value))}
                className="w-full h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] rounded-md">
                <option value="">Or pick from recent visits</option>
                {visits.map(v => <option key={v.visit_id} value={v.visit_id}>{v.school_name}</option>)}
              </select>
            </div>

            {isKmBased(form.category) ? (
              <div>
                <Label>Distance (KM)</Label>
                <Input type="number" step="0.1" min="0"
                  value={form.distance_km}
                  onChange={e => setForm({ ...form, distance_km: e.target.value })} required
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                <p className="text-xs text-[var(--text-muted)] mt-1">₹{KM_RATES[form.category]}/km</p>
              </div>
            ) : (
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" step="1" min="0"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} required
                  placeholder="Enter fare paid"
                  className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
              </div>
            )}
          </>)}

          {/* ── Food Form ── */}
          {form.expense_type === 'food' && (<>
            <div>
              <Label>Meal Type</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {FOOD_CATEGORIES.map(c => (
                  <button key={c.value} type="button" onClick={() => setForm({ ...form, category: c.value })}
                    className={`py-2 px-3 rounded border text-sm font-medium transition-colors ${
                      form.category === c.value
                        ? 'bg-[#e94560] border-[#e94560] text-white'
                        : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                    }`}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" step="1" min="0" value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })} required
                placeholder="Enter amount"
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
            </div>
          </>)}

          {/* ── Other Form ── */}
          {form.expense_type === 'other' && (<>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required
                placeholder="What was this expense for?"
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" step="1" min="0" value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })} required
                placeholder="Enter amount"
                className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
            </div>
          </>)}

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Any additional notes..."
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
          </div>

          {/* Amount Summary */}
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md p-3 flex justify-between items-center">
            <span className="text-[var(--text-secondary)] text-sm">Total Amount</span>
            <span className="text-xl font-mono font-bold text-[#e94560]">{formatCurrency(calcAmount())}</span>
          </div>

          {/* Receipt Upload */}
          <div>
            <Label>Receipt / Bill</Label>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf"
              onChange={handleReceiptUpload} className="hidden" />
            {!form.receipt_filename ? (
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="mt-1 w-full flex flex-col items-center justify-center py-5 border-2 border-dashed border-[var(--border-color)] rounded-md text-[var(--text-secondary)] hover:border-[#e94560] hover:text-[#e94560] transition-colors">
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
  );
}
