import React, { useState, useEffect } from 'react';
import { portalTraining } from '../../lib/api';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { Calendar, Video, Users, MapPin, Clock, CheckCircle, ExternalLink, Play } from 'lucide-react';

const PLATFORM = {
  zoom: { label: 'Zoom', color: 'bg-blue-500/15 text-blue-400' },
  meet: { label: 'Google Meet', color: 'bg-green-500/15 text-green-400' },
  physical: { label: 'In person', color: 'bg-amber-500/15 text-amber-400' },
};

/**
 * Shared training/meetings panel for both the school and teacher portals.
 * Props:
 *   meetingsFetch — () => Promise<axios resp> returning this principal's 1:1 meetings
 */
export default function PortalTraining({ meetingsFetch }) {
  const [sessions, setSessions] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [videos, setVideos] = useState([]);
  const [busy, setBusy] = useState('');

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  const loadSessions = () => portalTraining.sessions().then(r => setSessions(r.data || [])).catch(() => {});
  useEffect(() => {
    loadSessions();
    portalTraining.videos().then(r => setVideos(r.data || [])).catch(() => {});
    if (meetingsFetch) meetingsFetch().then(r => setMeetings(r.data || [])).catch(() => {});
  }, [meetingsFetch]);

  const toggleRegister = async (s) => {
    setBusy(s.session_id);
    try {
      if (s.registered) { await portalTraining.unregister(s.session_id); }
      else { await portalTraining.register(s.session_id); toast.success('Registered — see you there!'); }
      await loadSessions();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBusy(''); }
  };

  const playVideo = (v) => { portalTraining.viewVideo(v.video_id).catch(() => {}); window.open(v.youtube_url, '_blank', 'noopener'); };

  return (
    <div className="space-y-6">
      {/* Upcoming meetings (private 1:1) */}
      {meetings.length > 0 && (
        <div>
          <h3 className={`text-sm font-medium ${textPri} mb-2 flex items-center gap-2`}><Users className="h-4 w-4" /> Your meetings</h3>
          <div className="space-y-2">
            {meetings.map(m => {
              const pf = PLATFORM[m.platform] || PLATFORM.zoom;
              return (
                <div key={m.meeting_id} className={`${card} border rounded-md p-4`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-sm font-medium ${textPri}`}>{m.title}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${pf.color}`}>{pf.label}</span>
                  </div>
                  {m.description && <p className={`text-sm ${textSec}`}>{m.description}</p>}
                  <div className={`flex items-center gap-3 text-xs ${textMuted} mt-1`}>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{m.scheduled_at}</span>
                    {m.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{m.location}</span>}
                  </div>
                  {m.meeting_link && <a href={m.meeting_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-xs text-[#e94560] hover:underline"><ExternalLink className="h-3 w-3" /> Join</a>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming training sessions */}
      <div>
        <h3 className={`text-sm font-medium ${textPri} mb-2 flex items-center gap-2`}><Calendar className="h-4 w-4" /> Upcoming training</h3>
        {sessions.length === 0 ? (
          <div className={`${card} border rounded-md p-8 text-center`}><Calendar className={`h-10 w-10 mx-auto mb-2 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No upcoming sessions</p></div>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => {
              const pf = PLATFORM[s.platform] || PLATFORM.zoom;
              return (
                <div key={s.session_id} className={`${card} border rounded-md p-4`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-sm font-medium ${textPri}`}>{s.title}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${pf.color}`}>{pf.label}</span>
                  </div>
                  {s.description && <p className={`text-sm ${textSec}`}>{s.description}</p>}
                  <div className={`flex flex-wrap items-center gap-3 text-xs ${textMuted} mt-1`}>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.date} {s.time}</span>
                    {s.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.location}</span>}
                    {Number(s.max_participants) > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.registration_count}/{s.max_participants}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" variant={s.registered ? 'outline' : 'default'} disabled={busy === s.session_id || (s.is_full && !s.registered)}
                      onClick={() => toggleRegister(s)}
                      className={s.registered ? '' : 'bg-[#e94560] hover:bg-[#f05c75] text-white'}>
                      {s.registered ? <><CheckCircle className="h-4 w-4 mr-1" /> Registered</> : s.is_full ? 'Full' : 'Register'}
                    </Button>
                    {s.registered && s.meeting_link && s.platform !== 'physical' && (
                      <a href={s.meeting_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#e94560] hover:underline"><ExternalLink className="h-3 w-3" /> Join</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Training videos library */}
      <div>
        <h3 className={`text-sm font-medium ${textPri} mb-2 flex items-center gap-2`}><Video className="h-4 w-4" /> How-to videos</h3>
        {videos.length === 0 ? (
          <div className={`${card} border rounded-md p-8 text-center`}><Video className={`h-10 w-10 mx-auto mb-2 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No videos yet</p></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {videos.map(v => (
              <button key={v.video_id} onClick={() => playVideo(v)} className={`${card} border rounded-md overflow-hidden text-left hover:border-[#e94560]/40 transition-all`}>
                <div className="relative">
                  {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full h-36 object-cover" /> : <div className="w-full h-36 bg-[var(--bg-hover)] flex items-center justify-center"><Video className={`h-8 w-8 ${textMuted}`} /></div>}
                  <span className="absolute inset-0 flex items-center justify-center"><Play className="h-9 w-9 text-white/90 drop-shadow" /></span>
                </div>
                <div className="p-3">
                  <p className={`text-sm font-medium ${textPri} truncate`}>{v.title}</p>
                  <p className={`text-xs ${textMuted}`}>{v.duration_mins ? `${v.duration_mins} min • ` : ''}{v.view_count || 0} views</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
