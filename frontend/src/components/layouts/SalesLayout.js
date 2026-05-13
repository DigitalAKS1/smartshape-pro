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

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3" data-testid="sales-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {showBack && (
              <button onClick={() => navigate(-1)} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]" data-testid="sales-back-button">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div>
              <h1 className="text-lg font-bold text-[var(--text-primary)]" data-testid="sales-header-title">
                {title || 'SmartShape Field'}
              </h1>
              <div className="flex items-center gap-1.5">
                <User className="h-3 w-3 text-[var(--text-muted)]" />
                <p className="text-xs text-[var(--text-secondary)]">{user?.name}</p>
                {salesRoleDef && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold border ${salesRoleDef.cls}`}>
                    {salesRoleDef.label}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]" data-testid="sales-theme-toggle">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to={isAdmin ? '/dashboard' : '/today'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#e94560] text-white hover:bg-[#f05c75] transition-colors shadow-sm"
              data-testid="sales-back-to-dashboard"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <Button
              onClick={handleLogout}
              variant="ghost"
              size="sm"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              data-testid="sales-logout-button"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="px-4 py-6">
        {children}
      </main>

      {/* Bottom Navigation — items filtered by role permissions */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-card)] border-t border-[var(--border-color)] safe-area-bottom" data-testid="sales-bottom-nav">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center flex-1 h-full space-y-0.5 transition-colors ${
                  isActive ? 'text-[#e94560]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
                data-testid={`sales-nav-${item.label.toLowerCase()}-link`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2]' : ''}`} strokeWidth={1.5} />
                <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
