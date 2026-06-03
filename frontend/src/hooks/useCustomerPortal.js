import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

/**
 * Hook encapsulating all CustomerPortal state and API calls.
 */
export function useCustomerPortal(token) {
  const navigate = useNavigate();
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('overview');
  const [playVideo, setPlayVideo]   = useState(null);
  const [registering, setRegistering] = useState({});
  const [notifRead, setNotifRead]   = useState(false);
  const [vidCategory, setVidCategory] = useState('all');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Support ticket state
  const [tickets, setTickets]               = useState([]);
  const [ticketForm, setTicketForm]         = useState({ title: '', description: '', priority: 'medium' });
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketsLoaded, setTicketsLoaded]   = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/customer-portal/${token}/dashboard`);
      if (!r.ok) throw new Error('Not found');
      const d = await r.json();
      setData(d);
    } catch {
      toast.error('Could not load your portal');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Check login status
  useEffect(() => {
    fetch(`${BACKEND}/api/customer/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.catalogue_token) setIsLoggedIn(true); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch(`${BACKEND}/api/customer/logout`, { method: 'POST', credentials: 'include' });
    setIsLoggedIn(false);
    navigate('/customer-login');
  };

  const markRead = useCallback(async () => {
    if (notifRead) return;
    setNotifRead(true);
    try {
      await fetch(`${BACKEND}/api/customer-portal/${token}/notifications/read`, { method: 'POST' });
    } catch { /* ignore */ }
  }, [token, notifRead]);

  useEffect(() => {
    if (tab === 'overview' && data?.unread_count > 0) markRead();
  }, [tab, data, markRead]);

  const registerSession = async (sessionId, isRegistered) => {
    setRegistering(p => ({ ...p, [sessionId]: true }));
    try {
      if (isRegistered) {
        await fetch(`${BACKEND}/api/customer-portal/${token}/sessions/${sessionId}/register`, { method: 'DELETE' });
        toast.success('Unregistered from session');
      } else {
        const r = await fetch(`${BACKEND}/api/customer-portal/${token}/sessions/${sessionId}/register`, { method: 'POST' });
        const d = await r.json();
        if (r.ok) { toast.success(d.already_registered ? 'Already registered' : 'Registered! Check your email for confirmation'); }
        else { toast.error(d.detail || 'Could not register'); }
      }
      await fetchDashboard();
    } catch {
      toast.error('Network error');
    } finally {
      setRegistering(p => ({ ...p, [sessionId]: false }));
    }
  };

  const fetchTickets = useCallback(async () => {
    if (ticketsLoaded) return;
    try {
      const r = await fetch(`${BACKEND}/api/customer-portal/${token}/support-tickets`);
      if (r.ok) { const d = await r.json(); setTickets(d); }
    } catch { /* ignore */ } finally {
      setTicketsLoaded(true);
    }
  }, [token, ticketsLoaded]);

  useEffect(() => { if (tab === 'support') fetchTickets(); }, [tab, fetchTickets]);

  const handleTicketSubmit = async (e) => {
    e.preventDefault();
    if (!ticketForm.title.trim() || !ticketForm.description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    setTicketSubmitting(true);
    try {
      const r = await fetch(`${BACKEND}/api/customer-portal/${token}/support-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketForm),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      toast.success('Ticket submitted! Our team will get back to you.');
      setTicketForm({ title: '', description: '', priority: 'medium' });
      setTicketsLoaded(false);
      setTimeout(() => fetchTickets(), 300);
    } catch (err) {
      toast.error(err.message || 'Could not submit ticket');
    } finally {
      setTicketSubmitting(false);
    }
  };

  return {
    data, loading, tab, setTab,
    playVideo, setPlayVideo,
    registering, notifRead,
    vidCategory, setVidCategory,
    isLoggedIn, handleLogout, markRead,
    registerSession,
    tickets, ticketForm, setTicketForm,
    ticketSubmitting, handleTicketSubmit,
  };
}
