import React from 'react';

/**
 * Friendly empty state for tables, lists, and data sections.
 *
 * Usage:
 *   <EmptyState icon="📋" title="No quotations yet" desc="Create your first quotation to get started." action={{ label: 'Create Quotation', onClick: () => {} }} />
 *
 * icon: emoji string or Lucide component element
 * title: headline
 * desc: short explanation
 * action: { label, onClick } — optional primary CTA
 * compact: boolean — smaller variant for inside panels
 */
export default function EmptyState({ icon, title, desc, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'}`}>
      <div className={`${compact ? 'text-4xl mb-3' : 'text-5xl mb-4'} select-none`} aria-hidden>
        {typeof icon === 'string' ? icon : icon}
      </div>
      <h3 className={`font-semibold text-[var(--text-primary)] ${compact ? 'text-sm' : 'text-base'} mb-1`}>
        {title}
      </h3>
      {desc && (
        <p className={`text-[var(--text-muted)] ${compact ? 'text-xs' : 'text-sm'} max-w-xs leading-relaxed`}>
          {desc}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className={`mt-4 px-4 ${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} rounded-lg bg-[#e94560] text-white font-semibold hover:bg-[#c73652] transition-colors`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Pre-built variants for common pages. */
export const EMPTY_STATES = {
  leads:        { icon: '🎯', title: 'No leads found', desc: 'Add your first lead or adjust the active filters.' },
  schools:      { icon: '🏫', title: 'No schools yet', desc: 'Add a school to start tracking your B2B accounts.' },
  contacts:     { icon: '👤', title: 'No contacts', desc: 'Add contacts to build your network and convert them to leads.' },
  quotations:   { icon: '📄', title: 'No quotations yet', desc: 'Create a quotation to send a professional proposal to a client.' },
  orders:       { icon: '📦', title: 'No orders', desc: 'Confirmed quotations will appear here as orders.' },
  inventory:    { icon: '🏗️', title: 'No products', desc: 'Add products to your inventory to use them in quotations.' },
  packages:     { icon: '📦', title: 'No packages', desc: 'Create a package bundle to quickly add product groups to quotes.' },
  tasks:        { icon: '✅', title: 'All clear!', desc: "No tasks due — you're on top of things." },
  notifications:{ icon: '🔔', title: 'No notifications', desc: 'You\'re all caught up.' },
  visits:       { icon: '🗺️', title: 'No visits planned', desc: 'Schedule a school visit to track your field activities.' },
  dispatches:   { icon: '📬', title: 'No dispatches', desc: 'Log material dispatches here once you send brochures or samples.' },
  callNotes:    { icon: '📞', title: 'No activity yet', desc: 'Log your first call, meeting, or note for this lead.' },
  followups:    { icon: '📅', title: 'No follow-ups', desc: 'Schedule a follow-up to keep this lead moving forward.' },
  tickets:      { icon: '🎫', title: 'No support tickets', desc: 'No issues have been reported by users yet.' },
  expenses:     { icon: '💸', title: 'No expenses', desc: 'Log field expenses to track your sales costs.' },
  employees:    { icon: '🧑‍💼', title: 'No employees', desc: 'Add team members to manage payroll and attendance.' },
  payroll:      { icon: '💰', title: 'No payroll records', desc: 'Run payroll to generate salary slips for your team.' },
  searchResult: { icon: '🔍', title: 'No results', desc: 'Try different keywords or clear the search.' },
  analytics:    { icon: '📊', title: 'No data yet', desc: 'Data will appear here once activity is recorded.' },
};
