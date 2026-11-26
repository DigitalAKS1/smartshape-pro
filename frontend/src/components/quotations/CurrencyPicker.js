import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { currencyRates } from '../../lib/api';
import { convertQuote, recalcLine as defaultRecalc } from '../../lib/currency';

const btn = (on) => `px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${on
  ? 'bg-[#e94560] text-white border-[#e94560]'
  : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#e94560]/40'}`;
const inp = 'h-8 px-2 rounded-md text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';

/**
 * Pick any currency for a quotation (INR + every currency in the master), add a
 * new one on the spot (e.g. QAR, RUB), and set this quote's rate by hand.
 * Changing currency or rate re-prices every line from its INR price.
 * `quote` = {currency, currency_symbol, exchange_rate, lines, freight_amount, freight_inr}
 * `onChange(patch)` merges the patch into the quote; `recalcLine` recomputes a line.
 */
export default function CurrencyPicker({ quote, onChange, recalcLine = defaultRecalc, testPrefix = 'currency' }) {
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ code: '', symbol: '', rate: '', name: '' });
  const cur = String(quote.currency || 'INR').toUpperCase();
  const rate = Number(quote.exchange_rate) || 1;

  useEffect(() => {
    currencyRates.get().then(r => setList(r.data?.currencies || [])).catch(() => {});
  }, []);

  const switchTo = (code, symbol, newRate) => {
    const conv = convertQuote(quote, cur, rate, code, newRate, recalcLine);
    onChange({ currency: code, currency_symbol: symbol, exchange_rate: code === 'INR' ? 1 : newRate, ...conv });
  };

  const setRate = (val) => {
    const r = Number(val);
    if (!(r > 0)) { onChange({ exchange_rate: val }); return; }      // let them finish typing
    const conv = convertQuote(quote, cur, rate, cur, r, recalcLine);
    onChange({ exchange_rate: r, ...conv });
  };

  const saveRate = async () => {
    try {
      const r = await currencyRates.upsert({ code: cur, rate });
      setList(r.data?.currencies || list);
      toast.success(`Saved 1 ${cur} = ₹${rate} as the default rate`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not save rate'); }
  };

  const addCurrency = async () => {
    try {
      const r = await currencyRates.upsert({ ...nc, rate: Number(nc.rate) });
      setList(r.data?.currencies || []);
      const code = nc.code.trim().toUpperCase();
      switchTo(code, nc.symbol.trim(), Number(nc.rate));
      setAdding(false); setNc({ code: '', symbol: '', rate: '', name: '' });
      toast.success(`${code} added`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not add currency'); }
  };

  return (
    <div className="space-y-2" data-testid="currency-picker">
      <div className="flex gap-2 flex-wrap">
        <button type="button" className={btn(cur === 'INR')} onClick={() => switchTo('INR', '₹', 1)} data-testid={`${testPrefix}-INR`}>₹ INR</button>
        {list.map(c => (
          <button key={c.code} type="button" className={btn(cur === c.code)} title={c.name}
            onClick={() => switchTo(c.code, c.symbol, c.code === cur ? rate : c.rate)} data-testid={`${testPrefix}-${c.code}`}>
            {c.symbol} {c.code}
          </button>
        ))}
        <button type="button" className={btn(false)} onClick={() => setAdding(a => !a)} data-testid={`${testPrefix}-add`}>
          <Plus className="h-3.5 w-3.5 inline -mt-0.5" /> Currency
        </button>
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-[var(--border-color)] p-2">
          <input className={`${inp} w-20`} placeholder="QAR" maxLength={3} value={nc.code} onChange={e => setNc({ ...nc, code: e.target.value.toUpperCase() })} />
          <input className={`${inp} w-16`} placeholder="ر.ق" value={nc.symbol} onChange={e => setNc({ ...nc, symbol: e.target.value })} />
          <input className={`${inp} w-36`} placeholder="Qatari Riyal" value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} />
          <span className="text-xs text-[var(--text-muted)]">1 = ₹</span>
          <input className={`${inp} w-20`} type="number" min="0" step="0.01" placeholder="23" value={nc.rate} onChange={e => setNc({ ...nc, rate: e.target.value })} />
          <button type="button" onClick={addCurrency} className="h-8 px-3 rounded-md bg-[#e94560] text-white text-sm font-medium">Add & use</button>
        </div>
      )}

      {cur !== 'INR' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-secondary)]">Rate for this quote: 1 {cur} = ₹</span>
          <input className={`${inp} w-24`} type="number" min="0" step="0.01" value={quote.exchange_rate ?? ''}
            onChange={e => setRate(e.target.value)} data-testid={`${testPrefix}-rate`} />
          <button type="button" onClick={saveRate} className="text-[#e94560] underline">save as default</button>
          <span className="text-amber-500 w-full">Prices are converted from ₹ at this rate. Foreign currency — <b>no GST</b> (export sale).</span>
        </div>
      )}
    </div>
  );
}
