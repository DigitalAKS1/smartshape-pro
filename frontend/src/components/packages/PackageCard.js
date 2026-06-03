import React from 'react';
import { Package, Copy, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { TYPE_COLORS } from '../../hooks/usePackageMaster';

/**
 * Individual package display card with item chips and price footer.
 * Props: pkg, isSelected, onSelect, onDuplicate, onDelete, textPri, textMuted, borderCls, card
 */
export default function PackageCard({ pkg, isSelected, onSelect, onDuplicate, onDelete, textPri, textMuted, borderCls, card }) {
  const items      = pkg.items || [];
  const inactive   = pkg.is_active === false;
  const pkgSubtotal = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
  const pkgGst      = items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0) * ((i.gst_pct ?? pkg.gst_pct ?? 18) / 100), 0);
  const pkgTotal    = pkgSubtotal + pkgGst;

  return (
    <div
      onClick={onSelect}
      data-testid={`package-card-${pkg.name}`}
      className={`group cursor-pointer rounded-xl border transition-all ${
        isSelected
          ? 'border-[#e94560] bg-[#e94560]/5 shadow-sm shadow-[#e94560]/10'
          : inactive
          ? `${borderCls} bg-[var(--bg-primary)] opacity-60`
          : `${borderCls} ${card} hover:border-[#e94560]/40 hover:shadow-sm`
      }`}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-[#e94560]/20' : 'bg-[var(--bg-primary)]'}`}>
              <Package className={`h-3.5 w-3.5 ${isSelected ? 'text-[#e94560]' : textMuted}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className={`font-semibold text-sm ${isSelected ? 'text-[#e94560]' : textPri} truncate`}>{pkg.display_name}</p>
                {inactive && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 flex-shrink-0">Archived</span>
                )}
              </div>
              <p className={`text-[10px] ${textMuted} mt-0.5`}>{items.length} item{items.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Hover action buttons */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(pkg, e); }}
              title="Duplicate"
              className={`h-7 w-7 rounded flex items-center justify-center ${textMuted} hover:text-[#e94560] hover:bg-[#e94560]/10 transition-colors`}
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(pkg); }}
              title="Delete"
              className="h-7 w-7 rounded flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Item type chips */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {items.slice(0, 3).map((item, i) => (
              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[item.type] || TYPE_COLORS.custom}`}>
                {item.name || item.type} ×{item.qty}
              </span>
            ))}
            {items.length > 3 && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] ${textMuted}`}>
                +{items.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Price footer */}
        <div className={`flex items-center justify-between mt-2.5 pt-2.5 border-t ${borderCls}`}>
          <span className={`text-[10px] ${textMuted}`}>Incl. GST</span>
          <span className={`text-sm font-bold font-mono ${isSelected ? 'text-[#e94560]' : textPri}`}>
            {formatCurrency(pkgTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
