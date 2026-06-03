import React from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { Input } from '../../components/ui/input';
import { formatCurrency } from '../../lib/utils';
import { useSalesExpenses } from '../../hooks/useSalesExpenses';
import { ExpenseCard } from '../../components/expenses/ExpenseCard';
import { ExpenseFormDialog } from '../../components/expenses/ExpenseFormDialog';

export default function SalesExpenses() {
  const {
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
  } = useSalesExpenses();

  return (
    <SalesLayout title="Expenses" showBack>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="expenses-title">Expenses</h1>
            <p className="text-[var(--text-secondary)] mt-1">Log your daily expenses</p>
          </div>
          <ExpenseFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            form={form}
            setForm={setForm}
            visits={visits}
            fileInputRef={fileInputRef}
            receiptPreview={receiptPreview}
            handleTypeChange={handleTypeChange}
            handleSelectVisit={handleSelectVisit}
            handleReceiptUpload={handleReceiptUpload}
            clearReceipt={clearReceipt}
            calcAmount={calcAmount}
            handleSubmit={handleSubmit}
          />
        </div>

        {/* Month Selector */}
        <div>
          <Input type="month" value={currentMonth} onChange={e => setCurrentMonth(e.target.value)}
            className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-48" />
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
            <ExpenseCard key={expense.expense_id} expense={expense} />
          ))}
        </div>
      </div>
    </SalesLayout>
  );
}
