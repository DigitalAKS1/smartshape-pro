import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Eye, Send, Calendar } from 'lucide-react';
import { Button } from '../ui/button';

const QUOT_CLS = {
  draft:     'bg-slate-100 text-slate-600',
  pending:   'bg-amber-50 text-amber-700',
  sent:      'bg-blue-50 text-blue-700',
  confirmed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-600',
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

function fmtMoney(n) {
  if (!n) return '₹0';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

// ── Quotations / Sales tab ────────────────────────────────────────────────────
export function SchoolSalesSection({ quotations, metrics, tk }) {
  return (
    <div className="sp-tab space-y-4">
      {quotations.length > 0 && (
        <div className="flex items-center justify-between">
          <p className={`text-sm ${tk.tm}`}>{quotations.length} quotation{quotations.length !== 1 ? 's' : ''}</p>
          <p className={`text-sm font-semibold ${tk.t1}`}>
            Pipeline: <span className="text-[#e94560]">{fmtMoney(metrics.total_revenue_quoted)}</span>
          </p>
        </div>
      )}
      {quotations.length === 0 ? (
        <EmptyState icon={FileText} label="No quotations raised for this school yet." />
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {quotations.map(q => (
            <div key={q.quotation_id} className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold text-sm ${tk.t1}`}>{q.quotation_number || q.quotation_id}</span>
                  <Badge label={q.status} cls={QUOT_CLS[q.status]} />
                </div>
                <p className="sp-num text-xl font-black text-[#e94560] mt-0.5">{fmtMoney(q.grand_total)}</p>
                <div className={`flex items-center gap-3 mt-0.5 text-xs ${tk.tm} flex-wrap`}>
                  {q.items?.length > 0 && <span>{q.items.length} item{q.items.length !== 1 ? 's' : ''}</span>}
                  {q.created_by_name && <span>{q.created_by_name}</span>}
                  <span>{fmt(q.created_at)}</span>
                </div>
              </div>
              <Link to={`/view-quotation/${q.quotation_id}`}>
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

// ── Marketing / Dispatches tab ─────────────────────────────────────────────────
export function SchoolMarketingSection({ dispatches, tk }) {
  return (
    <div className="sp-tab space-y-4">
      <p className={`text-sm ${tk.tm}`}>{dispatches.length} dispatch{dispatches.length !== 1 ? 'es' : ''}</p>
      {dispatches.length === 0 ? (
        <EmptyState icon={Send} label="No brochures or samples dispatched to this school yet." />
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {dispatches.map((d, i) => (
            <div key={i} className="px-5 py-4 flex items-start gap-4">
              <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-2" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold text-sm ${tk.t1} capitalize`}>{d.material_type}</span>
                  {d.received_confirmed && <Badge label="Received" cls="bg-emerald-50 text-emerald-700" />}
                </div>
                {d.description && <p className={`text-xs ${tk.tm} mt-0.5`}>{d.description}</p>}
                <div className={`flex items-center gap-3 mt-1 text-xs ${tk.tm} flex-wrap`}>
                  {d.courier_name    && <span>Via {d.courier_name}</span>}
                  {d.tracking_number && <span>#{d.tracking_number}</span>}
                  <span>{fmt(d.sent_date || d.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Visits & Meetings tab ──────────────────────────────────────────────────────
export function SchoolVisitsSection({ visits, meetings, tk }) {
  const STATUS_CLS = {
    planned:    'bg-amber-50 text-amber-700',
    checked_in: 'bg-blue-50 text-blue-700',
    completed:  'bg-emerald-50 text-emerald-700',
    cancelled:  'bg-red-50 text-red-600',
  };
  const items = [
    ...visits.map(v => ({ ...v, _type: 'visit', _date: v.visit_date })),
    ...meetings.map(m => ({ ...m, _type: 'meeting', _date: m.followup_date })),
  ].sort((a, b) => (b._date || '').localeCompare(a._date || ''));

  return (
    <div className="sp-tab">
      {items.length === 0 ? (
        <EmptyState icon={Calendar} label="No visits or meetings recorded for this school yet." />
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {items.map((item, i) => (
            <div key={i} className="px-5 py-4 flex items-start gap-4">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${item._type === 'visit' ? 'bg-blue-400' : 'bg-violet-400'}`} />
              <div className="flex-1 min-w-0">
                {item._type === 'visit' ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-sm font-semibold ${tk.t1}`}>{fmt(item._date)}{item.visit_time ? ` · ${item.visit_time}` : ''}</span>
                      {item.status && <Badge label={item.status.replace('_', ' ')} cls={STATUS_CLS[item.status] || 'bg-slate-100 text-slate-600'} />}
                      {item.source === 'field_visit' && <Badge label="Self-booked" cls="bg-slate-100 text-slate-500" />}
                    </div>
                    {(item.rep_name || item.assigned_name) && (
                      <p className={`text-xs font-medium ${tk.t2}`}>Rep: {item.rep_name || item.assigned_name}</p>
                    )}
                    {item.purpose && <p className={`text-xs ${tk.tm} mt-0.5`}>{item.purpose}</p>}
                    {item.outcome && <p className={`text-xs ${tk.tm}`}>Outcome: {item.outcome}</p>}
                    {item.notes   && <p className={`text-xs ${tk.tm}`}>Notes: {item.notes}</p>}
                    {item.check_in_time && (
                      <p className={`text-xs ${tk.tm}`}>
                        In: {new Date(item.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        {item.check_out_time && ` → Out: ${new Date(item.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge label="Meeting" cls="bg-violet-50 text-violet-700" />
                      <span className={`text-xs ${tk.tm}`}>{fmt(item._date)}</span>
                    </div>
                    {item.assigned_to && <p className={`text-sm font-medium ${tk.t1}`}>{item.assigned_to}</p>}
                    {item.notes       && <p className={`text-xs ${tk.tm} mt-0.5`}>{item.notes}</p>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Activity Feed tab ──────────────────────────────────────────────────────────
export function SchoolActivityFeed({ feedItems, tk }) {
  function fmt(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  }
  return (
    <div className="sp-tab">
      {feedItems.length === 0 ? (
        <EmptyState label="No activity recorded for this school yet." />
      ) : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {feedItems.map((item, i) => (
            <div key={i} className="px-5 py-3.5 flex items-start gap-4">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${item.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <p className={`text-sm font-medium ${tk.t1}`}>{item.label}</p>
                  <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>{fmt(item.date)}</span>
                </div>
                {item.detail && <p className={`text-xs ${tk.tm} mt-0.5 truncate`}>{item.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
