import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Continuously watches the user's position via the browser Geolocation API.
 * When they are outside radiusM metres of the office for 60 continuous seconds,
 * it calls onExit(lat, lng, distanceMetres).
 *
 * Props:
 *   enabled   – false → watcher is inactive (skip for admins or when office not configured)
 *   offLat    – office latitude  (float)
 *   offLng    – office longitude (float)
 *   radiusM   – geofence radius in metres
 *   onExit    – async fn(lat, lng, distM) called on confirmed exit
 */
export function useGeofenceWatcher({ enabled, offLat, offLng, radiusM, onExit }) {
  const watchIdRef  = useRef(null);
  const timerRef    = useRef(null);
  const toastIdRef  = useRef(null);
  const outsideRef  = useRef(false);
  const secsLeftRef = useRef(60);
  const tickRef     = useRef(null);

  const cancelCountdown = useCallback(() => {
    if (timerRef.current)   { clearTimeout(timerRef.current);  timerRef.current  = null; }
    if (tickRef.current)    { clearInterval(tickRef.current);  tickRef.current   = null; }
    if (toastIdRef.current) { toast.dismiss(toastIdRef.current); toastIdRef.current = null; }
    outsideRef.current  = false;
    secsLeftRef.current = 60;
  }, []);

  // stable ref so we can call without re-creating the effect
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  useEffect(() => {
    if (!enabled || !offLat || !offLng || !navigator.geolocation) return;

    const handlePos = (pos) => {
      const { latitude, longitude } = pos.coords;
      const distM = haversineKm(latitude, longitude, offLat, offLng) * 1000;

      if (distM > radiusM) {
        if (!outsideRef.current) {
          outsideRef.current  = true;
          secsLeftRef.current = 60;

          toastIdRef.current = toast.warning(
            `⚠️ You've left the office zone (${Math.round(distM)}m away). Auto-logout in 60s if you don't return.`,
            { duration: 65000, id: 'geo-warn' }
          );

          // live countdown update every second
          tickRef.current = setInterval(() => {
            secsLeftRef.current -= 1;
            toast.warning(
              `⚠️ Outside office zone (${Math.round(distM)}m). Auto-logout in ${secsLeftRef.current}s.`,
              { id: 'geo-warn', duration: secsLeftRef.current * 1000 + 5000 }
            );
          }, 1000);

          timerRef.current = setTimeout(async () => {
            cancelCountdown();
            await onExitRef.current(latitude, longitude, Math.round(distM));
          }, 60000);
        }
      } else {
        if (outsideRef.current) {
          cancelCountdown();
          toast.success('✅ Back in office zone — auto-logout cancelled.', { duration: 4000 });
        }
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handlePos, null, {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 15000,
    });

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      cancelCountdown();
    };
  }, [enabled, offLat, offLng, radiusM, cancelCountdown]);
}
