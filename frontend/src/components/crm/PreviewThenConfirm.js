import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Shared "preview (dry-run) -> explicit type-to-confirm -> real run" affordance
 * for the CRM Data Health migrations/repairs. Mirrors BulkDeleteSchoolsDialog's
 * confirm pattern (red, permanent-but-restorable, disabled until the exact word
 * is typed) but as an inline widget instead of a modal, so several of these can
 * live inside one collapsible panel section.
 *
 * The confirm field/button are only ever rendered — and only ever enabled —
 * AFTER a successful dry-run response is in hand. There is no path that lets
 * `runConfirm` fire without a preceding `runDryRun` resolving first.
 *
 * Props:
 *   runDryRun()                    -> Promise<{data}>            (dry_run:true)
 *   runConfirm(previewData,reason) -> Promise<{data}>             (dry_run:false)
 *   renderPreview(previewData)     -> ReactNode
 *   renderResult(resultData)       -> ReactNode                   (optional)
 *   confirmWord                    e.g. 'CONFIRM' | 'MERGE'
 *   previewLabel, confirmLabel     button text
 *   onDone(resultData)             called after a successful real run
 *   disablePreview, disabledReason gate the Preview button itself (e.g. merge
 *                                  needs a survivor picked first)
 */
export default function PreviewThenConfirm({
  runDryRun, runConfirm, renderPreview, renderResult,
  confirmWord = 'CONFIRM', previewLabel = 'Preview', confirmLabel = 'Confirm & run',
  onDone, disablePreview = false, disabledReason = '',
}) {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setPreview(null); setResult(null); setPreviewError(''); setConfirmText(''); setReason(''); };

  const doPreview = async () => {
    reset();
    setPreviewLoading(true);
    try {
      const { data } = await runDryRun();
      setPreview(data);
    } catch (e) {
      setPreviewError(e.response?.data?.detail || 'Could not load preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const doConfirm = async () => {
    if (confirmText !== confirmWord || running || !preview) return;
    setRunning(true);
    try {
      const { data } = await runConfirm(preview, reason);
      setResult(data);
      toast.success('Done — backup saved, restorable');
      onDone?.(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Action failed — nothing was changed');
    } finally {
      setRunning(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 space-y-2 text-xs" data-testid="preview-confirm-result">
        <p className="flex items-center gap-1.5 font-medium text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Done</p>
        {renderResult ? renderResult(result) : null}
        <Button size="sm" variant="outline" onClick={reset} data-testid="preview-confirm-run-again">Run again</Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="space-y-1.5">
        <Button type="button" size="sm" onClick={doPreview} disabled={previewLoading || disablePreview}
          data-testid="preview-confirm-preview-btn" variant="outline"
          className="border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10">
          {previewLoading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…</> : previewLabel}
        </Button>
        {disablePreview && disabledReason && <p className="text-[11px] text-[var(--text-muted)]">{disabledReason}</p>}
        {previewError && <p className="text-xs text-red-400" data-testid="preview-confirm-error">{previewError}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 space-y-3" data-testid="preview-confirm-box">
      {renderPreview(preview)}

      <div>
        <label className="mb-1 block text-[11px] text-[var(--text-muted)]">Reason (optional, saved to audit log)</label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder="Why is this being run?" data-testid="preview-confirm-reason" className="text-xs" />
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
          Type <span className="font-mono font-semibold text-red-400">{confirmWord}</span> to confirm — permanent, but restorable from the backup this creates
        </label>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
          placeholder={confirmWord} autoComplete="off" data-testid="preview-confirm-word-input" className="text-sm" />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={reset} disabled={running} data-testid="preview-confirm-cancel-btn">Cancel</Button>
        <Button type="button" size="sm" onClick={doConfirm}
          disabled={confirmText !== confirmWord || running}
          data-testid="preview-confirm-run-btn"
          className="bg-red-600 text-white hover:bg-red-700">
          {running ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Running…</> : (
            <><AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> {confirmLabel}</>
          )}
        </Button>
      </div>
    </div>
  );
}
