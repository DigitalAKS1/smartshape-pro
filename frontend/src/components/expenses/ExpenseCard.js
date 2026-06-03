import React from 'react';
import { ArrowRight } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const isKmBased = (category) =>
  category === 'two_wheeler' || category === 'four_wheeler';

export function expenseIcon(expense) {
  if (expense.expense_type === 'food') {
    const icons = { breakfast: '🌅', lunch: '🍱', dinner: '🌙', tea_snacks: '☕' };
    return icons[expense.category] || '🍽️';
  }
  if (expense.expense_type === 'other') return '📋';
  const icons = {
    cab: '🚕', auto: '🛺', bus: '🚌', train: '🚂',
    two_wheeler: '🏍️', four_wheeler: '🚗',
  };
  return icons[expense.transport_mode || expense.category] || '🚗';
}

export function expenseLabel(expense) {
  if (expense.expense_type === 'food') {
    const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', tea_snacks: 'Tea & Snacks' };
    return labels[expense.category] || expense.category;
  }
  if (expense.expense_type === 'other') return expense.description || 'Other';
  const labels = {
    cab: 'Cab', auto: 'Auto', bus: 'Bus', train: 'Train',
    two_wheeler: 'Two Wheeler', four_wheeler: 'Four Wheeler',
  };
  return labels[expense.transport_mode || expense.category] ||
    (expense.transport_mode || expense.category);
}

export function ExpenseCard({ expense }) {
  return (
    <div
      key={expense.expense_id}
      className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4"
      data-testid={`expense-card-${expense.expense_id}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start space-x-2">
          <span className="text-xl mt-0.5">{expenseIcon(expense)}</span>
          <div>
            <div className="font-medium text-[var(--text-primary)] text-sm">
              {expenseLabel(expense)}
            </div>
            {expense.expense_type === 'travel' && expense.from_location && (
              <div className="flex items-center space-x-1 text-xs text-[var(--text-muted)] mt-0.5">
                <span className="text-[#10b981]">{expense.from_location}</span>
                <ArrowRight className="h-3 w-3" />
                <span className="text-[#ef4444]">{expense.to_location}</span>
              </div>
            )}
            {expense.notes && (
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{expense.notes}</div>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <div className="font-mono font-bold text-[var(--text-primary)]">
            {formatCurrency(expense.amount)}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">{expense.date}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center space-x-2">
          {expense.distance_km > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{expense.distance_km} km</span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            expense.status === 'pending'
              ? 'bg-yellow-500/10 text-yellow-500'
              : 'bg-green-500/10 text-green-500'
          }`}>
            {expense.status}
          </span>
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
  );
}
