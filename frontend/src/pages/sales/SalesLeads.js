import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SalesLayout from '../../components/layouts/SalesLayout';
import { leads as leadsApi, tasks as tasksApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Phone, MessageSquare, Clock, Search, ChevronDown, Plus, User, Building2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';

const STAGE = {
  new:         { label: 'New',         cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  contacted:   { label: 'Contacted',   cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  demo:        { label: 'Demo',        cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  quoted:      { label: 'Quoted',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  negotiation: { label: 'Negotiation', cls: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  won:         { label: 'Won',         cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  lost:        { label: 'Lost',        cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const STAGE_ORDER = ['new','contacted','demo','quoted','negotiation','won','lost'];

const card   = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
const tPri   = 'text-[var(--text-primary)]';
const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

const openWa = (phone) => {
  const n = phone?.replace(/\D/g, '');
  if (n) window.open(`https://wa.me/${n.startsWith('91') ? n : '91' + n}`, '_blank');
};

export default function SalesLeads() {
  const { user } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  const [leads, setLeads]     = useState([]);
  const [search, setSearch]   = useState('');
  const [stageFilter, setStageFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchLeads(); }, []);

  const fetchLeads = async () => {
    try {
      const res = await leadsApi.getAll();
      setLeads(res.data || []);
    } catch { toast.error('Failed to load leads'); }
    finally { setLoading(false); }
  };

  const filtered = leads.filter(l => {
    const matchSearch = !search ||
      l.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      l.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      l.contact_phone?.includes(search);
    const matchStage =
      stageFilter === 'all'    ? true :
      stageFilter === 'active' ? !['won','lost'].includes(l.stage) :
      l.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const counts = {};
  leads.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  const activeCount = leads.filter(l => !['won','lost'].includes(l.stage)).length;

  if (loading) return (
    <SalesLayout title="My Leads">
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </SalesLayout>
  );

  return (
    <SalesLayout title="My Leads">
      <div className="space-y-4 pb-28">

        {/* Search */}
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMuted}`} />
          <Input
            placeholder="Search leads, contacts, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`pl-9 bg-[var(--bg-card)] border-[var(--border-color)] ${tPri}`}
          />
        </div>

        {/* Stage filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'active', label: `Active (${activeCount})` },
            { id: 'all',    label: `All (${leads.length})` },
            ...STAGE_ORDER.map(s => ({ id: s, label: `${STAGE[s]?.label} (${counts[s] || 0})` })),
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setStageFilter(f.id)}
              className={`flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full font-medium transition-all border ${
                stageFilter === f.id
                  ? 'bg-[#e94560] text-white border-[#e94560]'
                  : `${card} ${tMuted} border-[var(--border-color)]`
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Count */}
        <p className={`text-xs ${tMuted}`}>{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>

        {/* Lead cards */}
        {filtered.length === 0 ? (
          <div className={`${card} rounded-xl p-10 text-center`}>
            <Building2 className={`h-10 w-10 ${tMuted} mx-auto mb-2`} />
            <p className={`text-sm ${tMuted}`}>No leads found</p>
          </div>
        ) : filtered.map(lead => {
          const stage      = STAGE[lead.stage] || STAGE.new;
          const isOverdue  = lead.next_followup_date && lead.next_followup_date <= today;
          const isExpanded = expanded === lead.lead_id;

          return (
            <div key={lead.lead_id} className={`${card} ${isOverdue ? 'border-[#e94560]/40' : ''} rounded-xl overflow-hidden`}>
              {/* Main row */}
              <div
                className="p-3 cursor-pointer active:opacity-80"
                onClick={() => setExpanded(isExpanded ? null : lead.lead_id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tPri} truncate`}>
                      {lead.company_name || lead.contact_name}
                    </p>
                    <p className={`text-[11px] ${tMuted} truncate`}>
                      {lead.contact_name}{lead.contact_phone ? ` · ${lead.contact_phone}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${stage.cls}`}>
                      {stage.label}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 ${tMuted} transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Follow-up indicator */}
                {lead.next_followup_date && (
                  <div className={`flex items-center gap-1 mt-1.5 text-[10px] font-medium w-fit px-2 py-0.5 rounded-full ${
                    isOverdue ? 'bg-[#e94560]/10 text-[#e94560]' : 'bg-[var(--bg-primary)] ' + tMuted
                  }`}>
                    <Clock className="h-3 w-3" />
                    {isOverdue ? 'Overdue · ' : 'Follow-up · '}{lead.next_followup_date}
                  </div>
                )}
              </div>

              {/* Expanded actions */}
              {isExpanded && (
                <div className="border-t border-[var(--border-color)] px-3 py-2.5 bg-[var(--bg-primary)]">
                  {/* Info row */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3">
                    {lead.lead_type && (
                      <div>
                        <p className={`text-[10px] ${tMuted}`}>Type</p>
                        <p className={`text-xs font-medium ${tSec} capitalize`}>{lead.lead_type}</p>
                      </div>
                    )}
                    {lead.source && (
                      <div>
                        <p className={`text-[10px] ${tMuted}`}>Source</p>
                        <p className={`text-xs font-medium ${tSec}`}>{lead.source}</p>
                      </div>
                    )}
                    {lead.contact_email && (
                      <div className="col-span-2">
                        <p className={`text-[10px] ${tMuted}`}>Email</p>
                        <a href={`mailto:${lead.contact_email}`} className={`text-xs text-[#e94560]`}>{lead.contact_email}</a>
                      </div>
                    )}
                    {lead.notes && (
                      <div className="col-span-2">
                        <p className={`text-[10px] ${tMuted}`}>Last note</p>
                        <p className={`text-xs ${tSec} line-clamp-2`}>{lead.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {lead.contact_phone && (
                      <>
                        <a
                          href={`tel:${lead.contact_phone}`}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-blue-500/10 text-blue-400 font-medium"
                        >
                          <Phone className="h-3.5 w-3.5" /> Call
                        </a>
                        <button
                          onClick={() => openWa(lead.contact_phone)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-green-500/10 text-green-400 font-medium"
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SalesLayout>
  );
}
