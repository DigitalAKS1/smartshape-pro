import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useGeofenceWatcher } from '../hooks/useGeofenceWatcher';
import { officeSettings, punchApi } from '../lib/api';

/**
 * Invisible component — renders null, runs geofence watching for non-admin users.
 * Mount once at the app root so it's always active.
 */
export default function GeofenceGuard() {
  const { user, logout } = useAuth();
  const [office, setOffice] = useState(null);

  useEffect(() => {
    if (!user || user.role === 'admin' || user.role === 'school') return;
    officeSettings.get()
      .then(r => setOffice(r.data))
      .catch(() => {});
  }, [user]);

  const handleAutoLogout = useCallback(async (lat, lng, distM) => {
    try {
      await punchApi.geofenceExit({ lat, lng, distance_m: distM });
    } catch {}
    toast.error('🚨 Auto-logged out: you left the office zone.', { duration: 6000 });
    await logout();
  }, [logout]);

  const isActive = !!user && user.role !== 'admin' && user.role !== 'school'
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
