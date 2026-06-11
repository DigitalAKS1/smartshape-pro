import React, { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { Upload, FileJson, FileCode, CheckCircle2, AlertTriangle } from 'lucide-react';
import { invoices as invoicesApi } from '../../lib/api';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

function Pill({ icon: Icon, cls, label }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-semibold ${cls}`}>
      {Icon && <Icon className="h-3 w-3" />}{label}
    </span>
  );
}

/**
 * Bulk Invoice Import — upload JSON or XML; each invoice auto-maps to its school
 * (by name/GSTIN) and sales order (by order/PO/quotation number). Unmatched rows
 * are flagged. Provides downloadable JSON/XML templates.
 */
export default function InvoiceBulkImport({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const r = await invoicesApi.bulkImport(file);
      const s = r.data?.summary || {};
      setResult(s);
      toast.success(`Imported ${s.created} invoice(s) — ${s.matched_so} matched to SO, ${s.unmatched} unmatched`);
      onDone && onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Import failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={`${card} border rounded-md p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className={`text-sm font-semibold ${textPri} flex items-center gap-1.5`}><Upload className="h-4 w-4" /> Bulk Invoice Import</h3>
          <p className={`text-xs ${textMuted} mt-0.5 max-w-xl`}>Upload a JSON or XML file — each invoice auto-maps to its school &amp; sales order. Unmatched rows are flagged for review.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <a href={invoicesApi.templateUrl('json')} className={`text-xs ${textSec} hover:text-[#e94560] flex items-center gap-1`}><FileJson className="h-3.5 w-3.5" /> JSON template</a>
          <a href={invoicesApi.templateUrl('xml')} className={`text-xs ${textSec} hover:text-[#e94560] flex items-center gap-1`}><FileCode className="h-3.5 w-3.5" /> XML template</a>
          <input ref={fileRef} type="file" accept=".json,.xml,application/json,text/xml,application/xml" onChange={onFile} className="hidden" data-testid="invoice-upload-input" />
          <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="invoice-upload-btn">
            {busy ? 'Importing…' : 'Upload file'}
          </Button>
        </div>
      </div>
      {result && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs" data-testid="invoice-import-result">
          <Pill icon={CheckCircle2} cls="bg-emerald-500/15 text-emerald-500" label={`${result.created} created`} />
          <Pill cls="bg-blue-500/15 text-blue-500" label={`${result.matched_so} matched to SO`} />
          <Pill cls="bg-slate-500/15 text-slate-400" label={`${result.school_only} school-only`} />
          {result.unmatched > 0 && <Pill icon={AlertTriangle} cls="bg-red-500/15 text-red-500" label={`${result.unmatched} unmatched`} />}
          {result.skipped_dupe > 0 && <Pill cls="bg-amber-500/15 text-amber-500" label={`${result.skipped_dupe} duplicates skipped`} />}
          {result.errors?.length > 0 && <Pill cls="bg-red-500/15 text-red-500" label={`${result.errors.length} error rows`} />}
        </div>
      )}
    </div>
  );
}
