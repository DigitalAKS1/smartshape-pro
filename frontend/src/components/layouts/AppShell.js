import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Target, MapPin, Package, FileText, CalendarDays, Megaphone, Wifi, WifiOff, Download, Bell } from 'lucide-react';
import AdminLayout from './AdminLayout';
import SalesLayout from './SalesLayout';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi, pushApi } from '../../lib/api';

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = window.atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Adaptive shell — uses mobile-first layout (top header + bottom nav) on small screens,
 * falls back to the existing Admin/Sales sidebar layout on md+ screens.
 */
export default function AppShell({ children }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showInstall, setShowInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);

  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

  const fetchUnread = useCallback(async () => {
    try { const r = await notificationsApi.getAll(); setUnreadCount((r.data || []).filter(n => !n.is_read).length); } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, 30000);
    return () => clearInterval(t);
  }, [fetchUnread]);

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(s => setPushSubscribed(!!s))
    );
  }, [pushSupported]);

  const enablePush = async () => {
    if (!pushSupported || pushEnabling) return;
    setPushEnabling(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const { data } = await pushApi.getPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(data.public_key) });
      await pushApi.subscribe(sub.toJSON());
      setPushSubscribed(true);
    } catch (e) { console.error('[push]', e); }
    finally { setPushEnabling(false); }
  };

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const goOn = () => setOnline(true);
    const goOff = () => setOnline(false);
    window.addEventListener('online', goOn);
    window.addEventListener('offline', goOff);
    return () => { window.removeEventListener('online', goOn); window.removeEventListener('offline', goOff); };
  }, []);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstall(false);
  };

  // Desktop → existing layout
  if (!isMobile) {
    const Layout = user?.role === 'sales' ? SalesLayout : AdminLayout;
    return <Layout>{children}</Layout>;
  }

  // Mobile shell — role-aware tabs
  const isSalesUser = user?.role === 'sales';
  const tabs = isSalesUser ? [
    { path: '/today',               icon: Home,         label: 'Today'  },
    { path: '/sales/leads',         icon: Target,       label: 'Leads'  },
    { path: '/sales/visits',        icon: MapPin,       label: 'Visits' },
    { path: '/sales/quotations',    icon: FileText,     label: 'Quotes' },
    { path: '/leave-management',    icon: CalendarDays, label: 'Leave'  },
  ] : [
    { path: '/today',           icon: Home,    label: 'Today'   },
    { path: '/leads',           icon: Target,  label: 'CRM'     },
    { path: '/visit-planning',  icon: MapPin,  label: 'Visits'  },
    { path: '/orders',          icon: Package, label: 'Orders'  },
    { path: '/marketing',       icon: Megaphone, label: 'Mktg'  },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Top header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-3 py-2 flex items-center justify-between" data-testid="mobile-header">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#e94560] to-[#f05c75] flex items-center justify-center font-bold text-white text-xs">SS</div>
          <div>
            <p className="text-sm font-semibold truncate leading-tight">SmartShape Pro</p>
            <p className="text-[10px] text-[var(--text-muted)] leading-tight">{user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Push enable — shown only if not yet subscribed */}
          {pushSupported && !pushSubscribed && Notification.permission !== 'denied' && (
            <button
              onClick={enablePush}
              disabled={pushEnabling}
              className="h-8 px-2.5 rounded-full bg-[#e94560] text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
              title="Enable push notifications"
            >
              <Bell className="h-3 w-3" /> {pushEnabling ? '…' : 'Alerts'}
            </button>
          )}
          {/* Install button */}
          {showInstall && (
            <button onClick={promptInstall} className="h-8 px-2.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] text-[11px] font-semibold inline-flex items-center gap-1" data-testid="install-pwa-btn">
              <Download className="h-3 w-3" /> Install
            </button>
          )}
          {/* Notification bell with unread badge */}
          <div className="relative">
            <Bell className="h-5 w-5 text-[var(--text-muted)]" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-[#e94560] text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          {online ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-red-400" />}
        </div>
      </header>

      {/* Offline banner */}
      {!online && (
        <div className="bg-red-500/15 border-b border-red-500/30 text-red-400 text-xs py-1.5 px-3 text-center" data-testid="offline-banner">
          You are offline — actions will sync when you reconnect.
        </div>
      )}

      {/* Main content */}
      <main className="pb-20">{children}</main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-color)] safe-area-bottom" data-testid="mobile-bottom-nav">
        <div className="grid grid-cols-5">
          {tabs.map(t => {
            const active = loc.pathname.startsWith(t.path);
            return (
              <button key={t.path} onClick={() => nav(t.path)} className={`flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px] transition-colors ${active ? 'text-[#e94560]' : 'text-[var(--text-muted)]'}`} data-testid={`nav-${t.label.toLowerCase()}`}>
                <t.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{t.label}</span>
                {active && <span className="absolute bottom-0 h-0.5 w-12 bg-[#e94560] rounded-t" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
