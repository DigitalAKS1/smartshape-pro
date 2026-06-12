import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { teacherAuth } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Presentation, LogOut, Video, Trophy, Images } from 'lucide-react';

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('videos');

  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  useEffect(() => {
    teacherAuth.me()
      .then(r => setTeacher(r.data))
      .catch(err => { if ([401, 403].includes(err.response?.status)) navigate('/teacher/login'); })
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = () => {
    document.cookie = 'access_token=; path=/; max-age=0';
    navigate('/teacher/login');
  };

  if (loading) return <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>;

  const TABS = [
    { id: 'videos', label: 'My Videos', icon: Video },
    { id: 'competitions', label: 'Competitions', icon: Trophy },
    { id: 'gallery', label: 'Gallery', icon: Images },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Presentation className="h-6 w-6 text-[#e94560]" />
            <div>
              <h1 className={`text-lg font-bold ${textPri}`} data-testid="teacher-dashboard-title">{teacher?.name || 'Teacher'}</h1>
              <p className={`text-xs ${textMuted}`}>{teacher?.email}</p>
            </div>
          </div>
          <Button onClick={handleLogout} variant="ghost" size="sm" className={textSec} data-testid="teacher-logout-btn">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${activeTab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className={`${card} border rounded-md p-12 text-center`}>
          {activeTab === 'videos' && <><Video className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>Upload review &amp; workshop videos here — coming next.</p></>}
          {activeTab === 'competitions' && <><Trophy className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>Browse and enter competitions — coming next.</p></>}
          {activeTab === 'gallery' && <><Images className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>The central gallery of approved work — coming next.</p></>}
        </div>
      </div>
    </div>
  );
}
