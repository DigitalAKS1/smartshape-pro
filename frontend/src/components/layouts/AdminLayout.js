import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  LayoutDashboard, FileText, Package, AlertTriangle, Settings, BarChart3,
  Warehouse, ClipboardList, DollarSign, Users, LogOut, Menu, X,
  Smartphone, Layers, IndianRupee, UserCog, Store, MapPin, Target,
  Sun, Moon, CalendarDays, Calendar, ShoppingCart, Upload, Activity,
  Home, MoreHorizontal, Megaphone, Zap, Heart, Bell, BellOff,
} from 'lucide-react';
import HelpButton from '../HelpButton';
import GuidedTour from '../GuidedTour';
import KeyboardShortcuts from '../KeyboardShortcuts';
import { notificationsApi, pushApi } from '../../lib/api';

// ── VAPID base64 → Uint8Array ─────────────────────────────────────────────────
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = window.atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

const NOTIF_META = {
  overdue_task:      { icon: '⚠️', url: '/today' },
  stale_lead:        { icon: '💤', url: '/leads' },
  pending_quotation: { icon: '📋', url: '/quotations' },
  birthday_today:    { icon: '🎂', url: '/leads' },
  anniversary_today: { icon: '🎉', url: '/leads' },
};

// ── Self-contained notification bell + push panel ────────────────────────────
function NotificationBell() {
  const [notifs, setNotifs]           = useState([]);
  const [open, setOpen]               = useState(false);
  const [subscribed, setSubscribed]   = useState(false);
  const [permDenied, setPermDenied]   = useState(false);
  const [enabling, setEnabling]       = useState(false);
  const panelRef = useRef(null);

  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const unread = notifs.filter(n => !n.is_read).length;

  const fetchNotifs = useCallback(async () => {
    try { const r = await notificationsApi.getAll(); setNotifs(r.data || []); } catch {}
  }, []);

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
        <div className="absolute right-0 top-full mt-2 w-[320px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[60] overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
            <span className="text-sm font-semibold text-[var(--text-primary)]">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-[var(--accent)] hover:underline">Mark all read</button>
              )}
              <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Push toggle row */}
          {pushSupported && (
            <div className={`px-4 py-2.5 flex items-center justify-between gap-3 border-b border-[var(--border-color)] ${subscribed ? 'bg-green-500/5' : 'bg-[var(--bg-hover)]'}`}>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  {subscribed ? <Bell className="h-3 w-3 text-green-500" /> : <BellOff className="h-3 w-3 text-[var(--text-muted)]" />}
                  {subscribed ? 'Push alerts enabled' : 'Enable push alerts'}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-tight">
                  {permDenied ? 'Blocked — allow in browser settings' : subscribed ? 'You get alerts when app is closed' : 'Like WhatsApp — alerts even when closed'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {subscribed && (
                  <button onClick={testPush}
                    className="text-[10px] px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                    Test
                  </button>
                )}
                <button
                  disabled={enabling || permDenied}
                  onClick={subscribed ? disablePush : enablePush}
                  className={`text-[10px] px-2.5 py-1.5 rounded-md font-semibold transition-colors disabled:opacity-40 ${
                    subscribed ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-[#e94560] text-white hover:bg-[#f05c75]'
                  }`}>
                  {enabling ? '…' : subscribed ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          )}

          {/* Notification list */}
          <div className="max-h-[320px] overflow-y-auto divide-y divide-[var(--border-color)]">
            {notifs.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="h-6 w-6 mx-auto mb-2 text-[var(--text-muted)] opacity-40" />
                <p className="text-xs text-[var(--text-muted)]">No notifications yet</p>
              </div>
            ) : notifs.slice(0, 20).map((n, i) => {
              const meta = NOTIF_META[n.type] || { icon: '🔔', url: '/today' };
              return (
                <div key={i} className={`px-4 py-3 ${!n.is_read ? 'bg-[var(--accent-bg)]' : ''}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm flex-shrink-0 mt-0.5">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{n.title}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 opacity-70">{n.created_at?.slice(0, 16).replace('T', ' ')}</p>
                    </div>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#e94560] flex-shrink-0 mt-1.5" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const MODULE_ROUTE_MAP = {
  dashboard: [
    { path: '/today', icon: Target, label: "Today's Actions" },
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  ],
  quotations: [
    { path: '/create-quotation', icon: FileText, label: 'Create Quotation' },
    { path: '/quotations', icon: FileText, label: 'Quotations' },
    { path: '/orders', icon: ShoppingCart, label: 'Orders & Holds' },
  ],
  inventory: { path: '/inventory', icon: Package, label: 'Inventory' },
  purchase_alerts: { path: '/purchase-alerts', icon: AlertTriangle, label: 'Purchase Alerts' },
  package_master: { path: '/package-master', icon: Settings, label: 'Package Master' },
  stock_management: { path: '/stock-management', icon: Warehouse, label: 'Stock Management' },
  physical_count: { path: '/physical-count', icon: ClipboardList, label: 'Physical Count' },
  analytics: [
    { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    { path: '/admin-control', icon: Target, label: 'Admin Control' },
    { path: '/conversion', icon: Target, label: 'Conversion Tracking' },
  ],
  payroll: { path: '/payroll', icon: DollarSign, label: 'Payroll' },
  accounts: { path: '/accounts', icon: IndianRupee, label: 'Accounts' },
  hr: { path: '/hr', icon: UserCog, label: 'HR' },
  store: { path: '/store', icon: Store, label: 'Store' },
  field_sales: [
    { path: '/field-sales', icon: MapPin, label: 'Field Sales' },
    { path: '/visit-planning', icon: Calendar, label: 'Visit Planning' },
    { path: '/visit-calendar', icon: CalendarDays, label: 'Visit Calendar' },
  ],
  leads: [
    { path: '/leads', icon: Target, label: 'Leads & CRM' },
    { path: '/crm-masters', icon: Layers, label: 'CRM Masters' },
    { path: '/dispatch-tracking', icon: Package, label: 'Dispatch Tracking' },
    { path: '/customer-engagement', icon: Heart, label: 'Customer Engagement' },
    { path: '/marketing', icon: Zap, label: 'Marketing & WhatsApp' },
  ],
  sales_portal: { path: '/sales', icon: Smartphone, label: 'Sales Portal' },
  user_management: [
    { path: '/user-management', icon: Users, label: 'User Management' },
    { path: '/module-master', icon: Layers, label: 'Module Master' },
  ],
  settings: [
    { path: '/app-settings', icon: Settings, label: 'App Settings' },
    { path: '/import-center', icon: Upload, label: 'Import Center' },
    { path: '/activity-logs', icon: Activity, label: 'Activity Logs' },
  ],
};

const SIDEBAR_SECTIONS = [
  { label: null,               modules: ['dashboard'] },
  { label: 'Sales',            modules: ['quotations', 'leads', 'field_sales', 'sales_portal'] },
  { label: 'Store & Inventory',modules: ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'package_master', 'store'] },
  { label: 'Finance & HR',     modules: ['accounts', 'payroll', 'hr'] },
  { label: 'Reports',          modules: ['analytics'] },
  { label: 'Administration',   modules: ['user_management', 'settings'] },
];

const TEAM_MODULES = {
  accounts: ['dashboard', 'quotations', 'accounts', 'payroll', 'analytics'],
  store:    ['dashboard', 'quotations', 'inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master'],
};

function getPageTitle(pathname) {
  const allRoutes = Object.values(MODULE_ROUTE_MAP).flat();
  const exact = allRoutes.find(r => r?.path === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith('/school-profile/')) return 'School Profile';
  if (pathname === '/marketing') return 'Marketing & WhatsApp';
  if (pathname.startsWith('/view-quotation/'))  return 'View Quotation';
  if (pathname.startsWith('/edit-quotation/'))  return 'Edit Quotation';
  if (pathname.startsWith('/catalogue/'))       return 'Catalogue';
  return 'SmartShape Pro';
}

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const team = user?.role === 'admin' ? 'admin'
    : user?.role === 'accounts' ? 'accounts'
    : user?.role === 'store'    ? 'store'
    : 'sales';
  const isAdmin = team === 'admin';

  const assignedModules = user?.assigned_modules || [];
  const teamDefaults    = TEAM_MODULES[team] || [];
  const userModules     = [...new Set([...assignedModules, ...teamDefaults])];

  const sidebarGroups = [];
  SIDEBAR_SECTIONS.forEach((section) => {
    const items = [];
    section.modules.forEach((mod) => {
      if (isAdmin || userModules.includes(mod)) {
        const entry = MODULE_ROUTE_MAP[mod];
        if (Array.isArray(entry)) entry.forEach((item) => items.push(item));
        else if (entry) items.push(entry);
      }
    });
    if (items.length > 0) sidebarGroups.push({ label: section.label, items });
  });

  sidebarGroups.push({
    label: 'My Account',
    items: [{ path: '/leave-management', icon: CalendarDays, label: 'Leave Management' }],
  });

  const handleLogout = async () => { await logout(); navigate('/login'); };

  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ── Sidebar content (shared between desktop + mobile drawer) ───────
  const SidebarContent = () => (
    <div className="h-full flex flex-col">

      {/* Logo bar */}
      <div className="flex items-center justify-between px-5 h-[60px] border-b border-[var(--border-color)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-bold leading-none">S</span>
          </div>
          <div>
            <span className="text-[var(--text-primary)] text-sm font-bold tracking-tight leading-none">SmartShape</span>
            <span className="text-[var(--accent)] text-sm font-bold tracking-tight leading-none">Pro</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Toggle theme"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-3" data-testid="admin-sidebar">
        {sidebarGroups.map((group, gi) => (
          <div key={gi}>
            {/* Visual separator between groups */}
            {gi > 0 && (
              <div className="h-px bg-[var(--border-color)] mx-1 my-2" />
            )}
            {group.label && (
              <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path
                  || (item.path !== '/today' && item.path !== '/dashboard' && location.pathname.startsWith(item.path + '/'));
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    data-testid={`admin-sidebar-${item.label.toLowerCase().replace(/ /g, '-')}-link`}
                    className={`group relative flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--accent)]" />
                    )}
                    <Icon
                      className={`h-[15px] w-[15px] flex-shrink-0 transition-colors ${
                        isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
                      }`}
                      strokeWidth={isActive ? 2 : 1.7}
                    />
                    <span className="truncate leading-none">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
          <div className="w-7 h-7 rounded-full bg-[var(--accent-bg)] flex items-center justify-center flex-shrink-0">
            <span className="text-[11px] font-bold text-[var(--accent)]">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate leading-tight">{user?.name}</p>
            <p className="text-[10px] text-[var(--text-muted)] truncate leading-tight capitalize">{user?.role || 'Admin'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
            title="Logout"
            data-testid="admin-logout-button"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Bottom nav items ────────────────────────────────────────────────
  const bottomItems = [
    { path: '/today',       icon: Home,        label: 'Home',   module: 'dashboard',   related: ['/dashboard'] },
    { path: '/leads',       icon: Target,      label: 'CRM',    module: 'leads',       related: ['/school-profile', '/crm-masters', '/dispatch-tracking', '/customer-engagement', '/marketing'] },
    { path: '/field-sales', icon: MapPin,      label: 'Field',  module: 'field_sales', related: ['/visit-planning', '/visit-calendar'] },
    { path: '/sales',       icon: Smartphone,  label: 'Sales',  module: 'sales_portal',related: ['/quotations', '/create-quotation', '/view-quotation', '/edit-quotation', '/orders'] },
  ].filter(item => isAdmin || userModules.includes(item.module));

  const allBottomItems = [...bottomItems, { path: '__more__', icon: MoreHorizontal, label: 'More' }];

  function isBottomActive(item) {
    const p = location.pathname;
    if (p === item.path) return true;
    if (item.related?.some(r => p === r || p.startsWith(r + '/') || p.startsWith(r + '?'))) return true;
    return false;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">

      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[240px] flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-color)]">
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar drawer ────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          onClick={() => setSidebarOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          {/* Drawer */}
          <aside
            className="relative w-[272px] max-w-[85vw] bg-[var(--bg-sidebar)] h-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Main content area ────────────────────────────────────────── */}
      <div className="flex-1 lg:ml-[240px] min-w-0">

        {/* Mobile top header */}
        <header
          className="lg:hidden sticky top-0 z-40 flex items-center justify-between bg-[var(--bg-card)] border-b border-[var(--border-color)]"
          style={{
            height: 'calc(56px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
            paddingLeft: '16px',
            paddingRight: '16px',
          }}
        >
          {/* Left: hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 -ml-1.5 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          {/* Center: page title */}
          <span className="text-[14px] font-bold text-[var(--text-primary)] tracking-tight truncate mx-3 flex-1 text-center">
            {getPageTitle(location.pathname)}
          </span>

          {/* Right: theme toggle + avatar */}
          <div className="flex items-center gap-1 -mr-1">
            <button
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-8 h-8 rounded-full bg-[var(--accent-bg)] flex items-center justify-center ml-0.5"
            >
              <span className="text-[11px] font-bold text-[var(--accent)]">{initials}</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom navigation ──────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-color)]"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: 'var(--shadow-up)',
        }}
      >
        <div className="flex items-stretch h-[62px]">
          {allBottomItems.map((item) => {
            const Icon = item.icon;
            const isMore = item.path === '__more__';
            const isActive = isMore ? sidebarOpen : isBottomActive(item);

            const tabContent = (
              <>
                {/* Active indicator bar */}
                <div
                  className={`absolute top-0 inset-x-3 h-[2.5px] rounded-b-full transition-all duration-200 ${
                    isActive ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'
                  }`}
                />
                <Icon
                  className={`h-[20px] w-[20px] mb-1 transition-colors ${
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                  }`}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                <span
                  className={`text-[10px] font-semibold leading-none transition-colors ${
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {item.label}
                </span>
              </>
            );

            const cls = `relative flex-1 flex flex-col items-center justify-center pt-1 pb-0.5 transition-colors active:opacity-70`;

            if (isMore) {
              return (
                <button key="more" onClick={() => setSidebarOpen(s => !s)} className={cls}>
                  {tabContent}
                </button>
              );
            }
            return (
              <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)} className={cls}>
                {tabContent}
              </Link>
            );
          })}
        </div>
      </nav>

      <HelpButton />
      <GuidedTour />
      <KeyboardShortcuts />
    </div>
  );
}
