import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { waNumbers } from '../lib/api';

// The QR WhatsApp shows rotates; the server fetches a new one when ours is older than 20 s.
export const QR_POLL_MS = 20000;
// A linked number is re-read once a minute so a drop or an admin pause shows up on its own.
export const CONNECTED_POLL_MS = 60000;
export const WARMUP_DAYS = 14;

/** "Day 4 of 14 — today 40 of 60", or "Warmed up — today 3 of 200" after the last warm-up day.
 *  Takes the /wa/me view (flat warmup_day / sent_today / cap_today) or its nested `warmup`. */
export function warmupText(src) {
  if (!src) return '';
  const w = src.warmup || {};
  const day = src.warmup_day ?? w.day ?? src.day;
  if (day === undefined || day === null) return '';
  const of = w.of ?? src.of ?? WARMUP_DAYS;
  const sent = src.sent_today ?? w.today_sent ?? src.today_sent ?? 0;
  const cap = src.cap_today ?? w.today_cap ?? src.today_cap;
  const today = cap === undefined || cap === null ? '' : ` — today ${sent} of ${cap}`;
  if (day > of) return `Warmed up${today}`;
  return `Day ${day} of ${of}${today}`;
}

/** 0..1 through the warm-up (1 once warmed up). */
export function warmupProgress(src) {
  if (!src) return 0;
  const w = src.warmup || {};
  const day = Number(src.warmup_day ?? w.day ?? 0);
  const of = Number(w.of ?? WARMUP_DAYS) || WARMUP_DAYS;
  return Math.max(0, Math.min(1, day / of));
}

/** "919811111111" -> "+91 98111 11111"; anything else -> "+<digits>". */
export function formatPhone(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : '';
}

/** Evolution usually returns a full data URL; a bare base64 PNG gets the prefix. */
export function qrSrc(b64) {
  const s = String(b64 || '');
  if (!s) return '';
  return s.startsWith('data:') ? s : `data:image/png;base64,${s}`;
}

const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};

export default function useMyWhatsApp({ pollMs = QR_POLL_MS, connectedPollMs = CONNECTED_POLL_MS } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const inFlight = useRef(0);        // loads still running
  const seq = useRef(0);             // only the newest load may write its answer

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    inFlight.current += 1;
    try {
      const r = await waNumbers.me();
      if (!alive.current || mine !== seq.current) return;
      setData(r?.data || null);
      setError('');
    } catch (e) {
      if (alive.current && mine === seq.current) setError(errText(e, 'Could not load your WhatsApp status'));
    } finally {
      inFlight.current -= 1;
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 20 s while waiting for the scan (fresh QR), every 60 s once connected, never otherwise.
  const state = data?.state;
  useEffect(() => {
    const every = state === 'qr' ? pollMs : state === 'connected' ? connectedPollMs : 0;
    if (!every) return undefined;
    const iv = setInterval(() => { if (!inFlight.current) load(); }, every);   // a slow poll never stacks up
    return () => clearInterval(iv);
  }, [state, load, pollMs, connectedPollMs]);

  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    try {
      const r = await fn();
      const msg = typeof okText === 'function' ? okText(r?.data || {}) : okText;
      if (msg) toast.success(msg);
      await load();                                      // newest load wins over any poll still running
    } catch (e) {
      toast.error(errText(e, 'Something went wrong'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [load]);

  const link = useCallback((label) => run(
    () => waNumbers.link({ accept_notice: true, label }),
    (d) => (d.already_linked ? 'You already have a number linked' : 'Now scan the QR code with the company phone'),
  ), [run]);
  const relink = useCallback(() => run(() => waNumbers.relink(), 'Scan the new QR code'), [run]);
  const unlink = useCallback(() => run(() => waNumbers.unlink(), 'Number unlinked'), [run]);

  return { data, loading, busy, error, reload: load, link, relink, unlink };
}
