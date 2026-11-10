import React, { useRef, useState } from 'react';
import { Download, Upload, CheckCircle, AlertTriangle, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { pastPurchases } from '../../lib/api';

const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md';
const textPri = 'text-[var(--text-primary)]';
const textMuted = 'text-[var(--text-muted)]';

/**
 * One-time upload of old orders (before the app) for many schools.
 * Step 1 checks the file without saving (dry run) and shows what will be created
 * and which rows can't be matched; step 2 imports. Uploading the same file twice
 * never duplicates.
 */
export default function OldOrdersImport() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const downloadTemplate = async () => {
    try {
      const r = await pastPurchases.template();
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'old-orders-template.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Could not download template'); }
  };

  const run = async (dryRun) => {
    if (!file) { toast.error('Choose a file first'); return; }
    setBusy(true);
    try {
      const r = await pastPurchases.importFile(file, dryRun);
      setResult(r.data);
      if (!dryRun) toast.success(`Imported ${r.data.created} old order(s)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Import failed');
    } finally { setBusy(false); }
  };

  const newCount = result ? result.preview.filter(p => !p.duplicate).length : 0;

  return (
    <div className="space-y-4" data-testid="old-orders-import">
      <div className={`${card} p-5 space-y-3`}>
        <h2 className={`text-lg font-medium ${textPri}`}>Upload old orders</h2>
        <ol className={`text-sm ${textMuted} list-decimal pl-5 space-y-1`}>
          <li>Download the template. One row per item; rows with the same school, date and bill no. become one order.</li>
          <li>School is matched by <b>school_id</b>, or by <b>school_name</b> (+ city if two schools share a name).</li>
          <li><b>die_code</b> is matched to inventory; anything else (e.g. a machine) goes in <b>item_name</b>.</li>
          <li>Dates: 15-03-2023, 15/03/2023 or 2023-03-15. Old orders never change stock or payments.</li>
        </ol>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="old-orders-template">
            <Download className="h-3.5 w-3.5 mr-1" /> Template
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden"
            onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="border-[var(--border-color)] text-[var(--text-secondary)]">
            <Upload className="h-3.5 w-3.5 mr-1" /> {file ? file.name : 'Choose file'}
          </Button>
          <Button size="sm" disabled={!file || busy} onClick={() => run(true)} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="old-orders-check">
            {busy ? 'Checking…' : 'Check file'}
          </Button>
        </div>
      </div>

      {result && (
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className={textPri}><b>{result.groups}</b> order(s) found</span>
            {result.dry_run
              ? <span className="text-emerald-500"><b>{newCount}</b> new</span>
              : <span className="text-emerald-500 flex items-center gap-1"><CheckCircle className="h-4 w-4" /><b>{result.created}</b> imported</span>}
            <span className={textMuted}><b>{result.duplicates}</b> already recorded</span>
            <span className={result.skipped.length ? 'text-amber-500' : textMuted}><b>{result.skipped.length}</b> row(s) skipped</span>
          </div>

          {result.skipped.length > 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 max-h-48 overflow-y-auto">
              {result.skipped.map((s, i) => (
                <p key={i} className="text-xs text-amber-600 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Row {s.row}: {s.reason}</p>
              ))}
            </div>
          )}

          {result.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className={`${textMuted} text-left`}>
                  <th className="py-1.5 pr-3">School</th><th className="pr-3">Date</th><th className="pr-3">Bill no.</th><th className="pr-3">Items</th><th />
                </tr></thead>
                <tbody>
                  {result.preview.slice(0, 200).map((p, i) => (
                    <tr key={i} className={`border-t border-[var(--border-color)] ${textPri}`}>
                      <td className="py-1.5 pr-3">{p.school_name}</td>
                      <td className="pr-3 whitespace-nowrap">{p.purchase_date}</td>
                      <td className="pr-3">{p.reference}</td>
                      <td className="pr-3">{p.items.map(it => `${it.die_code || it.name} ×${it.qty}${it.die_id ? '' : ' (text)'}`).join(', ')}</td>
                      <td className={p.duplicate ? textMuted : 'text-emerald-500'}>{p.duplicate ? 'already there' : 'new'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.dry_run && newCount > 0 && (
            <Button onClick={() => run(false)} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="old-orders-import-btn">
              <Play className="h-3.5 w-3.5 mr-1" /> Import {newCount} order(s)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
