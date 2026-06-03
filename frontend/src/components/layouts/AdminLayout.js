import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import HelpButton from '../HelpButton';
import GuidedTour from '../GuidedTour';
import KeyboardShortcuts from '../KeyboardShortcuts';
import AdminSidebar from './AdminSidebar';
import AdminTopbar from './AdminTopbar';
import { MODULE_ROUTE_MAP, SIDEBAR_SECTIONS, TEAM_MODULES, BOTTOM_NAV_ITEMS, MORE_ITEM } from './AdminNavItems';

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const team = user?.role === 'admin'    ? 'admin'
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

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Bottom nav
  const bottomItems = BOTTOM_NAV_ITEMS.filter(item => isAdmin || userModules.includes(item.module));
  const allBottomItems = [...bottomItems, MORE_ITEM];

  function isBottomActive(item) {
    const p = location.pathname;
    if (p === item.path) return true;
    if (item.related?.some(r => p === r || p.startsWith(r + '/') || p.startsWith(r + '?'))) return true;
    return false;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[240px] flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-color)]">
        <AdminSidebar
          sidebarGroups={sidebarGroups}
          user={user}
          initials={initials}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
        />
      </aside>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <aside className="relative w-[272px] max-w-[85vw] bg-[var(--bg-sidebar)] h-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <AdminSidebar
              sidebarGroups={sidebarGroups}
              user={user}
              initials={initials}
              onClose={() => setSidebarOpen(false)}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 lg:ml-[240px] min-w-0">

        <AdminTopbar initials={initials} onMenuOpen={() => setSidebarOpen(true)} />

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-color)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: 'var(--shadow-up)' }}
      >
        <div className="flex items-stretch h-[62px]">
          {allBottomItems.map((item) => {
            const Icon = item.icon;
            const isMore = item.path === '__more__';
            const isActive = isMore ? sidebarOpen : isBottomActive(item);

            const tabContent = (
              <>
                <div className={`absolute top-0 inset-x-3 h-[2.5px] rounded-b-full transition-all duration-200 ${isActive ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'}`} />
                <Icon className={`h-[20px] w-[20px] mb-1 transition-colors ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} strokeWidth={isActive ? 2.2 : 1.6} />
                <span className={`text-[10px] font-semibold leading-none transition-colors ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
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
