import React from 'react';

const STATUS_STEPS = [
  { key: 'sent',      label: 'Sent' },
  { key: 'opened',    label: 'Opened' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'order',     label: 'Processing' },
  { key: 'delivered', label: 'Delivered' },
];

export function stepIndex(quot, orderStatus) {
  if (orderStatus === 'delivered') return 4;
  if (orderStatus && orderStatus !== 'cancelled') return 3;
  if (quot?.catalogue_status === 'submitted') return 2;
  if (quot?.catalogue_status === 'opened') return 1;
  return 0;
}

/**
 * Order status tracker strip shown in the portal header.
 * Props: currentStep
 */
export function StatusTracker({ currentStep }) {
  return (
    <div className="mt-5 flex items-center gap-0">
      {STATUS_STEPS.map((step, idx) => {
        const done   = idx < currentStep;
        const active = idx === currentStep;
        const isLast = idx === STATUS_STEPS.length - 1;
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center">
            <div className="flex items-center w-full">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                done   ? 'bg-[#e94560] border-[#e94560]' :
                active ? 'border-[#e94560] bg-[#e94560]/20' :
                         'border-[#3d3d55] bg-transparent'
              }`}>
                {done
                  ? <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  : <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[#e94560]' : 'bg-[#3d3d55]'}`} />
                }
              </div>
              {!isLast && <div className={`flex-1 h-0.5 ${done ? 'bg-[#e94560]' : 'bg-[#2d2d44]'}`} />}
            </div>
            <p className={`text-[9px] mt-1 text-center px-0.5 leading-tight ${active ? 'text-[#e94560] font-semibold' : done ? 'text-[#a0a0b0]' : 'text-[#3d3d55]'}`}>
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export { STATUS_STEPS };

/**
 * Quotation summary card shown in overview tab.
 * Props: q (quotation)
 */
export default function PortalQuotationCard({ q }) {
  return (
    <div className="bg-[#1a1a2e] rounded-xl p-5 border border-[#2d2d44]">
      <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide font-semibold mb-3">Quotation Summary</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Package</p>
          <p className="text-white font-medium mt-0.5 text-sm">{q.package_name || 'Custom'}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Total Payable</p>
          <p className="text-[#e94560] font-bold text-xl mt-0.5">₹{q.grand_total ? q.grand_total.toLocaleString('en-IN') : '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Sales Executive</p>
          <p className="text-white font-medium mt-0.5 text-sm">{q.sales_person_name || '—'}</p>
          {q.sales_person_email && (
            <a href={`mailto:${q.sales_person_email}`} className="text-[10px] text-[#e94560] hover:underline">{q.sales_person_email}</a>
          )}
        </div>
      </div>
    </div>
  );
}
