import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Public branded meeting-join page — app.smartshape.in/zoom/:eventId
 * Z1: resolves the event's meeting link and redirects into the Zoom/Meet/other meeting.
 * Z2 (later): replace the redirect with an embedded Meeting SDK client.
 * No SmartShape login required (external attendees use this).
 */
const PINK = '#e94560';
const PROVIDER_LABEL = { zoom: 'Zoom', meet: 'Google Meet', other: 'meeting' };

export default function ZoomJoin() {
  const { eventId } = useParams();
  const [state, setState] = useState({ status: 'loading' }); // loading | redirect | error | cancelled

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/delegation/zoom/${eventId}/resolve`);
        if (!res.ok) { if (alive) setState({ status: 'error' }); return; }
        const d = await res.json();
        if (!alive) return;
        if (d.status === 'cancelled') { setState({ status: 'cancelled', d }); return; }
        if (!d.meeting_link) { setState({ status: 'error', d }); return; }
        setState({ status: 'redirect', d });
        // brief beat so the branded page is visible, then hand off to the meeting
        setTimeout(() => { window.location.href = d.meeting_link; }, 1200);
      } catch {
        if (alive) setState({ status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [eventId]);

  const d = state.d || {};
  const label = PROVIDER_LABEL[d.meeting_provider] || 'meeting';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f1117', color: '#e7e9ee', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center', background: '#171a23',
        border: '1px solid #262a36', borderRadius: 20, padding: '36px 28px' }}>
        <div style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 20, marginBottom: 4 }}>
          SmartShape <span style={{ color: PINK }}>Meet</span>
        </div>

        {state.status === 'loading' && (
          <p style={{ color: '#9aa1b2', fontSize: 14, marginTop: 16 }}>Preparing your meeting…</p>
        )}

        {state.status === 'redirect' && (
          <>
            {d.title && <p style={{ fontWeight: 600, marginTop: 14 }}>{d.title}</p>}
            <p style={{ color: '#9aa1b2', fontSize: 14, margin: '8px 0 20px' }}>
              Connecting you to the {label}…
            </p>
            <div style={{ width: 28, height: 28, margin: '0 auto 20px', borderRadius: '50%',
              border: `3px solid ${PINK}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            <a href={d.meeting_link} style={{ display: 'inline-block', background: PINK, color: '#fff',
              fontWeight: 700, fontSize: 14, padding: '10px 22px', borderRadius: 12, textDecoration: 'none' }}>
              Join now
            </a>
            <p style={{ color: '#6b7280', fontSize: 11, marginTop: 14 }}>
              Not redirected automatically? Tap “Join now”.
            </p>
          </>
        )}

        {state.status === 'cancelled' && (
          <p style={{ color: '#9aa1b2', fontSize: 14, marginTop: 16 }}>
            This meeting has been cancelled.
          </p>
        )}

        {state.status === 'error' && (
          <p style={{ color: '#9aa1b2', fontSize: 14, marginTop: 16 }}>
            This meeting link is not available. Please check with the organiser.
          </p>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
