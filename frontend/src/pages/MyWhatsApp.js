import React, { useState } from 'react';
import { MessageCircle, ShieldAlert, PauseCircle, RefreshCw, Loader2, Smartphone } from 'lucide-react';
import AppShell from '../components/layouts/AppShell';
import { useTheme } from '../contexts/ThemeContext';
import useMyWhatsApp, { warmupText, warmupProgress, formatPhone, qrSrc } from '../hooks/useMyWhatsApp';

// My WhatsApp (spec 2026-09-24, W1): each rep links a company SIM by QR. The notice is shown
// always and must be ticked before linking; the QR refreshes every 20 s; a paused number waits
// for an admin.

export const NOTICE = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';

const STATE_LABEL = {
  unlinked: 'Not linked', qr: 'Waiting for scan', connected: 'Connected',
  disconnected: 'Disconnected', paused: 'Paused',
};
const STATE_TONE = {
  connected: 'bg-green-500/15 text-green-600 border-green-500/30',
  qr: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  disconnected: 'bg-red-500/15 text-red-500 border-red-500/30',
  paused: 'bg-red-500/15 text-red-500 border-red-500/30',
  unlinked: 'bg-gray-500/15 text-[var(--text-secondary)] border-[var(--border-color)]',
};

const BTN_PRIMARY = 'min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold bg-[#e94560] hover:bg-[#f05c75] '
  + 'text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN = 'min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium border border-[var(--border-color)] '
  + 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function MyWhatsApp() {
  const { isDark } = useTheme();
  const wa = useMyWhatsApp();
  const [accepted, setAccepted] = useState(false);
  const d = wa.data || {};
  const state = d.state || 'unlinked';
  const paused = state === 'paused';
  const waitsForAdmin = paused || !!d.needs_admin_resume;
  const linkedView = ['connected', 'paused', 'disconnected'].includes(state);

  const card = `rounded-2xl border p-4 ${isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)] shadow-sm'}`;
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const relink = () => {
    if (state === 'connected' && !window.confirm(
      'Relink this number? The company phone is logged out here and you scan a new QR code.')) return;
    wa.relink();
  };
  const unlink = () => {
    if (window.confirm('Unlink this number? Your automated messages will go from the company number until you link again.')) {
      wa.unlink();
    }
  };

  return (
    <AppShell>
      <div className="w-full max-w-xl mx-auto px-4 py-4 space-y-4" data-testid="my-whatsapp">
        <div className="flex items-center justify-between gap-3">
          <h1 className={`flex items-center gap-2 text-lg font-semibold ${textPri}`}>
            <MessageCircle className="h-5 w-5 text-green-600" /> My WhatsApp
          </h1>
          <div className="flex items-center gap-2">
            <span data-testid="wa-state"
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap ${STATE_TONE[state] || STATE_TONE.unlinked}`}>
              {STATE_LABEL[state] || state}
            </span>
            <button type="button" data-testid="wa-refresh" onClick={wa.reload} disabled={wa.loading}
              title="Refresh" aria-label="Refresh"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[#e94560] transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {wa.loading && (
          <p data-testid="wa-loading" className={`flex items-center gap-2 text-sm ${textSec}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {wa.error && <p data-testid="wa-error" className="text-sm text-red-500">{wa.error}</p>}

        {/* The notice is always on screen, linked or not. */}
        <div data-testid="wa-notice"
          className={`rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm ${textPri}`}>
          {d.notice || NOTICE}
        </div>

        {waitsForAdmin && (
          <div data-testid="wa-paused" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm space-y-1">
            <p className="flex items-center gap-2 font-semibold text-red-500">
              <PauseCircle className="h-4 w-4 flex-shrink-0" /> This number is paused
            </p>
            {d.paused_reason && <p data-testid="wa-paused-reason" className={textPri}>{d.paused_reason}</p>}
            <p className={textSec}>Ask an admin to resume this number.</p>
          </div>
        )}

        {d.looks_personal && (
          <div data-testid="wa-personal-warning"
            className="flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
            <ShieldAlert className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              This looks like your personal number (it matches the phone on your profile). If WhatsApp ever bans it,
              you lose your own WhatsApp too. Please link a company SIM instead.
            </span>
          </div>
        )}

        {!wa.loading && state === 'unlinked' && (
          <div className={`${card} space-y-3`}>
            {d.unlinked_detail && <p data-testid="wa-unlinked-detail" className="text-sm text-red-500">{d.unlinked_detail}</p>}
            {d.slots_full && (
              <p data-testid="wa-slots-full" className="text-sm text-red-500">
                Every WhatsApp slot on the server is in use. Ask an admin before linking.
              </p>
            )}
            <label className={`flex items-start gap-3 text-sm ${textPri} cursor-pointer`}>
              <input type="checkbox" data-testid="wa-accept" checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="accent-[#e94560] mt-0.5 h-5 w-5 flex-shrink-0" />
              <span>I have read this notice, and I am linking a company number.</span>
            </label>
            <button type="button" data-testid="wa-link" className={`${BTN_PRIMARY} w-full sm:w-auto`}
              disabled={!accepted || wa.busy || !!d.slots_full} onClick={() => wa.link()}>
              {wa.busy ? 'Linking…' : 'Link a WhatsApp number'}
            </button>
          </div>
        )}

        {state === 'qr' && (
          <div className={`${card} space-y-3 text-center`}>
            {d.qr_base64 ? (
              <img data-testid="wa-qr" src={qrSrc(d.qr_base64)} alt="WhatsApp QR code"
                className="mx-auto bg-white p-2 rounded-xl"
                style={{ width: 264, height: 264, minWidth: 240, minHeight: 240, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <p data-testid="wa-qr-preparing" className={`text-sm ${textSec}`}>Preparing the QR code…</p>
            )}
            <p className={`flex items-start gap-2 text-left text-sm ${textSec}`}>
              <Smartphone className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                On the company phone open WhatsApp → Settings → Linked devices → Link a device, and scan this code.
                It refreshes every 20 seconds.
              </span>
            </p>
          </div>
        )}

        {linkedView && (
          <div className={`${card} space-y-2`}>
            {d.phone_e164 && (
              <p data-testid="wa-connected-as" className={`text-sm font-medium ${textPri}`}>
                {state === 'connected' ? 'Connected as' : 'Linked number'} {formatPhone(d.phone_e164)}
              </p>
            )}
            {state === 'disconnected' && (
              <p data-testid="wa-disconnected-hint" className="text-sm text-red-500">
                The phone lost its link. Press Relink and scan the new QR code with the company phone.
              </p>
            )}
            <p data-testid="wa-warmup" className={`text-sm ${textSec}`}>{warmupText(d)}</p>
            <div className="h-2 rounded-full bg-[var(--bg-hover)] overflow-hidden" aria-hidden="true">
              <div data-testid="wa-warmup-bar" className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${Math.round(warmupProgress(d) * 100)}%` }} />
            </div>
          </div>
        )}

        {!wa.loading && state !== 'unlinked' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" data-testid="wa-relink" className={BTN}
              disabled={wa.busy || paused} onClick={relink}
              title={paused ? 'Ask an admin to resume this number' : 'Show a new QR code'}>
              Relink
            </button>
            <button type="button" data-testid="wa-unlink" className={BTN} disabled={wa.busy} onClick={unlink}>
              Unlink
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
