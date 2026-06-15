import React from 'react';
import { Camera, X, Scissors } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { CATEGORIES, CAT_LABELS, TYPES } from '../../hooks/useInventory';

// ── Create Dialog ──────────────────────────────────────────────────────────────
export function CreateDieDialog({
  open, onOpenChange,
  newDie, setNewDie,
  newDieImagePreview, handleNewImageSelect,
  handleCreateDie, saving,
  inputCls, textPri, textSec, textMuted, dlgCls,
  productTypes = [],
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto`}>
        <DialogHeader><DialogTitle className={textPri}>Add New Product</DialogTitle></DialogHeader>
        <form onSubmit={handleCreateDie} className="space-y-4">
          <div>
            <Label className={`${textSec} text-xs mb-1.5 block`}>Photo</Label>
            <div className="bg-[var(--bg-primary)] border-[var(--border-color)] border-2 border-dashed rounded-xl overflow-hidden cursor-pointer"
              onClick={() => document.getElementById('new-die-image')?.click()}>
              {newDieImagePreview
                ? <div className="relative">
                    <img src={newDieImagePreview} alt="Preview" className="w-full h-40 object-contain" />
                    <button type="button"
                      onClick={e => { e.stopPropagation(); handleNewImageSelect(null); }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-full shadow">
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                : <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Camera className={`h-8 w-8 ${textMuted}`} />
                    <p className={`text-sm ${textSec}`}>Tap to add photo</p>
                    <p className={`text-xs ${textMuted}`}>JPG, PNG — max 5 MB</p>
                  </div>}
              <input id="new-die-image" type="file" accept="image/*" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleNewImageSelect(e.target.files[0]); }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Code *</Label>
              <Input value={newDie.code} onChange={e => setNewDie({...newDie, code: e.target.value})}
                required className={`h-11 ${inputCls}`} placeholder="D-STD-001" />
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Name *</Label>
              <Input value={newDie.name} onChange={e => setNewDie({...newDie, name: e.target.value})}
                required className={`h-11 ${inputCls}`} placeholder="Rose Flower" />
            </div>
          </div>
          {productTypes.length > 0 && (
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Product Type</Label>
              <select value={newDie.product_type_id || ''} onChange={e => setNewDie({...newDie, product_type_id: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {productTypes.map(pt => <option key={pt.product_type_id} value={pt.product_type_id}>{pt.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Size class</Label>
              <select value={newDie.type} onChange={e => setNewDie({...newDie, type: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={newDie.category} onChange={e => setNewDie({...newDie, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Initial Stock</Label>
              <Input type="number" min={0} value={newDie.stock_qty}
                onChange={e => setNewDie({...newDie, stock_qty: parseInt(e.target.value) || 0})}
                className={`h-11 ${inputCls}`} />
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
              <Input type="number" min={0} value={newDie.min_level}
                onChange={e => setNewDie({...newDie, min_level: parseInt(e.target.value) || 0})}
                className={`h-11 ${inputCls}`} />
            </div>
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Description</Label>
            <Input value={newDie.description} onChange={e => setNewDie({...newDie, description: e.target.value})}
              className={`h-11 ${inputCls}`} placeholder="Optional notes" />
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>YouTube video link (optional)</Label>
            <Input value={newDie.video_url || ''} onChange={e => setNewDie({...newDie, video_url: e.target.value})}
              className={`h-11 ${inputCls}`} placeholder="https://youtu.be/…" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!newDie.show_video} onChange={e => setNewDie({...newDie, show_video: e.target.checked})} />
              <span className={textSec}>Show video to customers</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!newDie.show_description} onChange={e => setNewDie({...newDie, show_description: e.target.checked})} />
              <span className={textSec}>Show description to customers</span>
            </label>
          </div>
          <Button type="submit" disabled={saving}
            className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-medium disabled:opacity-60">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Saving…</>
              : 'Add Product'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Dialog ────────────────────────────────────────────────────────────────
export function EditDieDialog({
  open, onOpenChange,
  editTarget, editForm, setEditForm,
  handleSaveEdit, saving,
  inputCls, textPri, textSec, textMuted, dlgCls, backendUrl,
  productTypes = [], onUploadImages, onDeleteImage, onReorderImages, uploading,
}) {
  const images = editTarget?.images || [];
  return (
    <Dialog open={open} onOpenChange={open => { if (!saving) onOpenChange(open); }}>
      <DialogContent className={`${dlgCls} w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={textPri}>Edit Product</DialogTitle>
          {editTarget && (
            <div className="flex items-center gap-3 mt-2 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--bg-card)] border border-[var(--border-color)] flex-shrink-0">
                {editTarget.image_url
                  ? <img src={`${backendUrl}${editTarget.image_url}`} alt="" className="w-full h-full object-contain p-1" />
                  : <div className={`w-full h-full flex items-center justify-center ${textMuted}`}><Scissors className="h-5 w-5 opacity-20" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${textPri} truncate`}>{editTarget.name}</p>
                <p className="text-xs font-mono text-[#e94560]">{editTarget.code}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-mono font-bold text-lg ${editTarget.stock_qty === 0 ? 'text-red-500' : editTarget.stock_qty <= editTarget.min_level ? 'text-yellow-500' : textPri}`}>
                  {editTarget.stock_qty}
                </p>
                <p className={`text-[10px] ${textMuted}`}>in stock</p>
              </div>
            </div>
          )}
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label className={`${textSec} text-xs mb-1.5 block`}>Photos ({images.length}/5)</Label>
            <div className="grid grid-cols-5 gap-2">
              {images.map((url, idx) => (
                <div key={url} className="relative group aspect-square rounded-md overflow-hidden border border-[var(--border-color)]">
                  <img src={`${backendUrl}${url}`} alt="" className="w-full h-full object-cover" />
                  {idx === 0 && <span className="absolute top-0.5 left-0.5 text-[8px] px-1 rounded bg-[#e94560] text-white">Main</span>}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                    {idx > 0 && (
                      <button type="button" title="Make main"
                        onClick={() => onReorderImages(editTarget.die_id, [url, ...images.filter(u => u !== url)])}
                        className="text-white text-[10px] px-1 py-0.5 hover:text-[#e94560]">★</button>
                    )}
                    <button type="button" title="Remove"
                      onClick={() => onDeleteImage(editTarget.die_id, url)}
                      className="text-white text-[10px] px-1 py-0.5 hover:text-red-400">✕</button>
                  </div>
                </div>
              ))}
              {images.length < 5 && (
                <label className={`aspect-square rounded-md border border-dashed border-[var(--border-color)] flex items-center justify-center cursor-pointer ${textMuted} hover:border-[#e94560]`}>
                  {uploading === editTarget?.die_id ? '…' : <Camera className="h-4 w-4" />}
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { if (e.target.files?.length) onUploadImages(editTarget.die_id, e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            <p className={`text-[10px] ${textMuted} mt-1`}>First photo is the main image. Max 5, 5 MB each.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Code *</Label>
              <Input value={editForm.code} onChange={e => setEditForm({...editForm, code: e.target.value})}
                className={`h-11 ${inputCls}`} />
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Name *</Label>
              <Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})}
                className={`h-11 ${inputCls}`} />
            </div>
          </div>
          {productTypes.length > 0 && (
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Product Type</Label>
              <select value={editForm.product_type_id || ''} onChange={e => setEditForm({...editForm, product_type_id: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {!editForm.product_type_id && <option value="">— select —</option>}
                {productTypes.map(pt => <option key={pt.product_type_id} value={pt.product_type_id}>{pt.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Size class</Label>
              <select value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
              <Input type="number" min={0} value={editForm.min_level}
                onChange={e => setEditForm({...editForm, min_level: parseInt(e.target.value) || 0})}
                className={`h-11 ${inputCls}`} />
            </div>
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Description</Label>
              <Input value={editForm.description}
                onChange={e => setEditForm({...editForm, description: e.target.value})}
                className={`h-11 ${inputCls}`} />
            </div>
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>YouTube video link</Label>
            <Input value={editForm.video_url || ''} onChange={e => setEditForm({...editForm, video_url: e.target.value})}
              className={`h-11 ${inputCls}`} placeholder="https://youtu.be/…" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!editForm.show_video} onChange={e => setEditForm({...editForm, show_video: e.target.checked})} />
              <span className={textSec}>Show video to customers</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!editForm.show_description} onChange={e => setEditForm({...editForm, show_description: e.target.checked})} />
              <span className={textSec}>Show description to customers</span>
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}
            className={`flex-1 h-11 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={handleSaveEdit} disabled={saving}
            className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-60">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Saving…</>
              : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
