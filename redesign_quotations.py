
with open(r'f:\SMARTSHAPE APP\frontend\src\pages\admin\Quotations.js', 'r', encoding='utf-8') as f:
    content = f.read()

wa_start = content.index('  const WaBtn = ({ quot }) =>')
dialogs_start = content.index('      {/* ── Email dialog ── */')

old_section = content[wa_start:dialogs_start]
print(f'Replacing {len(old_section)} chars')

new_section = r"""  // ── Helpers ──────────────────────────────────────────────────────────────────
  const initials = (name) => (name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
  const STATUS_BORDER = { draft:'#6b7280', sent:'#3b82f6', pending:'#f59e0b', confirmed:'#22c55e', cancelled:'#ef4444' };
  const CATALOGUE_DOT = { not_sent:'#6b7280', sent:'#3b82f6', opened:'#f59e0b', submitted:'#22c55e' };
  const totalValue = filteredQuotations.reduce((s, q) => s + (q.grand_total || 0), 0);
  const sentCount  = filteredQuotations.filter(q => q.catalogue_status !== 'not_sent').length;

  return (
    <AppShell>

      {/* DESKTOP (lg+) */}
      <div className="hidden lg:flex lg:flex-col p-6 gap-5" style={{minHeight:'calc(100vh - 64px)'}}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Quotations</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {filteredQuotations.length} of {quotations.length} &middot; Total {fmtRound(totalValue)} &middot; {sentCount} sent
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedQuotations.length > 0 && (
              <button onClick={handleBulkSend} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium transition-colors">
                <Mail className="h-4 w-4" /> Send {selectedQuotations.length} selected
              </button>
            )}
            <button onClick={() => { exportData.download('quotations'); toast.success('Exporting…'); }}
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
            <button onClick={() => { setStatusFilter('all'); setAgentFilter('all'); setDateFrom(''); setDateTo(''); setSearchTerm(''); }}
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

        {/* Table */}
        <div className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-4 border-[#e94560] border-t-transparent animate-spin mx-auto" />
                <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
              </div>
            </div>
          ) : filteredQuotations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--bg-hover)] flex items-center justify-center mb-4">
                <FileText className="h-7 w-7 text-[var(--text-muted)] opacity-50" />
              </div>
              <p className="text-base font-bold text-[var(--text-primary)]">{searchTerm ? 'No results found' : 'No quotations yet'}</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">{searchTerm ? 'Try a different search term' : 'Create your first quotation to get started'}</p>
              {!searchTerm && (
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
                      <input type="checkbox" onChange={e => e.target.checked ? selectAll() : setSelected([])}
                        checked={selectedQuotations.length > 0}
                        className="w-4 h-4 rounded border-[var(--border-color)] accent-[#e94560] cursor-pointer" />
                    </th>
                    {['Quote #', 'School / Contact', 'Amount', 'Status', 'Catalogue', 'Sent By', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {filteredQuotations.map((quot) => (
                    <tr key={quot.quotation_id} className="group hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="px-4 py-3.5">
                        <input type="checkbox" checked={selectedQuotations.includes(quot.quotation_id)}
                          onChange={() => toggleSelection(quot.quotation_id)}
                          className="w-4 h-4 rounded border-[var(--border-color)] accent-[#e94560] cursor-pointer" />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <Link to={`/view-quotation/${quot.quotation_id}`}
                            className="font-mono text-sm font-bold text-[#e94560] hover:underline underline-offset-2">
                            {quot.quote_number}
                          </Link>
                          {quot.version > 1 ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/25">
                              <GitBranch className="h-2.5 w-2.5" />V{quot.version}
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]">V1</span>
                          )}
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {quot.created_at ? new Date(quot.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <p className="font-semibold text-[var(--text-primary)] truncate">{quot.school_name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                          {[quot.principal_name, quot.sales_person_name].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-mono font-bold text-[var(--text-primary)] text-base">{fmtRound(quot.grand_total)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${getStatusColor(quot.quotation_status)}`}>
                          {quot.quotation_status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CATALOGUE_DOT[quot.catalogue_status] || '#6b7280' }} />
                            <span className="text-xs capitalize text-[var(--text-secondary)]">{quot.catalogue_status?.replace('_', ' ')}</span>
                          </span>
                          {quot.catalogue_token && ['sent','opened'].includes(quot.catalogue_status) && (
                            <button onClick={() => handleCopyLink(quot.catalogue_token)} className="text-[var(--text-muted)] hover:text-blue-400 transition-colors" title="Copy link">
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {quot.catalogue_sent_at ? (
                          <div>
                            <p className="text-xs font-medium text-[var(--text-secondary)] truncate max-w-[130px]">{quot.catalogue_sent_by_name || '—'}</p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{fmtDateTime(quot.catalogue_sent_at)}</p>
                          </div>
                        ) : <span className="text-xs text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-0.5">
                          <Link to={`/view-quotation/${quot.quotation_id}`}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#e94560] hover:bg-[#e94560]/8 transition-colors" title="View">
                            <Eye className="h-3.5 w-3.5" />
                          </Link>
                          <button onClick={() => quotApi.downloadPdf(quot.quotation_id)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors" title="Download PDF">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setHistoryPanel(quot.quotation_id)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-400/8 transition-colors" title="Edit history">
                            <History className="h-3.5 w-3.5" />
                          </button>
                          <Link to={`/edit-quotation/${quot.quotation_id}`}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors" title="Edit">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Link>
                          <button onClick={() => handleOpenWhatsApp(quot)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#25d366] hover:bg-[#25d366]/8 transition-colors" title="WhatsApp">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openCatalogueDialog(quot)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#3b82f6] hover:bg-[#3b82f6]/8 transition-colors" title="Send Email">
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                          {quot.catalogue_status === 'submitted' && (
                            <button onClick={() => handleCreateOrder(quot.quotation_id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-green-400 hover:bg-green-400/10 transition-colors" title="Create Order">
                              <ShoppingCart className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => handleDelete(quot.quotation_id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/8 transition-colors" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
                {filteredQuotations.length} result{filteredQuotations.length !== 1 ? 's' : ''}{activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : ''}
              </p>
            </div>
            <button onClick={() => navigate('/create-quotation')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#e94560] text-white text-sm font-semibold shadow-sm active:opacity-80">
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
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
          </div>
          {showFilters && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-color)]">
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
                <button onClick={() => { setStatusFilter('all'); setAgentFilter('all'); setDateFrom(''); setDateTo(''); }}
                  className="col-span-2 text-xs text-[#e94560] font-semibold text-right">Clear filters</button>
              )}
            </div>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-4 border-[#e94560] border-t-transparent animate-spin" />
          </div>
        ) : filteredQuotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-[var(--text-muted)] opacity-40" />
            </div>
            <p className="text-base font-bold text-[var(--text-primary)]">{searchTerm ? 'No results' : 'No quotations'}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{searchTerm ? 'Try a different search' : 'Tap New to create your first quotation'}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {filteredQuotations.map((quot) => (
              <div key={quot.quotation_id} className="bg-[var(--bg-card)]"
                style={{ borderLeft: `3px solid ${STATUS_BORDER[quot.quotation_status] || '#6b7280'}` }}>
                <div className="flex items-start gap-3 px-4 pt-4 pb-2">
                  <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
                    style={{ background: STATUS_BORDER[quot.quotation_status] || '#6b7280' }}>
                    {initials(quot.school_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--text-primary)] leading-tight truncate">{quot.school_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Link to={`/view-quotation/${quot.quotation_id}`} className="font-mono text-xs text-[#e94560] font-semibold">{quot.quote_number}</Link>
                          {quot.version > 1 && <span className="text-[9px] px-1 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6] font-bold border border-[#3b82f6]/25">V{quot.version}</span>}
                          {quot.sales_person_name && <span className="text-[10px] text-[var(--text-muted)]">· {quot.sales_person_name}</span>}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${getStatusColor(quot.quotation_status)}`}>
                        {quot.quotation_status}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-color)]/50">
                  <span className="font-mono text-xl font-bold text-[var(--text-primary)]">{fmtRound(quot.grand_total)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATALOGUE_DOT[quot.catalogue_status] || '#6b7280' }} />
                    <span className="text-xs text-[var(--text-muted)] capitalize">{quot.catalogue_status?.replace('_', ' ')}</span>
                  </div>
                </div>
                {quot.catalogue_sent_at && (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-[var(--border-color)]/50">
                    <Clock className="h-3 w-3 text-[var(--text-muted)] flex-shrink-0" />
                    <span className="text-[11px] text-[var(--text-muted)] truncate">{fmtDateTime(quot.catalogue_sent_at)} · {quot.catalogue_sent_by_name || '—'}</span>
                  </div>
                )}
                <div className="grid grid-cols-4 gap-1.5 px-3 pb-3 pt-2 border-t border-[var(--border-color)]/50">
                  <Link to={`/view-quotation/${quot.quotation_id}`}>
                    <button className="w-full flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] active:opacity-70">
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                  </Link>
                  <button onClick={() => handleOpenWhatsApp(quot)}
                    className="flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[#25d366]/10 border border-[#25d366]/30 text-xs font-semibold text-[#25d366] active:opacity-70">
                    <MessageCircle className="h-3.5 w-3.5" /> WA
                  </button>
                  <button onClick={() => openCatalogueDialog(quot)}
                    className="flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-xs font-semibold text-[#3b82f6] active:opacity-70">
                    <Mail className="h-3.5 w-3.5" /> Email
                  </button>
                  <Link to={`/edit-quotation/${quot.quotation_id}`}>
                    <button className="w-full flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs font-semibold text-[var(--text-muted)] active:opacity-70">
                      <Edit2 className="h-3.5 w-3.5" /> Edit
                    </button>
                  </Link>
                </div>
                {quot.catalogue_status === 'submitted' && (
                  <div className="px-3 pb-3">
                    <button onClick={() => handleCreateOrder(quot.quotation_id)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-sm font-semibold text-green-400 active:opacity-70">
                      <ShoppingCart className="h-4 w-4" /> Convert to Order
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

"""

new_content = content[:wa_start] + new_section + content[dialogs_start:]
with open(r'f:\SMARTSHAPE APP\frontend\src\pages\admin\Quotations.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
print(f'Done. File is now {len(new_content)} chars.')
