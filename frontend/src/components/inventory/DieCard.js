import React, { useRef } from 'react';
import { Camera, Scissors, TrendingUp, TrendingDown, Edit2, Archive, ArchiveRestore, Trash2, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

export default function DieCard({
  die, uploading, onUpload, onArchive, onEdit,
  onDeleteRequest, onStockIn, onStockOut,
  isAdmin, canWrite,
  textPri, textMuted, textSec, card, backendUrl,
}) {
  const fileRef = useRef(null);
  const isUploading = uploading === die.die_id;
  const isArchived = die.is_active === false;
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const stockPct = die.min_level > 0
    ? Math.min(100, (die.stock_qty / (die.min_level * 3)) * 100)
    : (die.stock_qty > 0 ? 100 : 0);
  const barColor = die.stock_qty === 0 ? '#ef4444' : die.stock_qty <= die.min_level ? '#f59e0b' : '#22c55e';

  return (
    <div className={`${card} border rounded-xl overflow-hidden flex flex-col group ${isArchived ? 'opacity-50' : ''}`}>

      {/* Image */}
      <div className="relative aspect-square bg-[var(--bg-primary)] overflow-hidden">
        {die.image_url
          ? <img src={`${backendUrl}${die.image_url}`} alt={die.name} className="w-full h-full object-contain p-2" />
          : <div className={`w-full h-full flex flex-col items-center justify-center ${textMuted} gap-1`}>
              <Scissors className="h-8 w-8 opacity-20" strokeWidth={1.5} />
              <span className="text-[10px] opacity-40">No image</span>
            </div>}

        {die.stock_qty <= die.min_level && !isArchived && (
          <div className={`absolute top-1.5 left-1.5 ${die.stock_qty === 0 ? 'bg-red-500' : 'bg-yellow-500'} text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full`}>
            {die.stock_qty === 0 ? 'OUT' : 'LOW'}
          </div>
        )}
        {isArchived && (
          <div className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">ARCHIVED</div>
        )}

        {!isArchived && canWrite && (
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/40 text-white sm:opacity-0 sm:group-hover:opacity-100 active:scale-90 transition-all">
            {isUploading
              ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Camera className="h-3.5 w-3.5" />}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { if (e.target.files?.[0]) onUpload(die.die_id, e.target.files[0]); e.target.value = ''; }} />
      </div>

      {/* Stock health bar */}
      <div className="h-[3px] bg-[var(--border-color)]">
        <div className="h-full transition-all duration-500" style={{ width: `${stockPct}%`, backgroundColor: barColor }} />
      </div>

      {/* Info */}
      <div className="px-2.5 pt-2 pb-1.5 flex-1">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] text-[#e94560] font-semibold leading-none truncate">{die.code}</p>
            <h3 className={`text-[11px] font-semibold ${textPri} leading-tight mt-0.5 line-clamp-2`} title={die.name}>{die.name}</h3>
          </div>
          <span className={`font-mono text-sm font-bold shrink-0 ml-1 ${die.stock_qty === 0 ? 'text-red-500' : die.stock_qty <= die.min_level ? 'text-yellow-500' : textPri}`}>
            {die.stock_qty}
          </span>
        </div>
      </div>

      {/* Action strip */}
      {!isArchived && canWrite && (
        <div className="flex border-t border-[var(--border-color)]">
          <button onClick={() => onStockIn(die)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-green-500 hover:bg-green-500/10 active:bg-green-500/20 transition-colors min-h-[44px]">
            <TrendingUp className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold">IN</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <button onClick={() => onStockOut(die)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-colors min-h-[44px]">
            <TrendingDown className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold">OUT</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <button onClick={() => onEdit(die)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 ${textSec} hover:bg-[var(--bg-hover)] transition-colors min-h-[44px]`}>
            <Edit2 className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold">EDIT</span>
          </button>
          <div className="w-px bg-[var(--border-color)]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`flex flex-col items-center justify-center px-3 py-2.5 ${textMuted} hover:bg-[var(--bg-hover)] transition-colors min-h-[44px]`}>
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={dlgCls}>
              <DropdownMenuItem onClick={() => onArchive(die)} className="cursor-pointer">
                <Archive className="mr-2 h-4 w-4" />Archive
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => onDeleteRequest(die)} className="cursor-pointer text-red-500">
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {isArchived && (
        <div className="border-t border-[var(--border-color)]">
          <button onClick={() => onArchive(die)}
            className={`w-full flex items-center justify-center gap-1.5 py-2.5 ${textSec} hover:bg-[var(--bg-hover)] text-xs font-medium`}>
            <ArchiveRestore className="h-3.5 w-3.5" /> Restore
          </button>
        </div>
      )}
    </div>
  );
}
