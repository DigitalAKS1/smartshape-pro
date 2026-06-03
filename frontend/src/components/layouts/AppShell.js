import React, { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import SalesLayout from './SalesLayout';
import AppShellHeader from './AppShellHeader';
import AppShellNav from './AppShellNav';
import AppShellNotifDrawer from './AppShellNotifDrawer';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi, pushApi } from '../../lib/api';

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = window.atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = typeof window !== 'undefined' && !!window.navigator.standalone;

/**
 * AppShell — adaptive layout.
 * - Desktop (md+): delegates to AdminLayout or SalesLayout.
 * - Mobile: custom top-header + bottom-nav + notification drawer.
 */
export default function AppShell({ children }) {
  const { user } = useAuth();
  const nav = useNavigate();

  const [isMobile, setIsMobile] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showInstall, setShowInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

  const prevUnreadRef = useRef(null);

  const playNotifAlert = useCallback(() => {
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

  const fetchUnread = useCallback(async () => {
    try {
      const r = await notificationsApi.getAll();
      const all = r.data || [];
      const newUnread = all.filter(n => !n.is_read).length;
      if (prevUnreadRef.current !== null && newUnread > prevUnreadRef.current) {
        playNotifAlert();
        const diff = newUnread - prevUnreadRef.current;
        toast.message(`${diff} new notification${diff > 1 ? 's' : ''}`, {
          description: all.find(n => !n.is_read)?.title || '',
          icon: '🔔', duration: 4000,
        });
      }
      prevUnreadRef.current = newUnread;
      setNotifs(all);
      setUnreadCount(newUnread);
    } catch {}
  }, [playNotifAlert]);

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

  useEffect(() => {
    if (isIOS && !isStandalone && !localStorage.getItem('ios-install-dismissed')) {
      const t = setTimeout(() => setShowIosInstall(true), 2000);
      return () => clearTimeout(t);
    }
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstall(false);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/get-app`;
    if (navigator.share) {
      navigator.share({ title: 'Divine Computer Pvt Ltd', url }).catch(() => {});
    } else {
      try { await navigator.clipboard.writeText(url); }
      catch {
        const el = document.createElement('textarea');
        el.value = url; el.style.position = 'fixed'; el.style.opacity = '0';
        document.body.appendChild(el); el.select();
        document.execCommand('copy'); document.body.removeChild(el);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  // Desktop → existing layout
  if (!isMobile) {
    const Layout = user?.role === 'sales' ? SalesLayout : AdminLayout;
    return <Layout>{children}</Layout>;
  }

  const isSalesUser = user?.role === 'sales';

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppShellHeader
        user={user}
        online={online}
        unreadCount={unreadCount}
        pushSupported={pushSupported}
        pushSubscribed={pushSubscribed}
        pushEnabling={pushEnabling}
        showInstall={showInstall}
        showIosInstall={showIosInstall}
        shareCopied={shareCopied}
        onBellClick={() => setNotifOpen(true)}
        onEnablePush={enablePush}
        onShare={handleShare}
        onInstall={promptInstall}
        onDismissIos={() => { localStorage.setItem('ios-install-dismissed', '1'); setShowIosInstall(false); }}
      />

      <main className="pb-20">{children}</main>

      <AppShellNotifDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifs={notifs}
        setNotifs={setNotifs}
        unreadCount={unreadCount}
        setUnreadCount={setUnreadCount}
        pushSupported={pushSupported}
        pushSubscribed={pushSubscribed}
        setPushSubscribed={setPushSubscribed}
        pushEnabling={pushEnabling}
        onEnablePush={enablePush}
        onNavigate={nav}
      />

      <AppShellNav isSalesUser={isSalesUser} />
    </div>
  );
}
