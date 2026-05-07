import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Home, Calendar, MapPin, FileText, Receipt, LogOut, ArrowLeft, Sun, Moon, User } from 'lucide-react';
import { Button } from '../ui/button';

export default function SalesLayout({ children, title, showBack }) {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const navItems = [
    { path: '/sales', icon: Home, label: 'Home' },
    { path: '/sales/attendance', icon: Calendar, label: 'Attendance' },
    { path: '/sales/visits', icon: MapPin, label: 'Visits' },
    { path: '/sales/quotations', icon: FileText, label: 'Quotes' },
    { path: '/sales/expenses', icon: Receipt, label: 'Expenses' },
  ];

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
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]" data-testid="sales-theme-toggle">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {isAdmin && (
              <Link to="/dashboard" className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 transition-colors" data-testid="sales-back-to-admin">
                Admin
              </Link>
            )}
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

      {/* Bottom Navigation */}
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
