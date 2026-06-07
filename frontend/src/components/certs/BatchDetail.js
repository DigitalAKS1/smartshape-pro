import React, { useEffect, useRef, useCallback } from 'react';
import {
  Zap, Send, ExternalLink, ArrowLeft,
  CheckCircle, Clock, XCircle, Loader2, AlertTriangle,
} from 'lucide-react';
import { certsApi } from '../../lib/api';

const PINK = '#e94560';

/* ── status badge helpers ─────────────────────────────────────────────────── */
const GEN_BADGE = {
  pending:    { label: 'Pending',    cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  generating: { label: 'Generating', cls: 'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400'   },
  generated:  { label: 'Generated',  cls: 'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400'  },
  failed:     { label: 'Failed',     cls: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400'    },
};

const DEL_BADGE = {
  pending:  { label: 'Pending',  cls: 'bg-gray-100  text-gray-600  dark:bg-gray-800   dark:text-gray-400' },
  sent:     { label: 'Sent',     cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  failed:   { label: 'Failed',   cls: 'bg-red-100   text-red-700   dark:bg-red-900/30   dark:text-red-400'  },
  skipped:  { label: 'Skipped',  cls: 'bg-gray-100  text-gray-500  dark:bg-gray-800   dark:text-gray-400' },
};

function Badge({ map, status }) {
  const s = map[status] || { label: status || '—', cls: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  );
}

/* ── batch-level status indicator ─────────────────────────────────────────── */
function BatchStatusIcon({ status }) {
  if (status === 'generating' || status === 'sending')
    return <Loader2 className="h-4 w-4 animate-spin" style={{ color: PINK }} />;
  if (status === 'ready')
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === 'done')
    return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'draft')
    return <Clock className="h-4 w-4 text-yellow-500" />;
  return <AlertTriangle className="h-4 w-4 text-gray-400" />;
}

/* ── counts row ────────────────────────────────────────────────────────────── */
function CountCard({ label, value, sub }) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-lg p-3 text-center min-w-[80px]">
      <p className="text-xl font-semibold text-[var(--text-primary)]">{value ?? 0}</p>
      <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

/* ── polling interval ──────────────────────────────────────────────────────── */
const POLL_MS = 4000;
const ACTIVE_STATUSES = new Set(['generating', 'sending']);

/**
 * BatchDetail — shows a single batch with its items, status, generate/send actions.
 *
 * Props:
 *   batch      — the batch object (with .items array) from useCertificates
 *   loadBatch  — (id) => Promise  (from hook, updates currentBatch in parent)
 *   generate   — (id) => Promise  (from hook)
 *   send       — (id) => Promise  (from hook)
 *   onBack     — callback to return to the batch list
 */
export default function BatchDetail({ batch, loadBatch, generate, send, onBack }) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  /* ── ref to the latest batch so the interval callback doesn't stale-close ── */
  const batchRef = useRef(batch);
  useEffect(() => { batchRef.current = batch; }, [batch]);

  /* ── polling: every 4s while status is generating or sending ── */
  const intervalRef = useRef(null);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return; // already running
    intervalRef.current = setInterval(async () => {
      const current = batchRef.current;
      if (!current?.batch_id) return;
      if (!ACTIVE_STATUSES.has(current.status)) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        return;
      }
      await loadBatch(current.batch_id);
    }, POLL_MS);
  }, [loadBatch]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /* Start/stop polling based on current status */
  useEffect(() => {
    if (batch && ACTIVE_STATUSES.has(batch.status)) {
      startPolling();
    } else {
      stopPolling();
    }
    /* cleanup on unmount or when batch changes away from active */
    return stopPolling;
  }, [batch?.status, startPolling, stopPolling]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── guard: nothing to show ── */
  if (!batch) {
    return (
      <div className={`${card} border rounded-xl p-8 text-center`}>
        <p className={`${textMuted} text-sm`}>No batch selected.</p>
      </div>
    );
  }

  const { batch_id, title, status, counts = {}, items = [], shared_values = {}, channels = [] } = batch;
  const isActive = ACTIVE_STATUSES.has(status);
  const canSend  = status === 'ready';

  /* ── action handlers ── */
  const handleGenerate = async () => {
    await generate(batch_id);
    // After queuing, start polling immediately
    startPolling();
  };

  const handleSend = async () => {
    await send(batch_id);
    startPolling();
  };

  const handlePreview = (itemId) => {
    const url = certsApi.previewUrl(itemId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* ─── render ─── */
  return (
    <div className="space-y-4">

      {/* Back + header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={`p-1.5 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] transition-colors`}
              title="Back to batches"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <BatchStatusIcon status={status} />
            <h2 className={`text-lg font-semibold ${textPri} leading-tight`}>{title}</h2>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border border-[var(--border-color)] ${textMuted} capitalize`}>
            {status}
          </span>
        </div>

        {/* Generate / Send actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-color)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-hover)]"
            title={isActive ? 'Processing…' : 'Generate certificates'}
          >
            {isActive && status === 'generating' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" style={{ color: PINK }} />
            )}
            <span className={textSec}>Generate</span>
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend || isActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: PINK }}
            title={canSend ? 'Send certificates to all attendees' : 'Generate first before sending'}
          >
            {isActive && status === 'sending' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </button>
        </div>
      </div>

      {/* Shared values + channels */}
      <div className={`${card} border rounded-xl p-4 flex flex-wrap gap-4 text-sm`}>
        {shared_values.date   && <span className={textSec}><span className={textMuted}>Date:</span> {shared_values.date}</span>}
        {shared_values.theme  && <span className={textSec}><span className={textMuted}>Theme:</span> {shared_values.theme}</span>}
        {shared_values.expert && <span className={textSec}><span className={textMuted}>Expert:</span> {shared_values.expert}</span>}
        {channels.length > 0  && (
          <span className={textSec}>
            <span className={textMuted}>Channels:</span> {channels.join(', ')}
          </span>
        )}
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-3">
        <CountCard label="Total"     value={counts.total}          />
        <CountCard label="Generated" value={counts.generated}      />
        <CountCard label="WA Sent"   value={counts.sent_whatsapp}  />
        <CountCard label="Email Sent" value={counts.sent_email}    />
        <CountCard label="Failed"    value={counts.failed}         />
      </div>

      {/* Items table */}
      {items.length > 0 ? (
        <div className={`${card} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  {['Name', 'Generated', 'WhatsApp', 'Email', 'Preview'].map(h => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide ${textMuted} whitespace-nowrap`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {items.map(item => {
                  const wa    = item.delivery?.whatsapp?.status || 'pending';
                  const email = item.delivery?.email?.status    || 'pending';
                  return (
                    <tr key={item.item_id} className="hover:bg-[var(--bg-hover)] transition-colors">
                      <td className={`px-4 py-2.5 font-medium ${textPri} whitespace-nowrap`}>
                        {item.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge map={GEN_BADGE} status={item.gen_status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge map={DEL_BADGE} status={wa} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge map={DEL_BADGE} status={email} />
                      </td>
                      <td className="px-4 py-2.5">
                        {item.gen_status === 'generated' ? (
                          <button
                            type="button"
                            onClick={() => handlePreview(item.item_id)}
                            className={`inline-flex items-center gap-1 text-xs font-medium hover:underline`}
                            style={{ color: PINK }}
                            title="Open certificate PDF in new tab"
                          >
                            Preview
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className={`text-xs ${textMuted}`}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`${card} border rounded-xl p-6 text-center border-dashed`}>
          <XCircle className={`h-8 w-8 mx-auto mb-2 ${textMuted}`} />
          <p className={`text-sm ${textMuted}`}>No items in this batch.</p>
        </div>
      )}
    </div>
  );
}
