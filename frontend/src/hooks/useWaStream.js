import { useCallback, useEffect, useRef, useState } from 'react';
import { waInbox } from '../lib/api';

// After this many consecutive stream errors we stop trusting the browser's
// own auto-reconnect and fall back to a 30 s poll (the inbox hook watches
// `degraded` and refetches on that cadence).
export const DEGRADE_AFTER_ERRORS = 3;
export const DEGRADED_POLL_MS = 30000;

/** Live WhatsApp inbox events over SSE. `onEvent(type, data)` fires for every
 *  `message_new` / `message_status` / `chat_updated` / `instance_state` frame.
 *  `enabled=false` opens nothing (and closes whatever was open). */
export default function useWaStream(onEvent, { enabled = true } = {}) {
  const [connected, setConnected] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [lastError, setLastError] = useState(null);
  const esRef = useRef(null);
  const errorCountRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const open = useCallback(() => {
    if (esRef.current) return;
    const es = new EventSource(waInbox.streamUrl(), { withCredentials: true });
    esRef.current = es;

    const handle = (type) => (evt) => {
      errorCountRef.current = 0;
      setConnected(true);
      setDegraded(false);
      let data = null;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }
      onEventRef.current?.(type, data);
    };

    ['message_new', 'message_status', 'chat_updated', 'instance_state'].forEach((type) => {
      es.addEventListener(type, handle(type));
    });

    // A quiet-but-healthy connection (no events yet, but the socket is up) must
    // still read as connected — don't wait for the first named event for that.
    es.onopen = () => {
      errorCountRef.current = 0;
      setConnected(true);
      setDegraded(false);
    };

    es.onerror = (evt) => {
      setConnected(false);
      setLastError(evt);
      errorCountRef.current += 1;
      if (errorCountRef.current >= DEGRADE_AFTER_ERRORS) setDegraded(true);
    };
  }, []);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    close();
    errorCountRef.current = 0;
    setDegraded(false);
    open();
  }, [close, open]);

  useEffect(() => {
    if (!enabled) {
      close();
      return undefined;
    }
    open();
    return () => close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { connected, degraded, lastError, reconnect };
}
