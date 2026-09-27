import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Target, MapPin, Package, FileText, MessageCircle } from 'lucide-react';

/**
 * AppShellNav — mobile bottom tab navigation.
 *
 * Props:
 *   isSalesUser — boolean, determines which tab set to show
 *   waUnread    — number, unread WhatsApp chats; shown as a badge on the Chats tab
 *
 * Five tabs at most. Sales: Leave moved to the menu drawer to make room for Chats;
 * admin: Chats replaces Mktg (Marketing stays in the menu drawer).
 */
export default function AppShellNav({ isSalesUser, waUnread = 0 }) {
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = isSalesUser ? [
    { path: '/today',            icon: Home,          label: 'Today'  },
    { path: '/sales/leads',      icon: Target,        label: 'Leads'  },
    { path: '/sales/visits',     icon: MapPin,        label: 'Visits' },
    { path: '/sales/quotations', icon: FileText,      label: 'Quotes' },
    { path: '/whatsapp',         icon: MessageCircle, label: 'Chats'  },
  ] : [
    { path: '/today',          icon: Home,          label: 'Today'  },
    { path: '/leads',          icon: Target,        label: 'CRM'    },
    { path: '/visit-planning', icon: MapPin,        label: 'Visits' },
    { path: '/orders',         icon: Package,       label: 'Orders' },
    { path: '/whatsapp',       icon: MessageCircle, label: 'Chats'  },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-color)] safe-area-bottom" data-testid="mobile-bottom-nav">
      <div className="grid grid-cols-5">
        {tabs.map(t => {
          const active = loc.pathname.startsWith(t.path);
          const badge = t.path === '/whatsapp' && waUnread > 0 ? (waUnread > 9 ? '9+' : String(waUnread)) : '';
          return (
            <button
              key={t.path}
              onClick={() => nav(t.path)}
              className={`relative flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px] transition-colors ${active ? 'text-[#e94560]' : 'text-[var(--text-muted)]'}`}
              data-testid={`nav-${t.label.toLowerCase()}`}
            >
              <span className="relative">
                <t.icon className="h-5 w-5" />
                {badge && (
                  <span data-testid="nav-chats-badge"
                    className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-0.5 bg-[#e94560] text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                    {badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{t.label}</span>
              {active && <span className="absolute bottom-0 h-0.5 w-12 bg-[#e94560] rounded-t" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
