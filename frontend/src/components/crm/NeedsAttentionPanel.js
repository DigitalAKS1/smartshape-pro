import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { STAGES } from '../../lib/crmConstants';

/**
 * The deals to deal with today, in the order to deal with them.
 *
 * "Needs attention: 5" sat on the dashboard as a number nobody could open — the
 * list behind it was fetched only to be counted. So the one screen that could
 * have told a rep where to start told them a quantity instead.
 *
 * Order comes from the server: value discounted by how often comparable schools
 * actually convert, longest-silent breaking ties. The reason each deal is here
 * is shown next to it, because "needs attention" on its own is an accusation
 * rather than an instruction.
 */

const REASON_LABEL = {
  overdue: 'Follow-up overdue',
  stuck: 'Stuck in this stage',
  no_next_action: 'No next step',
};

const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const stageOf = (id) => STAGES.find(s => s.id === id);

export default function NeedsAttentionPanel({ open, onOpenChange, rows = [], onPick }) {
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-[var(--bg-card)] border-[var(--border-color)]">
        <DialogHeader>
          <DialogTitle className={textPri}>Deals needing attention</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className={`py-6 text-center text-sm ${textMuted}`} data-testid="attention-empty">
            Nothing is overdue, stuck or missing a next step. Rare — enjoy it.
          </p>
        ) : (
          <>
            <p className={`text-xs ${textSec}`}>
              Best first: what each deal is worth, weighted by how often schools like it
              actually buy. Where two are close, the one nobody has touched comes first.
            </p>
            <ul className="mt-2 max-h-[60vh] space-y-1.5 overflow-y-auto" data-testid="attention-list">
              {rows.map(r => {
                const stage = stageOf(r.stage);
                return (
                  <li key={r.lead_id}>
                    <button
                      type="button"
                      onClick={() => onPick && onPick(r)}
                      data-testid={`attention-row-${r.lead_id}`}
                      className="w-full rounded-md border border-[var(--border-color)] p-2.5 text-left hover:border-[#e94560] focus:outline-none focus-visible:border-[#e94560]"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={`text-sm font-medium ${textPri}`}>
                          {r.company_name || 'Unnamed'}
                          {r.contact_name && <span className={`ml-2 text-xs font-normal ${textMuted}`}>{r.contact_name}</span>}
                        </span>
                        <span className={`text-sm ${textPri}`}>{inr(r.deal_value)}</span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {stage && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${stage.color}`}>
                            {stage.label}
                          </span>
                        )}
                        {(r.reasons || []).map(code => (
                          <span key={code}
                            className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                            {REASON_LABEL[code] || code}
                          </span>
                        ))}
                        {r.days_silent > 0 && (
                          <span className={`text-[10px] ${textMuted}`}>
                            silent {r.days_silent} day{r.days_silent === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>

                      {/* Say why it is ranked where it is. An order nobody can
                          account for is an order nobody will trust. */}
                      {r.fit_rate != null && (
                        <p className={`mt-1 text-[11px] ${textMuted}`} data-testid={`attention-why-${r.lead_id}`}>
                          {inr(r.expected_value)} expected — {Math.round(r.fit_rate)}% of comparable schools buy
                        </p>
                      )}
                      {r.fit_rate == null && (
                        <p className={`mt-1 text-[11px] ${textMuted}`} data-testid={`attention-why-${r.lead_id}`}>
                          Ranked on value — not enough comparable schools yet
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
