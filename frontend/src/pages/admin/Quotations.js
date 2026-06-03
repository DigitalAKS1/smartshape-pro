import React from 'react';
import AppShell from '../../components/layouts/AppShell';
import { quotations as quotApi } from '../../lib/api';
import { useNavigate } from 'react-router-dom';
import { FileText, Mail, Download, Plus, Search, Filter } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SendEmailDialog from '../../components/SendEmailDialog';

import useQuotations from '../../hooks/useQuotations';
import { QuotationRow, QuotationMobileCard } from '../../components/quotations/QuotationCard';
import { DesktopFilterBar, MobileFilterPanel } from '../../components/quotations/QuotationFilters';
import { HistoryPanel, WhatsAppDialog } from '../../components/quotations/QuotationVersionHistory';

const fmtRound = (n) =>
  typeof n === 'number' ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';

export default function Quotations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || (user?.assigned_modules || []).includes('accounts');
  const canDelete = isAdmin;

  const q = useQuotations();

  return (
    <AppShell>

      {/* DESKTOP (lg+) */}
      <div className="hidden lg:flex lg:flex-col p-6 gap-5" style={{ minHeight: 'calc(100vh - 64px)' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Quotations</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {q.filteredQuotations.length} of {q.quotations.length} &middot; Total {fmtRound(q.totalValue)} &middot; {q.sentCount} sent
            </p>
          </div>
          <div className="flex items-center gap-2">
            {q.selectedQuotations.length > 0 && (
              <button onClick={q.handleBulkSend}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium transition-colors">
                <Mail className="h-4 w-4" /> Send {q.selectedQuotations.length} selected
              </button>
            )}
            <button onClick={q.handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={() => navigate('/create-quotation')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold transition-colors shadow-sm">
              <Plus className="h-4 w-4" /> New Quotation
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <DesktopFilterBar
          searchTerm={q.searchTerm} setSearchTerm={q.setSearchTerm}
          statusFilter={q.statusFilter} setStatusFilter={q.setStatusFilter}
          agentFilter={q.agentFilter} setAgentFilter={q.setAgentFilter}
          dateFrom={q.dateFrom} setDateFrom={q.setDateFrom}
          dateTo={q.dateTo} setDateTo={q.setDateTo}
          agentList={q.agentList} isAdmin={isAdmin}
          activeFilterCount={q.activeFilterCount} clearFilters={q.clearFilters}
          selectAll={q.selectAll}
          selectedCount={q.selectedQuotations.length}
          onBulkSend={q.handleBulkSend} />

        {/* Table */}
        <div className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden flex flex-col">
          {q.loading ? (
            <div className="flex-1 flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-4 border-[#e94560] border-t-transparent animate-spin mx-auto" />
                <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
              </div>
            </div>
          ) : q.filteredQuotations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--bg-hover)] flex items-center justify-center mb-4">
                <FileText className="h-7 w-7 text-[var(--text-muted)] opacity-50" />
              </div>
              <p className="text-base font-bold text-[var(--text-primary)]">{q.searchTerm ? 'No results found' : 'No quotations yet'}</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">{q.searchTerm ? 'Try a different search term' : 'Create your first quotation to get started'}</p>
              {!q.searchTerm && (
                <button onClick={() => navigate('/create-quotation')}
                  className="mt-4 px-4 py-2 rounded-lg bg-[#e94560] text-white text-sm font-semibold hover:bg-[#f05c75] transition-colors">
                  + Create Quotation
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                    <th className="w-10 px-4 py-3.5 text-left">
                      <input type="checkbox"
                        onChange={e => e.target.checked ? q.selectAll() : q.setSelected([])}
                        checked={q.selectedQuotations.length > 0}
                        className="w-4 h-4 rounded border-[var(--border-color)] accent-[#e94560] cursor-pointer" />
                    </th>
                    {['Quote #', 'School / Contact', 'Amount', 'Status', 'Catalogue', 'Sent By', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {q.filteredQuotations.map(quot => (
                    <QuotationRow
                      key={quot.quotation_id}
                      quot={quot}
                      isSelected={q.selectedQuotations.includes(quot.quotation_id)}
                      onToggle={() => q.toggleSelection(quot.quotation_id)}
                      catalogueLabel={q.catalogueLabel}
                      onWhatsApp={q.handleOpenWhatsApp}
                      onEmail={q.openCatalogueDialog}
                      onDelete={q.handleDelete}
                      onHistory={q.setHistoryPanel}
                      onCopyLink={q.handleCopyLink}
                      onCreateOrder={q.handleCreateOrder}
                      canDelete={canDelete}
                      quotApi={quotApi} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE (< lg) */}
      <div className="lg:hidden flex flex-col bg-[var(--bg-primary)]">

        {/* Sticky top bar */}
        <div className="sticky top-0 z-20 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Quotations</h1>
              <p className="text-[10px] text-[var(--text-muted)]">
                {q.filteredQuotations.length} result{q.filteredQuotations.length !== 1 ? 's' : ''}{q.activeFilterCount > 0 ? ` · ${q.activeFilterCount} filter${q.activeFilterCount > 1 ? 's' : ''}` : ''}
              </p>
            </div>
            <button onClick={() => navigate('/create-quotation')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#e94560] text-white text-sm font-semibold shadow-sm active:opacity-80">
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
          <div className="relative">
            <MobileFilterPanel
              searchTerm={q.searchTerm} setSearchTerm={q.setSearchTerm}
              statusFilter={q.statusFilter} setStatusFilter={q.setStatusFilter}
              agentFilter={q.agentFilter} setAgentFilter={q.setAgentFilter}
              dateFrom={q.dateFrom} setDateFrom={q.setDateFrom}
              dateTo={q.dateTo} setDateTo={q.setDateTo}
              agentList={q.agentList} isAdmin={isAdmin}
              activeFilterCount={q.activeFilterCount} clearFilters={q.clearFilters}
              showFilters={q.showFilters} setShowFilters={q.setShowFilters} />
          </div>
        </div>

        {/* List */}
        {q.loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-4 border-[#e94560] border-t-transparent animate-spin" />
          </div>
        ) : q.filteredQuotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-[var(--text-muted)] opacity-40" />
            </div>
            <p className="text-base font-bold text-[var(--text-primary)]">{q.searchTerm ? 'No results' : 'No quotations'}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{q.searchTerm ? 'Try a different search' : 'Tap New to create your first quotation'}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {q.filteredQuotations.map(quot => (
              <QuotationMobileCard
                key={quot.quotation_id}
                quot={quot}
                catalogueLabel={q.catalogueLabel}
                onWhatsApp={q.handleOpenWhatsApp}
                onEmail={q.openCatalogueDialog}
                onCreateOrder={q.handleCreateOrder} />
            ))}
          </div>
        )}
      </div>

      {/* Email dialog */}
      <SendEmailDialog
        open={q.catalogueDialog.open}
        onClose={() => q.setCatalogueDialog({ open: false, quot: null, sending: false })}
        onSend={q.handleSendCatalogue}
        title="Send Catalogue via Email"
        defaultTo={q.catalogueDialog.quot?.customer_email || ''}
        defaultCc={q.catalogueDialog.quot?.sales_person_email || ''}
        sending={q.catalogueDialog.sending} />

      {/* WhatsApp dialog */}
      <WhatsAppDialog
        open={q.waDialog.open}
        onClose={() => q.setWaDialog({ open: false, quot: null, link: '', generating: false })}
        quot={q.waDialog.quot}
        link={q.waDialog.link}
        generating={q.waDialog.generating} />

      {/* History panel */}
      {q.historyPanel && (
        <HistoryPanel quotId={q.historyPanel} onClose={() => q.setHistoryPanel(null)} />
      )}

    </AppShell>
  );
}
