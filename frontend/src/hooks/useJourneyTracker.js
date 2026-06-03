import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { journeyApi, expenses, schools as schoolsApi, contacts as contactsApi } from '../lib/api';

// ── Constants ────────────────────────────────────────────────────────────────

export const VEHICLE_OPTS = [
  { value: 'two_wheeler',  label: 'Two-wheeler',  rate: 5  },
  { value: 'four_wheeler', label: 'Four-wheeler', rate: 10 },
];

export const EXPENSE_TYPES = [
  { value: 'travel', label: 'Travel (KM-based)' },
  { value: 'food',   label: 'Food / Tea'        },
  { value: 'other',  label: 'Other Expense'     },
];

// ── LocalStorage helpers for start-type ──────────────────────────────────────

const DAYKEY = () => `jrn_startType_${new Date().toISOString().split('T')[0]}`;
export function getSavedStartType() {
  try { return localStorage.getItem(DAYKEY()) || 'office'; } catch { return 'office'; }
}
export function saveStartType(t) {
  try { localStorage.setItem(DAYKEY(), t); } catch {}
}

// ── GPS helper ───────────────────────────────────────────────────────────────

export function getGps() {
  return new Promise((res, rej) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 })
      : rej(new Error('GPS not supported'))
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useJourneyTracker() {
  const [journey,       setJourney]       = useState(null);
  const [loaded,        setLoaded]        = useState(false);
  const [busy,          setBusy]          = useState(false);

  // Start-journey UI
  const [startType, setStartType] = useState(getSavedStartType);

  // Arrive-at-stop form
  const [arriveOpen,   setArriveOpen]   = useState(false);
  const [schoolName,   setSchoolName]   = useState('');
  const [linkedVisit,  setLinkedVisit]  = useState('');

  // School + contact search within arrive form
  const [allSchools,         setAllSchools]         = useState([]);
  const [allContacts,        setAllContacts]         = useState([]);
  const [dbLoaded,           setDbLoaded]           = useState(false);
  const [schoolSearch,       setSchoolSearch]       = useState('');
  const [selectedSchool,     setSelectedSchool]     = useState(null);
  const [showSchoolDrop,     setShowSchoolDrop]     = useState(false);
  const [schoolContacts,     setSchoolContacts]     = useState([]);
  const [contactName,        setContactName]        = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactPhone,       setContactPhone]       = useState('');
  const [contactId,          setContactId]          = useState('');

  // Depart-stop form
  const [departOpen, setDepartOpen] = useState(false);
  const [outcome,    setOutcome]    = useState('');

  // Post-journey expense prompt
  const [expensePrompt, setExpensePrompt] = useState(null);
  const [expenseDialog, setExpenseDialog] = useState(false);
  const [expType,  setExpType]  = useState('travel');
  const [vehicle,  setVehicle]  = useState('two_wheeler');
  const [expAmt,   setExpAmt]   = useState('');
  const [expNote,  setExpNote]  = useState('');
  const [expBusy,  setExpBusy]  = useState(false);

  // Next-stop nudge after depart
  const [nextStopNudge, setNextStopNudge] = useState(false);

  // End journey confirmation
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  // Tick for live duration display
  const tickRef = useRef(null);
  const [tick, setTick] = useState(0); // eslint-disable-line no-unused-vars

  // ── Load active journey ──────────────────────────────────────────────────
  const loadJourney = useCallback(async () => {
    try {
      const r = await journeyApi.active();
      setJourney(Object.keys(r.data).length ? r.data : null);
    } catch {
      setJourney(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { loadJourney(); }, [loadJourney]);

  // Tick every minute while on journey
  useEffect(() => {
    if (!journey) return;
    tickRef.current = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(tickRef.current);
  }, [journey]);

  // Lock body scroll when any sheet is open (prevents iOS repositioning)
  useEffect(() => {
    const anyOpen = arriveOpen || departOpen || confirmEndOpen || expenseDialog;
    if (anyOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [arriveOpen, departOpen, confirmEndOpen, expenseDialog]);

  // Lazy-load schools + contacts when arrive sheet first opens
  useEffect(() => {
    if (!arriveOpen || dbLoaded) return;
    Promise.all([schoolsApi.getAll(), contactsApi.getAll()])
      .then(([sr, cr]) => {
        setAllSchools(sr.data || []);
        setAllContacts(cr.data || []);
        setDbLoaded(true);
      })
      .catch(() => {});
  }, [arriveOpen, dbLoaded]);

  // ── School search results (derived) ─────────────────────────────────────
  const schoolResults = (() => {
    if (!schoolSearch.trim() || selectedSchool) return [];
    const q = schoolSearch.toLowerCase();
    return allSchools
      .filter(s =>
        (s.school_name || s.name || '').toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  })();

  // ── School / contact selection ───────────────────────────────────────────
  const selectSchool = (s) => {
    setSelectedSchool(s);
    const name = s.school_name || s.name || '';
    setSchoolName(name);
    setSchoolSearch(name);
    setShowSchoolDrop(false);
    const sc = allContacts.filter(c => c.school_id === s.school_id);
    setSchoolContacts(sc);
    setContactName('');
    setContactDesignation('');
    setContactPhone('');
    setContactId('');
  };

  const selectContact = (c) => {
    setContactName(c.name || '');
    setContactDesignation(c.designation || '');
    setContactPhone(c.phone || '');
    setContactId(c.contact_id || '');
  };

  const clearSchool = () => {
    setSelectedSchool(null);
    setSchoolSearch('');
    setSchoolName('');
    setSchoolContacts([]);
    setContactName('');
    setContactDesignation('');
    setContactPhone('');
    setContactId('');
  };

  const resetArriveForm = () => {
    setArriveOpen(false);
    setSchoolName('');
    setLinkedVisit('');
    setSchoolSearch('');
    setSelectedSchool(null);
    setShowSchoolDrop(false);
    setSchoolContacts([]);
    setContactName('');
    setContactDesignation('');
    setContactPhone('');
    setContactId('');
  };

  // ── Journey actions ──────────────────────────────────────────────────────

  const startJourney = async () => {
    setBusy(true);
    try {
      const pos = await getGps();
      const r = await journeyApi.start({
        start_type: startType,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      setJourney(r.data);
      toast.success('Field journey started!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not get GPS. Please allow location access.');
    }
    setBusy(false);
  };

  const arrive = async () => {
    if (!schoolName.trim()) { toast.error('Enter school / destination name'); return; }
    setBusy(true);
    try {
      const pos = await getGps();
      const r = await journeyApi.arrive(journey.journey_id, {
        lat:                 pos.coords.latitude,
        lng:                 pos.coords.longitude,
        school_name:         schoolName.trim(),
        school_id:           selectedSchool?.school_id || '',
        contact_name:        contactName.trim(),
        contact_designation: contactDesignation.trim(),
        contact_phone:       contactPhone.trim(),
        contact_id:          contactId,
        visit_id:            linkedVisit || undefined,
      });
      setJourney(prev => ({
        ...prev,
        stops:    [...(prev.stops || []), r.data.stop],
        total_km: r.data.total_km,
      }));
      resetArriveForm();
      toast.success(`Arrived at ${schoolName.trim()} · +${r.data.stop.km_from_prev} km`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'GPS error — try again');
    }
    setBusy(false);
  };

  const depart = async () => {
    setBusy(true);
    try {
      await journeyApi.depart(journey.journey_id, { outcome: outcome || undefined });
      const stops = journey.stops || [];
      const idx   = stops.length - 1;
      const updated = stops.map((s, i) =>
        i === idx ? { ...s, departed_at: new Date().toISOString(), status: 'completed', outcome } : s
      );
      setJourney(prev => ({ ...prev, stops: updated }));
      setDepartOpen(false);
      setOutcome('');
      setNextStopNudge(true);
      toast.success('Visit marked done. Ready for next stop!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error');
    }
    setBusy(false);
  };

  const endJourney = async () => {
    setBusy(true);
    try {
      const pos = await getGps().catch(() => null);
      const r = await journeyApi.end(journey.journey_id, {
        lat: pos?.coords.latitude  ?? null,
        lng: pos?.coords.longitude ?? null,
      });
      setJourney(null);
      setExpensePrompt(r.data);
      toast.success(`Journey complete! Total: ${r.data.total_km} km`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error ending journey');
    }
    setBusy(false);
  };

  const submitExpense = async () => {
    if (!expensePrompt || expBusy) return;
    setExpBusy(true);
    try {
      if (expType === 'travel') {
        await expenses.create({
          expense_type:   'travel',
          category:       vehicle,
          transport_mode: vehicle,
          description:    `Field visit — ${expensePrompt.stops?.length || 0} stop(s) on ${expensePrompt.date}`,
          distance_km:    expensePrompt.total_km,
          date:           expensePrompt.date,
          notes:          expNote,
        });
        const rate = VEHICLE_OPTS.find(v => v.value === vehicle)?.rate || 5;
        toast.success(`Travel expense added! ₹${Math.round(expensePrompt.total_km * rate)}`);
      } else {
        const amount = parseFloat(expAmt) || 0;
        if (!amount) { toast.error('Enter amount'); setExpBusy(false); return; }
        await expenses.create({
          expense_type: expType,
          category:     expType === 'food' ? 'food' : 'other',
          description:  expNote || (expType === 'food' ? 'Food expense' : 'Other expense'),
          date:         expensePrompt.date,
          amount,
        });
        toast.success(`Expense of ₹${amount} added!`);
      }
      setExpenseDialog(false);
      setExpensePrompt(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not save expense');
    }
    setExpBusy(false);
  };

  const openExpenseDialog = () => {
    setExpType('travel');
    setVehicle('two_wheeler');
    setExpAmt('');
    setExpNote('');
    setExpenseDialog(true);
  };

  // ── Expose everything the UI needs ───────────────────────────────────────
  return {
    // Status
    journey, setJourney, loaded, busy,
    // Start form
    startType, setStartType,
    startJourney,
    // Arrive form
    arriveOpen, setArriveOpen,
    schoolName, setSchoolName,
    linkedVisit, setLinkedVisit,
    schoolSearch, setSchoolSearch,
    selectedSchool, setSelectedSchool,
    showSchoolDrop, setShowSchoolDrop,
    schoolResults, dbLoaded,
    selectSchool, clearSchool,
    schoolContacts,
    contactName, setContactName,
    contactDesignation, setContactDesignation,
    contactPhone, setContactPhone,
    contactId, setContactId,
    selectContact,
    resetArriveForm,
    arrive,
    // Depart form
    departOpen, setDepartOpen,
    outcome, setOutcome,
    depart,
    // End journey
    confirmEndOpen, setConfirmEndOpen,
    endJourney,
    // Expense
    expensePrompt, setExpensePrompt,
    expenseDialog, setExpenseDialog,
    expType, setExpType,
    vehicle, setVehicle,
    expAmt, setExpAmt,
    expNote, setExpNote,
    expBusy,
    submitExpense, openExpenseDialog,
    // Nudge
    nextStopNudge, setNextStopNudge,
  };
}
