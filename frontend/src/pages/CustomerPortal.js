import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const PRIORITIES = [
  { value: 'low',    label: 'Low',    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { value: 'high',   label: 'High',   color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];
const STATUS_COLORS = {
  open:        'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  resolved:    'bg-green-500/20 text-green-400',
  closed:      'bg-gray-500/20 text-gray-400',
};

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

// ── Status tracker config ─────────────────────────────────────────────────────
const STATUS_STEPS = [
  { key: 'sent',      label: 'Sent' },
  { key: 'opened',    label: 'Opened' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'order',     label: 'Processing' },
  { key: 'delivered', label: 'Delivered' },
];

function stepIndex(quot, orderStatus) {
  if (orderStatus === 'delivered') return 4;
  if (orderStatus && orderStatus !== 'cancelled') return 3;
  if (quot?.catalogue_status === 'submitted') return 2;
  if (quot?.catalogue_status === 'opened') return 1;
  return 0;
}

// ── Die card ──────────────────────────────────────────────────────────────────
function DieCard({ item }) {
  const isRemoved = item.status === 'removed_by_admin';
  const isAdded   = item.status === 'added_by_admin';
  return (
    <div className={`relative rounded-xl overflow-hidden border transition-all ${
      isRemoved ? 'border-red-500/40 opacity-60' :
      isAdded   ? 'border-yellow-400/60 ring-1 ring-yellow-400/30' :
                  'border-[#2d2d44]'
    } bg-[#1a1a2e]`}>
      {isRemoved && <div className="absolute top-0 inset-x-0 bg-red-600/90 text-white text-[9px] font-bold text-center py-0.5 z-10">REMOVED</div>}
      {isAdded   && <div className="absolute top-0 inset-x-0 bg-yellow-500/90 text-black text-[9px] font-bold text-center py-0.5 z-10">REPLACED</div>}
      <div className="aspect-square bg-[#0f0f1a] flex items-center justify-center p-3 mt-4">
        {item.die_image_url
          ? <img src={`${BACKEND}${item.die_image_url}`} alt={item.die_name} className="w-full h-full object-contain" loading="lazy" />
          : <div className="text-[#3d3d55] text-center"><svg className="h-8 w-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><rect x="3" y="3" width="18" height="18" rx="2" /></svg></div>
        }
      </div>
      <div className="p-2">
        <p className="font-mono text-[9px] text-[#e94560]">{item.die_code}</p>
        <p className="text-xs font-medium text-white leading-tight mt-0.5 line-clamp-2">{item.die_name}</p>
        <p className="text-[9px] text-[#6b6b80] mt-0.5 capitalize">{item.die_type}</p>
        {item.admin_note && <p className="text-[9px] text-yellow-400 mt-0.5 italic line-clamp-1">{item.admin_note}</p>}
      </div>
    </div>
  );
}

// ── Video modal ───────────────────────────────────────────────────────────────
function VideoModal({ video, onClose, token }) {
  useEffect(() => {
    if (video) {
      fetch(`${BACKEND}/api/training/videos/${video.video_id}/view`, { method: 'POST' }).catch(() => {});
    }
  }, [video]);

  if (!video) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl overflow-hidden bg-[#1a1a2e]" onClick={e => e.stopPropagation()}>
        <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={video.youtube_url}
            title={video.title}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="p-4">
          <p className="text-white font-semibold">{video.title}</p>
          {video.description && <p className="text-[#a0a0b0] text-sm mt-1">{video.description}</p>}
          <button onClick={onClose} className="mt-3 text-sm text-[#e94560] hover:underline">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CustomerPortal() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [playVideo, setPlayVideo] = useState(null);
  const [registering, setRegistering] = useState({});
  const [notifRead, setNotifRead] = useState(false);
  const [vidCategory, setVidCategory] = useState('all');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // Support ticket state
  const [tickets, setTickets] = useState([]);
  const [ticketForm, setTicketForm] = useState({ title: '', description: '', priority: 'medium' });
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);

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

  // Check if logged in via cookie
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
    try { await fetch(`${BACKEND}/api/customer-portal/${token}/notifications/read`, { method: 'POST' }); } catch { /* ignore */ }
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
    } catch { toast.error('Network error'); } finally {
      setRegistering(p => ({ ...p, [sessionId]: false }));
    }
  };

  const fetchTickets = useCallback(async () => {
    if (ticketsLoaded) return;
    try {
      const r = await fetch(`${BACKEND}/api/customer-portal/${token}/support-tickets`);
      if (r.ok) { const d = await r.json(); setTickets(d); }
    } catch { /* ignore */ } finally { setTicketsLoaded(true); }
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
    } catch (err) { toast.error(err.message || 'Could not submit ticket'); }
    finally { setTicketSubmitting(false); }
  };

  if (loading) return <Spinner />;
  if (!data) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Portal not found</h1>
        <p className="text-[#a0a0b0]">This link may be invalid or expired.</p>
      </div>
    </div>
  );

  const { quotation: q, selection_items, order_status, production_stage,
          sessions, videos, promotions, announcements, notifications, unread_count } = data;

  const currentStep   = stepIndex(q, order_status);
  const activeItems   = selection_items.filter(i => i.status !== 'removed_by_admin');
  const removedItems  = selection_items.filter(i => i.status === 'removed_by_admin');
  const addedItems    = selection_items.filter(i => i.status === 'added_by_admin');
  const hasChanges    = addedItems.length > 0 || removedItems.length > 0;

  const groupBy = (items, key) => items.reduce((acc, item) => {
    const k = item[key] || 'other';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
  const grouped = groupBy(activeItems, 'die_type');

  const today = new Date().toISOString().slice(0, 10);
  const upcomingSessions = sessions.filter(s => s.date >= today && s.status === 'upcoming');
  const nextSession = upcomingSessions[0];
  const activePromos = promotions.filter(p => p.is_active && (!p.valid_until || p.valid_until >= today));
  const publishedAnns = announcements.filter(a => a.is_published);
  const unreadAnns    = publishedAnns.filter(a => !notifications.some(n => n.reference_id === a.announcement_id && n.is_read));

  const vidCategories = ['all', ...new Set(videos.map(v => v.category).filter(Boolean))];
  const filteredVids  = vidCategory === 'all' ? videos : videos.filter(v => v.category === vidCategory);
  const publishedVids = videos.filter(v => v.is_published);
  const filteredPublished = vidCategory === 'all' ? publishedVids : publishedVids.filter(v => v.category === vidCategory);

  const TABS = [
    { id: 'overview',      label: 'Overview' },
    { id: 'order',         label: 'My Order' },
    { id: 'training',      label: 'Training' },
    { id: 'offers',        label: 'Offers' },
    { id: 'whats_new',     label: "What's New" },
    { id: 'support',       label: 'Help & Support' },
  ];

  const platformIcon = (pl) => {
    if (pl === 'physical') return '📍';
    if (pl === 'zoom') return '🎥';
    if (pl === 'meet') return '🎙️';
    return '💻';
  };

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] pt-10 pb-6 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[#e94560] text-xs font-semibold uppercase tracking-widest mb-1">SmartShape Pro</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{q.school_name}</h1>
              <p className="text-[#a0a0b0] text-sm mt-1">{q.principal_name} · {q.quote_number}</p>
            </div>
            {/* Header actions */}
            <div className="flex items-center gap-2 mt-1">
              {isLoggedIn && (
                <button onClick={handleLogout}
                  className="p-2 rounded-full bg-[#1a1a2e] border border-[#2d2d44] hover:border-red-500/50 transition-colors"
                  title="Sign out">
                  <svg className="h-4 w-4 text-[#6b6b80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              )}
            {/* Notification bell */}
            <button
              onClick={() => { setTab('overview'); markRead(); }}
              className="relative p-2 rounded-full bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#e94560]/50 transition-colors">
              <svg className="h-5 w-5 text-[#a0a0b0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unread_count > 0 && !notifRead && (
                <span className="absolute -top-1 -right-1 h-5 w-5 bg-[#e94560] rounded-full text-[10px] font-bold flex items-center justify-center">{unread_count > 9 ? '9+' : unread_count}</span>
              )}
            </button>
            </div>
          </div>

          {/* Order status mini-tracker */}
          <div className="mt-5 flex items-center gap-0">
            {STATUS_STEPS.map((step, idx) => {
              const done   = idx < currentStep;
              const active = idx === currentStep;
              const isLast = idx === STATUS_STEPS.length - 1;
              return (
                <div key={step.key} className="flex-1 flex flex-col items-center">
                  <div className="flex items-center w-full">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                      done   ? 'bg-[#e94560] border-[#e94560]' :
                      active ? 'border-[#e94560] bg-[#e94560]/20' :
                               'border-[#3d3d55] bg-transparent'
                    }`}>
                      {done
                        ? <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        : <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[#e94560]' : 'bg-[#3d3d55]'}`} />
                      }
                    </div>
                    {!isLast && <div className={`flex-1 h-0.5 ${done ? 'bg-[#e94560]' : 'bg-[#2d2d44]'}`} />}
                  </div>
                  <p className={`text-[9px] mt-1 text-center px-0.5 leading-tight ${active ? 'text-[#e94560] font-semibold' : done ? 'text-[#a0a0b0]' : 'text-[#3d3d55]'}`}>{step.label}</p>
                </div>
              );
            })}
          </div>
          {production_stage && order_status !== 'delivered' && (
            <p className="text-center text-[10px] text-[#a0a0b0] mt-2">Stage: <span className="text-white font-medium capitalize">{production_stage.replace(/_/g, ' ')}</span></p>
          )}
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[#0d0d1a] border-b border-[#2d2d44]">
        <div className="max-w-4xl mx-auto flex overflow-x-auto scrollbar-hide">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-[#e94560] text-white' : 'border-transparent text-[#6b6b80] hover:text-[#a0a0b0]'}`}>
              {t.label}
              {t.id === 'whats_new' && publishedAnns.length > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#e94560]/20 text-[#e94560] font-bold">{publishedAnns.length}</span>
              )}
              {t.id === 'offers' && activePromos.length > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold">{activePromos.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 py-6 pb-20 space-y-5">

        {/* ════ OVERVIEW ════ */}
        {tab === 'overview' && (
          <>
            {/* Quick cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Order */}
              <button onClick={() => setTab('order')} className="bg-[#1a1a2e] rounded-xl p-4 border border-[#2d2d44] text-left hover:border-[#e94560]/40 transition-colors">
                <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide mb-1">My Order</p>
                <p className="text-sm font-semibold text-white">{STATUS_STEPS[currentStep]?.label}</p>
                <p className="text-[10px] text-[#e94560] mt-0.5">View details →</p>
              </button>
              {/* Next session */}
              <button onClick={() => setTab('training')} className="bg-[#1a1a2e] rounded-xl p-4 border border-[#2d2d44] text-left hover:border-[#e94560]/40 transition-colors">
                <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide mb-1">Next Training</p>
                {nextSession
                  ? <><p className="text-xs font-semibold text-white line-clamp-1">{nextSession.title}</p><p className="text-[10px] text-[#a0a0b0] mt-0.5">{nextSession.date}</p></>
                  : <p className="text-xs text-[#6b6b80]">No upcoming sessions</p>
                }
              </button>
              {/* Offers */}
              <button onClick={() => setTab('offers')} className="bg-[#1a1a2e] rounded-xl p-4 border border-[#2d2d44] text-left hover:border-[#e94560]/40 transition-colors">
                <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide mb-1">Active Offers</p>
                <p className="text-2xl font-bold text-yellow-400">{activePromos.length}</p>
                <p className="text-[10px] text-yellow-400 mt-0.5">{activePromos.length > 0 ? 'View now →' : 'None currently'}</p>
              </button>
              {/* What's new */}
              <button onClick={() => setTab('whats_new')} className="bg-[#1a1a2e] rounded-xl p-4 border border-[#2d2d44] text-left hover:border-[#e94560]/40 transition-colors">
                <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide mb-1">What's New</p>
                <p className="text-2xl font-bold text-purple-400">{publishedAnns.length}</p>
                <p className="text-[10px] text-purple-400 mt-0.5">{publishedAnns.length > 0 ? 'See updates →' : 'No updates'}</p>
              </button>
            </div>

            {/* Quotation summary */}
            <div className="bg-[#1a1a2e] rounded-xl p-5 border border-[#2d2d44]">
              <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide font-semibold mb-3">Quotation Summary</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Package</p>
                  <p className="text-white font-medium mt-0.5 text-sm">{q.package_name || 'Custom'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Total Payable</p>
                  <p className="text-[#e94560] font-bold text-xl mt-0.5">₹{q.grand_total ? q.grand_total.toLocaleString('en-IN') : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide">Sales Executive</p>
                  <p className="text-white font-medium mt-0.5 text-sm">{q.sales_person_name || '—'}</p>
                  {q.sales_person_email && <a href={`mailto:${q.sales_person_email}`} className="text-[10px] text-[#e94560] hover:underline">{q.sales_person_email}</a>}
                </div>
              </div>
            </div>

            {/* Next session preview */}
            {nextSession && (
              <div className="bg-[#1a1a2e] rounded-xl p-5 border border-[#2d2d44]">
                <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide font-semibold mb-3">Upcoming Training</p>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{platformIcon(nextSession.platform)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold">{nextSession.title}</p>
                    <p className="text-[#a0a0b0] text-sm mt-0.5">{nextSession.date} · {nextSession.time} · {nextSession.platform.toUpperCase()}</p>
                    {nextSession.description && <p className="text-[#6b6b80] text-xs mt-1 line-clamp-2">{nextSession.description}</p>}
                  </div>
                  <button onClick={() => registerSession(nextSession.session_id, nextSession.is_registered)}
                    disabled={registering[nextSession.session_id]}
                    className={`flex-shrink-0 text-sm px-4 py-2 rounded-lg font-medium transition-colors ${nextSession.is_registered ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-[#e94560] text-white hover:bg-[#f05c75]'}`}>
                    {registering[nextSession.session_id] ? '…' : nextSession.is_registered ? '✓ Registered' : 'Register'}
                  </button>
                </div>
              </div>
            )}

            {/* Latest video */}
            {publishedVids[0] && (
              <div className="bg-[#1a1a2e] rounded-xl overflow-hidden border border-[#2d2d44]">
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <p className="text-[10px] text-[#6b6b80] uppercase tracking-wide font-semibold">Latest Video</p>
                  <button onClick={() => setTab('training')} className="text-xs text-[#e94560] hover:underline">View all</button>
                </div>
                <button onClick={() => setPlayVideo(publishedVids[0])} className="w-full text-left px-5 pb-5">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0 w-24 h-14 rounded-lg overflow-hidden bg-[#0f0f1a]">
                      {publishedVids[0].thumbnail_url
                        ? <img src={publishedVids[0].thumbnail_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#6b6b80]">▶</div>
                      }
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"><span className="text-white text-sm">▶</span></div>
                      </div>
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm line-clamp-1">{publishedVids[0].title}</p>
                      <p className="text-[#6b6b80] text-xs mt-0.5 capitalize">{publishedVids[0].category?.replace(/_/g, ' ')}{publishedVids[0].duration_mins ? ` · ${publishedVids[0].duration_mins} min` : ''}</p>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Latest announcement */}
            {publishedAnns[0] && (
              <button onClick={() => setTab('whats_new')} className="w-full text-left bg-purple-500/10 border border-purple-500/20 rounded-xl p-5 hover:border-purple-500/40 transition-colors">
                <p className="text-[10px] text-purple-400 uppercase tracking-wide font-semibold mb-2">Latest Update</p>
                <p className="text-white font-semibold">{publishedAnns[0].title}</p>
                {publishedAnns[0].body && <p className="text-[#a0a0b0] text-sm mt-1 line-clamp-2">{publishedAnns[0].body}</p>}
              </button>
            )}
          </>
        )}

        {/* ════ MY ORDER ════ */}
        {tab === 'order' && (
          <>
            {hasChanges && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-400 font-semibold text-sm mb-1">Your selection was updated by our team</p>
                <p className="text-[#a0a0b0] text-xs">
                  {removedItems.length > 0 && `${removedItems.length} item${removedItems.length > 1 ? 's' : ''} removed. `}
                  {addedItems.length > 0 && `${addedItems.length} replacement${addedItems.length > 1 ? 's' : ''} added. `}
                  Contact your sales executive for queries.
                </p>
              </div>
            )}

            {selection_items.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Your Selection ({activeItems.length} items)</p>
                {Object.entries(grouped).map(([type, items]) => (
                  <div key={type} className="mb-5">
                    <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-2 capitalize">{type.replace(/_/g, ' ')} Dies ({items.length})</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {items.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
                    </div>
                  </div>
                ))}
                {removedItems.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-red-400 uppercase mb-2">Removed ({removedItems.length})</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {removedItems.map((item, i) => <DieCard key={item.die_id || i} item={item} />)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-[#6b6b80]">No selection submitted yet.</p>
                <p className="text-[#a0a0b0] text-sm mt-1">Your catalogue link will be shared by your sales executive.</p>
              </div>
            )}
          </>
        )}

        {/* ════ TRAINING ════ */}
        {tab === 'training' && (
          <>
            {/* Upcoming sessions */}
            <div>
              <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Upcoming Sessions</p>
              {upcomingSessions.length === 0
                ? <div className="bg-[#1a1a2e] rounded-xl p-6 border border-[#2d2d44] text-center"><p className="text-[#6b6b80]">No upcoming sessions scheduled</p></div>
                : <div className="space-y-3">
                    {upcomingSessions.map(s => (
                      <div key={s.session_id} className="bg-[#1a1a2e] rounded-xl p-4 border border-[#2d2d44]">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl flex-shrink-0">{platformIcon(s.platform)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold">{s.title}</p>
                            <p className="text-[#a0a0b0] text-sm mt-0.5">{s.date} · {s.time} · {s.platform.toUpperCase()}</p>
                            {s.description && <p className="text-[#6b6b80] text-xs mt-1">{s.description}</p>}
                            <div className="flex items-center gap-3 mt-2 text-xs text-[#6b6b80]">
                              {s.max_participants > 0 && <span>{s.registration_count}/{s.max_participants} registered</span>}
                              {s.meeting_link && s.is_registered && <a href={s.meeting_link} target="_blank" rel="noreferrer" className="text-[#e94560] hover:underline">Join Link ↗</a>}
                            </div>
                          </div>
                          <button onClick={() => registerSession(s.session_id, s.is_registered)}
                            disabled={registering[s.session_id] || (!s.is_registered && s.max_participants > 0 && s.registration_count >= s.max_participants)}
                            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${s.is_registered ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-[#e94560] text-white hover:bg-[#f05c75] disabled:opacity-50'}`}>
                            {registering[s.session_id] ? '…' : s.is_registered ? '✓ Registered' : 'Register'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>

            {/* Video library */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-[#a0a0b0] uppercase">Video Library ({publishedVids.length})</p>
              </div>
              {/* Category filter */}
              {vidCategories.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                  {vidCategories.map(c => (
                    <button key={c} onClick={() => setVidCategory(c)}
                      className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${vidCategory === c ? 'bg-[#e94560] text-white' : 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44] hover:border-[#e94560]/40'}`}>
                      {c === 'all' ? 'All' : c.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              )}
              {filteredPublished.length === 0
                ? <div className="bg-[#1a1a2e] rounded-xl p-6 border border-[#2d2d44] text-center"><p className="text-[#6b6b80]">No videos available yet</p></div>
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredPublished.map(v => (
                      <button key={v.video_id} onClick={() => setPlayVideo(v)} className="text-left bg-[#1a1a2e] rounded-xl overflow-hidden border border-[#2d2d44] hover:border-[#e94560]/40 transition-colors group">
                        <div className="relative aspect-video bg-[#0f0f1a]">
                          {v.thumbnail_url
                            ? <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-3xl">🎬</div>
                          }
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                              <span className="text-white text-lg ml-0.5">▶</span>
                            </div>
                          </div>
                          {v.duration_mins > 0 && <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">{v.duration_mins} min</span>}
                        </div>
                        <div className="p-3">
                          <p className="text-white font-medium text-sm line-clamp-1">{v.title}</p>
                          <p className="text-[#6b6b80] text-xs mt-0.5 capitalize">{v.category?.replace(/_/g, ' ')}</p>
                          {v.description && <p className="text-[#a0a0b0] text-xs mt-1 line-clamp-2">{v.description}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
              }
            </div>
          </>
        )}

        {/* ════ OFFERS ════ */}
        {tab === 'offers' && (
          <>
            <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Active Offers & Promotions</p>
            {activePromos.length === 0
              ? <div className="bg-[#1a1a2e] rounded-xl p-10 border border-[#2d2d44] text-center"><p className="text-[#6b6b80]">No active offers at the moment</p><p className="text-[#3d3d55] text-sm mt-1">Check back soon!</p></div>
              : <div className="space-y-4">
                  {activePromos.map(p => (
                    <div key={p.promo_id} className="bg-gradient-to-br from-[#1a1a2e] to-[#0f0f1a] rounded-xl overflow-hidden border border-yellow-500/20">
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold uppercase">{p.promo_type}</span>
                            <h3 className="text-white font-bold text-lg mt-2 leading-tight">{p.title}</h3>
                            {p.description && <p className="text-[#a0a0b0] text-sm mt-1">{p.description}</p>}
                            {p.details && <p className="text-[#6b6b80] text-xs mt-2 whitespace-pre-line">{p.details}</p>}
                          </div>
                          {p.image_url && <img src={p.image_url} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />}
                        </div>
                        {(p.valid_from || p.valid_until) && (
                          <div className="mt-3 flex items-center gap-2 text-xs text-[#6b6b80]">
                            <span className="text-yellow-400">⏱</span>
                            <span>Valid: {p.valid_from || '—'} → {p.valid_until || '—'}</span>
                          </div>
                        )}
                        {p.cta_text && p.cta_url && (
                          <a href={p.cta_url} target="_blank" rel="noreferrer"
                            className="inline-block mt-4 px-5 py-2 rounded-lg bg-yellow-500 text-black font-bold text-sm hover:bg-yellow-400 transition-colors">
                            {p.cta_text}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </>
        )}

        {/* ════ WHAT'S NEW ════ */}
        {tab === 'whats_new' && (
          <>
            <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Updates & Announcements</p>
            {publishedAnns.length === 0
              ? <div className="bg-[#1a1a2e] rounded-xl p-10 border border-[#2d2d44] text-center"><p className="text-[#6b6b80]">No announcements yet</p></div>
              : <div className="space-y-4">
                  {publishedAnns.map(a => {
                    const typeColor = a.type === 'new_die' ? 'text-green-400 bg-green-500/20' : a.type === 'new_feature' ? 'text-blue-400 bg-blue-500/20' : 'text-purple-400 bg-purple-500/20';
                    const typeLabel = a.type === 'new_die' ? '🆕 New Product' : a.type === 'new_feature' ? '✨ New Feature' : '📢 News';
                    return (
                      <div key={a.announcement_id} className="bg-[#1a1a2e] rounded-xl overflow-hidden border border-[#2d2d44]">
                        {a.image_url && <img src={a.image_url} alt="" className="w-full h-40 object-cover" />}
                        <div className="p-5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${typeColor}`}>{typeLabel}</span>
                          <h3 className="text-white font-bold text-base mt-2">{a.title}</h3>
                          {a.body && <p className="text-[#a0a0b0] text-sm mt-2 whitespace-pre-line leading-relaxed">{a.body}</p>}
                          <p className="text-[#3d3d55] text-[10px] mt-3">{a.published_at?.slice(0, 10)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </>
        )}

      </div>

        {/* ════ HELP & SUPPORT ════ */}
        {tab === 'support' && (
          <div className="space-y-6">
            {/* Raise a ticket */}
            <div className="bg-[#1a1a2e] rounded-2xl border border-[#2d2d44] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#2d2d44] flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#e94560]/20 flex items-center justify-center">
                  <svg className="h-4 w-4 text-[#e94560]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Raise a Support Ticket</p>
                  <p className="text-[#6b6b80] text-xs">Our team typically responds within 24 hours</p>
                </div>
              </div>
              <form onSubmit={handleTicketSubmit} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Issue Title *</label>
                  <input value={ticketForm.title} onChange={e => setTicketForm(p => ({...p, title: e.target.value}))}
                    placeholder="Brief description of your issue"
                    className="w-full bg-[#0f0f1a] border border-[#2d2d44] rounded-xl px-4 py-2.5 text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560]/60" />
                </div>
                <div>
                  <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Description *</label>
                  <textarea value={ticketForm.description} onChange={e => setTicketForm(p => ({...p, description: e.target.value}))}
                    placeholder="Describe the issue in detail — what happened, when, any error messages..."
                    rows={4}
                    className="w-full bg-[#0f0f1a] border border-[#2d2d44] rounded-xl px-4 py-2.5 text-white text-sm placeholder-[#3d3d55] focus:outline-none focus:border-[#e94560]/60 resize-none" />
                </div>
                <div>
                  <label className="block text-xs text-[#a0a0b0] uppercase tracking-wide mb-1.5">Priority</label>
                  <div className="flex gap-2">
                    {PRIORITIES.map(p => (
                      <button key={p.value} type="button" onClick={() => setTicketForm(f => ({...f, priority: p.value}))}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${ticketForm.priority === p.value ? p.color : 'bg-[#0f0f1a] border-[#2d2d44] text-[#6b6b80]'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="submit" disabled={ticketSubmitting}
                  className="w-full py-3 rounded-xl bg-[#e94560] hover:bg-[#f05c75] disabled:opacity-60 text-white font-semibold text-sm transition-colors">
                  {ticketSubmitting ? 'Submitting…' : 'Submit Ticket'}
                </button>
              </form>
            </div>

            {/* Ticket history */}
            <div>
              <p className="text-xs font-semibold text-[#a0a0b0] uppercase mb-3">Your Tickets</p>
              {tickets.length === 0
                ? <div className="bg-[#1a1a2e] rounded-xl p-8 border border-[#2d2d44] text-center">
                    <p className="text-[#6b6b80] text-sm">No tickets yet</p>
                    <p className="text-[#3d3d55] text-xs mt-1">Use the form above to raise your first ticket</p>
                  </div>
                : <div className="space-y-3">
                    {tickets.map(t => {
                      const pri = PRIORITIES.find(p => p.value === t.priority) || PRIORITIES[1];
                      return (
                        <div key={t.ticket_id} className="bg-[#1a1a2e] rounded-xl border border-[#2d2d44] p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-mono text-[#e94560]">{t.ticket_number}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${pri.color}`}>{t.priority}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[t.status] || 'bg-gray-500/20 text-gray-400'}`}>{t.status.replace('_',' ')}</span>
                              </div>
                              <p className="text-white text-sm font-medium mt-1">{t.title}</p>
                              <p className="text-[#6b6b80] text-xs mt-1 line-clamp-2">{t.description}</p>
                            </div>
                          </div>
                          <p className="text-[#3d3d55] text-[10px] mt-2">{t.created_at?.slice(0,10)}</p>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>

            {/* Direct contact */}
            <div className="bg-[#1a1a2e] rounded-2xl border border-[#2d2d44] p-5">
              <p className="text-white font-semibold text-sm mb-3">Contact Your Sales Executive</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
                  <svg className="h-5 w-5 text-[#e94560]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{q.sales_person_name || 'Your Representative'}</p>
                  {q.sales_person_email && (
                    <a href={`mailto:${q.sales_person_email}`} className="text-[#e94560] hover:text-[#f05c75] text-xs">{q.sales_person_email}</a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="text-center text-[#3d3d55] text-xs py-6 border-t border-[#1a1a2e]">
        SmartShape Pro · {q.sales_person_email ? <a href={`mailto:${q.sales_person_email}`} className="text-[#6b6b80] hover:text-[#e94560]">{q.sales_person_email}</a> : 'contact your sales executive'}
      </div>

      {/* Video modal */}
      {playVideo && <VideoModal video={playVideo} onClose={() => setPlayVideo(null)} token={token} />}
    </div>
  );
}
