import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Target, MapPin, Package, FileText, CalendarDays, Megaphone } from 'lucide-react';

/**
 * AppShellNav — mobile bottom tab navigation.
 *
 * Props:
 *   isSalesUser — boolean, determines which tab set to show
 */
export default function AppShellNav({ isSalesUser }) {
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = isSalesUser ? [
    { path: '/today',            icon: Home,         label: 'Today'  },
    { path: '/sales/leads',      icon: Target,       label: 'Leads'  },
    { path: '/sales/visits',     icon: MapPin,       label: 'Visits' },
    { path: '/sales/quotations', icon: FileText,     label: 'Quotes' },
    { path: '/leave-management', icon: CalendarDays, label: 'Leave'  },
  ] : [
    { path: '/today',          icon: Home,     label: 'Today'  },
    { path: '/leads',          icon: Target,   label: 'CRM'    },
    { path: '/visit-planning', icon: MapPin,   label: 'Visits' },
    { path: '/orders',         icon: Package,  label: 'Orders' },
    { path: '/marketing',      icon: Megaphone,label: 'Mktg'   },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-color)] safe-area-bottom" data-testid="mobile-bottom-nav">
      <div className="grid grid-cols-5">
        {tabs.map(t => {
          const active = loc.pathname.startsWith(t.path);
          return (
            <button
              key={t.path}
              onClick={() => nav(t.path)}
              className={`relative flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px] transition-colors ${active ? 'text-[#e94560]' : 'text-[var(--text-muted)]'}`}
              data-testid={`nav-${t.label.toLowerCase()}`}
            >
              <t.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{t.label}</span>
              {active && <span className="absolute bottom-0 h-0.5 w-12 bg-[#e94560] rounded-t" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
