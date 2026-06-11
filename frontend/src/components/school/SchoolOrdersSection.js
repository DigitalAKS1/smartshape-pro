import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Eye, Send, Calendar, Package, MessageSquare, Receipt } from 'lucide-react';
import { Button } from '../ui/button';
import PlanVisitButton from './PlanVisitButton';

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

const ORDER_CLS = {
  pending:    'bg-amber-50 text-amber-700',
  confirmed:  'bg-blue-50 text-blue-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered:  'bg-emerald-50 text-emerald-700',
  cancelled:  'bg-red-50 text-red-600',
};

function RollupCard({ label, value, sub, tk, accent }) {
  return (
    <div className={`${tk.card} border ${tk.border} rounded-2xl px-4 py-3`}>
      <p className={`text-[11px] uppercase tracking-wide ${tk.tm}`}>{label}</p>
      <p className={`sp-num text-2xl font-black mt-0.5 ${accent ? 'text-[#e94560]' : tk.t1}`}>{fmtMoney(value)}</p>
      {sub && <p className={`text-[11px] ${tk.tm} mt-0.5`}>{sub}</p>}
    </div>
  );
}

// ── Quotations + Sales Orders tab ─────────────────────────────────────────────
export function SchoolSalesSection({ quotations, orders = [], invoices = [], metrics, tk }) {
  return (
    <div className="sp-tab space-y-5">
      {/* Revenue rollup: Quoted → Ordered → Invoiced → Paid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RollupCard label="Quoted" value={metrics.total_revenue_quoted} sub={`${quotations.length} quote${quotations.length !== 1 ? 's' : ''}`} tk={tk} />
        <RollupCard label="Ordered" value={metrics.total_revenue_ordered} sub={`${orders.length} order${orders.length !== 1 ? 's' : ''}`} tk={tk} accent />
        <RollupCard label="Invoiced" value={metrics.total_invoiced} sub={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`} tk={tk} />
        <RollupCard label="Paid" value={metrics.total_paid} sub={`of ${fmtMoney(metrics.total_revenue_ordered)}`} tk={tk} />
      </div>

      {/* Quotations */}
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm} mb-2`}>Quotations</p>
        {quotations.length === 0 ? (
          <EmptyState icon={FileText} label="No quotations raised for this school yet." />
        ) : (
          <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
            {quotations.map(q => (
              <div key={q.quotation_id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-sm ${tk.t1}`}>{q.quotation_number || q.quotation_id}</span>
                    <Badge label={q.status || q.quotation_status} cls={QUOT_CLS[q.status || q.quotation_status]} />
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

      {/* Sales Orders */}
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm} mb-2`}>Sales Orders</p>
        {orders.length === 0 ? (
          <EmptyState icon={Package} label="No sales orders for this school yet." />
        ) : (
          <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
            {orders.map(o => (
              <div key={o.order_id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-sm ${tk.t1}`}>{o.order_number || o.order_id}</span>
                    <Badge label={o.order_status} cls={ORDER_CLS[o.order_status]} />
                    {o.production_stage && <Badge label={String(o.production_stage).replace(/_/g, ' ')} cls="bg-slate-100 text-slate-600" />}
                  </div>
                  <p className="sp-num text-xl font-black text-[#e94560] mt-0.5">{fmtMoney(o.grand_total)}</p>
                  <div className={`flex items-center gap-3 mt-0.5 text-xs ${tk.tm} flex-wrap`}>
                    <span>Paid {fmtMoney(o.payment_received)}</span>
                    {o.package_name && <span>{o.package_name}</span>}
                    <span>{fmt(o.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoices */}
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm} mb-2`}>Invoices · {invoices.length}</p>
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} label="No invoices uploaded for this school yet." />
        ) : (
          <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
            {invoices.map(inv => (
              <div key={inv.invoice_id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-sm ${tk.t1}`}>{inv.invoice_number}</span>
                    {inv.order_number && <Badge label={`SO ${inv.order_number}`} cls="bg-blue-50 text-blue-700" />}
                    {inv.match_status === 'unmatched' && <Badge label="unmatched" cls="bg-red-50 text-red-600" />}
                  </div>
                  <p className="sp-num text-xl font-black text-[#e94560] mt-0.5">{fmtMoney(inv.total_amount)}</p>
                  <div className={`flex items-center gap-3 mt-0.5 text-xs ${tk.tm} flex-wrap`}>
                    {inv.tax_amount > 0 && <span>incl. GST {fmtMoney(inv.tax_amount)}</span>}
                    <span>{fmt(inv.invoice_date || inv.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Marketing / Dispatches tab ─────────────────────────────────────────────────
const CHANNEL = {
  whatsapp: { label: 'WhatsApp', cls: 'text-green-600',  dot: 'bg-green-400' },
  email:    { label: 'Email',    cls: 'text-blue-600',   dot: 'bg-blue-400' },
  drip:     { label: 'Drip',     cls: 'text-violet-600', dot: 'bg-violet-400' },
  greeting: { label: 'Greeting', cls: 'text-amber-600',  dot: 'bg-amber-400' },
};
const COMM_STATUS = (s) => s === 'sent' ? 'bg-emerald-50 text-emerald-700'
  : s === 'failed' ? 'bg-red-50 text-red-600'
  : s === 'active' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600';

export function SchoolMarketingSection({ dispatches, communications = [], tk }) {
  return (
    <div className="sp-tab space-y-5">
      {/* Communications — WhatsApp / Email / Drip / Greetings to this school's contacts */}
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm} mb-2`}>Communications · {communications.length}</p>
        {communications.length === 0 ? (
          <EmptyState icon={MessageSquare} label="No WhatsApp, email, drip or greeting messages to this school yet." />
        ) : (
          <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
            {communications.slice(0, 100).map((m, i) => {
              const ch = CHANNEL[m.channel] || {};
              return (
                <div key={i} className="px-5 py-3 flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${ch.dot || 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase ${ch.cls || tk.tm}`}>{ch.label || m.channel}</span>
                      <span className={`text-sm ${tk.t1} truncate`}>{m.label}</span>
                      {m.status && <Badge label={m.status} cls={COMM_STATUS(m.status)} />}
                    </div>
                    <div className={`flex items-center gap-2 mt-0.5 text-xs ${tk.tm} flex-wrap`}>
                      {m.detail && <span>{m.detail}</span>}
                      <span>{fmt(m.at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Brochures & Samples dispatched */}
      <div>
        <p className={`text-[11px] uppercase tracking-wide ${tk.tm} mb-2`}>Brochures &amp; Samples · {dispatches.length}</p>
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
    </div>
  );
}

// ── Visits & Meetings tab ──────────────────────────────────────────────────────
export function SchoolVisitsSection({ visits, meetings, tk, school, onDone }) {
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
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm font-semibold ${tk.t1}`}>Visits & Meetings</p>
        {school && <PlanVisitButton school={school} onDone={onDone} />}
      </div>
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
