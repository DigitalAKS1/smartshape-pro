import React from 'react';
import { Upload, FileDown, AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

// ── Import CSV Dialog ──────────────────────────────────────────────────────────
export function ImportDialog({
  open, onOpenChange,
  importRef, handleImport, downloadSample,
  textPri, textSec, textMuted, dlgCls,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md`}>
        <DialogHeader><DialogTitle className={textPri}>Import Products from CSV</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className={`bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-xs`}>
            <p className={`font-semibold ${textSec} mb-1`}>Required columns:</p>
            <p className={`font-mono text-[11px] ${textMuted}`}>code, name, type, category, stock_qty, min_level, description</p>
            <p className={`${textMuted} mt-1.5`}>Optional <span className="font-mono">product_type</span> column (Die / Stamp / Machine / Other) — blank defaults to Die.</p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadSample}
            className={`w-full h-10 border-[var(--border-color)] ${textSec} gap-2`}>
            <FileDown className="h-4 w-4" /> Download Sample CSV
          </Button>
          <div className="bg-[var(--bg-primary)] border-2 border-dashed border-[var(--border-color)] rounded-xl p-8 text-center cursor-pointer active:opacity-70"
            onClick={() => importRef.current?.click()}>
            <Upload className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
            <p className={`text-sm ${textSec} font-medium`}>Tap to upload CSV</p>
            <p className={`text-xs ${textMuted} mt-1`}>Duplicate codes are skipped</p>
            <input ref={importRef} type="file" accept=".csv" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirm Dialog ──────────────────────────────────────────────────────
export function DeleteConfirmDialog({
  open, onOpenChange,
  deleteTarget, handleDelete,
  textPri, textSec, textMuted, dlgCls,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] max-w-sm`}>
        <DialogHeader><DialogTitle className="text-red-500">Delete Permanently?</DialogTitle></DialogHeader>
        <p className={`text-sm ${textSec} mt-1`}>
          Delete <strong className={textPri}>{deleteTarget?.name}</strong> ({deleteTarget?.code})?<br />This cannot be undone.
        </p>
        {deleteTarget?.stock_qty > 0 && (
          <p className="text-sm text-yellow-500 flex items-center gap-1.5 mt-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />Has {deleteTarget.stock_qty} units in stock.
          </p>
        )}
        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className={`flex-1 h-11 border-[var(--border-color)] ${textMuted}`}>Cancel</Button>
          <Button onClick={handleDelete} className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Delete Confirm Dialog (admin) ─────────────────────────────────────────
export function BulkDeleteConfirmDialog({
  open, onOpenChange, count, onConfirm, deleting,
  textPri, textSec, textMuted, dlgCls,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] max-w-sm`}>
        <DialogHeader><DialogTitle className="text-red-500">Delete {count} item{count !== 1 ? 's' : ''}?</DialogTitle></DialogHeader>
        <p className={`text-sm ${textSec} mt-1`}>
          You are about to permanently delete <strong className={textPri}>{count}</strong> selected item{count !== 1 ? 's' : ''}.<br />This cannot be undone.
        </p>
        <p className="text-sm text-yellow-500 flex items-center gap-1.5 mt-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />Any stock recorded on these items will be removed too.
        </p>
        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}
            className={`flex-1 h-11 border-[var(--border-color)] ${textMuted}`}>Cancel</Button>
          <Button onClick={onConfirm} disabled={deleting || count === 0}
            className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
            <Trash2 className="mr-1.5 h-4 w-4" /> {deleting ? 'Deleting…' : `Delete ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
