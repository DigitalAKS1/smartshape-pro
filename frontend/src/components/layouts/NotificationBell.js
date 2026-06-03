import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bell, BellOff, X, CheckCheck, FileText, AlertTriangle,
  Clock, Gift, Zap, ClipboardList,
} from 'lucide-react';
import { notificationsApi, pushApi } from '../../lib/api';

// ── VAPID base64 → Uint8Array ─────────────────────────────────────────────────
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = window.atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

const NOTIF_META = {
  overdue_task:       { Icon: AlertTriangle, color: '#f97316', bg: 'rgba(249,115,22,0.12)',  url: '/today' },
  stale_lead:         { Icon: Clock,         color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  url: '/leads' },
  pending_quotation:  { Icon: FileText,      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  url: '/quotations' },
  birthday_today:     { Icon: Gift,          color: '#ec4899', bg: 'rgba(236,72,153,0.12)',  url: '/leads' },
  anniversary_today:  { Icon: Zap,           color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  url: '/leads' },
  delegation_overdue: { Icon: ClipboardList, color: '#e94560', bg: 'rgba(233,69,96,0.12)',   url: '/delegation' },
};
const NOTIF_DEFAULT = { Icon: Bell, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' };

const relTime = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function NotificationBell() {
  const nav = useNavigate();
  const [notifs, setNotifs]           = useState([]);
  const [open, setOpen]               = useState(false);
  const [subscribed, setSubscribed]   = useState(false);
  const [permDenied, setPermDenied]   = useState(false);
  const [enabling, setEnabling]       = useState(false);
  const panelRef  = useRef(null);
  const prevUnread = useRef(null);

  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const unread = notifs.filter(n => !n.is_read).length;

  const playAlert = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
      ctx.close().catch(() => {});
    } catch {}
  }, []);

  const fetchNotifs = useCallback(async () => {
    try {
      const r = await notificationsApi.getAll();
      const all = r.data || [];
      const newUnread = all.filter(n => !n.is_read).length;
      if (prevUnread.current !== null && newUnread > prevUnread.current) {
        playAlert();
        const diff = newUnread - prevUnread.current;
        toast.message(`${diff} new notification${diff > 1 ? 's' : ''}`, {
          description: all.find(n => !n.is_read)?.title || '',
          icon: '🔔', duration: 4000,
        });
      }
      prevUnread.current = newUnread;
      setNotifs(all);
    } catch {}
  }, [playAlert]);

  useEffect(() => {
    fetchNotifs();
    const t = setInterval(fetchNotifs, 30000);
    return () => clearInterval(t);
  }, [fetchNotifs]);

  useEffect(() => {
    if (!pushSupported) return;
    setPermDenied(Notification.permission === 'denied');
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(s => setSubscribed(!!s))
    );
  }, [pushSupported]);

  useEffect(() => {
    const handler = e => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    try { await notificationsApi.markAllRead(); setNotifs(n => n.map(x => ({ ...x, is_read: true }))); } catch {}
  };

  const enablePush = async () => {
    setEnabling(true);
    try {
      const perm = await Notification.requestPermission();
      setPermDenied(perm === 'denied');
      if (perm !== 'granted') return;
      const { data } = await pushApi.getPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(data.public_key) });
      await pushApi.subscribe(sub.toJSON());
      setSubscribed(true);
    } catch (e) { console.error('[push]', e); }
    finally { setEnabling(false); }
  };

  const disablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await pushApi.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
      setSubscribed(false);
    } catch {}
  };

  const testPush = async () => { try { await pushApi.test(); } catch {} };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        title="Notifications"
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-[#e94560] text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2.5 w-[380px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.25)] z-[60] overflow-hidden flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#e94560]/10 flex items-center justify-center">
                <Bell className="h-3.5 w-3.5 text-[#e94560]" />
              </div>
              <span className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Notifications</span>
              {unread > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e94560] text-white font-bold leading-none">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[#e94560] font-medium transition-colors">
                  <CheckCheck className="h-3 w-3" /> Mark read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="w-6 h-6 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Push alerts strip */}
          {pushSupported && (
            <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-color)] ${subscribed ? 'bg-emerald-500/5' : 'bg-[var(--bg-hover)]'}`}>
              <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${subscribed ? 'bg-emerald-500/15' : 'bg-[var(--border-color)]'}`}>
                {subscribed ? <Bell className="h-3 w-3 text-emerald-400" /> : <BellOff className="h-3 w-3 text-[var(--text-muted)]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[var(--text-primary)] leading-tight">
                  {permDenied ? 'Push blocked' : subscribed ? 'Push alerts active' : 'Enable push alerts'}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] leading-tight">
                  {permDenied ? 'Allow in browser settings' : subscribed ? 'Alerts arrive even when closed' : 'Get WhatsApp-style alerts when closed'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {subscribed && (
                  <button onClick={testPush} className="text-[10px] px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                    Test
                  </button>
                )}
                {!permDenied && (
                  <button
                    disabled={enabling}
                    onClick={subscribed ? disablePush : enablePush}
                    className={`text-[10px] px-3 py-1 rounded-full font-semibold transition-all disabled:opacity-40 ${
                      subscribed ? 'text-red-400 hover:bg-red-500/10' : 'bg-[#e94560] text-white hover:bg-[#f05c75]'
                    }`}
                  >
                    {enabling ? '…' : subscribed ? 'Turn off' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Notification list */}
          <div className="overflow-y-auto" style={{ maxHeight: '380px' }}>
            {notifs.length === 0 ? (
              <div className="py-14 flex flex-col items-center text-center px-6">
                <div className="w-14 h-14 rounded-full bg-[var(--bg-hover)] flex items-center justify-center mb-4">
                  <Bell className="h-6 w-6 text-[var(--text-muted)] opacity-40" />
                </div>
                <p className="text-sm font-bold text-[var(--text-primary)]">All caught up!</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">New alerts will show up here as they arrive</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {notifs.slice(0, 25).map((n, i) => {
                  const meta = NOTIF_META[n.type] || NOTIF_DEFAULT;
                  const { Icon, url } = meta;
                  const linkedId = n.task_id || n.lead_id || n.quotation_id;

                  const handleClick = async () => {
                    if (!n.is_read) {
                      setNotifs(prev => prev.map((x, j) => j === i ? { ...x, is_read: true } : x));
                      try { if (linkedId) await notificationsApi.markOneRead(linkedId); } catch {}
                    }
                    if (url) { setOpen(false); nav(url); }
                  };

                  return (
                    <div
                      key={n._id || i}
                      onClick={handleClick}
                      className={`relative flex items-start gap-3 px-4 py-3.5 transition-colors cursor-pointer hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] ${!n.is_read ? 'bg-[#e94560]/[0.04]' : ''}`}
                    >
                      {!n.is_read && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#e94560] rounded-r-full" />}
                      <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5" style={{ background: meta.bg }}>
                        <Icon className="h-4 w-4" style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <p className={`text-[12px] leading-snug ${!n.is_read ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                            {n.title}
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                            <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{relTime(n.created_at)}</span>
                            {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-[#e94560]" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] leading-snug line-clamp-2">{n.message}</p>
                        {url && <p className="text-[10px] font-semibold mt-0.5" style={{ color: meta.color }}>Click to view →</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifs.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[var(--border-color)] flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-muted)]">{notifs.length} total · {unread} unread</span>
              <button onClick={() => setOpen(false)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
