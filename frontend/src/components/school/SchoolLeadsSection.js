import React from 'react';
import { Link } from 'react-router-dom';
import { Users, Clock, Eye, TrendingUp } from 'lucide-react';
import { Button } from '../ui/button';

const STAGE_CLS = {
  new:         'bg-blue-50 text-blue-700',
  contacted:   'bg-cyan-50 text-cyan-700',
  demo:        'bg-violet-50 text-violet-700',
  quoted:      'bg-amber-50 text-amber-700',
  negotiation: 'bg-orange-50 text-orange-700',
  won:         'bg-emerald-50 text-emerald-700',
  retention:   'bg-teal-50 text-teal-700',
  resell:      'bg-indigo-50 text-indigo-700',
  lost:        'bg-red-50 text-red-600',
};

function Badge({ label, cls }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${cls || 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

function EmptyState({ icon: Icon, label }) {
  return (
    <div className="py-16 text-center flex flex-col items-center gap-3">
      {Icon && <Icon className="h-10 w-10" style={{ color: '#d1d9e0' }} strokeWidth={1.2} />}
      <p className="text-sm" style={{ color: '#94a3b8' }}>{label}</p>
    </div>
  );
}

function fmt(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export default function SchoolLeadsSection({ leads, filteredLeads, stageFilter, setStageFilter, tk, onCreate, onEnroll }) {
  return (
    <div className="sp-tab space-y-4">
      {/* Stage chips + Create Lead button */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {['all', 'new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost'].map(s => (
            <button key={s} onClick={() => setStageFilter(s)}
              className={`text-[11px] px-3 py-1 rounded-full font-semibold transition-all border capitalize ${
                stageFilter === s
                  ? 'bg-[#e94560] text-white border-[#e94560]'
                  : `${tk.border} ${tk.tm} hover:border-[#e94560] hover:text-[#e94560]`
              }`}>
              {s === 'all' ? `All · ${leads.length}` : s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {onEnroll && (
            <Button onClick={onEnroll} size="sm" variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="enroll-drip-btn">Enroll in Drip</Button>
          )}
          {onCreate && (
            <Button onClick={onCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-lead-on-profile">+ Create Lead</Button>
          )}
        </div>
      </div>

      {filteredLeads.length === 0 ? (
        <EmptyState icon={TrendingUp} label={stageFilter === 'all' ? 'No leads for this school yet.' : `No leads in "${stageFilter}" stage.`} />
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {filteredLeads.map(lead => (
            <div key={lead.lead_id} className="px-5 py-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold text-sm ${tk.t1}`}>{lead.contact_name}</span>
                  {lead.stage     && <Badge label={lead.stage}     cls={STAGE_CLS[lead.stage]} />}
                  {lead.lead_type && <Badge label={lead.lead_type} cls={
                    lead.lead_type === 'hot' ? 'bg-red-50 text-red-600'
                  : lead.lead_type === 'warm' ? 'bg-amber-50 text-amber-700'
                  : 'bg-blue-50 text-blue-700'} />}
                </div>
                {(lead.designation || lead.contact_phone) && (
                  <p className={`text-xs ${tk.tm} mt-0.5`}>
                    {lead.designation}{lead.designation && lead.contact_phone ? ' · ' : ''}{lead.contact_phone}
                  </p>
                )}
                <div className={`flex items-center gap-4 mt-1.5 text-xs ${tk.tm} flex-wrap`}>
                  {lead.assigned_name      && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{lead.assigned_name}</span>}
                  {lead.next_followup_date && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Followup {fmt(lead.next_followup_date)}</span>}
                </div>
              </div>
              <Link to={`/leads?lead=${lead.lead_id}`}>
                <Button size="sm" variant="ghost" className={`${tk.tm} hover:text-[#e94560] h-8 w-8 p-0`}>
                  <Eye className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
