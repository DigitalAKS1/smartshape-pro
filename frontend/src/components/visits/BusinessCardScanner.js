import React from 'react';
import {
  Camera, Images, ScanLine, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

const tSec   = 'text-[var(--text-secondary)]';
const tMuted = 'text-[var(--text-muted)]';

/**
 * BusinessCardScanner — Body content for the Scan Card bottom sheet.
 * Renders preview, camera/gallery pickers, loading state, error, and result.
 */
export default function BusinessCardScanner({
  scanPreview, setScanPreview,
  scanLoading,
  scanResult, setScanResult,
  scanError, setScanError,
  scanFileRef, scanGalleryRef,
  handleScanImage,
}) {
  return (
    <div className="px-4 py-4 space-y-4">
      {/* Hidden file inputs */}
      <input
        ref={scanFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture="environment"
        className="hidden"
        onChange={e => { handleScanImage(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={scanGalleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => { handleScanImage(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Card preview or placeholder */}
      {scanPreview ? (
        <div className="rounded-2xl overflow-hidden border border-blue-400/25 bg-blue-500/5">
          <img src={scanPreview} alt="card" className="w-full max-h-48 object-contain" />
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] py-10 flex flex-col items-center gap-2">
          <ScanLine className="h-10 w-10 text-[var(--text-muted)] opacity-50" />
          <p className={`text-sm font-semibold ${tSec}`}>Capture or choose a business card</p>
          <p className={`text-xs ${tMuted}`}>JPEG, PNG, WebP supported · Not HEIC</p>
        </div>
      )}

      {/* Camera + Gallery buttons */}
      {!scanLoading && !scanResult && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { scanFileRef.current.value = ''; scanFileRef.current.click(); }}
            className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] active:opacity-70">
            <Camera className="h-6 w-6 text-blue-400" />
            <span className={`text-xs font-semibold ${tSec}`}>Take Photo</span>
          </button>
          <button
            onClick={() => { scanGalleryRef.current.value = ''; scanGalleryRef.current.click(); }}
            className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] active:opacity-70">
            <Images className="h-6 w-6 text-purple-400" />
            <span className={`text-xs font-semibold ${tSec}`}>Choose from Gallery</span>
          </button>
        </div>
      )}

      {/* Loading */}
      {scanLoading && (
        <div className="flex flex-col items-center gap-2 py-4">
          <Loader2 className="h-7 w-7 text-blue-400 animate-spin" />
          <p className={`text-sm ${tSec}`}>Extracting contact details…</p>
        </div>
      )}

      {/* Error */}
      {scanError && !scanLoading && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p className="text-xs text-red-400 font-medium">{scanError}</p>
            <button
              onClick={() => { setScanError(null); setScanPreview(null); }}
              className="text-xs text-[#e94560] font-semibold">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {scanResult && !scanLoading && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-1.5 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Extracted Details</p>
          </div>
          {[
            { label: 'Name',        value: scanResult.name },
            { label: 'Phone',       value: scanResult.phone },
            { label: 'Email',       value: scanResult.email },
            { label: 'School / Org',value: scanResult.school_name },
            { label: 'Role',        value: scanResult.role },
            { label: 'Website',     value: scanResult.website },
          ].filter(f => f.value).map(f => (
            <div key={f.label} className="flex items-start gap-2">
              <span className={`text-xs ${tMuted} w-20 shrink-0`}>{f.label}</span>
              <span className={`text-xs ${tSec} font-medium`}>{f.value}</span>
            </div>
          ))}
          <button
            onClick={() => { setScanResult(null); setScanPreview(null); setScanError(null); }}
            className="w-full text-center text-xs text-[var(--text-muted)] pt-2">
            Scan a different card
          </button>
        </div>
      )}
    </div>
  );
}
