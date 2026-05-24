import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Home, Users, MapPin, FileText, Calendar, LogOut, ArrowLeft, Sun, Moon, User } from 'lucide-react';
import { Button } from '../ui/button';
import { getSalesPermissions, SALES_ROLES } from '../../lib/salesPermissions';

// All possible nav items; each guarded by a permission key
const ALL_NAV = [
  { path: '/sales',            icon: Home,     label: 'Home',   perm: null },
  { path: '/sales/leads',      icon: Users,    label: 'Leads',  perm: 'leads_view' },
  { path: '/sales/visits',     icon: MapPin,   label: 'Visits', perm: 'visits_log' },
  { path: '/sales/quotations', icon: FileText, label: 'Quotes', perm: 'quotation_view' },
  { path: '/leave-management', icon: Calendar, label: 'Leave',  perm: 'leave_apply' },
];

export default function SalesLayout({ children, title, showBack }) {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const perms = getSalesPermissions(user?.sales_role);
  const salesRoleDef = SALES_ROLES[user?.sales_role];

  const navItems = ALL_NAV.filter(item => !item.perm || perms[item.perm]);

  function isNavActive(path) {
    if (path === '/sales') return location.pathname === '/sales';
    return location.pathname === path || location.pathname.startsWith(path + '/') || location.pathname.startsWith(path + '?');
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingBottom: '10px' }}
        data-testid="sales-header">
        <div className="flex items-center gap-3">
          {showBack && (
            <button onClick={() => navigate(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex-shrink-0"
              data-testid="sales-back-button">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          {/* Title + user row */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-bold text-[var(--text-primary)] leading-tight truncate"
              data-testid="sales-header-title">
              {title || 'SmartShape Field'}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-[var(--text-secondary)] truncate">{user?.name}</p>
              {salesRoleDef && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold border flex-shrink-0 ${salesRoleDef.cls}`}>
                  {salesRoleDef.label}
                </span>
              )}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={toggleTheme}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
              data-testid="sales-theme-toggle">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to={isAdmin ? '/dashboard' : '/today'}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[#e94560] transition-colors"
              title="Back to dashboard"
              data-testid="sales-back-to-dashboard">
              <User className="h-4 w-4" />
            </Link>
            <button onClick={handleLogout}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500 transition-colors"
              title="Logout"
              data-testid="sales-logout-button">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="px-4 py-6">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-card)] border-t border-[var(--border-color)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: 'var(--shadow-up)' }}
        data-testid="sales-bottom-nav"
      >
        <div className="flex items-stretch h-[62px] max-w-lg mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isNavActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className="relative flex-1 flex flex-col items-center justify-center pt-1 pb-0.5 transition-colors active:opacity-70"
                data-testid={`sales-nav-${item.label.toLowerCase()}-link`}
              >
                <div
                  className={`absolute top-0 inset-x-3 h-[2.5px] rounded-b-full transition-all ${
                    isActive ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'
                  }`}
                />
                <Icon
                  className={`h-[20px] w-[20px] mb-1 transition-colors ${
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                  }`}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                <span className={`text-[10px] font-semibold leading-none ${
                  isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                }`}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
