import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, X, ListChecks } from 'lucide-react';
import { notificationsApi } from '../../lib/api';
import { shouldShowPopup } from './taskPopupSchedule';

// Notification types that represent a task / to-do the person should act on.
const TASK_TYPES = new Set(['overdue_task', 'delegation_overdue']);

const LS_LAST = 'taskPopup.lastShown';
const LS_SNOOZE = 'taskPopup.snoozeDate';
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * A gentle, dismissible popup that surfaces the current user's pending/overdue
 * tasks roughly once an hour. Reuses the same /notifications source the bell
 * uses, so no extra backend is needed.
 */
export default function TaskReminderPopup() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  const tick = useCallback(async () => {
    const snoozedForDay = localStorage.getItem(LS_SNOOZE) === todayStr();
    const lastShown = Number(localStorage.getItem(LS_LAST)) || null;
    if (!shouldShowPopup(lastShown, Date.now(), snoozedForDay)) return;
    try {
      const r = await notificationsApi.getAll();
      const taskNotifs = (r.data || []).filter(n => TASK_TYPES.has(n.type) && !n.is_read);
      if (taskNotifs.length === 0) return; // nothing pending → stay quiet
      setTasks(taskNotifs);
      setVisible(true);
      localStorage.setItem(LS_LAST, String(Date.now()));
    } catch { /* ignore network hiccups */ }
  }, []);

  useEffect(() => {
    // first check shortly after mount, then poll every 5 minutes
    const initial = setTimeout(tick, 8000);
    timer.current = setInterval(tick, 5 * 60 * 1000);
    return () => { clearTimeout(initial); clearInterval(timer.current); };
  }, [tick]);

  if (!visible) return null;

  const dismiss = () => setVisible(false);
  const snoozeToday = () => { localStorage.setItem(LS_SNOOZE, todayStr()); setVisible(false); };
  const viewAll = () => { setVisible(false); nav('/today'); };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-80 max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl
                    bg-[var(--bg-card)] border-[var(--border-color)] animate-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" style={{ color: '#e94560' }} />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {tasks.length} task{tasks.length > 1 ? 's' : ''} need attention
          </span>
        </div>
        <button onClick={dismiss} aria-label="Dismiss"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="max-h-56 overflow-auto px-4 py-2 space-y-1.5">
        {tasks.slice(0, 5).map((t, i) => (
          <li key={t.notification_id || t._id || i} className="text-sm text-[var(--text-secondary)] truncate">
            • {t.title || 'Task'}
          </li>
        ))}
        {tasks.length > 5 && (
          <li className="text-xs text-[var(--text-muted)]">+{tasks.length - 5} more</li>
        )}
      </ul>
      <div className="flex gap-2 px-4 py-3 border-t border-[var(--border-color)]">
        <button onClick={viewAll}
          className="h-8 px-3 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5"
          style={{ background: '#e94560' }}>
          <ListChecks className="h-3.5 w-3.5" /> View all
        </button>
        <button onClick={snoozeToday}
          className="h-8 px-3 rounded-lg text-xs font-semibold border border-[var(--border-color)] text-[var(--text-secondary)]">
          Snooze today
        </button>
      </div>
    </div>
  );
}
