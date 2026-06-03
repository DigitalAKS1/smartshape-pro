import React from 'react';
import { Button } from '../ui/button';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
const tPri = 'text-[var(--text-primary)]';
const tSec = 'text-[var(--text-secondary)]';
const tMut = 'text-[var(--text-muted)]';

export default function QuotationStep2Package({
  packagesList,
  selectedContact,
  formData,
  handlePackageSelect,
  setStep,
}) {
  return (
    <div className="px-4 sm:px-0 space-y-4">
      <div>
        <h2 className={`text-lg font-semibold ${tPri} mb-0.5`}>Select Package</h2>
        {selectedContact
          ? <p className={`text-sm ${tSec}`}>For {selectedContact.name}{selectedContact.company ? ` · ${selectedContact.company}` : ''}</p>
          : <p className={`text-sm ${tSec}`}>Choose a package or skip to add items manually</p>
        }
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {packagesList.filter(p => p.is_active !== false).map((pkg) => {
          const items = pkg.items || [];
          const itemTotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
          const isSelected = formData.package_id === pkg.package_id;
          return (
            <button
              key={pkg.package_id}
              onClick={() => handlePackageSelect(pkg)}
              className={`text-left p-5 rounded-xl border transition-all active:opacity-70 ${
                isSelected
                  ? 'border-[#e94560] ring-2 ring-[#e94560]/20 bg-[#e94560]/5'
                  : `${card} hover:border-[#e94560]/40 hover:-translate-y-0.5`
              }`}
              data-testid={`package-card-${pkg.name}`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className={`font-semibold ${tPri} leading-tight`}>{pkg.display_name}</h3>
                {isSelected && <CheckCircle2 className="h-5 w-5 text-[#e94560] flex-shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-[#e94560] mb-3">{formatCurrency(itemTotal)}</p>
              <div className="space-y-1">
                {items.map((item, idx) => (
                  <div key={idx} className={`flex justify-between text-xs ${tSec}`}>
                    <span className="truncate">{item.name}</span>
                    <span className={`${tPri} font-medium ml-2 flex-shrink-0`}>×{item.qty}</span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <p className={`text-xs ${tMut} text-center`}>You can add or modify items in the next step</p>

      <div className="flex gap-3 pt-2">
        <Button
          onClick={() => setStep(1)}
          variant="outline"
          className={`border-[var(--border-color)] ${tSec} h-12`}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          onClick={() => setStep(3)}
          className="flex-1 h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold"
          data-testid="step2-next-button"
        >
          Continue <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
