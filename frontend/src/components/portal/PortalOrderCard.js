import React from 'react';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

/**
 * Individual die card for the order/selection view.
 * Props: item
 */
export function DieCard({ item }) {
  const isRemoved = item.status === 'removed_by_admin';
  const isAdded   = item.status === 'added_by_admin';
  return (
    <div className={`relative rounded-xl overflow-hidden border transition-all ${
      isRemoved ? 'border-red-500/40 opacity-60' :
      isAdded   ? 'border-yellow-400/60 ring-1 ring-yellow-400/30' :
                  'border-[#2d2d44]'
    } bg-[#1a1a2e]`}>
      {isRemoved && <div className="absolute top-0 inset-x-0 bg-red-600/90 text-white text-[9px] font-bold text-center py-0.5 z-10">REMOVED</div>}
      {isAdded   && <div className="absolute top-0 inset-x-0 bg-yellow-500/90 text-black text-[9px] font-bold text-center py-0.5 z-10">REPLACED</div>}
      <div className="aspect-square bg-[#0f0f1a] flex items-center justify-center p-3 mt-4">
        {item.die_image_url
          ? <img src={`${BACKEND}${item.die_image_url}`} alt={item.die_name} className="w-full h-full object-contain" loading="lazy" />
          : <div className="text-[#3d3d55] text-center"><svg className="h-8 w-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><rect x="3" y="3" width="18" height="18" rx="2" /></svg></div>
        }
      </div>
      <div className="p-2">
        <p className="font-mono text-[9px] text-[#e94560]">{item.die_code}</p>
        <p className="text-xs font-medium text-white leading-tight mt-0.5 line-clamp-2">{item.die_name}</p>
        <p className="text-[9px] text-[#6b6b80] mt-0.5 capitalize">{item.die_type}</p>
        {item.admin_note && <p className="text-[9px] text-yellow-400 mt-0.5 italic line-clamp-1">{item.admin_note}</p>}
      </div>
    </div>
  );
}

/**
 * My Order tab — shows die selection groups, removed items, and change notices.
 * Props: selection_items, hasChanges, removedItems, addedItems, activeItems, grouped
 */
export default function PortalOrderCard({ selection_items, hasChanges, removedItems, addedItems, activeItems, grouped }) {
  return (
    <>
      {hasChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <p className="text-yellow-400 font-semibold text-sm mb-1">Your selection was updated by our team</p>
          <p className="text-[#a0a0b0] text-xs">
            {removedItems.length > 0 && `${removedItems.length} item${removedItems.length > 1 ? 's' : ''} removed. `}
            {addedItems.length > 0 && `${addedItems.length} replacement${addedItems.length > 1 ? 's' : ''} added. `}
            Contact your sales executive for queries.
          </p>
        </div>
      )}

      {selection_items.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Your Selection ({activeItems.length} items)</p>
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="mb-5">
              <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-2 capitalize">{type.replace(/_/g, ' ')} Dies ({items.length})</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {items.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
              </div>
            </div>
          ))}
          {removedItems.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-red-400 uppercase mb-2">Removed ({removedItems.length})</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {removedItems.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-[#6b6b80]">No selection submitted yet.</p>
          <p className="text-[#a0a0b0] text-sm mt-1">Your catalogue link will be shared by your sales executive.</p>
        </div>
      )}
    </>
  );
}
