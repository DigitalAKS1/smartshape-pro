import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  LayoutDashboard, FileText, Package, AlertTriangle, Settings, BarChart3,
  Warehouse, ClipboardList, DollarSign, Users, LogOut, Menu, X,
  Smartphone, Layers, IndianRupee, UserCog, Store, MapPin, Target,
  Sun, Moon, CalendarDays, Calendar, ShoppingCart, Upload, Activity,
  Home, MoreHorizontal, Megaphone
} from 'lucide-react';
import { Button } from '../ui/button';

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
  { label: null, modules: ['dashboard'] },
  { label: 'Sales', modules: ['quotations', 'leads', 'field_sales', 'sales_portal'] },
  { label: 'Store & Inventory', modules: ['inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'package_master', 'store'] },
  { label: 'Finance & HR', modules: ['accounts', 'payroll', 'hr'] },
  { label: 'Reports', modules: ['analytics'] },
  { label: 'Administration', modules: ['user_management', 'settings'] },
];

// Modules each team always gets regardless of assigned_modules
const TEAM_MODULES = {
  accounts: ['dashboard', 'quotations', 'accounts', 'payroll', 'analytics'],
  store:    ['dashboard', 'quotations', 'inventory', 'stock_management', 'purchase_alerts', 'physical_count', 'store', 'package_master'],
};

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const team = user?.role === 'admin' ? 'admin'
    : user?.role === 'accounts' ? 'accounts'
    : user?.role === 'store' ? 'store'
    : 'sales';
  const isAdmin = team === 'admin';

  // Effective modules = assigned_modules + team-based defaults
  const assignedModules = user?.assigned_modules || [];
  const teamDefaults = TEAM_MODULES[team] || [];
  const userModules = [...new Set([...assignedModules, ...teamDefaults])];

  const sidebarGroups = [];
  SIDEBAR_SECTIONS.forEach((section) => {
    const items = [];
    section.modules.forEach((modName) => {
      if (isAdmin || userModules.includes(modName)) {
        const entry = MODULE_ROUTE_MAP[modName];
        if (Array.isArray(entry)) entry.forEach((item) => items.push(item));
        else if (entry) items.push(entry);
      }
    });
    if (items.length > 0) sidebarGroups.push({ label: section.label, items });
  });

  // Leave Management is UNIVERSAL - every user can apply for leave
  sidebarGroups.push({
    label: 'My Account',
    items: [{ path: '/leave-management', icon: CalendarDays, label: 'Leave Management' }],
  });

  const handleLogout = async () => { await logout(); navigate('/login'); };

  // Theme-aware colors
  const bg = 'bg-[var(--bg-primary)]';
  const sidebarBg = 'bg-[var(--bg-card)]';
  const borderClr = 'border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const hoverBg = 'hover:bg-[var(--bg-hover)]';
  const mobileBg = isDark ? 'bg-[#0a0a12]/80' : 'bg-white/80';

  return (
    <div className={`min-h-screen ${bg} flex`}>
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 ${sidebarBg} border-r ${borderClr} transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-full flex flex-col">
          <div className={`p-5 border-b ${borderClr} flex items-center justify-between`}>
            <div>
              <h1 className={`text-xl font-bold ${textPri}`} data-testid="admin-logo">SmartShape Pro</h1>
              <p className={`text-xs ${textMuted} mt-0.5`}>Admin Portal</p>
            </div>
            <button onClick={toggleTheme} className={`p-2 rounded-md ${hoverBg} ${textSec} transition-colors`} data-testid="theme-toggle">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <nav className="flex-1 px-3 py-3 overflow-y-auto" data-testid="admin-sidebar">
            {sidebarGroups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
                {group.label && (
                  <p className={`px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest ${textMuted}`}>{group.label}</p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link key={item.path} to={item.path}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-md transition-all text-sm ${
                          isActive ? 'bg-[#e94560] text-white' : `${textSec} ${hoverBg} hover:${textPri}`
                        }`}
                        onClick={() => setSidebarOpen(false)}
                        data-testid={`admin-sidebar-${item.label.toLowerCase().replace(/ /g, '-')}-link`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        <span className="font-medium truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className={`p-3 border-t ${borderClr}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${textPri} truncate`}>{user?.name}</p>
                <p className={`text-xs ${textMuted} truncate`}>{user?.email}</p>
              </div>
            </div>
            <Button onClick={handleLogout} variant="outline"
              className={`w-full ${borderClr} ${textSec} ${hoverBg}`} data-testid="admin-logout-button">
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex-1 lg:ml-64">
        <div className={`lg:hidden sticky top-0 z-40 ${mobileBg} backdrop-blur-xl border-b ${borderClr} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <h1 className={`text-lg font-bold ${textPri}`}>SmartShape Pro</h1>
            <div className="flex items-center gap-2">
              <button onClick={toggleTheme} className={`p-2 rounded-md ${textSec}`}>
                {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <Button onClick={() => setSidebarOpen(!sidebarOpen)} variant="ghost" size="icon" className={textPri}>
                {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          </div>
        </div>

        <main className="p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">{children}</main>
      </div>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Mobile Bottom Navigation */}
      {(() => {
        const bottomItems = [
          { path: '/today', icon: Home, label: 'Home', module: 'dashboard' },
          { path: '/leads', icon: Target, label: 'CRM', module: 'leads' },
          { path: '/field-sales', icon: MapPin, label: 'Field', module: 'field_sales' },
          { path: '/sales', icon: Smartphone, label: 'Sales', module: 'sales_portal' },
        ].filter(item => isAdmin || userModules.includes(item.module));
        return (
          <nav className={`lg:hidden fixed bottom-0 inset-x-0 z-50 ${sidebarBg} border-t ${borderClr} flex items-stretch`} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {bottomItems.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${isActive ? 'text-[#e94560]' : textMuted}`}>
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.5} />
                  <span className={`text-[10px] font-medium ${isActive ? 'text-[#e94560]' : ''}`}>{item.label}</span>
                </Link>
              );
            })}
            <button onClick={() => setSidebarOpen(s => !s)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${sidebarOpen ? 'text-[#e94560]' : textMuted}`}>
              <MoreHorizontal className="h-5 w-5" strokeWidth={sidebarOpen ? 2 : 1.5} />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </nav>
        );
      })()}
    </div>
  );
}
