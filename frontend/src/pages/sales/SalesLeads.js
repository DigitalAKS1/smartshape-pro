import React from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { useAuth } from '../../contexts/AuthContext';
import { getSalesPermissions } from '../../lib/salesPermissions';
import { Search, Building2, Clock, LayoutGrid, AlignJustify, Phone, MessageSquare } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { useSalesLeads } from '../../hooks/useSalesLeads';
import { KanbanCard, STAGES, STAGE, TYPE_CLS, openWa } from '../../components/crm/SalesLeadCard';
import { callViaBonvoice } from '../../components/crm/ContactDetailPanel';
import { BottomSheet, LeadActionSheet } from '../../components/crm/SalesLeadDetailSheet';

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

export default function SalesLeads() {
  const { user } = useAuth();
  const perms = getSalesPermissions(user?.sales_role);

  const {
    leads, filtered, counts, activeCount, today,
    search, setSearch,
    stageFilter, setStageFilter,
    loading,
    viewMode, switchView,
    selectedLead, sheetOpen,
    openSheet, closeSheet,
    handleStageChange,
    fetchLeads,
  } = useSalesLeads();

  if (loading) return (
    <SalesLayout title="Pipeline">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="Pipeline">
      <div className="pb-28">

        {/* Search + View toggle */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMuted}`} />
            <Input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)}
              className={`pl-9 bg-[var(--bg-card)] border-[var(--border-color)] ${tPri} h-10`} />
          </div>
          <button onClick={() => switchView(viewMode === 'list' ? 'kanban' : 'list')}
            className={`${card} rounded-xl h-10 w-10 flex items-center justify-center flex-shrink-0`}
            title={viewMode === 'list' ? 'Kanban view' : 'List view'}>
            {viewMode === 'list'
              ? <LayoutGrid className={`h-4 w-4 ${tMuted}`} />
              : <AlignJustify className={`h-4 w-4 ${tMuted}`} />}
          </button>
        </div>

        {/* Stage filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar mb-4">
          {[
            { id: 'active', label: `Active (${activeCount})` },
            { id: 'all',    label: `All (${leads.length})` },
            ...STAGES.map(s => ({ id: s, label: `${STAGE[s].label} (${counts[s] || 0})` })),
          ].map(f => (
            <button key={f.id} onClick={() => setStageFilter(f.id)}
              className={`flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full font-medium border transition-all ${
                stageFilter === f.id ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} ${tMuted}`
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── KANBAN VIEW ── */}
        {viewMode === 'kanban' && (
          <>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 no-scrollbar">
              {STAGES
                .filter(s =>
                  stageFilter === 'active' ? !['lost'].includes(s) :
                  stageFilter === 'all'    ? true :
                  s === stageFilter
                )
                .map(s => {
                  const st = STAGE[s];
                  const colLeads = filtered.filter(l => l.stage === s);
                  return (
                    <div key={s} className="flex-shrink-0 w-[200px]">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className={`w-2 h-2 rounded-full ${st.dot}`} />
                        <span className={`text-xs font-semibold ${tSec}`}>{st.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] ${tMuted} ml-auto`}>{colLeads.length}</span>
                      </div>
                      <div className="space-y-2">
                        {colLeads.length === 0 ? (
                          <div className="h-16 rounded-xl border-2 border-dashed border-[var(--border-color)] flex items-center justify-center">
                            <span className={`text-[10px] ${tMuted}`}>Empty</span>
                          </div>
                        ) : colLeads.map(lead => (
                          <KanbanCard key={lead.lead_id} lead={lead} onTap={openSheet} />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className={`text-[10px] ${tMuted} text-center mt-1`}>Tap a card → log call, change stage, send WhatsApp</p>
          </>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && (
          <div className="space-y-2">
            <p className={`text-xs ${tMuted} mb-1`}>{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.length === 0 ? (
              <div className={`${card} rounded-xl p-10 text-center`}>
                <Building2 className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
                <p className={`text-sm ${tMuted}`}>No leads found</p>
              </div>
            ) : filtered.map(lead => {
              const st      = STAGE[lead.stage] || STAGE.new;
              const overdue = lead.next_followup_date && lead.next_followup_date <= today;
              return (
                <button key={lead.lead_id} onClick={() => openSheet(lead)}
                  className={`w-full text-left ${card} ${overdue ? 'border-[#e94560]/40' : ''} rounded-xl p-3 active:opacity-75 transition-opacity`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${tPri} truncate`}>{lead.company_name || lead.contact_name}</p>
                      <p className={`text-[11px] ${tMuted} truncate`}>
                        {lead.contact_name}{lead.contact_phone ? ` · ${lead.contact_phone}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {lead.lead_type && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[lead.lead_type] || ''}`}>{lead.lead_type}</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                  {lead.next_followup_date && (
                    <div className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full mb-2 ${
                      overdue ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] ' + tMuted
                    }`}>
                      <Clock className="h-3 w-3" />
                      {overdue ? 'Overdue · ' : 'Follow-up · '}{lead.next_followup_date}
                    </div>
                  )}
                  {lead.contact_phone && (
                    <div className="flex gap-2">
                      <button onClick={e => { e.stopPropagation(); callViaBonvoice({ kind: 'lead', ref_id: lead.lead_id, label: lead.contact_name || lead.company_name }); }}
                        className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 font-medium">
                        <Phone className="h-3 w-3" /> Call
                      </button>
                      <button onClick={e => { e.stopPropagation(); openSheet(lead); }}
                        className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 font-medium">
                        <MessageSquare className="h-3 w-3" /> WhatsApp
                      </button>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet open={sheetOpen} onClose={closeSheet}>
        <LeadActionSheet
          lead={selectedLead}
          onClose={closeSheet}
          onStageChange={handleStageChange}
          onRefresh={fetchLeads}
          perms={perms}
        />
      </BottomSheet>
    </SalesLayout>
  );
}
