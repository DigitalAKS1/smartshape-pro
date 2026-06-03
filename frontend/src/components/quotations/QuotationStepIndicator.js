import React from 'react';
import { Check } from 'lucide-react';

const STEP_LABELS = ['Contact', 'Package', 'Pricing'];

const tPri = 'text-[var(--text-primary)]';
const tMut = 'text-[var(--text-muted)]';

export default function QuotationStepIndicator({ step }) {
  return (
    <div className="flex items-center px-4 sm:px-0 mb-6">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
              step > i + 1 ? 'bg-[#10b981] text-white' :
              step === i + 1 ? 'bg-[#e94560] text-white' :
              'bg-[var(--bg-card)] border border-[var(--border-color)] ' + tMut
            }`}>
              {step > i + 1 ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${step === i + 1 ? tPri : tMut}`}>{label}</span>
          </div>
          {i < 2 && (
            <div className={`flex-1 h-0.5 mx-1 mb-5 transition-all ${
              step > i + 1 ? 'bg-[#10b981]' : 'bg-[var(--border-color)]'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
