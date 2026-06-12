import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { teacherAuth, teacherVideos, portal, uploadVideoToCloudinary } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Presentation, LogOut, Video, Trophy, Images, Upload, Trash2, Clock, CheckCircle, XCircle, Bell } from 'lucide-react';

const STATUS = {
  pending: { color: 'bg-yellow-500/15 text-yellow-400', icon: Clock, label: 'Pending review' },
  approved: { color: 'bg-green-500/15 text-green-400', icon: CheckCircle, label: 'Approved' },
  rejected: { color: 'bg-red-500/15 text-red-400', icon: XCircle, label: 'Needs changes' },
};

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('videos');
  const [videos, setVideos] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [form, setForm] = useState({ type: 'review', title: '', description: '', machine_used: '', dies_used: '', competition_id: '', file: null });
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    teacherAuth.me().then(r => setTeacher(r.data))
      .catch(err => { if ([401, 403].includes(err.response?.status)) navigate('/teacher/login'); })
      .finally(() => setLoading(false));
  }, [navigate]);

  // Load competitions + notifications once (competitions are also needed for the upload dropdown).
  useEffect(() => {
    if (loading) return;
    portal.competitions().then(r => setCompetitions(r.data || [])).catch(() => {});
    teacherVideos.notifications().then(r => setNotifs(r.data || [])).catch(() => {});
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    if (activeTab === 'videos') teacherVideos.list().then(r => setVideos(r.data || [])).catch(() => {});
    if (activeTab === 'gallery') portal.gallery().then(r => setGallery(r.data || [])).catch(() => {});
  }, [activeTab, loading]);

  const handleLogout = () => { document.cookie = 'access_token=; path=/; max-age=0'; navigate('/teacher/login'); };

  const submitVideo = async () => {
    if (!form.file) return toast.error('Choose a video file');
    if (!form.title.trim()) return toast.error('Add a title');
    setUploading(true); setProgress(0);
    try {
      const cloudinary = await uploadVideoToCloudinary(form.file, setProgress);
      await teacherVideos.create({
        type: form.type, title: form.title, description: form.description,
        machine_used: form.machine_used, dies_used: form.dies_used,
        competition_id: form.type === 'competition' ? form.competition_id : undefined,
        cloudinary,
      });
      toast.success('Uploaded — pending review.');
      setForm({ type: 'review', title: '', description: '', machine_used: '', dies_used: '', competition_id: '', file: null });
      teacherVideos.list().then(r => setVideos(r.data || []));
    } catch (e) {
      toast.error(e.response?.data?.detail || (String(e.message || '').includes('Cloudinary') ? 'Video uploads need Cloudinary — ask your admin.' : 'Upload failed'));
    } finally { setUploading(false); setProgress(0); }
  };

  const removeVideo = async (id) => {
    try { await teacherVideos.remove(id); setVideos(v => v.filter(x => x.video_id !== id)); toast.success('Removed'); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  if (loading) return <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>;

  const TABS = [{ id: 'videos', label: 'My Videos', icon: Video }, { id: 'competitions', label: 'Competitions', icon: Trophy }, { id: 'gallery', label: 'Gallery', icon: Images }];
  const openComps = competitions.filter(c => ['open', 'upcoming'].includes(c.computed_status));

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="sticky top-0 z-40 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Presentation className="h-6 w-6 text-[#e94560]" />
            <div><h1 className={`text-lg font-bold ${textPri}`} data-testid="teacher-dashboard-title">{teacher?.name || 'Teacher'}</h1>
              <p className={`text-xs ${textMuted}`}>{teacher?.email}</p></div>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setShowNotifs(s => !s)} className={`relative p-2 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`}>
                <Bell className="h-5 w-5" />
                {notifs.some(n => !n.read) && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#e94560] rounded-full" />}
              </button>
              {showNotifs && (
                <div className={`absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto ${card} border rounded-md shadow-lg z-50 p-2`}>
                  {notifs.length === 0 ? <p className={`text-xs ${textMuted} p-3 text-center`}>No notifications</p> : notifs.map(n => (
                    <div key={n.notification_id} className="p-2 border-b border-[var(--border-color)] last:border-0">
                      <p className={`text-sm ${textPri}`}>{n.title}</p>
                      <p className={`text-xs ${textMuted}`}>{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={handleLogout} variant="ghost" size="sm" className={textSec} data-testid="teacher-logout-btn"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {TABS.map(t => { const Icon = t.icon; return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${activeTab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              <Icon className="h-4 w-4" /> {t.label}</button>); })}
        </div>

        {/* MY VIDEOS */}
        {activeTab === 'videos' && (
          <div className="space-y-4">
            <div className={`${card} border rounded-md p-4 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><Upload className="h-4 w-4" /> Upload a video</h3>
              <div className="grid grid-cols-2 gap-2">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={`h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="review">Review video</option>
                  <option value="workshop">Workshop video</option>
                  <option value="competition">Competition entry</option>
                </select>
                {form.type === 'competition' && (
                  <select value={form.competition_id} onChange={e => setForm({ ...form, competition_id: e.target.value })} className={`h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="">Select competition</option>
                    {openComps.map(c => <option key={c.competition_id} value={c.competition_id}>{c.title}</option>)}
                  </select>
                )}
              </div>
              <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
              <Input placeholder="What did you make / show? (description)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Machine used" value={form.machine_used} onChange={e => setForm({ ...form, machine_used: e.target.value })} className={inputCls} />
                <Input placeholder="Dies used" value={form.dies_used} onChange={e => setForm({ ...form, dies_used: e.target.value })} className={inputCls} />
              </div>
              <input type="file" accept="video/*" onChange={e => setForm({ ...form, file: e.target.files?.[0] })} className={`text-sm ${textSec}`} />
              {uploading && <div className="w-full h-2 rounded bg-[var(--bg-primary)] overflow-hidden"><div className="h-full bg-[#e94560]" style={{ width: `${progress}%` }} /></div>}
              <Button onClick={submitVideo} disabled={uploading} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                {uploading ? `Uploading… ${progress}%` : 'Upload'}
              </Button>
            </div>

            {videos.length === 0 ? (
              <div className={`${card} border rounded-md p-10 text-center`}><Video className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No videos yet</p></div>
            ) : videos.map(v => { const st = STATUS[v.status] || STATUS.pending; const Icon = st.icon; return (
              <div key={v.video_id} className={`${card} border rounded-md p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 min-w-0">
                    {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-20 h-14 object-cover rounded flex-shrink-0" /> : <div className="w-20 h-14 rounded bg-[var(--bg-hover)] flex items-center justify-center flex-shrink-0"><Video className={`h-5 w-5 ${textMuted}`} /></div>}
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${textPri} truncate`}>{v.title}</p>
                      <p className={`text-xs ${textMuted} capitalize`}>{v.type}{v.machine_used ? ` • ${v.machine_used}` : ''}</p>
                      <span className={`inline-flex items-center gap-1 mt-1 text-[10px] px-2 py-0.5 rounded-full ${st.color}`}><Icon className="h-3 w-3" /> {st.label}</span>
                      {v.status === 'rejected' && v.review_note && <p className="text-[10px] text-red-400 mt-1">{v.review_note}</p>}
                    </div>
                  </div>
                  {v.status !== 'approved' && <button onClick={() => removeVideo(v.video_id)} className={`p-2 rounded hover:bg-[var(--bg-hover)] ${textMuted}`}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            ); })}
          </div>
        )}

        {/* COMPETITIONS */}
        {activeTab === 'competitions' && (
          <div className="space-y-3">
            {competitions.length === 0 ? (
              <div className={`${card} border rounded-md p-10 text-center`}><Trophy className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No competitions yet</p></div>
            ) : competitions.map(c => (
              <div key={c.competition_id} className={`${card} border rounded-md p-4`}>
                <div className="flex items-center justify-between mb-1">
                  <p className={`font-medium ${textPri}`}>{c.title}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${c.computed_status === 'open' ? 'bg-green-500/15 text-green-400' : c.computed_status === 'results' ? 'bg-purple-500/15 text-purple-400' : 'bg-gray-500/15 text-gray-400'}`}>{c.computed_status}</span>
                </div>
                {c.theme && <p className={`text-xs ${textSec}`}>{c.theme}</p>}
                <p className={`text-xs ${textMuted} mt-1`}>{c.start_date} → {c.end_date}</p>
                {c.description && <p className={`text-sm ${textSec} mt-2`}>{c.description}</p>}
                {c.computed_status === 'open' && <p className="text-xs text-[#e94560] mt-2">Enter via the "My Videos" tab → upload type "Competition entry".</p>}
              </div>
            ))}
          </div>
        )}

        {/* GALLERY */}
        {activeTab === 'gallery' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {gallery.length === 0 ? (
              <div className={`${card} border rounded-md p-10 text-center col-span-full`}><Images className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No approved videos yet</p></div>
            ) : gallery.map(v => (
              <a key={v.video_id} href={v.video_url} target="_blank" rel="noopener noreferrer" className={`${card} border rounded-md overflow-hidden hover:border-[#e94560]/40 transition-all`}>
                {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full h-36 object-cover" /> : <div className="w-full h-36 bg-[var(--bg-hover)] flex items-center justify-center"><Video className={`h-8 w-8 ${textMuted}`} /></div>}
                <div className="p-3">
                  <p className={`text-sm font-medium ${textPri} truncate`}>{v.title}</p>
                  <p className={`text-xs ${textMuted}`}>{v.teacher_name}{v.machine_used ? ` • ${v.machine_used}` : ''}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
