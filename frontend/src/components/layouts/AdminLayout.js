import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  LayoutDashboard, FileText, Package, AlertTriangle, Settings, BarChart3,
  Warehouse, ClipboardList, DollarSign, Users, LogOut, Menu, X,
  Smartphone, Layers, IndianRupee, UserCog, Store, MapPin, Target,
  Sun, Moon, CalendarDays, Calendar, ShoppingCart, Upload, Activity,
  Home, MoreHorizontal, Megaphone, ChevronRight,
} from 'lucide-react';
import HelpButton from '../HelpButton';
import GuidedTour from '../GuidedTour';
import KeyboardShortcuts from '../KeyboardShortcuts';

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
    { path: '/customer-engagement', icon: Megaphone, label: 'Customer Engagement' },
    { path: '/marketing', icon: Megaphone, label: 'Marketing & WhatsApp' },
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
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5" data-testid="admin-sidebar">
        {sidebarGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'pt-3' : ''}>
            {group.label && (
              <p className="px-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--text-muted)]">
                {group.label}
              </p>
            )}
            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    data-testid={`admin-sidebar-${item.label.toLowerCase().replace(/ /g, '-')}-link`}
                    className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon
                      className={`h-[15px] w-[15px] flex-shrink-0 transition-colors ${
                        isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
                      }`}
                      strokeWidth={isActive ? 2 : 1.7}
                    />
                    <span className="truncate leading-none">{item.label}</span>
                    {isActive && (
                      <ChevronRight className="h-3 w-3 ml-auto text-[var(--accent)] opacity-50 flex-shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
          <div className="w-7 h-7 rounded-full bg-[var(--accent-bg)] flex items-center justify-center flex-shrink-0">
            <span className="text-[11px] font-bold text-[var(--accent)]">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate leading-tight">{user?.name}</p>
            <p className="text-[10px] text-[var(--text-muted)] truncate leading-tight">{user?.email}</p>
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
    { path: '/today',       icon: Home,        label: 'Home',   module: 'dashboard' },
    { path: '/leads',       icon: Target,      label: 'CRM',    module: 'leads' },
    { path: '/field-sales', icon: MapPin,      label: 'Field',  module: 'field_sales' },
    { path: '/sales',       icon: Smartphone,  label: 'Sales',  module: 'sales_portal' },
  ].filter(item => isAdmin || userModules.includes(item.module));

  const allBottomItems = [...bottomItems, { path: '__more__', icon: MoreHorizontal, label: 'More' }];

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
            const isActive = isMore
              ? sidebarOpen
              : location.pathname === item.path || location.pathname.startsWith(item.path + '/');

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
