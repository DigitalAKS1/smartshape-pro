import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Target, MapPin, Package, User, Wifi, WifiOff, Download } from 'lucide-react';
import AdminLayout from './AdminLayout';
import SalesLayout from './SalesLayout';
import { useAuth } from '../../contexts/AuthContext';

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

  // Mobile shell
  const tabs = [
    { path: '/today', icon: Home, label: 'Today' },
    { path: '/leads', icon: Target, label: 'Leads' },
    { path: '/visit-planning', icon: MapPin, label: 'Visits' },
    { path: '/orders', icon: Package, label: 'Orders' },
    { path: '/profile', icon: User, label: 'Profile' },
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
        <div className="flex items-center gap-1">
          {showInstall && (
            <button onClick={promptInstall} className="h-9 px-2 rounded-full bg-[#e94560] text-white text-xs inline-flex items-center gap-1" data-testid="install-pwa-btn">
              <Download className="h-3.5 w-3.5" /> Install
            </button>
          )}
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
