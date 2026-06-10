import React, { useState, useRef } from 'react';
import { toast } from 'sonner';
import { FileText, Upload, CheckCircle2, XCircle, Trash2, ExternalLink, Clock } from 'lucide-react';
import { quotations as quotApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_STYLE = {
  not_uploaded: { label: 'No PO', cls: 'text-[var(--text-muted)] border-[var(--border-color)]', Icon: Clock },
  uploaded:     { label: 'PO uploaded', cls: 'text-blue-600 border-blue-500/40', Icon: FileText },
  approved:     { label: 'PO approved', cls: 'text-green-600 border-green-500/40', Icon: CheckCircle2 },
  rejected:     { label: 'PO rejected', cls: 'text-red-500 border-red-500/40', Icon: XCircle },
};

function poUrl(doc) {
  if (!doc?.url) return '#';
  return /^https?:\/\//.test(doc.url) ? doc.url : `${BACKEND}${doc.url}`;
}

export default function QuotationPoPanel({ quotation, onChanged }) {
  const { user } = useAuth();
  const canReview = user?.role === 'admin' || (user?.assigned_modules || []).includes('accounts');
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [poNumber, setPoNumber] = useState(quotation?.po_number || '');
  const [poDate, setPoDate] = useState(quotation?.po_date || '');

  const status = quotation?.po_status || 'not_uploaded';
  const doc = quotation?.po_document;
  const meta = STATUS_STYLE[status] || STATUS_STYLE.not_uploaded;
  const StatusIcon = meta.Icon;

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast.error('File must be under 25 MB'); return; }
    setUploading(true);
    try {
      await quotApi.uploadPo(quotation.quotation_id, file, { po_number: poNumber, po_date: poDate });
      toast.success('PO uploaded');
      onChanged && onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const review = async (decision) => {
    setBusy(true);
    try {
      await quotApi.updatePoStatus(quotation.quotation_id, decision);
      toast.success(`PO ${decision}`);
      onChanged && onChanged();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Remove the attached PO document?')) return;
    setBusy(true);
    try { await quotApi.removePo(quotation.quotation_id); toast.success('PO removed'); onChanged && onChanged(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inp = 'w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]';

  return (
    <div className={`${card} border rounded-md p-5 space-y-4`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <FileText className="h-4 w-4" /> Purchase Order
        </h3>
        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${meta.cls}`}>
          <StatusIcon className="h-3.5 w-3.5" /> {meta.label}
        </span>
      </div>

      {doc ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)]">
            <div className="min-w-0">
              <a href={poUrl(doc)} target="_blank" rel="noopener noreferrer"
                className="text-[#e94560] hover:underline flex items-center gap-1.5 truncate">
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" /> <span className="truncate">{doc.filename || 'PO document'}</span>
              </a>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {quotation.po_number ? `#${quotation.po_number} · ` : ''}
                {quotation.po_date ? `${quotation.po_date} · ` : ''}
                by {doc.uploaded_by_name || doc.uploaded_by}
              </p>
            </div>
            <button onClick={remove} disabled={busy}
              className="text-[var(--text-muted)] hover:text-red-500 disabled:opacity-50" title="Remove PO">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {quotation.po_notes && <p className="text-xs text-[var(--text-secondary)]">Note: {quotation.po_notes}</p>}
          {canReview && status === 'uploaded' && (
            <div className="flex gap-2">
              <button onClick={() => review('approved')} disabled={busy}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> Approve
              </button>
              <button onClick={() => review('rejected')} disabled={busy}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-red-500/50 text-red-500 hover:bg-red-500/10 disabled:opacity-50">
                <XCircle className="h-4 w-4" /> Reject
              </button>
            </div>
          )}
          <div>
            <label className="text-xs text-[var(--text-secondary)]">Replace document</label>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={e => handleFile(e.target.files?.[0])} disabled={uploading}
              className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-[#e94560] file:text-white" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">Attach the school's purchase order for this quotation.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)]">PO number (optional)</label>
              <input className={inp} value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="PO-2026-001" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)]">PO date (optional)</label>
              <input type="date" className={inp} value={poDate} onChange={e => setPoDate(e.target.value)} />
            </div>
          </div>
          <label className={`inline-flex items-center gap-2 text-sm px-3 py-2 rounded bg-[#e94560] text-white hover:bg-[#f05c75] cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload PO'}
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
              onChange={e => handleFile(e.target.files?.[0])} disabled={uploading} />
          </label>
          <p className="text-xs text-[var(--text-muted)]">PDF, JPG, PNG, DOC, DOCX · max 25 MB</p>
        </div>
      )}
    </div>
  );
}
