import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { portalInbox } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Inbox, CheckCircle, RefreshCw, Video, Bell } from 'lucide-react';

function timeAgo(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function PortalInbox() {
  const navigate = useNavigate();
  const [data, setData] = useState({ notifications: [], requests: [], counts: {} });
  const [loading, setLoading] = useState(true);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  const load = () => { setLoading(true); portalInbox.get().then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const markRead = async (id) => { try { await portalInbox.markRead(id); load(); } catch {} };
  const markAllRead = async () => { try { await portalInbox.markAllRead(); toast.success('All marked read'); load(); } catch {} };
  const handleRequest = async (id) => { try { await portalInbox.updateRequest(id, 'handled'); toast.success('Marked handled'); load(); } catch (e) { toast.error('Failed'); } };

  const c = data.counts || {};

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-2xl font-semibold ${textPri} flex items-center gap-2`}><Inbox className="h-6 w-6" /> School Portal Inbox</h1>
            <p className={`text-sm ${textSec} mt-1`}>Everything schools and teachers submit from their portals.</p>
          </div>
          <Button onClick={load} variant="outline" size="sm"><RefreshCw className="h-4 w-4" /></Button>
        </div>

        {/* counts */}
        <div className="grid grid-cols-3 gap-3">
          <div className={`${card} border rounded-md p-4 text-center`}><div className="text-2xl font-mono font-bold text-[#e94560]">{c.open_requests || 0}</div><p className={`text-xs ${textMuted}`}>Open requests</p></div>
          <div className={`${card} border rounded-md p-4 text-center`}><div className="text-2xl font-mono font-bold text-yellow-400">{c.unread || 0}</div><p className={`text-xs ${textMuted}`}>Unread activity</p></div>
          <button onClick={() => navigate('/teacher-review')} className={`${card} border rounded-md p-4 text-center hover:border-[#e94560]/40`}>
            <div className="text-2xl font-mono font-bold text-purple-400">{c.pending_videos || 0}</div><p className={`text-xs ${textMuted}`}>Videos to review →</p>
          </button>
        </div>

        {/* Reorder / new-quote requests */}
        <div>
          <h2 className={`text-sm font-medium ${textPri} mb-2 flex items-center gap-2`}><RefreshCw className="h-4 w-4" /> Reorder / quote requests</h2>
          {loading ? <p className={textMuted}>Loading…</p> : (data.requests || []).length === 0 ? (
            <div className={`${card} border rounded-md p-8 text-center`}><p className={textMuted}>No open requests</p></div>
          ) : data.requests.map(r => (
            <div key={r.request_id} className={`${card} border rounded-md p-4 mb-2`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-sm font-medium ${textPri}`}>{r.school_name || 'School'}</p>
                  <p className={`text-sm ${textSec}`}>{r.message || '(no message)'}</p>
                  <p className={`text-[10px] ${textMuted} mt-1`}>{timeAgo(r.created_at)}</p>
                </div>
                <Button onClick={() => handleRequest(r.request_id)} size="sm" className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle className="h-4 w-4 mr-1" /> Handled</Button>
              </div>
            </div>
          ))}
        </div>

        {/* Activity feed */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><Bell className="h-4 w-4" /> Activity</h2>
            {(data.notifications || []).some(n => !n.read) && <button onClick={markAllRead} className="text-xs text-[#e94560] hover:underline">Mark all read</button>}
          </div>
          {loading ? <p className={textMuted}>Loading…</p> : (data.notifications || []).length === 0 ? (
            <div className={`${card} border rounded-md p-8 text-center`}><p className={textMuted}>No activity yet</p></div>
          ) : data.notifications.map(n => (
            <div key={n.notification_id} className={`${card} border rounded-md p-3 mb-2 flex items-start justify-between gap-3 ${!n.read ? 'border-l-2 border-l-[#e94560]' : ''}`}>
              <div className="flex items-start gap-2">
                {n.type === 'teacher_video' ? <Video className="h-4 w-4 text-purple-400 mt-0.5" /> : <Bell className="h-4 w-4 text-[#e94560] mt-0.5" />}
                <div>
                  <p className={`text-sm ${textPri}`}>{n.title}</p>
                  <p className={`text-[10px] ${textMuted}`}>{timeAgo(n.created_at)}</p>
                </div>
              </div>
              {!n.read && <button onClick={() => markRead(n.notification_id)} className={`text-xs ${textMuted} hover:text-[#e94560]`}>mark read</button>}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
