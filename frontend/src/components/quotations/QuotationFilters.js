import React from 'react';
import { Search, X, Filter, Mail } from 'lucide-react';

// ── Desktop Filter Bar ─────────────────────────────────────────────────────────
export function DesktopFilterBar({
  searchTerm, setSearchTerm,
  statusFilter, setStatusFilter,
  agentFilter, setAgentFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  agentList, isAdmin, activeFilterCount, clearFilters, selectAll,
  selectedCount, onBulkSend,
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl px-4 py-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
        <input type="text" placeholder="Search school, quote #, contact…"
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 h-9 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[#e94560]/50 transition-colors" />
      </div>
      <div className="h-5 w-px bg-[var(--border-color)]" />
      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
        className="h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none cursor-pointer">
        <option value="all">All Status</option>
        <option value="draft">Draft</option>
        <option value="sent">Sent</option>
        <option value="pending">Pending</option>
        <option value="confirmed">Confirmed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      {isAdmin && (
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
          className="h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none cursor-pointer">
          <option value="all">All Agents</option>
          {agentList.map(a => <option key={a.sales_person_id} value={a.sales_person_id}>{a.name}</option>)}
        </select>
      )}
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
        className="h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none cursor-pointer" />
      <span className="text-[var(--text-muted)] text-xs">&rarr;</span>
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
        className="h-9 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none cursor-pointer" />
      {activeFilterCount > 0 && (
        <button onClick={clearFilters}
          className="flex items-center gap-1 text-xs text-[#e94560] font-medium hover:underline whitespace-nowrap">
          <X className="h-3 w-3" /> Clear
        </button>
      )}
      <div className="ml-auto">
        <button onClick={selectAll} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium transition-colors whitespace-nowrap">
          Select all unsent
        </button>
      </div>
    </div>
  );
}

// ── Mobile Filter Panel ────────────────────────────────────────────────────────
export function MobileFilterPanel({
  searchTerm, setSearchTerm,
  statusFilter, setStatusFilter,
  agentFilter, setAgentFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  agentList, isAdmin, activeFilterCount, clearFilters,
  showFilters, setShowFilters,
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
        <input type="text" placeholder="School, quote #…"
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 h-9 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[#e94560]/50" />
      </div>
      <button onClick={() => setShowFilters(v => !v)}
        className={`flex items-center gap-1 px-3 h-9 rounded-xl border text-sm font-medium ${activeFilterCount > 0 ? 'bg-[#e94560]/10 border-[#e94560]/40 text-[#e94560]' : 'border-[var(--border-color)] text-[var(--text-muted)]'}`}>
        <Filter className="h-4 w-4" />
        {activeFilterCount > 0 && <span className="text-[11px] font-bold">{activeFilterCount}</span>}
      </button>
      {showFilters && (
        <div className="absolute top-full left-0 right-0 grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-color)] bg-[var(--bg-card)] px-4 pb-3 z-10">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none">
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {isAdmin && (
            <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
              className="h-9 px-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none">
              <option value="all">All Agents</option>
              {agentList.map(a => <option key={a.sales_person_id} value={a.sales_person_id}>{a.name}</option>)}
            </select>
          )}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="h-9 px-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="h-9 px-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none" />
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="col-span-2 text-xs text-[#e94560] font-semibold text-right">Clear filters</button>
          )}
        </div>
      )}
    </div>
  );
}
