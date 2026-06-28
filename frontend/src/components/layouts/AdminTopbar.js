import React from 'react';
import { Menu, Sun, Moon, Smartphone } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getPageTitle } from './AdminNavItems';
import { useLocation } from 'react-router-dom';

/**
 * AdminTopbar — mobile-only sticky top header.
 *
 * Props:
 *   initials        — string, 1-2 char user initials
 *   onMenuOpen      — called when hamburger / avatar is tapped
 */
export default function AdminTopbar({ initials, onMenuOpen }) {
  const { toggleTheme, isDark } = useTheme();
  const location = useLocation();

  return (
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
        onClick={onMenuOpen}
        className="w-9 h-9 -ml-1.5 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {/* Center: page title */}
      <span className="text-[14px] font-bold text-[var(--text-primary)] tracking-tight truncate mx-3 flex-1 text-center">
        {getPageTitle(location.pathname)}
      </span>

      {/* Right: get-app + theme toggle + avatar */}
      <div className="flex items-center gap-1 -mr-1">
        <a
          href="/get-app"
          title="Get the mobile app"
          className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] transition-colors"
        >
          <Smartphone className="h-4 w-4" />
        </a>
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          onClick={onMenuOpen}
          className="w-8 h-8 rounded-full bg-[var(--accent-bg)] flex items-center justify-center ml-0.5"
        >
          <span className="text-[11px] font-bold text-[var(--accent)]">{initials}</span>
        </button>
      </div>
    </header>
  );
}
