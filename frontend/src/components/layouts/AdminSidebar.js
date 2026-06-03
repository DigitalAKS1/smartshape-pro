import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sun, Moon, X, LogOut, CalendarDays } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import NotificationBell from './NotificationBell';

/**
 * AdminSidebar — desktop sidebar + mobile drawer content.
 *
 * Props:
 *   sidebarGroups   — computed nav groups from AdminNavItems
 *   user            — auth user object
 *   initials        — string, 1-2 char initials
 *   onClose         — called when X or a link is clicked (mobile close)
 *   onLogout        — async logout handler
 */
export default function AdminSidebar({ sidebarGroups, user, initials, onClose, onLogout }) {
  const { toggleTheme, isDark } = useTheme();
  const location = useLocation();

  return (
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
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-3" data-testid="admin-sidebar">
        {sidebarGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="h-px bg-[var(--border-color)] mx-1 my-2" />}
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
                    onClick={onClose}
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

        {/* My Account section always present */}
        <div>
          <div className="h-px bg-[var(--border-color)] mx-1 my-2" />
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">My Account</p>
          <div className="space-y-0.5">
            {[{ path: '/leave-management', icon: CalendarDays, label: 'Leave Management' }].map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`group relative flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                    isActive
                      ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--accent)]" />}
                  <Icon className={`h-[15px] w-[15px] flex-shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} strokeWidth={isActive ? 2 : 1.7} />
                  <span className="truncate leading-none">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
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
            onClick={onLogout}
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
}
