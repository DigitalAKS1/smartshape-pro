import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  Plus, Trash2, Edit2, Send, Users, Video, Tag,
  Megaphone, Calendar, CheckCircle2, Globe,
  MapPin, Eye, Loader2,
} from 'lucide-react';
import { useCustomerEngagement } from '../../hooks/useCustomerEngagement';

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

const TABS = [
  { id: 'sessions',      label: 'Training Sessions', icon: Calendar },
  { id: 'videos',        label: 'Video Library',     icon: Video },
  { id: 'promotions',    label: 'Offers & Promos',   icon: Tag },
  { id: 'announcements', label: 'Announcements',     icon: Megaphone },
];

export default function CustomerEngagement() {
  const hook = useCustomerEngagement();

  const card     = 'bg-[var(--bg-card)] border border-[var(--border-color)]';
  const inp      = 'w-full h-9 px-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]';
  const textPri  = 'text-[var(--text-primary)]';
  const textSec  = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlg      = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

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
              <button key={t.id} onClick={() => hook.setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-1 justify-center ${
                  hook.tab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-primary)]`
                }`}>
                <Icon className="h-4 w-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* ── SESSIONS TAB ── */}
        {hook.tab === 'sessions' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={hook.openNewSess} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Session
              </Button>
            </div>
            <div className="space-y-3">
              {hook.sessions.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No sessions yet. Create your first training session.</p>}
              {hook.sessions.map(s => (
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
                      <Button size="sm" variant="outline" onClick={() => hook.viewRegs(s)} className={`border-[var(--border-color)] ${textSec} text-xs h-8`}><Users className="mr-1 h-3 w-3" />{s.registration_count || 0}</Button>
                      <Button size="sm" variant="outline" onClick={() => hook.notifySession(s.session_id)} disabled={hook.notifying[s.session_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {hook.notifying[s.session_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.openEditSess(s)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.deleteSess(s.session_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={hook.sessDialog} onOpenChange={hook.setSessDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{hook.editSess ? 'Edit Session' : 'New Training Session'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={hook.sessForm.title} onChange={e => hook.setSessForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Die Usage Workshop" /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><textarea className={`${inp} h-20 resize-none py-2`} value={hook.sessForm.description} onChange={e => hook.setSessForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Date *</label><input type="date" className={inp} value={hook.sessForm.date} onChange={e => hook.setSessForm(p => ({ ...p, date: e.target.value }))} /></div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Time</label><input type="time" className={inp} value={hook.sessForm.time} onChange={e => hook.setSessForm(p => ({ ...p, time: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Platform</label>
                      <select className={inp} value={hook.sessForm.platform} onChange={e => hook.setSessForm(p => ({ ...p, platform: e.target.value }))}>
                        {PLATFORMS.map(pl => <option key={pl.value} value={pl.value}>{pl.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Max Participants (0 = unlimited)</label><input type="number" className={inp} value={hook.sessForm.max_participants} onChange={e => hook.setSessForm(p => ({ ...p, max_participants: +e.target.value }))} /></div>
                  </div>
                  {hook.sessForm.platform !== 'physical'
                    ? <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Meeting Link</label>
                        <input className={inp} value={hook.sessForm.meeting_link} onChange={e => hook.setSessForm(p => ({ ...p, meeting_link: e.target.value }))} placeholder="https://zoom.us/j/..." />
                        {hook.sessForm.platform === 'zoom' && (
                          <button type="button" onClick={hook.genSessZoom} disabled={hook.genningZoom}
                            className={`mt-2 text-xs px-2.5 py-1 rounded border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)] disabled:opacity-50`}>
                            {hook.genningZoom ? 'Creating…' : 'Generate Zoom meeting'}
                          </button>
                        )}
                      </div>
                    : <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Location / Venue</label><input className={inp} value={hook.sessForm.location} onChange={e => hook.setSessForm(p => ({ ...p, location: e.target.value }))} /></div>
                  }
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hook.sessForm.is_published} onChange={e => hook.setSessForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => hook.setSessDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={hook.saveSess} disabled={hook.saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{hook.saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={hook.sessRegs.open} onOpenChange={o => hook.setSessRegs(p => ({ ...p, open: o }))}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>Registrations — {hook.sessRegs.session?.title}</DialogTitle></DialogHeader>
                <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
                  {hook.sessRegs.list.length === 0 && <p className={`text-center py-8 ${textMuted}`}>No registrations yet</p>}
                  {hook.sessRegs.list.map((r, i) => (
                    <div key={r.reg_id || i} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
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

        {/* ── VIDEOS TAB ── */}
        {hook.tab === 'videos' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={hook.openNewVid} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />Add Video
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {hook.videos.length === 0 && <p className={`col-span-3 text-center py-12 ${textMuted}`}>No videos yet.</p>}
              {hook.videos.map(v => (
                <div key={v.video_id} className={`${card} rounded-xl overflow-hidden`}>
                  <div className="relative aspect-video bg-[var(--bg-primary)]">
                    {v.thumbnail_url
                      ? <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Video className="h-10 w-10 text-[var(--text-muted)]" /></div>
                    }
                    {!v.is_published && <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-yellow-500/90 text-black font-bold">DRAFT</span>}
                    <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">{v.duration_mins ? `${v.duration_mins} min` : ''}</span>
                  </div>
                  <div className="p-3">
                    <p className={`font-medium text-sm ${textPri} line-clamp-1`}>{v.title}</p>
                    <p className={`text-[10px] ${textMuted} mt-0.5 capitalize`}>{v.category?.replace(/_/g, ' ')}</p>
                    {v.description && <p className={`text-xs ${textSec} mt-1 line-clamp-2`}>{v.description}</p>}
                    <div className={`flex items-center gap-1 mt-1 text-[10px] ${textMuted}`}><Eye className="h-3 w-3" />{v.view_count || 0} views</div>
                  </div>
                  <div className="flex items-center gap-1 px-3 pb-3">
                    <Button size="sm" variant="ghost" onClick={() => hook.openEditVid(v)} className={`${textSec} h-7 px-2 text-xs`}><Edit2 className="mr-1 h-3 w-3" />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => hook.deleteVid(v.video_id)} className="text-red-400 h-7 px-2 text-xs"><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={hook.vidDialog} onOpenChange={hook.setVidDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{hook.editVid ? 'Edit Video' : 'Add Training Video'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={hook.vidForm.title} onChange={e => hook.setVidForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>YouTube URL *</label><input className={inp} value={hook.vidForm.youtube_url} onChange={e => hook.setVidForm(p => ({ ...p, youtube_url: e.target.value }))} placeholder="https://youtube.com/watch?v=..." /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><textarea className={`${inp} h-16 resize-none py-2`} value={hook.vidForm.description} onChange={e => hook.setVidForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Category</label>
                      <select className={inp} value={hook.vidForm.category} onChange={e => hook.setVidForm(p => ({ ...p, category: e.target.value }))}>
                        {VIDEO_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Duration (mins)</label><input type="number" className={inp} value={hook.vidForm.duration_mins} onChange={e => hook.setVidForm(p => ({ ...p, duration_mins: +e.target.value }))} /></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hook.vidForm.is_published} onChange={e => hook.setVidForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => hook.setVidDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={hook.saveVid} disabled={hook.saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{hook.saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ── PROMOTIONS TAB ── */}
        {hook.tab === 'promotions' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={hook.openNewPromo} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Offer
              </Button>
            </div>
            <div className="space-y-3">
              {hook.promos.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No promotions yet.</p>}
              {hook.promos.map(p => (
                <div key={p.promo_id} className={`${card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-semibold ${textPri}`}>{p.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize ${p.is_active ? 'bg-green-500/20 text-green-400' : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium capitalize">{p.promo_type}</span>
                      </div>
                      <p className={`text-sm ${textSec} mt-0.5`}>{p.description}</p>
                      {(p.valid_from || p.valid_until) && <p className={`text-xs ${textMuted} mt-1`}>Valid: {p.valid_from} → {p.valid_until}</p>}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => hook.notifyPromo(p.promo_id)} disabled={hook.notifying[p.promo_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {hook.notifying[p.promo_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Notify</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.openEditPromo(p)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.deletePromo(p.promo_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={hook.promoDialog} onOpenChange={hook.setPromoDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{hook.editPromo ? 'Edit Promotion' : 'New Promotion / Offer'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={hook.promoForm.title} onChange={e => hook.setPromoForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Description</label><input className={inp} value={hook.promoForm.description} onChange={e => hook.setPromoForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Details</label><textarea className={`${inp} h-16 resize-none py-2`} value={hook.promoForm.details} onChange={e => hook.setPromoForm(p => ({ ...p, details: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Type</label>
                      <select className={inp} value={hook.promoForm.promo_type} onChange={e => hook.setPromoForm(p => ({ ...p, promo_type: e.target.value }))}>
                        {PROMO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>CTA Button Text</label><input className={inp} value={hook.promoForm.cta_text} onChange={e => hook.setPromoForm(p => ({ ...p, cta_text: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Valid From</label><input type="date" className={inp} value={hook.promoForm.valid_from} onChange={e => hook.setPromoForm(p => ({ ...p, valid_from: e.target.value }))} /></div>
                    <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Valid Until</label><input type="date" className={inp} value={hook.promoForm.valid_until} onChange={e => hook.setPromoForm(p => ({ ...p, valid_until: e.target.value }))} /></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hook.promoForm.is_active} onChange={e => hook.setPromoForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Active (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => hook.setPromoDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={hook.savePromo} disabled={hook.saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{hook.saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ── ANNOUNCEMENTS TAB ── */}
        {hook.tab === 'announcements' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={hook.openNewAnn} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1.5 h-4 w-4" />New Announcement
              </Button>
            </div>
            <div className="space-y-3">
              {hook.anns.length === 0 && <p className={`text-center py-12 ${textMuted}`}>No announcements yet.</p>}
              {hook.anns.map(a => (
                <div key={a.announcement_id} className={`${card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-semibold ${textPri}`}>{a.title}</span>
                        {!a.is_published && <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">Draft</span>}
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium capitalize">{a.type?.replace(/_/g, ' ')}</span>
                        {a.notify_sent && <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Sent to {a.notify_count}</span>}
                      </div>
                      {a.body && <p className={`text-sm ${textSec} mt-1 line-clamp-2`}>{a.body}</p>}
                      <p className={`text-[10px] ${textMuted} mt-1`}>{a.published_at?.slice(0, 10)}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => hook.notifyAnn(a.announcement_id)} disabled={hook.notifying[a.announcement_id]} className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-8">
                        {hook.notifying[a.announcement_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Notify All</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.openEditAnn(a)} className={`${textSec} h-8 w-8 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => hook.deleteAnn(a.announcement_id)} className="text-red-400 h-8 w-8 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Dialog open={hook.annDialog} onOpenChange={hook.setAnnDialog}>
              <DialogContent className={dlg}>
                <DialogHeader><DialogTitle>{hook.editAnn ? 'Edit Announcement' : 'New Announcement'}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Title *</label><input className={inp} value={hook.annForm.title} onChange={e => hook.setAnnForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Body</label><textarea className={`${inp} h-24 resize-none py-2`} value={hook.annForm.body} onChange={e => hook.setAnnForm(p => ({ ...p, body: e.target.value }))} /></div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Type</label>
                    <select className={inp} value={hook.annForm.type} onChange={e => hook.setAnnForm(p => ({ ...p, type: e.target.value }))}>
                      {ANN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div><label className={`block text-xs font-medium ${textSec} mb-1`}>Image URL (optional)</label><input className={inp} value={hook.annForm.image_url} onChange={e => hook.setAnnForm(p => ({ ...p, image_url: e.target.value }))} placeholder="https://..." /></div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hook.annForm.is_published} onChange={e => hook.setAnnForm(p => ({ ...p, is_published: e.target.checked }))} className="rounded" />
                    <span className={`text-sm ${textSec}`}>Publish immediately (visible to customers)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => hook.setAnnDialog(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                    <Button onClick={hook.saveAnn} disabled={hook.saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{hook.saving ? 'Saving…' : 'Save'}</Button>
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
