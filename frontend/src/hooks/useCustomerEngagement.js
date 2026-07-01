import { useState, useEffect } from 'react';
import API, { zoomApi } from '../lib/api';
import { toast } from 'sonner';

export function useCustomerEngagement() {
  const [tab, setTab] = useState('sessions');

  // ── Sessions ──────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [sessDialog, setSessDialog] = useState(false);
  const [editSess, setEditSess] = useState(null);
  const [sessForm, setSessForm] = useState({
    title: '', description: '', date: '', time: '',
    platform: 'zoom', meeting_link: '', location: '',
    max_participants: 0, is_published: true,
  });
  const [sessRegs, setSessRegs] = useState({ open: false, session: null, list: [] });

  // ── Videos ────────────────────────────────────────────────────────────────
  const [videos, setVideos] = useState([]);
  const [vidDialog, setVidDialog] = useState(false);
  const [editVid, setEditVid] = useState(null);
  const [vidForm, setVidForm] = useState({
    title: '', description: '', youtube_url: '',
    duration_mins: 0, category: 'product_training', is_published: true,
  });

  // ── Promotions ────────────────────────────────────────────────────────────
  const [promos, setPromos] = useState([]);
  const [promoDialog, setPromoDialog] = useState(false);
  const [editPromo, setEditPromo] = useState(null);
  const [promoForm, setPromoForm] = useState({
    title: '', description: '', promo_type: 'discount', details: '',
    valid_from: '', valid_until: '', cta_text: '', cta_url: '', is_active: true,
  });

  // ── Announcements ─────────────────────────────────────────────────────────
  const [anns, setAnns] = useState([]);
  const [annDialog, setAnnDialog] = useState(false);
  const [editAnn, setEditAnn] = useState(null);
  const [annForm, setAnnForm] = useState({
    title: '', body: '', type: 'news', image_url: '', is_published: true,
  });

  // Shared
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState({});

  // ── Email composer ───────────────────────────────────────────────────────
  const [composer, setComposer] = useState({ open: false, source: '', sourceId: '', subject: '', html: '' });
  const openComposerForSession = (s) => setComposer({ open: true, source: 'training_session', sourceId: s.session_id,
    subject: `Training Session: ${s.title}`,
    html: `<h2 style="color:#e94560">${s.title}</h2>`
        + `<p><strong>Date:</strong> ${s.date}${s.time ? ' ' + s.time : ''}</p>`
        + (s.description ? `<p>${s.description}</p>` : '')
        + (s.meeting_link ? `<p><a href="${s.meeting_link}">Join the session</a></p>` : (s.location ? `<p><strong>Location:</strong> ${s.location}</p>` : ''))
        + `<p>Dear {name}, you're invited to this SmartShape training session.</p>` });
  const openComposerForPromo = (p) => setComposer({ open: true, source: 'promo', sourceId: p.promo_id,
    subject: p.title || 'Special Offer from SmartShape',
    html: `<h2 style="color:#e94560">${p.title || ''}</h2>` + (p.description ? `<p>${p.description}</p>` : '') + (p.details ? `<p>${p.details}</p>` : '') + `<p>Dear {name}, here's an offer for {school_name}.</p>` });
  const openComposerForAnn = (a) => setComposer({ open: true, source: 'announcement', sourceId: a.announcement_id,
    subject: a.title || 'Announcement from SmartShape',
    html: `<h2 style="color:#e94560">${a.title || ''}</h2>` + (a.body ? `<p>${a.body}</p>` : '') + (a.image_url ? `<p><img src="${a.image_url}" alt="" style="max-width:100%"/></p>` : '') + `<p>Dear {name},</p>` });

  useEffect(() => {
    if (tab === 'sessions')      fetchSessions();
    if (tab === 'videos')        fetchVideos();
    if (tab === 'promotions')    fetchPromos();
    if (tab === 'announcements') fetchAnns();
  }, [tab]); // eslint-disable-line

  const fetchSessions = async () => { try { const r = await API.get('/training/sessions'); setSessions(r.data); } catch { toast.error('Failed to load sessions'); } };
  const fetchVideos   = async () => { try { const r = await API.get('/training/videos');   setVideos(r.data);   } catch { toast.error('Failed to load videos');   } };
  const fetchPromos   = async () => { try { const r = await API.get('/promotions');         setPromos(r.data);   } catch { toast.error('Failed to load promotions'); } };
  const fetchAnns     = async () => { try { const r = await API.get('/announcements');      setAnns(r.data);     } catch { toast.error('Failed to load announcements'); } };

  // ── Sessions CRUD ─────────────────────────────────────────────────────────
  const openNewSess = () => {
    setEditSess(null);
    setSessForm({ title: '', description: '', date: '', time: '', platform: 'zoom', meeting_link: '', location: '', max_participants: 0, is_published: true });
    setSessDialog(true);
  };
  const openEditSess = (s) => {
    setEditSess(s);
    setSessForm({ title: s.title, description: s.description || '', date: s.date, time: s.time, platform: s.platform, meeting_link: s.meeting_link || '', location: s.location || '', max_participants: s.max_participants || 0, is_published: s.is_published });
    setSessDialog(true);
  };
  const saveSess = async () => {
    if (!sessForm.title || !sessForm.date) { toast.error('Title and date are required'); return; }
    setSaving(true);
    try {
      if (editSess) { await API.put(`/training/sessions/${editSess.session_id}`, sessForm); toast.success('Session updated'); }
      else { await API.post('/training/sessions', sessForm); toast.success('Session created'); }
      setSessDialog(false); fetchSessions();
    } catch { toast.error('Failed to save session'); } finally { setSaving(false); }
  };
  const [genningZoom, setGenningZoom] = useState(false);
  const genSessZoom = async () => {
    if (!sessForm.title || !sessForm.date) { toast.error('Title and date are required first'); return; }
    setGenningZoom(true);
    try {
      const start = `${sessForm.date}T${sessForm.time || '10:00'}:00`;
      const r = await zoomApi.createMeeting({ topic: sessForm.title, start_time: start, duration: 60 });
      setSessForm(p => ({ ...p, meeting_link: r.data.join_url || '' }));
      toast.success('Zoom meeting created');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create Zoom meeting (check Zoom setup / scope)');
    } finally { setGenningZoom(false); }
  };
  const deleteSess = async (id) => {
    if (!window.confirm('Delete this session?')) return;
    try { await API.delete(`/training/sessions/${id}`); fetchSessions(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };
  const viewRegs = async (s) => {
    try { const r = await API.get(`/training/sessions/${s.session_id}/registrations`); setSessRegs({ open: true, session: s, list: r.data }); } catch { toast.error('Failed to load registrations'); }
  };
  // ── Videos CRUD ──────────────────────────────────────────────────────────
  const openNewVid = () => {
    setEditVid(null);
    setVidForm({ title: '', description: '', youtube_url: '', duration_mins: 0, category: 'product_training', is_published: true });
    setVidDialog(true);
  };
  const openEditVid = (v) => {
    setEditVid(v);
    setVidForm({ title: v.title, description: v.description || '', youtube_url: v.youtube_url || '', duration_mins: v.duration_mins || 0, category: v.category || 'product_training', is_published: v.is_published });
    setVidDialog(true);
  };
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
  const openNewPromo = () => {
    setEditPromo(null);
    setPromoForm({ title: '', description: '', promo_type: 'discount', details: '', valid_from: '', valid_until: '', cta_text: '', cta_url: '', is_active: true });
    setPromoDialog(true);
  };
  const openEditPromo = (p) => {
    setEditPromo(p);
    setPromoForm({ title: p.title, description: p.description || '', promo_type: p.promo_type || 'discount', details: p.details || '', valid_from: p.valid_from || '', valid_until: p.valid_until || '', cta_text: p.cta_text || '', cta_url: p.cta_url || '', is_active: p.is_active });
    setPromoDialog(true);
  };
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
  // ── Announcements CRUD ────────────────────────────────────────────────────
  const openNewAnn = () => {
    setEditAnn(null);
    setAnnForm({ title: '', body: '', type: 'news', image_url: '', is_published: true });
    setAnnDialog(true);
  };
  const openEditAnn = (a) => {
    setEditAnn(a);
    setAnnForm({ title: a.title, body: a.body || '', type: a.type || 'news', image_url: a.image_url || '', is_published: a.is_published });
    setAnnDialog(true);
  };
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
  return {
    tab, setTab,
    // sessions
    sessions, sessDialog, setSessDialog, editSess, sessForm, setSessForm, sessRegs, setSessRegs,
    openNewSess, openEditSess, saveSess, deleteSess, viewRegs,
    genSessZoom, genningZoom,
    // videos
    videos, vidDialog, setVidDialog, editVid, vidForm, setVidForm,
    openNewVid, openEditVid, saveVid, deleteVid,
    // promos
    promos, promoDialog, setPromoDialog, editPromo, promoForm, setPromoForm,
    openNewPromo, openEditPromo, savePromo, deletePromo,
    // announcements
    anns, annDialog, setAnnDialog, editAnn, annForm, setAnnForm,
    openNewAnn, openEditAnn, saveAnn, deleteAnn,
    // shared
    saving, notifying,
    // email composer
    composer, setComposer, openComposerForSession, openComposerForPromo, openComposerForAnn,
  };
}
