import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye } from 'lucide-react';
import { Button } from '../ui/button';
import { formatCurrency, formatDate } from '../../lib/utils';

const QUOT_STATUS_CLS = {
  draft:     'bg-slate-100 text-slate-600 border-slate-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  sent:      'bg-blue-50 text-blue-700 border-blue-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
};

function statusCls(s) {
  return QUOT_STATUS_CLS[s?.toLowerCase?.()] || 'bg-slate-100 text-slate-600 border-slate-200';
}

/**
 * Recent quotations card — desktop table + mobile cards.
 * Props: recentQuotations, tk (theme tokens), isDark, rv (animation fn)
 */
export default function RecentQuotationsCard({ recentQuotations, tk, isDark, rv }) {
  return (
    <div className={`${rv('delay-[120ms]')} ${tk.card} border rounded-2xl overflow-hidden`}>
      <div className={`flex items-center justify-between px-5 sm:px-6 py-4 border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
        <div>
          <p className={`font-bold text-base ${tk.t1}`} data-testid="recent-quotations-title">
            Recent Quotations
          </p>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Last 5 created</p>
        </div>
        <Link
          to="/quotations"
          className="text-[11px] font-semibold text-[#e94560] hover:text-[#f05c75] flex items-center gap-1 transition-colors"
          data-testid="view-all-quotations-link"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {recentQuotations.length === 0 ? (
        <div className="py-16 text-center">
          <p className={`text-sm ${tk.tm}`}>No quotations yet</p>
          <Link to="/create-quotation">
            <Button size="sm" className="mt-4 bg-[#e94560] hover:bg-[#f05c75] text-white rounded-lg px-4 h-8 text-xs">
              Create first quotation
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block" data-testid="recent-quotations-table">
            <table className="w-full">
              <thead>
                <tr className={`border-b ${isDark ? 'border-[var(--border-color)]' : 'border-[#f1f5f9]'}`}>
                  {['Quote #', 'School', 'Package', 'Amount', 'Status', 'Date'].map(h => (
                    <th key={h} className={`text-left text-[10px] uppercase tracking-[0.12em] font-semibold ${tk.tm} px-5 sm:px-6 py-3`}>
                      {h}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className={`divide-y ${tk.divide}`}>
                {recentQuotations.map((q) => (
                  <tr
                    key={q.quotation_id}
                    className={`${tk.row} transition-colors`}
                    data-testid={`quotation-row-${q.quote_number}`}
                  >
                    <td className="px-5 sm:px-6 py-3.5 text-sm font-semibold text-[#e94560] tabular-nums">
                      {q.quote_number || q.quotation_number || '—'}
                    </td>
                    <td className={`px-5 sm:px-6 py-3.5 text-sm font-medium ${tk.t1} max-w-[160px] truncate`}>
                      {q.school_name}
                    </td>
                    <td className={`px-5 sm:px-6 py-3.5 text-sm ${tk.t2}`}>{q.package_name || '—'}</td>
                    <td className={`px-5 sm:px-6 py-3.5 text-sm font-bold ${tk.t1} tabular-nums`}>
                      {formatCurrency(q.grand_total)}
                    </td>
                    <td className="px-5 sm:px-6 py-3.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border capitalize ${statusCls(q.quotation_status || q.status)}`}>
                        {q.quotation_status || q.status || 'draft'}
                      </span>
                    </td>
                    <td className={`px-5 sm:px-6 py-3.5 text-xs ${tk.tm} tabular-nums`}>
                      {formatDate(q.created_at)}
                    </td>
                    <td className="pr-3">
                      <Link to={`/view-quotation/${q.quotation_id}`}>
                        <Button size="sm" variant="ghost" className={`${tk.tm} hover:text-[#e94560] h-7 w-7 p-0`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-[var(--border-color)]">
            {recentQuotations.map((q) => (
              <Link
                key={q.quotation_id}
                to={`/view-quotation/${q.quotation_id}`}
                className={`flex items-center gap-3 px-4 py-3.5 ${tk.row} transition-colors`}
                data-testid={`quotation-card-${q.quote_number}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#e94560] tabular-nums">
                      {q.quote_number || q.quotation_number || '—'}
                    </span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${statusCls(q.quotation_status || q.status)}`}>
                      {q.quotation_status || q.status || 'draft'}
                    </span>
                  </div>
                  <p className={`text-sm font-medium ${tk.t1} truncate`}>{q.school_name}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${tk.t1} tabular-nums`}>{formatCurrency(q.grand_total)}</p>
                  <p className={`text-xs ${tk.tm} mt-0.5 tabular-nums`}>{formatDate(q.created_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
