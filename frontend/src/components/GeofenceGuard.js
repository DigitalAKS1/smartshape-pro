import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useGeofenceWatcher } from '../hooks/useGeofenceWatcher';
import { officeSettings, punchApi } from '../lib/api';

/**
 * Invisible component — renders null, runs geofence watching for non-admin users.
 * Only active when the user is currently punched IN — no warnings after punch-out.
 * Mount once at the app root so it's always active.
 */
export default function GeofenceGuard() {
  const { user, logout } = useAuth();
  const [office, setOffice] = useState(null);
  const [isPunchedIn, setIsPunchedIn] = useState(false);

  const isFieldUser = !!user && user.role !== 'admin' && user.role !== 'school';

  useEffect(() => {
    if (!isFieldUser) return;
    officeSettings.get()
      .then(r => setOffice(r.data))
      .catch(() => {});
  }, [isFieldUser]);

  // Poll punch status every 60s so geofence deactivates automatically after punch-out
  useEffect(() => {
    if (!isFieldUser) return;
    const check = () => {
      punchApi.todayPunches()
        .then(r => {
          const punches = r.data || [];
          const last = punches[punches.length - 1];
          setIsPunchedIn(last?.type === 'in');
        })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [isFieldUser]);

  const handleAutoLogout = useCallback(async (lat, lng, distM) => {
    try {
      await punchApi.geofenceExit({ lat, lng, distance_m: distM });
    } catch {}
    toast.error('🚨 Auto-logged out: you left the office zone.', { duration: 6000 });
    await logout();
  }, [logout]);

  const isActive = isFieldUser && isPunchedIn
    && !!office?.office_lat && !!office?.office_lng;

  useGeofenceWatcher({
    enabled:  isActive,
    offLat:   isActive ? parseFloat(office.office_lat)  : 0,
    offLng:   isActive ? parseFloat(office.office_lng)  : 0,
    radiusM:  isActive ? parseFloat(office.office_radius_m || 300) : 300,
    onExit:   handleAutoLogout,
  });

  return null;
}
