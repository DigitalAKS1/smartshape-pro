import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Phone, Check } from 'lucide-react';
import { crmNotifications } from '../../lib/api';

const PINK = '#e94560';

/** Polled in-app CRM notifications (e.g. "incoming call for your account"). */
export default function CrmNotificationsBell({ card, textPri, textSec, textMuted }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try { const r = await crmNotifications.list({}); setItems(r.data || []); } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const unread = items.filter(n => !n.is_read).length;

  const markRead = async (id) => {
    try { await crmNotifications.read(id); setItems(xs => xs.map(n => n.notif_id === id ? { ...n, is_read: true } : n)); } catch { /* */ }
  };
  const markAll = async () => {
    try { await crmNotifications.readAll(); setItems(xs => xs.map(n => ({ ...n, is_read: true }))); } catch { /* */ }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button onClick={() => setOpen(o => !o)} title="CRM notifications"
        className={`relative h-9 w-9 rounded-md border border-[var(--border-color)] flex items-center justify-center ${textSec} hover:bg-[var(--bg-hover)]`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: PINK }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className={`${card} border rounded-xl shadow-xl absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto z-50`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
            <span className={`text-sm font-semibold ${textPri}`}>Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-xs font-semibold" style={{ color: PINK }}>Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className={`text-sm text-center py-8 ${textMuted}`}>Nothing yet.</p>
          ) : items.map(n => (
            <button key={n.notif_id} onClick={() => markRead(n.notif_id)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] flex gap-2.5 ${n.is_read ? 'opacity-60' : ''}`}>
              <span className="mt-0.5"><Phone className="h-3.5 w-3.5" style={{ color: PINK }} /></span>
              <span className="flex-1 min-w-0">
                <span className={`block text-xs font-semibold ${textPri}`}>{n.title}</span>
                <span className={`block text-xs ${textSec} mt-0.5`}>{n.body}</span>
                <span className={`block text-[10px] ${textMuted} mt-0.5`}>
                  {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                </span>
              </span>
              {!n.is_read && <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
