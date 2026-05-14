import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import API from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, Trash2, Edit2, Send, Users, Video, Tag,
  Megaphone, Calendar, CheckCircle2, Clock, Globe,
  MapPin, Eye, EyeOff, Loader2
} from 'lucide-react';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

const VIDEO_CATEGORIES = [
  { value: 'product_training', label: 'Product Training' },
  { value: 'usage_tips', label: 'Usage Tips' },
  { value: 'demo', label: 'Demo' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'other', label: 'Other' },
];

const PROMO_TYPES = [
  { value: 'discount', label: 'Discount' },
  { value: 'bundle', label: 'Bundle Deal' },
  { value: 'scheme', label: 'Scheme' },
];

const ANN_TYPES = [
  { value: 'new_die', label: 'New Die / Product' },
  { value: 'new_feature', label: 'New Feature' },
  { value: 'news', label: 'General News' },
];

const PLATFORMS = [
  { value: 'zoom', label: 'Zoom' },
  { value: 'meet', label: 'Google Meet' },
  { value: 'physical', label: 'Physical' },
  { value: 'teams', label: 'MS Teams' },
];

export default function CustomerEngagement() {
  const [tab, setTab] = useState('sessions');

  // ── Sessions ──────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [sessDialog, setSessDialog] = useState(false);
  const [editSess, setEditSess] = useState(null);
  const [sessForm, setSessForm] = useState({ title: '', description: '', date: '', time: '', platform: 'zoom', meeting_link: '', location: '', max_participants: 0, is_published: true });
  const [sessRegs, setSessRegs] = useState({ open: false, session: null, list: [] });
  const [notifying, setNotifying] = useState({});

  // ── Videos ────────────────────────────────────────────────────────────────
  const [videos, setVideos] = useState([]);
  const [vidDialog, setVidDialog] = useState(false);
  const [editVid, setEditVid] = useState(null);
  const [vidForm, setVidForm] = useState({ title: '', description: '', youtube_url: '', duration_mins: 0, category: 'product_training', is_published: true });

  // ── Promotions ────────────────────────────────────────────────────────────
  const [promos, setPromos] = useState([]);
  const [promoDialog, setPromoDialog] = useState(false);
  const [editPromo, setEditPromo] = useState(null);
  const [promoForm, setPromoForm] = useState({ title: '', description: '', promo_type: 'discount', details: '', valid_from: '', valid_until: '', cta_text: '', cta_url: '', is_active: true });

  // ── Announcements ─────────────────────────────────────────────────────────
  const [anns, setAnns] = useState([]);
  const [annDialog, setAnnDialog] = useState(false);
  const [editAnn, setEditAnn] = useState(null);
  const [annForm, setAnnForm] = useState({ title: '', body: '', type: 'news', image_url: '', is_published: true });

  // Shared
  const [saving, setSaving] = useState(false);

  // Design tokens
  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
  const inp = 'w-full h-9 px-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlg = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === 'sessions')      fetchSessions();
    if (tab === 'videos')        fetchVideos();
    if (tab === 'promotions')    fetchPromos();
    if (tab === 'announcements') fetchAnns();
  }, [tab]);

  const fetchSessions = async () => { try { const r = await API.get('/training/sessions'); setSessions(r.data); } catch { toast.error('Failed to load sessions'); } };
  const fetchVideos   = async () => { try { const r = await API.get('/training/videos');   setVideos(r.data);   } catch { toast.error('Failed to load videos');   } };
  const fetchPromos   = async () => { try { const r = await API.get('/promotions');         setPromos(r.data);   } catch { toast.error('Failed to load promotions'); } };
  const fetchAnns     = async () => { try { const r = await API.get('/announcements');      setAnns(r.data);     } catch { toast.error('Failed to load announcements'); } };

  // ── Sessions CRUD ─────────────────────────────────────────────────────────
  const openNewSess = () => { setEditSess(null); setSessForm({ title: '', description: '', date: '', time: '', platform: 'zoom', meeting_link: '', location: '', max_participants: 0, is_published: true }); setSessDialog(true); };
  const openEditSess = (s) => { setEditSess(s); setSessForm({ title: s.title, description: s.description || '', date: s.date, time: s.time, platform: s.platform, meeting_link: s.meeting_link || '', location: s.location || '', max_participants: s.max_participants || 0, is_published: s.is_published }); setSessDialog(true); };
  const saveSess = async () => {
    if (!sessForm.title || !sessForm.date) { toast.error('Title and date are required'); return; }
    setSaving(true);
    try {
      if (editSess) { await API.put(`/training/sessions/${editSess.session_id}`, sessForm); toast.success('Session updated'); }
      else { await API.post('/training/sessions', sessForm); toast.success('Session created'); }
      setSessDialog(false); fetchSessions();
    } catch { toast.error('Failed to save session'); } finally { setSaving(false); }
  };
  const deleteSess = async (id) => {
    if (!window.confirm('Delete this session?')) return;
    try { await API.delete(`/training/sessions/${id}`); fetchSessions(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };
  const viewRegs = async (s) => {
    try { const r = await API.get(`/training/sessions/${s.session_id}/registrations`); setSessRegs({ open: true, session: s, list: r.data }); } catch { toast.error('Failed to load registrations'); }
  };
  const notifySession = async (id) => {
    setNotifying(p => ({ ...p, [id]: true }));
    try { const r = await API.post(`/training/sessions/${id}/notify`); toast.success(`Notified ${r.data.sent} customers`); } catch { toast.error('Notification failed'); } finally { setNotifying(p => ({ ...p, [id]: false })); }
  };

  // ── Videos CRUD ──────────────────────────────────────────────────────────
  const openNewVid = () => { setEditVid(null); setVidForm({ title: '', description: '', youtube_url: '', duration_mins: 0, category: 'product_training', is_published: true }); setVidDialog(true); };
  const openEditVid = (v) => { setEditVid(v); setVidForm({ title: v.title, description: v.description || '', youtube_url: v.youtube_url || '', duration_mins: v.duration_mins || 0, category: v.category || 'product_training', is_published: v.is_published }); setVidDialog(true); };
  const saveVid = async () => {
    if (!vidForm.title || !vidForm.youtube_url) { toast.error('Title and YouTube URL required'); return; }
    setSaving(true);
    try {
      if (editVid) { await API.put(`/training/videos/${editVid.video_id}`, vidForm); toast.success('Video updated'); }
      else { await API.post('/training/videos', vidForm); toast.success('Video added'); }
      setVidDialog(false); fetchVideos();
    } catch { toast.error('Failed to save video'); } finally { setSaving(false); }
  };
  const deleteVid = async (id) => {
    if (!window.confirm('Delete this video?')) return;
    try { await API.delete(`/training/videos/${id}`); fetchVideos(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };

  // ── Promotions CRUD ───────────────────────────────────────────────────────
  const openNewPromo = () => { setEditPromo(null); setPromoForm({ title: '', description: '', promo_type: 'discount', details: '', valid_from: '', valid_until: '', cta_text: '', cta_url: '', is_active: true }); setPromoDialog(true); };
  const openEditPromo = (p) => { setEditPromo(p); setPromoForm({ title: p.title, description: p.description || '', promo_type: p.promo_type || 'discount', details: p.details || '', valid_from: p.valid_from || '', valid_until: p.valid_until || '', cta_text: p.cta_text || '', cta_url: p.cta_url || '', is_active: p.is_active }); setPromoDialog(true); };
  const savePromo = async () => {
    if (!promoForm.title) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      if (editPromo) { await API.put(`/promotions/${editPromo.promo_id}`, promoForm); toast.success('Promotion updated'); }
      else { await API.post('/promotions', promoForm); toast.success('Promotion created'); }
      setPromoDialog(false); fetchPromos();
    } catch { toast.error('Failed to save promotion'); } finally { setSaving(false); }
  };
  const deletePromo = async (id) => {
    if (!window.confirm('Delete this promotion?')) return;
    try { await API.delete(`/promotions/${id}`); fetchPromos(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };
  const notifyPromo = async (id) => {
    setNotifying(p => ({ ...p, [id]: true }));
    try { const r = await API.post(`/promotions/${id}/notify`); toast.success(`Notified ${r.data.sent} customers`); } catch { toast.error('Notification failed'); } finally { setNotifying(p => ({ ...p, [id]: false })); }
  };

  // ── Announcements CRUD ────────────────────────────────────────────────────
  const openNewAnn = () => { setEditAnn(null); setAnnForm({ title: '', body: '', type: 'news', image_url: '', is_published: true }); setAnnDialog(true); };
  const openEditAnn = (a) => { setEditAnn(a); setAnnForm({ title: a.title, body: a.body || '', type: a.type || 'news', image_url: a.image_url || '', is_published: a.is_published }); setAnnDialog(true); };
  const saveAnn = async () => {
    if (!annForm.title) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      if (editAnn) { await API.put(`/announcements/${editAnn.announcement_id}`, annForm); toast.success('Announcement updated'); }
      else { await API.post('/announcements', annForm); toast.success('Announcement created'); }
      setAnnDialog(false); fetchAnns();
    } catch { toast.error('Failed to save announcement'); } finally { setSaving(false); }
  };
  const deleteAnn = async (id) => {
    if (!window.confirm('Delete this announcement?')) return;
    try { await API.delete(`/announcements/${id}`); fetchAnns(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };
  const notifyAnn = async (id) => {
    setNotifying(p => ({ ...p, [id]: true }));
    try { const r = await API.post(`/announcements/${id}/notify`); toast.success(`Notified ${r.data.sent} customers`); } catch { toast.error('Notification failed'); } finally { setNotifying(p => ({ ...p, [id]: false })); }
  };

  const TABS = [
    { id: 'sessions',      label: 'Training Sessions', icon: Calendar },
    { id: 'videos',        label: 'Video Library',     icon: Video },
    { id: 'promotions',    label: 'Offers & Promos',   icon: Tag },
    { id: 'announcements', label: 'Announcements',     icon: Megaphone },
  ];

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className={`text-xl font-bold ${textPri}`}>Customer Engagement</h1>
          <p className={`text-sm ${textMuted} mt-0.5`}>Manage training, offers, and announcements for your customers</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-1 mb-6 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-1 justify-center ${tab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-primary)]`}`}>
                <Icon className="h-4 w-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* ── SESSIONS TAB ─────────────────────────────────────────────────── */}
        {tab === 'sessions' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={openNewSess} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Session
              </Button>
            </div>
            <div className="space-y-3">
              {sessions.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No sessions yet. Create your first training session.</p>}
              {sessions.map(s => (
                <div key={s.session_id} className={`${card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-semibold ${textPri}`}>{s.title}</span>
                        {!s.is_published && <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">Draft</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize ${s.status === 'upcoming' ? 'bg-green-500/20 text-green-400' : s.status === 'completed' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{s.status}</span>
                      </div>
                      <div className={`flex items-center gap-3 mt-1 text-sm ${textSec} flex-wrap`}>
                        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{s.date} {s.time}</span>
                        <span className="flex items-center gap-1">{s.platform === 'physical' ? <MapPin className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}{s.platform.toUpperCase()}</span>
                        {s.max_participants > 0 && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{s.registration_count || 0}/{s.max_participants}</span>}
                      </div>
                      {s.description && <p className={`text-xs ${textMuted} mt-1 line-clamp-2`}>{s.description}</p>}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => viewRegs(s)} className={`border-[var(--border-color)] ${textSec} text-xs h-8`}>
                        <Users className="mr-1 h-3 w-3" />{s.registration_count || 0}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => notifySession(s.session_id)} disabled={notifying[s.session_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {notifying[s.session_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditSess(s)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteSess(s.session_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Session Dialog */}
            <Dialog open={sessDialog} onOpenChange={setSessDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{editSess ? 'Edit Session' : 'New Training Session'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={sessForm.title} onChange={e => setSessForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Die Usage Workshop" /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><textarea className={`${inp} h-20 resize-none py-2`} value={sessForm.description} onChange={e => setSessForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Date *</label><input type="date" className={inp} value={sessForm.date} onChange={e => setSessForm(p => ({ ...p, date: e.target.value }))} /></div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Time</label><input type="time" className={inp} value={sessForm.time} onChange={e => setSessForm(p => ({ ...p, time: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Platform</label>
                      <select className={inp} value={sessForm.platform} onChange={e => setSessForm(p => ({ ...p, platform: e.target.value }))}>
                        {PLATFORMS.map(pl => <option key={pl.value} value={pl.value}>{pl.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Max Participants (0 = unlimited)</label><input type="number" className={inp} value={sessForm.max_participants} onChange={e => setSessForm(p => ({ ...p, max_participants: +e.target.value }))} /></div>
                  </div>
                  {sessForm.platform !== 'physical'
                    ? <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Meeting Link</label><input className={inp} value={sessForm.meeting_link} onChange={e => setSessForm(p => ({ ...p, meeting_link: e.target.value }))} placeholder="https://zoom.us/j/..." /></div>
                    : <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Location / Venue</label><input className={inp} value={sessForm.location} onChange={e => setSessForm(p => ({ ...p, location: e.target.value }))} /></div>
                  }
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={sessForm.is_published} onChange={e => setSessForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setSessDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={saveSess} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Registrations Dialog */}
            <Dialog open={sessRegs.open} onOpenChange={o => setSessRegs(p => ({ ...p, open: o }))}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>Registrations — {sessRegs.session?.title}</DialogTitle></DialogHeader>
                <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
                  {sessRegs.list.length === 0 && <p className={`text-center py-8 ${textMuted}`}>No registrations yet</p>}
                  {sessRegs.list.map((r, i) => (
                    <div key={r.reg_id || i} className={`flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]`}>
                      <div>
                        <p className={`text-sm font-medium ${textPri}`}>{r.school_name}</p>
                        <p className={`text-xs ${textMuted}`}>{r.contact_name} · {r.contact_email}</p>
                      </div>
                      <p className={`text-[10px] ${textMuted}`}>{r.registered_at?.slice(0, 10)}</p>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ── VIDEOS TAB ───────────────────────────────────────────────────── */}
        {tab === 'videos' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={openNewVid} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />Add Video
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.length === 0 && <p className={`col-span-3 text-center py-12 ${textMuted}`}>No videos yet. Add your first training video.</p>}
              {videos.map(v => (
                <div key={v.video_id} className={`${card} rounded-xl overflow-hidden`}>
                  <div className="relative aspect-video bg-[var(--bg-primary)]">
                    {v.thumbnail_url
                      ? <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Video className="h-10 w-10 text-[var(--text-muted)]" /></div>
                    }
                    {!v.is_published && (
                      <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-yellow-500/90 text-black font-bold">DRAFT</span>
                    )}
                    <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">{v.duration_mins ? `${v.duration_mins} min` : ''}</span>
                  </div>
                  <div className="p-3">
                    <p className={`font-medium text-sm ${textPri} line-clamp-1`}>{v.title}</p>
                    <p className={`text-[10px] ${textMuted} mt-0.5 capitalize`}>{v.category?.replace(/_/g, ' ')}</p>
                    {v.description && <p className={`text-xs ${textSec} mt-1 line-clamp-2`}>{v.description}</p>}
                    <div className={`flex items-center gap-1 mt-1 text-[10px] ${textMuted}`}>
                      <Eye className="h-3 w-3" />{v.view_count || 0} views
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 px-3 pb-3`}>
                    <Button size="sm" variant="ghost" onClick={() => openEditVid(v)} className={`${textSec} h-7 px-2 text-xs`}><Edit2 className="mr-1 h-3 w-3" />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteVid(v.video_id)} className="text-red-400 h-7 px-2 text-xs"><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Video Dialog */}
            <Dialog open={vidDialog} onOpenChange={setVidDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{editVid ? 'Edit Video' : 'Add Training Video'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={vidForm.title} onChange={e => setVidForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>YouTube URL *</label><input className={inp} value={vidForm.youtube_url} onChange={e => setVidForm(p => ({ ...p, youtube_url: e.target.value }))} placeholder="https://youtube.com/watch?v=..." /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><textarea className={`${inp} h-16 resize-none py-2`} value={vidForm.description} onChange={e => setVidForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Category</label>
                      <select className={inp} value={vidForm.category} onChange={e => setVidForm(p => ({ ...p, category: e.target.value }))}>
                        {VIDEO_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Duration (mins)</label><input type="number" className={inp} value={vidForm.duration_mins} onChange={e => setVidForm(p => ({ ...p, duration_mins: +e.target.value }))} /></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={vidForm.is_published} onChange={e => setVidForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setVidDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={saveVid} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ── PROMOTIONS TAB ───────────────────────────────────────────────── */}
        {tab === 'promotions' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={openNewPromo} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Offer
              </Button>
            </div>
            <div className="space-y-3">
              {promos.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No promotions yet. Create your first offer.</p>}
              {promos.map(p => (
                <div key={p.promo_id} className={`${card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-semibold ${textPri}`}>{p.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize ${p.is_active ? 'bg-green-500/20 text-green-400' : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium capitalize`}>{p.promo_type}</span>
                      </div>
                      <p className={`text-sm ${textSec} mt-0.5`}>{p.description}</p>
                      {(p.valid_from || p.valid_until) && <p className={`text-xs ${textMuted} mt-1`}>Valid: {p.valid_from} → {p.valid_until}</p>}
                      {p.details && <p className={`text-xs ${textSec} mt-1 line-clamp-2`}>{p.details}</p>}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => notifyPromo(p.promo_id)} disabled={notifying[p.promo_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {notifying[p.promo_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Notify</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditPromo(p)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deletePromo(p.promo_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Promo Dialog */}
            <Dialog open={promoDialog} onOpenChange={setPromoDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{editPromo ? 'Edit Promotion' : 'New Promotion / Offer'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={promoForm.title} onChange={e => setPromoForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Festival Discount 20%" /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><input className={inp} value={promoForm.description} onChange={e => setPromoForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Details</label><textarea className={`${inp} h-16 resize-none py-2`} value={promoForm.details} onChange={e => setPromoForm(p => ({ ...p, details: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Type</label>
                      <select className={inp} value={promoForm.promo_type} onChange={e => setPromoForm(p => ({ ...p, promo_type: e.target.value }))}>
                        {PROMO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>CTA Button Text</label><input className={inp} value={promoForm.cta_text} onChange={e => setPromoForm(p => ({ ...p, cta_text: e.target.value }))} placeholder="e.g. Claim Now" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Valid From</label><input type="date" className={inp} value={promoForm.valid_from} onChange={e => setPromoForm(p => ({ ...p, valid_from: e.target.value }))} /></div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Valid Until</label><input type="date" className={inp} value={promoForm.valid_until} onChange={e => setPromoForm(p => ({ ...p, valid_until: e.target.value }))} /></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={promoForm.is_active} onChange={e => setPromoForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Active (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setPromoDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={savePromo} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ── ANNOUNCEMENTS TAB ─────────────────────────────────────────────── */}
        {tab === 'announcements' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={openNewAnn} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Announcement
              </Button>
            </div>
            <div className="space-y-3">
              {anns.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No announcements yet.</p>}
              {anns.map(a => (
                <div key={a.announcement_id} className={`${card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-semibold ${textPri}`}>{a.title}</span>
                        {!a.is_published && <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">Draft</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium capitalize`}>{a.type?.replace(/_/g, ' ')}</span>
                        {a.notify_sent && <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Sent to {a.notify_count}</span>}
                      </div>
                      {a.body && <p className={`text-sm ${textSec} mt-1 line-clamp-2`}>{a.body}</p>}
                      <p className={`text-[10px] ${textMuted} mt-1`}>{a.published_at?.slice(0, 10)}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => notifyAnn(a.announcement_id)} disabled={notifying[a.announcement_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {notifying[a.announcement_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Notify All</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditAnn(a)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteAnn(a.announcement_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Ann Dialog */}
            <Dialog open={annDialog} onOpenChange={setAnnDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{editAnn ? 'Edit Announcement' : 'New Announcement'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={annForm.title} onChange={e => setAnnForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Introducing New Die Series" /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Body</label><textarea className={`${inp} h-24 resize-none py-2`} value={annForm.body} onChange={e => setAnnForm(p => ({ ...p, body: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Type</label>
                    <select className={inp} value={annForm.type} onChange={e => setAnnForm(p => ({ ...p, type: e.target.value }))}>
                      {ANN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Image URL (optional)</label><input className={inp} value={annForm.image_url} onChange={e => setAnnForm(p => ({ ...p, image_url: e.target.value }))} placeholder="https://..." /></div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={annForm.is_published} onChange={e => setAnnForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish immediately (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setAnnDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={saveAnn} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
