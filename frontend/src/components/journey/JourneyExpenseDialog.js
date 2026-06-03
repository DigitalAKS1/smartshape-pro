import React from 'react';
import { Loader2, ReceiptText, CheckCircle2, Navigation, UtensilsCrossed, MoreHorizontal, Bike, Car } from 'lucide-react';
import { VEHICLE_OPTS, EXPENSE_TYPES } from '../../hooks/useJourneyTracker';

const VEHICLE_ICONS = { two_wheeler: Bike, four_wheeler: Car };
const EXPENSE_ICONS = { travel: Navigation, food: UtensilsCrossed, other: MoreHorizontal };

export default function JourneyExpenseDialog({
  expensePrompt,
  expType, setExpType,
  vehicle, setVehicle,
  expAmt, setExpAmt,
  expNote, setExpNote,
  expBusy,
  submitExpense,
  setExpenseDialog,
}) {
  return (
    <div className="fixed inset-0 z-[300] flex items-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExpenseDialog(false)} />
      <div className="relative w-full bg-[var(--bg-card)] rounded-t-3xl flex flex-col" style={{ maxHeight: '88dvh' }}>
        {/* Drag handle */}
        <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 bg-[var(--border-color)] rounded-full" />
        </div>
        <div className="flex-shrink-0 px-5 pt-2 pb-3.5 border-b border-[var(--border-color)]">
          <p className="text-lg font-bold text-[var(--text-primary)] leading-tight">Add Expense</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {expensePrompt.total_km} km journey · {expensePrompt.stops?.length || 0} stops · {expensePrompt.date}
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* Expense type */}
          <div>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-3">Expense Type</p>
            <div className="grid grid-cols-3 gap-2">
              {EXPENSE_TYPES.map(et => {
                const EIcon = EXPENSE_ICONS[et.value];
                const sel = expType === et.value;
                return (
                  <button
                    key={et.value}
                    onClick={() => setExpType(et.value)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-all ${
                      sel ? 'border-[#e94560]/50 bg-[#e94560]/10' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'
                    }`}
                  >
                    <EIcon className={`h-5 w-5 ${sel ? 'text-[#e94560]' : 'text-[var(--text-secondary)]'}`} />
                    <span className={`text-[10px] font-bold text-center leading-tight ${sel ? 'text-[#e94560]' : 'text-[var(--text-secondary)]'}`}>
                      {et.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vehicle — travel only */}
          {expType === 'travel' && (
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-3">Vehicle</p>
              <div className="grid grid-cols-2 gap-3">
                {VEHICLE_OPTS.map(vo => {
                  const VIcon = VEHICLE_ICONS[vo.value];
                  const sel = vehicle === vo.value;
                  return (
                    <button
                      key={vo.value}
                      onClick={() => setVehicle(vo.value)}
                      className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all ${
                        sel ? 'border-[#e94560]/50 bg-[#e94560]/10' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'
                      }`}
                    >
                      <VIcon className={`h-5 w-5 flex-shrink-0 ${sel ? 'text-[#e94560]' : 'text-[var(--text-secondary)]'}`} />
                      <div className="text-left">
                        <p className={`text-xs font-bold ${sel ? 'text-[#e94560]' : 'text-[var(--text-primary)]'}`}>{vo.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">₹{vo.rate}/km</p>
                      </div>
                      {sel && <CheckCircle2 className="h-4 w-4 text-[#e94560] ml-auto flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 px-4 py-3 rounded-xl bg-green-500/8 border border-green-500/20 flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {expensePrompt.total_km} km × ₹{VEHICLE_OPTS.find(v => v.value === vehicle)?.rate}/km
                </span>
                <span className="text-base font-bold text-green-400">
                  ₹{Math.round(expensePrompt.total_km * (VEHICLE_OPTS.find(v => v.value === vehicle)?.rate || 5))}
                </span>
              </div>
            </div>
          )}

          {/* Amount — food/other only */}
          {expType !== 'travel' && (
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">Amount (₹)</p>
              <input
                type="number" inputMode="numeric"
                value={expAmt}
                onChange={e => setExpAmt(e.target.value)}
                placeholder="0"
                className="w-full bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-2xl px-4 py-3.5 text-lg font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
              />
            </div>
          )}

          {/* Note */}
          <div>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold mb-2">Note (optional)</p>
            <input
              value={expNote}
              onChange={e => setExpNote(e.target.value)}
              placeholder="e.g. fuel stop, lunch with principal…"
              className="w-full bg-[var(--bg-primary)] border-2 border-[var(--border-color)] rounded-2xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#e94560] transition-colors"
            />
          </div>
        </div>

        <div
          className="flex-shrink-0 px-5 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-card)]"
          style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={submitExpense}
            disabled={expBusy}
            className="w-full py-4 rounded-2xl bg-[#e94560] text-white font-bold text-sm shadow-xl shadow-[#e94560]/30 disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            {expBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            {expBusy ? 'Saving…' : 'Save Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}
