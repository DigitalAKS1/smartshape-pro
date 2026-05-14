import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_STEPS = [
  { key: 'sent',      label: 'Quotation Sent' },
  { key: 'opened',    label: 'Catalogue Opened' },
  { key: 'submitted', label: 'Selection Submitted' },
  { key: 'order',     label: 'Order Processing' },
  { key: 'delivered', label: 'Delivered' },
];

function stepIndex(quot, orderStatus) {
  if (orderStatus === 'delivered') return 4;
  if (orderStatus && orderStatus !== 'cancelled') return 3;
  if (quot?.catalogue_status === 'submitted') return 2;
  if (quot?.catalogue_status === 'opened') return 1;
  return 0;
}

function DieCard({ item }) {
  const isRemoved = item.status === 'removed_by_admin';
  const isAdded   = item.status === 'added_by_admin';
  return (
    <div className={`relative rounded-xl overflow-hidden border transition-all ${
      isRemoved ? 'border-red-500/40 opacity-60' :
      isAdded   ? 'border-yellow-400/60 ring-1 ring-yellow-400/30' :
                  'border-[#2d2d44]'
    } bg-[#1a1a2e]`}>
      {isRemoved && (
        <div className="absolute top-0 inset-x-0 bg-red-600/90 text-white text-[10px] font-bold text-center py-0.5 z-10">
          NOT AVAILABLE — REMOVED
        </div>
      )}
      {isAdded && (
        <div className="absolute top-0 inset-x-0 bg-yellow-500/90 text-black text-[10px] font-bold text-center py-0.5 z-10">
          REPLACED BY ADMIN
        </div>
      )}
      <div className="aspect-square bg-[#0f0f1a] flex items-center justify-center p-3 mt-4">
        {item.die_image_url ? (
          <img src={`${BACKEND}${item.die_image_url}`} alt={item.die_name}
            className="w-full h-full object-contain" loading="lazy" />
        ) : (
          <div className="text-[#3d3d55] text-center">
            <svg className="h-10 w-10 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            <span className="text-[10px]">{item.die_code}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-mono text-[10px] text-[#e94560]">{item.die_code}</p>
        <p className="text-sm font-medium text-white leading-tight mt-0.5 line-clamp-2">{item.die_name}</p>
        <p className="text-[10px] text-[#6b6b80] mt-1 capitalize">{item.die_type} die</p>
        {item.admin_note && (
          <p className="text-[10px] text-yellow-400 mt-1 italic">Note: {item.admin_note}</p>
        )}
      </div>
    </div>
  );
}

export default function CustomerPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BACKEND}/api/customer-portal/${token}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then(setData)
      .catch(() => toast.error('Could not load your portal'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Portal not found</h1>
        <p className="text-[#a0a0b0]">This link may be invalid or expired.</p>
      </div>
    </div>
  );

  const { quotation: q, selection_items, order_status, production_stage } = data;
  const currentStep = stepIndex(q, order_status);

  const activeItems  = selection_items.filter(i => i.status !== 'removed_by_admin');
  const removedItems = selection_items.filter(i => i.status === 'removed_by_admin');
  const addedItems   = selection_items.filter(i => i.status === 'added_by_admin');
  const hasChanges   = addedItems.length > 0 || removedItems.length > 0;

  const groupBy = (items, key) => items.reduce((acc, item) => {
    const k = item[key] || 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
  const grouped = groupBy(activeItems, 'die_type');

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] py-10 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[#e94560] text-sm font-semibold uppercase tracking-widest mb-2">SmartShape Pro</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">{q.school_name}</h1>
          <p className="text-[#a0a0b0] mt-1">{q.principal_name} · {q.quote_number}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-16 space-y-8">

        {/* Status tracker */}
        <div className="bg-[#1a1a2e] rounded-2xl p-6 border border-[#2d2d44]">
          <h2 className="text-sm font-semibold text-[#a0a0b0] uppercase tracking-wide mb-5">Your Order Status</h2>
          <div className="flex items-start gap-0">
            {STATUS_STEPS.map((step, idx) => {
              const done    = idx < currentStep;
              const active  = idx === currentStep;
              const isLast  = idx === STATUS_STEPS.length - 1;
              return (
                <div key={step.key} className="flex-1 flex flex-col items-center">
                  <div className="flex items-center w-full">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                      done   ? 'bg-[#e94560] border-[#e94560]' :
                      active ? 'border-[#e94560] bg-[#e94560]/20' :
                               'border-[#3d3d55] bg-transparent'
                    }`}>
                      {done ? (
                        <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className={`w-2 h-2 rounded-full ${active ? 'bg-[#e94560]' : 'bg-[#3d3d55]'}`} />
                      )}
                    </div>
                    {!isLast && <div className={`flex-1 h-0.5 ${done ? 'bg-[#e94560]' : 'bg-[#2d2d44]'}`} />}
                  </div>
                  <p className={`text-[10px] mt-2 text-center px-1 leading-tight ${
                    active ? 'text-[#e94560] font-semibold' : done ? 'text-[#a0a0b0]' : 'text-[#3d3d55]'
                  }`}>{step.label}</p>
                </div>
              );
            })}
          </div>
          {production_stage && order_status !== 'delivered' && (
            <p className="text-center text-xs text-[#a0a0b0] mt-4">
              Production stage: <span className="text-white font-medium capitalize">{production_stage.replace(/_/g, ' ')}</span>
            </p>
          )}
        </div>

        {/* Quotation summary */}
        <div className="bg-[#1a1a2e] rounded-2xl p-6 border border-[#2d2d44]">
          <h2 className="text-sm font-semibold text-[#a0a0b0] uppercase tracking-wide mb-4">Quotation Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Package</p>
              <p className="text-white font-medium mt-0.5">{q.package_name || 'Custom'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Total Payable</p>
              <p className="text-[#e94560] font-bold text-lg mt-0.5">
                ₹{q.grand_total ? q.grand_total.toLocaleString('en-IN') : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Sales Executive</p>
              <p className="text-white font-medium mt-0.5">{q.sales_person_name || '—'}</p>
              {q.sales_person_email && (
                <a href={`mailto:${q.sales_person_email}`} className="text-[10px] text-[#e94560] hover:underline">
                  {q.sales_person_email}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Admin changes banner */}
        {hasChanges && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5">
            <p className="text-yellow-400 font-semibold text-sm mb-1">Your selection was updated by our team</p>
            <p className="text-[#a0a0b0] text-xs">
              {removedItems.length > 0 && `${removedItems.length} item${removedItems.length > 1 ? 's' : ''} were unavailable and removed. `}
              {addedItems.length > 0 && `${addedItems.length} replacement${addedItems.length > 1 ? 's' : ''} added.`}
              {' '}See below for details. Contact your sales executive if you have questions.
            </p>
          </div>
        )}

        {/* Selected items */}
        {selection_items.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[#a0a0b0] uppercase tracking-wide mb-4">
              Your Selection ({activeItems.length} items)
            </h2>
            {Object.entries(grouped).map(([type, items]) => (
              <div key={type} className="mb-6">
                <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3 capitalize">
                  {type.replace(/_/g, ' ')} Dies ({items.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {items.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
                </div>
              </div>
            ))}

            {removedItems.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold text-red-400 uppercase mb-3">
                  Removed — Not Available ({removedItems.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {removedItems.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {q.catalogue_status !== 'submitted' && q.catalogue_status !== 'opened' ? null : (
          q.catalogue_status !== 'submitted' && (
            <div className="text-center py-8">
              <p className="text-[#a0a0b0]">Your catalogue link will be sent shortly.</p>
            </div>
          )
        )}

        {/* Contact footer */}
        <div className="text-center text-[#6b6b80] text-xs pt-4 border-t border-[#2d2d44]">
          <p>SmartShape Pro · For queries: {q.sales_person_email || 'contact your sales executive'}</p>
        </div>
      </div>
    </div>
  );
}
