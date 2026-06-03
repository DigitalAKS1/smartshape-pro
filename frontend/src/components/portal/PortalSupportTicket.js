import React from 'react';

const PRIORITIES = [
  { value: 'low',    label: 'Low',    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { value: 'high',   label: 'High',   color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

const STATUS_COLORS = {
  open:        'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  resolved:    'bg-green-500/20 text-green-400',
  closed:      'bg-gray-500/20 text-gray-400',
};

/**
 * Help & Support tab — ticket form + ticket history + direct contact.
 * Props: tickets, ticketForm, setTicketForm, ticketSubmitting, handleTicketSubmit, q
 */
export default function PortalSupportTicket({ tickets, ticketForm, setTicketForm, ticketSubmitting, handleTicketSubmit, q }) {
  return (
    <div className="space-y-6">
      {/* Raise a ticket form */}
      <div className="bg-[#1a1a2e] rounded-2xl border border-[#2d2d44] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2d2d44] flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#e94560]/20 flex items-center justify-center">
            <svg className="h-4 w-4 text-[#e94560]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Raise a Support Ticket</p>
            <p className="text-[#6b6b80] text-xs">Our team typically responds within 24 hours</p>
          </div>
        </div>
        <form onSubmit={handleTicketSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Issue Title *</label>
            <input
              value={ticketForm.title}
              onChange={e => setTicketForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Brief description of your issue"
              className="w-full bg-[#0f0f1a] border border-[#2d2d44] rounded-xl px-4 py-2.5 text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560]/60"
            />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Description *</label>
            <textarea
              value={ticketForm.description}
              onChange={e => setTicketForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Describe the issue in detail — what happened, when, any error messages..."
              rows={4}
              className="w-full bg-[#0f0f1a] border border-[#2d2d44] rounded-xl px-4 py-2.5 text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560]/60 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button key={p.value} type="button" onClick={() => setTicketForm(f => ({ ...f, priority: p.value }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${ticketForm.priority === p.value ? p.color : 'bg-[#0f0f1a] border-[#2d2d44] text-[#6b6b80]'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={ticketSubmitting}
            className="w-full py-3 rounded-xl bg-[#e94560] hover:bg-[#f05c75] disabled:opacity-60 text-white font-semibold text-sm transition-colors">
            {ticketSubmitting ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </form>
      </div>

      {/* Ticket history */}
      <div>
        <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Your Tickets</p>
        {tickets.length === 0
          ? <div className="bg-[#1a1a2e] rounded-xl p-8 border border-[#2d2d44] text-center">
              <p className="text-[#6b6b80] text-sm">No tickets yet</p>
              <p className="text-[#3d3d55] text-xs mt-1">Use the form above to raise your first ticket</p>
            </div>
          : <div className="space-y-3">
              {tickets.map(t => {
                const pri = PRIORITIES.find(p => p.value === t.priority) || PRIORITIES[1];
                return (
                  <div key={t.ticket_id} className="bg-[#1a1a2e] rounded-xl border border-[#2d2d44] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-[#e94560]">{t.ticket_number}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${pri.color}`}>{t.priority}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[t.status] || 'bg-gray-500/20 text-gray-400'}`}>{t.status.replace('_', ' ')}</span>
                        </div>
                        <p className="text-white text-sm font-medium mt-1">{t.title}</p>
                        <p className="text-[#6b6b80] text-xs mt-1 line-clamp-2">{t.description}</p>
                      </div>
                    </div>
                    <p className="text-[#3d3d55] text-[10px] mt-2">{t.created_at?.slice(0, 10)}</p>
                  </div>
                );
              })}
            </div>
        }
      </div>

      {/* Direct contact */}
      <div className="bg-[#1a1a2e] rounded-2xl border border-[#2d2d44] p-5">
        <p className="text-white font-semibold text-sm mb-3">Contact Your Sales Executive</p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
            <svg className="h-5 w-5 text-[#e94560]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <p className="text-white text-sm font-medium">{q.sales_person_name || 'Your Representative'}</p>
            {q.sales_person_email && (
              <a href={`mailto:${q.sales_person_email}`} className="text-[#e94560] hover:text-[#f05c75] text-xs">{q.sales_person_email}</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
