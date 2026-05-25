import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useGeofenceWatcher } from '../hooks/useGeofenceWatcher';
import { officeSettings, punchApi, wfhApi, visits as visitsApi } from '../lib/api';

/**
 * Invisible component — runs geofence watching for non-admin users.
 * Only active when the user is currently punched IN.
 *
 * Behaviour by role:
 *   sales_person  — silent mode: no user toasts, no logout.
 *                   Quietly notifies admin/HR if outside both zones.
 *                   Completely disabled if rep has an active/planned visit today.
 *   other field   — existing behaviour: countdown toast + auto-logout if outside
 *                   both office and WFH zones for 60 continuous seconds.
 *
 * Two zones checked for everyone:
 *   1. Office location (from field_settings)
 *   2. User's personal WFH home location (stored per user, optional)
 * Being inside either zone is treated as "safe" — no alert triggered.
 */
export default function GeofenceGuard() {
  const { user, logout } = useAuth();
  const [office,      setOffice]      = useState(null);
  const [wfhLocation, setWfhLocation] = useState(null);   // { wfh_lat, wfh_lng }
  const [isPunchedIn, setIsPunchedIn] = useState(false);
  const [hasVisitToday, setHasVisitToday] = useState(false);

  const isSalesPerson = !!user && user.role === 'sales_person';
  const isFieldUser   = !!user && user.role !== 'admin' && user.role !== 'school';

  // Load office settings
  useEffect(() => {
    if (!isFieldUser) return;
    officeSettings.get()
      .then(r => setOffice(r.data))
      .catch(() => {});
  }, [isFieldUser]);

  // Load user's WFH location
  useEffect(() => {
    if (!isFieldUser) return;
    wfhApi.get()
      .then(r => setWfhLocation(r.data))
      .catch(() => {});
  }, [isFieldUser]);

  // Poll punch status every 60s
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

  // For sales reps: check if they have a visit planned/active today (poll every 5 min)
  useEffect(() => {
    if (!isSalesPerson) return;
    const check = () => {
      const today = new Date().toISOString().slice(0, 10);
      visitsApi.getAll()
        .then(r => {
          const visits = r.data || [];
          const active = visits.some(v =>
            v.visit_date === today &&
            (v.status === 'planned' || v.status === 'in_progress')
          );
          setHasVisitToday(active);
        })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 300000);
    return () => clearInterval(id);
  }, [isSalesPerson]);

  // Sales person: silent field alert — admin/HR notified, rep unaffected
  const handleFieldAlert = useCallback(async (lat, lng, distM) => {
    try {
      await punchApi.geofenceFieldAlert({ lat, lng, distance_m: distM });
    } catch {}
    // No toast, no logout — intentionally silent for the rep
  }, []);

  // Other field users: full auto-logout behaviour
  const handleAutoLogout = useCallback(async (lat, lng, distM) => {
    try {
      await punchApi.geofenceExit({ lat, lng, distance_m: distM });
    } catch {}
    toast.error('🚨 Auto-logged out: you left the office zone.', { duration: 6000 });
    await logout();
  }, [logout]);

  const hasOfficeCentre = !!office?.office_lat && !!office?.office_lng;
  const hasWfh          = !!wfhLocation?.wfh_lat && !!wfhLocation?.wfh_lng;

  // Geofence is active when:
  //   - field user, punched in, office configured
  //   - for sales: also NOT on a field visit today
  const isActive = isFieldUser && isPunchedIn && hasOfficeCentre
    && !(isSalesPerson && hasVisitToday);

  useGeofenceWatcher({
    enabled:    isActive,
    offLat:     hasOfficeCentre ? parseFloat(office.office_lat)      : 0,
    offLng:     hasOfficeCentre ? parseFloat(office.office_lng)      : 0,
    radiusM:    hasOfficeCentre ? parseFloat(office.office_radius_m || 300) : 300,
    altLat:     hasWfh ? parseFloat(wfhLocation.wfh_lat) : undefined,
    altLng:     hasWfh ? parseFloat(wfhLocation.wfh_lng) : undefined,
    silentMode: isSalesPerson,
    onExit:     isSalesPerson ? handleFieldAlert : handleAutoLogout,
  });

  return null;
}
