import React from 'react';
import { Bell, BellOff, X, CheckCheck, FileText, AlertTriangle, Clock, Gift, Zap } from 'lucide-react';
import { notificationsApi, pushApi } from '../../lib/api';

const SHELL_NOTIF_META = {
  overdue_task:      { Icon: AlertTriangle, color: '#f97316', bg: 'rgba(249,115,22,0.14)' },
  stale_lead:        { Icon: Clock,         color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  pending_quotation: { Icon: FileText,      color: '#3b82f6', bg: 'rgba(59,130,246,0.14)' },
  birthday_today:    { Icon: Gift,          color: '#ec4899', bg: 'rgba(236,72,153,0.14)' },
  anniversary_today: { Icon: Zap,           color: '#a855f7', bg: 'rgba(168,85,247,0.14)' },
};
const SHELL_NOTIF_DEFAULT = { Icon: Bell, color: '#6b7280', bg: 'rgba(107,114,128,0.14)' };

const shellRelTime = (iso) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function getNotifLink(n) {
  if (n.type === 'overdue_task')                                    return '/delegation';
  if (n.type === 'stale_lead' && n.lead_id)                        return '/leads-crm';
  if (n.type === 'pending_quotation' && n.quotation_id)            return `/quotations/${n.quotation_id}`;
  if (n.type === 'birthday_today' || n.type === 'anniversary_today') return '/leads-crm';
  return null;
}

/**
 * AppShellNotifDrawer — mobile bottom-sheet notification panel.
 *
 * Props:
 *   open           — boolean
 *   onClose        — () => void
 *   notifs         — array
 *   setNotifs      — state setter
 *   unreadCount    — number
 *   setUnreadCount — state setter
 *   pushSupported  — boolean
 *   pushSubscribed — boolean
 *   pushEnabling   — boolean
 *   setPushSubscribed — state setter
 *   onEnablePush   — () => void
 *   onNavigate     — (path) => void
 */
export default function AppShellNotifDrawer({
  open,
  onClose,
  notifs,
  setNotifs,
  unreadCount,
  setUnreadCount,
  pushSupported,
  pushSubscribed,
  setPushSubscribed,
  pushEnabling,
  onEnablePush,
  onNavigate,
}) {
  if (!open) return null;

  const handleDisablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await pushApi.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
      setPushSubscribed(false);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[500] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-t-3xl flex flex-col" style={{ maxHeight: '85dvh' }}>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-[var(--border-color)] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-2 pb-3.5 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#e94560]/10 flex items-center justify-center">
              <Bell className="h-4 w-4 text-[#e94560]" />
            </div>
            <div>
              <p className="font-bold text-[var(--text-primary)] text-base leading-tight">Notifications</p>
              {unreadCount > 0 && (
                <p className="text-[10px] text-[#e94560] font-semibold leading-tight">{unreadCount} unread</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={async () => {
                  try {
                    await notificationsApi.markAllRead();
                    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
                    setUnreadCount(0);
                  } catch {}
                }}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[#e94560] font-medium transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark read
              </button>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Push strip */}
        {pushSupported && (
          <div className={`flex-shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-[var(--border-color)] ${pushSubscribed ? 'bg-emerald-500/5' : 'bg-[var(--bg-hover)]'}`}>
            <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${pushSubscribed ? 'bg-emerald-500/15' : 'bg-[var(--border-color)]'}`}>
              {pushSubscribed ? <Bell className="h-3.5 w-3.5 text-emerald-400" /> : <BellOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--text-primary)] leading-tight">
                {pushSubscribed ? 'Push alerts active' : 'Enable push alerts'}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] leading-tight">
                {pushSubscribed ? 'Alerts arrive even when app is closed' : 'Get WhatsApp-style alerts when closed'}
              </p>
            </div>
            <button
              disabled={pushEnabling}
              onClick={pushSubscribed ? handleDisablePush : onEnablePush}
              className={`flex-shrink-0 text-[10px] px-3 py-1 rounded-full font-semibold transition-all disabled:opacity-40 ${
                pushSubscribed ? 'text-red-400 hover:bg-red-500/10' : 'bg-[#e94560] text-white hover:bg-[#f05c75]'
              }`}
            >
              {pushEnabling ? '…' : pushSubscribed ? 'Turn off' : 'Enable'}
            </button>
          </div>
        )}

        {/* Notification list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {notifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-hover)] flex items-center justify-center mb-4">
                <Bell className="h-7 w-7 text-[var(--text-muted)] opacity-30" />
              </div>
              <p className="text-base font-bold text-[var(--text-primary)]">All caught up!</p>
              <p className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed">New alerts will appear here as they arrive</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {notifs.map((n, i) => {
                const meta = SHELL_NOTIF_META[n.type] || SHELL_NOTIF_DEFAULT;
                const { Icon } = meta;
                const notifLink = getNotifLink(n);
                const linkedId = n.task_id || n.lead_id || n.quotation_id;

                const handleClick = async () => {
                  if (!n.is_read) {
                    setNotifs(prev => prev.map((x, j) => j === i ? { ...x, is_read: true } : x));
                    setUnreadCount(c => Math.max(0, c - 1));
                    try { if (linkedId) await notificationsApi.markOneRead(linkedId); } catch {}
                  }
                  if (notifLink) { onClose(); onNavigate(notifLink); }
                };

                return (
                  <div
                    key={n._id || i}
                    onClick={handleClick}
                    className={`relative flex items-start gap-3.5 px-5 py-4 transition-colors cursor-pointer active:bg-[var(--bg-hover)] hover:bg-[var(--bg-hover)] ${!n.is_read ? 'bg-[#e94560]/[0.04]' : ''}`}
                  >
                    {!n.is_read && <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-[#e94560] rounded-r-full" />}
                    <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5" style={{ background: meta.bg }}>
                      <Icon className="h-4.5 w-4.5" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className={`text-sm leading-snug ${!n.is_read ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                          {n.title}
                        </p>
                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                          <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{shellRelTime(n.created_at)}</span>
                          {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#e94560]" />}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2">
                        {n.message || n.body || ''}
                      </p>
                      {notifLink && (
                        <p className="text-[10px] font-semibold mt-1" style={{ color: meta.color }}>Tap to view →</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifs.length > 0 && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-[var(--border-color)] flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">{notifs.length} total · {unreadCount} unread</span>
            <button onClick={onClose} className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
