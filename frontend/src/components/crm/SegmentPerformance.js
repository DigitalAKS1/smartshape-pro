import React, { useCallback, useEffect, useState } from 'react';
import { crmReports } from '../../lib/api';

/**
 * Which kinds of school actually buy.
 *
 * "We do well with big CBSE schools" is the sort of thing a sales team believes
 * for years without checking. This turns it into a number — and, just as often,
 * shows the belief resting on four data points.
 *
 * Every rate carries its sample size, and a segment too small to mean anything
 * is greyed and labelled rather than quietly dropped: knowing you cannot yet
 * answer a question is itself an answer, and hiding thin rows would leave the
 * reader assuming the strong ones are the whole picture.
 */

const LABELS = {
  board: 'Board',
  school_type: 'Type',
  strength_band: 'Size',
  city: 'City',
};

const pct = (n) => `${Number(n || 0).toFixed(0)}%`;
const inr = (n) => (n ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—');

export default function SegmentPerformance() {
  const [attribute, setAttribute] = useState('board');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (attr) => {
    setLoading(true);
    setError('');
    try {
      const r = await crmReports.segmentPerformance(attr);
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load segment performance');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(attribute); }, [attribute, load]);

  const rows = data?.rows || [];
  const best = rows.find(r => r.reliable);
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] p-4"
      data-testid="segment-performance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`text-base font-medium ${textPri}`}>Who actually buys</h3>
          <p className={`mt-0.5 text-xs ${textSec}`}>
            Share of schools in each group that have ever placed an order.
          </p>
        </div>
        <div className="flex gap-1">
          {Object.keys(LABELS).map(a => (
            <button
              key={a}
              type="button"
              onClick={() => setAttribute(a)}
              data-testid={`segment-by-${a}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                attribute === a
                  ? 'border-[#e94560] bg-[#e94560] text-white'
                  : `border-[var(--border-color)] ${textSec} hover:border-[#e94560] hover:text-[#e94560]`
              }`}
            >
              {LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className={`mt-3 text-sm ${textMuted}`}>Loading…</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className={`mt-3 text-sm ${textMuted}`}>
          No schools carry a {LABELS[attribute].toLowerCase()} yet, so there is nothing to compare.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <>
          {best && (
            <p className={`mt-3 text-sm ${textSec}`}>
              Best group so far: <strong className={textPri}>{best.value}</strong> —
              {' '}{best.customers} of {best.total} have ordered ({pct(best.conversion_rate)}).
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-[11px] uppercase tracking-wide ${textMuted}`}>
                  <th className="py-1.5 pr-3 font-medium">{LABELS[attribute]}</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Schools</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Ordered</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Rate</th>
                  <th className="py-1.5 font-medium text-right">Avg value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.value}
                    data-testid={`segment-row-${r.value}`}
                    className={`border-t border-[var(--border-color)] ${r.reliable ? '' : 'opacity-55'}`}>
                    <td className={`py-2 pr-3 ${textPri}`}>
                      {r.value}
                      {!r.reliable && (
                        <span className={`ml-2 text-[10px] ${textMuted}`}>too few to tell</span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 text-right ${textSec}`}>{r.total}</td>
                    <td className={`py-2 pr-3 text-right ${textSec}`}>{r.customers}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${r.reliable ? textPri : textMuted}`}>
                      {pct(r.conversion_rate)}
                    </td>
                    <td className={`py-2 text-right ${textSec}`}>{inr(r.avg_customer_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-2 text-[11px] ${textMuted}`}>
            Groups with fewer than {data.min_sample} schools are shown but not counted —
            a high rate off a handful of schools is chance, not a pattern.
          </p>
        </>
      )}
    </div>
  );
}
