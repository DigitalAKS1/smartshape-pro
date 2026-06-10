import React from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function IntegrationStatusChip({ configured, testing, onTest, testResult }) {
  return (
    <div className="flex items-center gap-3">
      {configured ? (
        <span className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" /> Connected
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
          <XCircle className="h-4 w-4" /> Not set
        </span>
      )}
      {onTest && (
        <button type="button" onClick={onTest} disabled={testing}
          className="text-xs px-2.5 py-1 rounded border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test connection'}
        </button>
      )}
      {testResult === 'ok' && <span className="text-xs text-green-600">✓ OK</span>}
      {testResult === 'fail' && <span className="text-xs text-red-500">✗ Failed</span>}
    </div>
  );
}
