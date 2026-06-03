import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { visits as visitsApi, leads as leadsApi, schools as schoolsApi, salesTargets, contacts as contactsApi } from '../lib/api';

export default function useSalesVisits() {
  const today = new Date().toISOString().split('T')[0];

  const [visits, setVisits]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [planOpen, setPlanOpen]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [filter, setFilter]         = useState('today');
  const [targetProgress, setTargetProgress] = useState(null);

  // Add Contact sheet
  const [addContactVisit, setAddContactVisit] = useState(null);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', designation: 'Principal', company: '' });
  const [savingContact, setSavingContact] = useState(false);

  // Business card scanner
  const [scanOpen, setScanOpen]       = useState(false);
  const [scanPreview, setScanPreview] = useState(null); // data URL
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult]   = useState(null); // extracted fields
  const [scanError, setScanError]     = useState(null);
  const scanFileRef                   = useRef(null); // camera
  const scanGalleryRef                = useRef(null); // gallery

  // Complete Visit sheet
  const [completeVisit, setCompleteVisit] = useState(null); // visit object
  const [completing, setCompleting]       = useState(false);
  const [completeForm, setCompleteForm]   = useState({ outcome: '', notes: '' });
  const [gpsState, setGpsState]           = useState({ loading: true, lat: null, lng: null, address: null, error: null });

  useEffect(() => { fetchVisits(); fetchProgress(); }, []); // eslint-disable-line

  const fetchVisits = async () => {
    try {
      const res = await visitsApi.getAll();
      setVisits(res.data || []);
    } catch { toast.error('Failed to load visits'); }
    finally { setLoading(false); }
  };

  const fetchProgress = async () => {
    try {
      const res = await salesTargets.myProgress();
      setTargetProgress(res.data);
    } catch { /* no target set yet — hide widget */ }
  };

  const handleCheckIn = async (visitId) => {
    setCheckingIn(true);
    try {
      const pos = await new Promise((res) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000 })
          : res(null)
      );
      await visitsApi.checkIn(visitId, pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
      toast.success('Checked in!');
      fetchVisits();
    } catch { toast.error('Check-in failed'); }
    finally { setCheckingIn(false); }
  };

  const openCompleteSheet = (visit) => {
    setCompleteVisit(visit);
    setCompleteForm({ outcome: '', notes: '' });
    setGpsState({ loading: true, lat: null, lng: null, address: null, error: null });
    // Start GPS capture immediately
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          try {
            const r = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { 'User-Agent': 'SmartShapePro/1.0' } }
            );
            const d = await r.json();
            setGpsState({ loading: false, lat, lng, address: d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, error: null });
          } catch {
            setGpsState({ loading: false, lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, error: null });
          }
        },
        (err) => setGpsState({ loading: false, lat: null, lng: null, address: null, error: err.message }),
        { enableHighAccuracy: true, timeout: 12000 }
      );
    } else {
      setGpsState({ loading: false, lat: null, lng: null, address: null, error: 'GPS not supported on this device' });
    }
  };

  const submitComplete = async () => {
    if (!completeVisit) return;
    setCompleting(true);
    try {
      const payload = {
        status:  'completed',
        outcome: completeForm.outcome,
        notes:   completeForm.notes,
      };
      if (gpsState.lat && gpsState.lng) {
        payload.check_out_lat     = gpsState.lat;
        payload.check_out_lng     = gpsState.lng;
        payload.check_out_address = gpsState.address;
      }
      await visitsApi.update(completeVisit.visit_id, payload);
      toast.success('Visit completed! Location saved.');
      setCompleteVisit(null);
      fetchVisits();
    } catch { toast.error('Failed to complete visit'); }
    finally { setCompleting(false); }
  };

  // Haversine distance in metres
  function distanceBetween(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  const handleScanImage = async (file) => {
    if (!file) return;
    setScanError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setScanPreview(dataUrl);
      setScanLoading(true);
      setScanResult(null);
      try {
        const [header, b64] = dataUrl.split(',');
        const mediaType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
        const res = await visitsApi.scanCard(b64, mediaType);
        setScanResult(res.data);
      } catch (err) {
        const detail = err.response?.data?.detail || '';
        if (detail.includes('format') || detail.includes('HEIC') || err.response?.status === 415) {
          setScanError('HEIC/HEIF format not supported. On iPhone go to Settings → Camera → Formats → Most Compatible, then retake the photo.');
        } else if (detail.includes('GEMINI_API_KEY') || detail.includes('API key') || err.response?.status === 503) {
          setScanError('AI scanning not available. Admin needs to add GEMINI_API_KEY in App Settings.');
        } else if (detail) {
          setScanError(detail);
        } else {
          setScanError('Scan failed — try a clearer, well-lit photo of the card.');
        }
      } finally { setScanLoading(false); }
    };
    reader.readAsDataURL(file);
  };

  const applyScanResult = () => {
    if (!scanResult) return;
    setContactForm({
      name:        scanResult.name        || '',
      phone:       scanResult.phone       || '',
      email:       scanResult.email       || '',
      designation: scanResult.role        || 'Principal',
      company:     scanResult.school_name || '',
    });
    setScanOpen(false);
    setScanPreview(null);
    setScanResult(null);
    setAddContactVisit({ contact_person: scanResult.name, school_name: scanResult.school_name, contact_phone: scanResult.phone });
    toast.success('Contact details extracted! Review and save.');
  };

  const openAddContact = (visit) => {
    setAddContactVisit(visit);
    setContactForm({
      name:        visit.contact_person || '',
      phone:       visit.contact_phone  || '',
      email:       '',
      designation: 'Principal',
      company:     visit.school_name    || '',
    });
  };

  const submitAddContact = async () => {
    if (!contactForm.name.trim())  { toast.error('Name is required');  return; }
    if (!contactForm.phone.trim()) { toast.error('Phone is required'); return; }
    setSavingContact(true);
    try {
      await contactsApi.create(contactForm);
      toast.success('Contact added!');
      setAddContactVisit(null);
    } catch { toast.error('Failed to save contact'); }
    finally { setSavingContact(false); }
  };

  // Derived lists
  const todayVisits    = visits.filter(v => v.visit_date === today);
  const upcomingVisits = visits.filter(v => v.visit_date > today);
  const pastVisits     = visits.filter(v => v.visit_date < today).slice(0, 30);
  const shown          = filter === 'today' ? todayVisits : filter === 'upcoming' ? upcomingVisits : pastVisits;

  const todayWithCoords = todayVisits.filter(v => v.lat && v.lng);
  const openRoute = () => {
    if (!todayWithCoords.length) { toast.error("No GPS coordinates on today's visits"); return; }
    const pts = todayWithCoords.map(v => `${v.lat},${v.lng}`).join('/');
    window.open(`https://www.google.com/maps/dir/${pts}`, '_blank');
  };

  const tabs = [
    { id: 'today',    label: 'Today',    count: todayVisits.length },
    { id: 'upcoming', label: 'Upcoming', count: upcomingVisits.length },
    { id: 'past',     label: 'Past',     count: null },
  ];

  return {
    today, loading,
    visits, filter, setFilter, tabs,
    shown, todayVisits, upcomingVisits,
    todayWithCoords, openRoute,

    // Plan Visit
    planOpen, setPlanOpen,
    saving, setSaving,
    fetchVisits,

    // Check In
    checkingIn, handleCheckIn,

    // Complete Visit
    completeVisit, setCompleteVisit,
    completing, completeForm, setCompleteForm,
    gpsState, openCompleteSheet, submitComplete,
    distanceBetween,

    // Business Card Scanner
    scanOpen, setScanOpen,
    scanPreview, setScanPreview,
    scanLoading, scanResult, setScanResult,
    scanError, setScanError,
    scanFileRef, scanGalleryRef,
    handleScanImage, applyScanResult,

    // Add Contact
    addContactVisit, setAddContactVisit,
    contactForm, setContactForm,
    savingContact, openAddContact, submitAddContact,

    // Target progress
    targetProgress,
  };
}
