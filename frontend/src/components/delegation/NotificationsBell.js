import React, { useState } from 'react';
import { Bell, Check } from 'lucide-react';

const PINK = '#e94560';

/**
 * Polled in-app notification dropdown for the delegation module.
 */
export default function NotificationsBell({
  notifications = [], markNotifRead, markAllNotifsRead,
  card, textPri, textSec, textMuted,
}) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`relative p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
            style={{ background: PINK }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto z-50 ${card} border rounded-xl shadow-2xl`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] sticky top-0 bg-[var(--bg-card)]">
              <p className={`text-sm font-semibold ${textPri}`}>Notifications</p>
              {unread > 0 && (
                <button onClick={markAllNotifsRead}
                  className="text-[11px] font-medium" style={{ color: PINK }}>
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className={`h-8 w-8 mx-auto mb-2 opacity-20 ${textMuted}`} />
                <p className={`text-xs ${textMuted}`}>You're all caught up</p>
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.notif_id}
                  className={`px-4 py-3 border-b border-[var(--border-color)] flex items-start gap-2 ${n.is_read ? '' : 'bg-[var(--bg-hover)]'}`}>
                  {!n.is_read && (
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: PINK }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${textPri}`}>{n.title}</p>
                    <p className={`text-[11px] ${textMuted} mt-0.5`}>{n.body}</p>
                  </div>
                  {!n.is_read && (
                    <button onClick={() => markNotifRead(n.notif_id)}
                      className={`p-1 rounded hover:bg-[var(--bg-card)] ${textMuted}`} title="Mark read">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
