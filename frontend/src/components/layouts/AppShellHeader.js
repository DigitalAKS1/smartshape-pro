import React from 'react';
import { Bell, Wifi, WifiOff, Download, Share2, X } from 'lucide-react';

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * AppShellHeader — mobile sticky top header + iOS install banner.
 *
 * Props:
 *   user             — auth user object
 *   online           — boolean
 *   unreadCount      — number
 *   pushSupported    — boolean
 *   pushSubscribed   — boolean
 *   pushEnabling     — boolean
 *   showInstall      — boolean (Android PWA install prompt available)
 *   showIosInstall   — boolean
 *   shareCopied      — boolean
 *   onBellClick      — () => void
 *   onEnablePush     — () => void
 *   onShare          — () => void
 *   onInstall        — () => void
 *   onDismissIos     — () => void
 */
export default function AppShellHeader({
  user,
  online,
  unreadCount,
  pushSupported,
  pushSubscribed,
  pushEnabling,
  showInstall,
  showIosInstall,
  shareCopied,
  onBellClick,
  onEnablePush,
  onShare,
  onInstall,
  onDismissIos,
}) {
  return (
    <>
      <header className="sticky top-0 z-30 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-3 py-2 flex items-center justify-between" data-testid="mobile-header">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#e94560] to-[#f05c75] flex items-center justify-center font-bold text-white text-xs">SS</div>
          <div>
            <p className="text-sm font-semibold truncate leading-tight">Divine Computer Pvt Ltd</p>
            <p className="text-[10px] text-[var(--text-muted)] leading-tight">{user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Push enable — shown only if not yet subscribed */}
          {pushSupported && !pushSubscribed && typeof Notification !== 'undefined' && Notification.permission !== 'denied' && (
            <button
              onClick={onEnablePush}
              disabled={pushEnabling}
              className="h-8 px-2.5 rounded-full bg-[#e94560] text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
              title="Enable push notifications"
            >
              <Bell className="h-3 w-3" /> {pushEnabling ? '…' : 'Alerts'}
            </button>
          )}
          {/* Share install link */}
          <button
            onClick={onShare}
            className={`h-8 px-2 rounded-full border flex items-center gap-1 transition-colors ${
              shareCopied
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-[var(--bg-hover)] border-[var(--border-color)] text-[var(--text-secondary)]'
            }`}
            title="Share install link"
          >
            <Share2 className="h-3 w-3" />
            {shareCopied && <span className="text-[10px] font-semibold">Copied!</span>}
          </button>
          {/* Install button */}
          {showInstall && (
            <button onClick={onInstall} className="h-8 px-2.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-secondary)] text-[11px] font-semibold inline-flex items-center gap-1" data-testid="install-pwa-btn">
              <Download className="h-3 w-3" /> Install
            </button>
          )}
          {/* Notification bell */}
          <button onClick={onBellClick} className="relative p-1">
            <Bell className="h-5 w-5 text-[var(--text-muted)]" />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 min-w-[14px] h-3.5 px-0.5 bg-[#e94560] text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {online ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-red-400" />}
        </div>
      </header>

      {/* iOS Add to Home Screen banner */}
      {showIosInstall && (
        <div className="bg-blue-500/8 border-b border-blue-500/20 px-3 py-2.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#e94560] to-[#f05c75] flex items-center justify-center text-white font-black text-[9px] shrink-0 shadow-sm">SS</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[var(--text-primary)]">Install Divine Computer Pvt Ltd</p>
            <p className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5">
              Tap <span className="text-blue-400 font-semibold">Share ↑</span> in Safari → <span className="text-blue-400 font-semibold">"Add to Home Screen"</span>
            </p>
          </div>
          <button onClick={onDismissIos} className="shrink-0 p-1.5 text-[var(--text-muted)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
