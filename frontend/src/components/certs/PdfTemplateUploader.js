import React, { useState } from 'react';
import { Upload, FileText, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { certsApi } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';
const TOKENS = ['{Name}', '{Theme}', '{Date}', '{School}', '{Conducted By}'];

/**
 * PdfTemplateUploader — create a "PDF token-merge" certificate template.
 * Upload a PDF that already has {Name}/{Theme}/{Date}/{Conducted By} printed as text;
 * at generation time those tokens are replaced per attendee (no field positioning).
 *
 * Props:
 *   onSaved — callback() after a template is saved
 */
export default function PdfTemplateUploader({ onSaved }) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560] w-full';

  const [name, setName]           = useState('');
  const [pdfUrl, setPdfUrl]       = useState(null);
  const [fileName, setFileName]   = useState('');
  const [tokensFound, setTokensFound] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast.error('Please select a PDF file'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await certsApi.uploadBackground(fd);
      const url = res.data?.url;
      if (!url) throw new Error('No URL returned from server');
      setPdfUrl(url);
      setFileName(file.name);
      setTokensFound(res.data?.tokens_found || []);
      toast.success('PDF uploaded');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name is required'); return; }
    if (!pdfUrl)      { toast.error('Upload a PDF first');        return; }
    setSaving(true);
    try {
      await certsApi.createTemplate({
        name: name.trim(),
        background_url: pdfUrl,
        kind: 'pdf',
      });
      toast.success('PDF template saved');
      setName(''); setPdfUrl(null); setFileName(''); setTokensFound([]);
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const missing = TOKENS.filter(t => !tokensFound.includes(t));

  return (
    <div className={`${card} border rounded-xl p-5 space-y-4`}>
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg" style={{ background: PINK + '18' }}>
          <FileText className="h-4 w-4" style={{ color: PINK }} />
        </div>
        <p className={`font-semibold text-sm ${textPri}`}>New PDF Template (mail-merge)</p>
      </div>

      <p className={`text-xs ${textMuted}`}>
        Upload a certificate PDF that already has the placeholders typed into the design.
        At generation each one is replaced with the attendee's details. Supported tokens:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {TOKENS.map(t => (
          <span key={t} className={`px-1.5 py-0.5 rounded border border-[var(--border-color)] text-xs font-mono ${textSec}`}>
            {t}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={`block text-xs ${textSec} mb-1`}>Template Name *</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. Creative Enrichment Series"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={`block text-xs ${textSec} mb-1`}>Certificate PDF *</label>
          <label
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-color)] cursor-pointer text-sm ${textSec} hover:bg-[var(--bg-hover)] transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {uploading ? (
              <><Upload className="h-4 w-4 animate-spin" />Uploading…</>
            ) : pdfUrl ? (
              <><FileText className="h-4 w-4" style={{ color: PINK }} />Change PDF</>
            ) : (
              <><Upload className="h-4 w-4" />Upload PDF</>
            )}
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      {pdfUrl && (
        <div className="space-y-2">
          <p className={`text-xs ${textMuted} truncate`}>Uploaded: {fileName}</p>
          <div className="flex flex-wrap gap-1.5">
            {TOKENS.map(t => {
              const ok = tokensFound.includes(t);
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono
                    ${ok ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                         : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}
                  title={ok ? 'Found in the PDF — will be replaced' : 'Not found in the PDF text'}
                >
                  {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {t}
                </span>
              );
            })}
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              {missing.join(', ')} not detected — that text won't be replaced. Make sure the tokens are
              typed exactly (including braces) in the PDF, as selectable text (not an image).
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !pdfUrl || !name.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: PINK }}
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>
    </div>
  );
}
