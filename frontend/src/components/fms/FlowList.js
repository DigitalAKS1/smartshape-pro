import React from 'react';
import { Plus, Search, RefreshCw, Workflow } from 'lucide-react';
import { Input } from '../ui/input';
import { FlowCard } from './FlowDetailPanel';

const PINK = '#e94560';

export default function FlowList({
  filtered, loading, search, setSearch, filterType, setFType,
  templates, expandedFlow, setExpanded, activeFlowData, setAFD,
  loadFlow, setTab,
  openComplete, doApprove, doReject, openPayment,
  card, textPri, textSec, textMuted, inputCls,
}) {
  return (
    <>
      <div className={`${card} border rounded-xl p-3 flex flex-wrap gap-2`}>
        <div className="relative flex-1 min-w-40">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title, customer, ref…" className={`pl-8 h-8 text-xs ${inputCls}`} />
        </div>
        <select value={filterType} onChange={e => setFType(e.target.value)}
          className={`h-8 px-2 text-xs rounded-lg border border-[var(--border-color)] ${inputCls}`}>
          <option value="">All Templates</option>
          {templates.map(t => <option key={t.template_id} value={t.key}>{t.name}</option>)}
        </select>
        <button onClick={() => setTab('create')}
          className="h-8 px-4 rounded-lg text-white text-xs font-semibold flex items-center gap-1.5"
          style={{ background: PINK }}>
          <Plus className="h-3.5 w-3.5" /> New Flow
        </button>
      </div>

      <div className="space-y-3">
        {loading && (
          <div className={`${card} border rounded-xl py-16 text-center ${textMuted}`}>
            <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-2" style={{ borderColor: PINK, borderTopColor: 'transparent' }} />
            Loading flows…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className={`${card} border rounded-xl py-16 text-center`}>
            <Workflow className="h-10 w-10 mx-auto mb-2 opacity-20" style={{ color: PINK }} />
            <p className={`text-sm ${textMuted}`}>No active flows — create one from a template</p>
          </div>
        )}
        {filtered.map(flow => (
          <FlowCard key={flow.flow_id} flow={flow}
            expanded={expandedFlow === flow.flow_id}
            activeFlowData={expandedFlow === flow.flow_id ? activeFlowData : null}
            onToggle={async () => {
              if (expandedFlow === flow.flow_id) { setExpanded(null); setAFD(null); }
              else { setExpanded(flow.flow_id); const d = await loadFlow(flow.flow_id); setAFD(d); }
            }}
            onComplete={openComplete} onApprove={doApprove} onReject={doReject}
            onPayment={() => openPayment(flow)}
            card={card} textPri={textPri} textSec={textSec} textMuted={textMuted}
          />
        ))}
      </div>
    </>
  );
}
