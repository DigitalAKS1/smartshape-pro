import React, { useState, useEffect } from 'react';
import {
  Megaphone, Plus, RefreshCw, Play, Eye, Check, Wifi, QrCode,
  Users, Target, TrendingUp, School, Video, UserX, Brain, Upload,
  Loader2, Paperclip, X, Search, MessageSquare,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import { whatsApp as waApi } from '../../lib/api';
import { STATUS_CHIP, pct, mapCampaign, personalize } from '../../lib/marketingUtils';

const TMPL_CAT_LABELS = { intro: 'Intro', catalogue: 'Catalogue', offer: 'Offer', followup: 'Follow-up', reengagement: 'Re-engagement', seasonal: 'Seasonal' };

export default function CampaignsTab({ tk, campaigns, setCampaigns, roles, contacts, templates, allTags, waConnected, openQrDialog }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewTmpl, setPreviewTmpl] = useState(null);
  const [previewCamp, setPreviewCamp] = useState(null);
  const [previewContact, setPreviewContact] = useState(0);
  const [contactSearch, setContactSearch] = useState('');
  const [contactTagFilter, setContactTagFilter] = useState('');
  const [form, setForm] = useState({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', contact_ids: [], template_id: '', message: '', schedule: 'draft', schedule_at: '', ai_personalization: true, attachment_id: null });

  useEffect(() => {
    waApi.listAttachments().then(r => setAttachments(r.data || [])).catch(() => {});
  }, []); // eslint-disable-line

  async function handleAttachFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const r = await waApi.uploadAttachment(file);
      const att = r.data;
      setAttachments(prev => [att, ...prev]);
      setForm(p => ({ ...p, attachment_id: att.attachment_id }));
      toast.success(`"${file.name}" uploaded`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed');
    } finally { setUploadingFile(false); e.target.value = ''; }
  }

  const PIPELINE_STAGES = [
    { id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' },
    { id: 'demo', label: 'Demo' }, { id: 'negotiation', label: 'Negotiation' },
    { id: 'quoted', label: 'Quoted' }, { id: 'follow_up', label: 'Follow Up' },
    { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
  ];

  const audienceCount = (() => {
    if (form.audience === 'all') return contacts.length;
    if (form.audience === 'role' && form.role_id) {
      const rName = (roles.find(r => r.role_id === form.role_id)?.name || '').toLowerCase();
      return contacts.filter(c =>
        c.contact_role_id === form.role_id ||
        (rName && (c.designation || '').toLowerCase() === rName)
      ).length;
    }
    if (form.audience === 'tags' && form.tag_ids.length > 0) {
      return contacts.filter(c => form.tag_ids.some(tid => (c.tag_ids || []).includes(tid))).length;
    }
    if (form.audience === 'select_contacts') return form.contact_ids.length;
    return null;
  })();

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'scheduled', label: 'Scheduled', count: campaigns.filter(c => c.status === 'scheduled').length },
    { key: 'queued',    label: 'Queued',    count: campaigns.filter(c => c.status === 'queued').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  const sampleContacts = contacts.filter(c => c.phone).slice(0, 5);
  const previewSample = sampleContacts[previewContact] || { name: 'Ramesh Kumar', first_name: 'Ramesh', company: 'Delhi Public School' };

  function closeCreate() {
    setShowCreate(false); setStep(1);
    setContactSearch(''); setContactTagFilter('');
    setForm({ name: '', audience: 'all', role_id: '', tag_ids: [], lead_stages: [], school_types: [], min_strength: '', school_cities: '', contact_ids: [], template_id: '', message: '', schedule: 'draft', schedule_at: '', ai_personalization: true, attachment_id: null });
  }

  function filteredContactsForPicker() {
    let result = contacts;
    if (contactTagFilter) result = result.filter(c => (c.tag_ids || []).includes(contactTagFilter));
    if (contactSearch.trim()) {
      const q = contactSearch.toLowerCase();
      result = result.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.designation || '').toLowerCase().includes(q)
      );
    }
    return result;
  }

  function pickTemplate(tmpl) {
    setForm(p => ({ ...p, template_id: tmpl.template_id, message: tmpl.body }));
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return; }
    setSaving(true);
    try {
      let audience_filter = {};
      let audienceLabel = 'All Contacts';
      if (form.audience === 'role' && form.role_id) {
        const rName = roles.find(r => r.role_id === form.role_id)?.name;
        audience_filter = { roles: [rName].filter(Boolean) };
        audienceLabel = rName || 'By Role';
      } else if (form.audience === 'tags' && form.tag_ids.length > 0) {
        audience_filter = { tags: form.tag_ids };
        audienceLabel = form.tag_ids.map(id => allTags.find(t => t.tag_id === id)?.name || id).join(', ');
      } else if (form.audience === 'lead_stage' && form.lead_stages.length > 0) {
        audience_filter = { lead_stages: form.lead_stages };
        audienceLabel = `Lead Stage: ${form.lead_stages.join(', ')}`;
      } else if (form.audience === 'school_attrs') {
        audience_filter = {};
        const labels = [];
        if (form.school_types.length > 0) { audience_filter.school_types = form.school_types; labels.push(form.school_types.join('/')); }
        if (form.min_strength) { audience_filter.min_strength = parseInt(form.min_strength); labels.push(`${form.min_strength}+ students`); }
        if (form.school_cities.trim()) { audience_filter.school_cities = form.school_cities.split(',').map(s => s.trim()).filter(Boolean); labels.push(form.school_cities); }
        audienceLabel = labels.length > 0 ? `School: ${labels.join(' · ')}` : 'By School Attributes';
      } else if (form.audience === 'select_contacts' && form.contact_ids.length > 0) {
        audience_filter = { contact_ids: form.contact_ids };
        audienceLabel = `${form.contact_ids.length} selected contact${form.contact_ids.length !== 1 ? 's' : ''}`;
      } else if (form.audience === 'not_purchased') {
        audience_filter = { not_purchased: true };
        audienceLabel = 'Non-purchasers (no won deal)';
      }
      const res = await waApi.createCampaign({
        name: form.name.trim(),
        template_id: form.template_id || null,
        message: form.message.trim(),
        audience_filter,
        audience_label: audienceLabel,
        scheduled_at: form.schedule === 'schedule' ? form.schedule_at : null,
        ai_personalization: form.ai_personalization,
        attachment_id: form.attachment_id || null,
      });
      setCampaigns(prev => [mapCampaign(res.data), ...prev]);
      closeCreate();
      toast.success('Campaign created as draft');
    } catch { toast.error('Failed to create campaign'); }
    finally { setSaving(false); }
  }

  async function launch(camp) {
    setLaunching(camp.id);
    try {
      const res = await waApi.launchCampaign(camp.campaign_id);
      const { queued, status } = res.data;
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status, stats: { ...c.stats, sent: queued } } : c));
      toast.success(`${queued} messages queued for ${camp.name}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to launch campaign');
    } finally { setLaunching(null); }
  }

  const AUDIENCE_OPTS = [
    { key: 'all',             label: 'All Contacts',           desc: `${contacts.length} contacts in your database`, icon: Users },
    { key: 'role',            label: 'By Designation',         desc: 'Principal, Teacher, Purchase Head, etc.', icon: Users },
    { key: 'tags',            label: 'By Tags',                desc: 'Hot Lead, Demo Done, Budget Approved, etc.', icon: Target },
    { key: 'lead_stage',      label: 'By Lead Stage',          desc: 'Demo, Negotiation, Quoted — contacts with active leads', icon: TrendingUp },
    { key: 'school_attrs',    label: 'By School Attributes',   desc: 'Filter by board type, city, or minimum student strength', icon: School },
    { key: 'select_contacts', label: 'Hand-pick Contacts',     desc: 'Search + multi-select individual contacts — ideal for Zoom webinars', icon: Video },
    { key: 'not_purchased',   label: 'Non-Purchasers (Funnel)',desc: 'All contacts whose school has not yet purchased — perfect for product launch campaigns', icon: UserX },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className={`flex items-center gap-0.5 p-1 bg-[var(--bg-primary)] border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar flex-shrink-0`}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                filter === f.key
                  ? `${tk.card} ${tk.t1} shadow-sm`
                  : `${tk.tm} ${tk.hov}`
              }`}>
              {f.label}
              <span className={`text-[10px] min-w-[16px] text-center px-1 rounded-full ${
                filter === f.key ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--border-color)]'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <button onClick={waConnected ? undefined : openQrDialog}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              waConnected
                ? 'border-green-500/30 bg-green-500/10 text-green-600 cursor-default'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 cursor-pointer'
            }`}>
            {waConnected ? <Wifi className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
            {waConnected ? 'WA Connected' : 'Connect WA'}
          </button>
          <Button size="sm" className="h-9 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
            onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Not-connected notice */}
      {!waConnected && (
        <div className={`${tk.card} border border-amber-500/20 rounded-xl p-3 flex items-center gap-3 mb-1`}>
          <QrCode className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className={`text-xs font-semibold ${tk.t1}`}>WhatsApp not connected — campaigns will queue but not send</p>
            <p className={`text-[11px] ${tk.tm}`}>Scan the QR code to link your phone via Evolution API. Messages send at 3-second intervals to avoid bans.</p>
          </div>
          <Button size="sm" variant="outline" onClick={openQrDialog}
            className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10 text-xs gap-1.5 flex-shrink-0">
            <QrCode className="h-3.5 w-3.5" /> Scan QR
          </Button>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
          <Megaphone className={`h-10 w-10 ${tk.tm} mx-auto mb-3 opacity-40`} />
          <p className={`text-sm font-medium ${tk.t2}`}>No {filter !== 'all' ? filter : ''} campaigns</p>
          <p className={`text-xs ${tk.tm} mt-1`}>Create a campaign to start reaching your contacts via WhatsApp</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(c => {
            const dr = pct(c.stats.delivered, c.stats.sent);
            const rr = pct(c.stats.read, c.stats.sent);
            const barColor =
              c.status === 'completed' ? 'bg-emerald-500' :
              c.status === 'scheduled' ? 'bg-blue-500'    :
              c.status === 'queued'    ? 'bg-indigo-500'  :
              c.status === 'running'   ? 'bg-yellow-500'  : 'bg-slate-300';
            return (
              <div key={c.id}
                className={`${tk.card} border ${tk.bdr} rounded-2xl overflow-hidden mh-card-lift group`}>
                <div className="flex">
                  <div className={`w-1 flex-shrink-0 ${barColor}`} />
                  <div className="flex-1 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] uppercase tracking-widest font-bold ${STATUS_CHIP[c.status]} rounded-md px-1.5 py-0.5`}>
                            {c.status}
                          </span>
                          <span className={`text-[10px] ${tk.tm} font-medium`}>
                            WA · {c.audience_count} contacts
                          </span>
                        </div>
                        <p className={`text-sm font-bold ${tk.t1} leading-snug`}>{c.name}</p>
                        <p className={`text-[11px] ${tk.tm} mt-0.5`}>
                          {c.audience_label}
                          {c.scheduled_at ? ` · Scheduled ${c.scheduled_at}` : c.created_at ? ` · ${c.created_at}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                        {c.status === 'draft' && (
                          <Button size="sm"
                            className="h-7 gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
                            disabled={launching === c.id} onClick={() => launch(c)}>
                            {launching === c.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <Play className="h-3 w-3" />}
                            {launching === c.id ? '…' : 'Launch'}
                          </Button>
                        )}
                        <button onClick={() => { setPreviewCamp(c); setPreviewContact(0); }}
                          className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center`} title="Preview">
                          <Eye className={`h-3.5 w-3.5 ${tk.tm} group-hover:text-indigo-500 transition-colors`} />
                        </button>
                      </div>
                    </div>

                    {(c.status === 'completed' || c.status === 'queued') && (
                      <div className="mt-3 pt-3 border-t border-[var(--border-color)]/60">
                        <div className="flex items-center gap-4 text-xs mb-2">
                          <span>
                            <span className={`font-bold ${tk.t1}`}>{c.stats.sent}</span>
                            <span className={`ml-1 ${tk.tm}`}>sent</span>
                          </span>
                          {c.stats.delivered > 0 && <span>
                            <span className="font-bold text-emerald-600">{c.stats.delivered}</span>
                            <span className={`ml-1 ${tk.tm}`}>delivered</span>
                          </span>}
                          {c.stats.read > 0 && <span>
                            <span className="font-bold text-blue-500">{c.stats.read}</span>
                            <span className={`ml-1 ${tk.tm}`}>read</span>
                          </span>}
                          {c.stats.failed > 0 && <span>
                            <span className="font-bold text-red-500">{c.stats.failed}</span>
                            <span className={`ml-1 ${tk.tm}`}>failed</span>
                          </span>}
                          {dr !== null && <span className={`ml-auto font-semibold text-emerald-600`}>{dr}% delivery</span>}
                        </div>
                        <div className="w-full bg-[var(--bg-primary)] rounded-full h-1.5">
                          <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-700"
                            style={{ width: `${dr || 0}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={showCreate} onOpenChange={v => { if (!v) closeCreate(); else setShowCreate(true); }}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New WhatsApp Campaign</DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-0 my-1">
            {['Audience', 'Message', 'Schedule'].map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1.5 ${i + 1 <= step ? 'text-[var(--accent)]' : tk.tm}`}>
                  <div className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center border-2 transition-all ${
                    i + 1 < step  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : i + 1 === step ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-[var(--border-color)] text-[var(--text-muted)]'
                  }`}>
                    {i + 1 < step ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className="text-xs font-medium hidden sm:block">{s}</span>
                </div>
                {i < 2 && <div className={`flex-1 h-px mx-2 transition-colors ${i + 1 < step ? 'bg-[var(--accent)]' : 'bg-[var(--border-color)]'}`} />}
              </React.Fragment>
            ))}
          </div>

          <div className="space-y-4 py-2">
            {/* Step 1 */}
            {step === 1 && (
              <>
                <div>
                  <Label className={`${tk.t2} text-xs mb-1.5 block`}>Campaign Name</Label>
                  <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali Special Offer"
                    value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className={`${tk.t2} text-xs`}>Who do you want to reach?</Label>
                    {(audienceCount !== null && audienceCount > 0) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">
                        ~{audienceCount} contacts
                      </span>
                    )}
                    {audienceCount === null && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tk.bdr} ${tk.tm}`}>
                        resolved on launch
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {AUDIENCE_OPTS.map(opt => (
                      <div key={opt.key}>
                        <button onClick={() => setForm(p => ({ ...p, audience: opt.key, role_id: '' }))}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                            form.audience === opt.key
                              ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                              : `border-[var(--border-color)] ${tk.hov}`
                          }`}>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            form.audience === opt.key ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                          }`}>
                            {form.audience === opt.key && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${tk.t1}`}>{opt.label}</p>
                            <p className={`text-[11px] ${tk.tm}`}>{opt.desc}</p>
                          </div>
                        </button>
                        {/* Role sub-selector */}
                        {opt.key === 'role' && form.audience === 'role' && roles.length > 0 && (
                          <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                            {roles.map(r => {
                              const rLow = r.name.toLowerCase();
                              const cnt = contacts.filter(c =>
                                c.contact_role_id === r.role_id ||
                                (c.designation || '').toLowerCase() === rLow
                              ).length;
                              if (cnt === 0) return null;
                              return (
                                <button key={r.role_id}
                                  onClick={() => setForm(p => ({ ...p, role_id: r.role_id }))}
                                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                                    form.role_id === r.role_id
                                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                                      : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                  }`}>
                                  {r.name}
                                  <span className={`font-bold text-[10px] ${form.role_id === r.role_id ? 'text-white/80' : tk.tm}`}>
                                    {cnt}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {/* Tags sub-selector */}
                        {opt.key === 'tags' && form.audience === 'tags' && allTags.length > 0 && (
                          <div className="mt-2 ml-7">
                            <p className={`text-[10px] ${tk.tm} mb-1.5`}>Select tags — contacts matching ANY selected tag will receive the campaign</p>
                            <div className="flex flex-wrap gap-1.5">
                              {allTags.map(tag => {
                                const selected = form.tag_ids.includes(tag.tag_id);
                                const cnt = contacts.filter(c => (c.tag_ids || []).includes(tag.tag_id)).length;
                                return (
                                  <button key={tag.tag_id}
                                    onClick={() => setForm(p => ({
                                      ...p,
                                      tag_ids: selected
                                        ? p.tag_ids.filter(id => id !== tag.tag_id)
                                        : [...p.tag_ids, tag.tag_id]
                                    }))}
                                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                      selected ? 'text-white border-transparent' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                    }`}
                                    style={selected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected ? 'white' : tag.color }} />
                                    {tag.name}
                                    <span className={`font-bold text-[10px] ${selected ? 'text-white/80' : tk.tm}`}>{cnt}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Lead Stage sub-selector */}
                        {opt.key === 'lead_stage' && form.audience === 'lead_stage' && (
                          <div className="mt-2 ml-7">
                            <p className={`text-[10px] ${tk.tm} mb-1.5`}>Target contacts whose linked lead is currently in these stages</p>
                            <div className="flex flex-wrap gap-1.5">
                              {PIPELINE_STAGES.map(s => {
                                const sel = form.lead_stages.includes(s.id);
                                return (
                                  <button key={s.id}
                                    onClick={() => setForm(p => ({
                                      ...p,
                                      lead_stages: sel ? p.lead_stages.filter(x => x !== s.id) : [...p.lead_stages, s.id]
                                    }))}
                                    className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                      sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                    }`}>
                                    {s.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* School Attributes sub-selector */}
                        {opt.key === 'school_attrs' && form.audience === 'school_attrs' && (
                          <div className="mt-2 ml-7 space-y-2">
                            <div>
                              <p className={`text-[10px] ${tk.tm} mb-1.5`}>Board type (select any)</p>
                              <div className="flex flex-wrap gap-1.5">
                                {['CBSE', 'ICSE', 'IB', 'State Board', 'Montessori'].map(bt => {
                                  const sel = form.school_types.includes(bt);
                                  return (
                                    <button key={bt}
                                      onClick={() => setForm(p => ({
                                        ...p,
                                        school_types: sel ? p.school_types.filter(x => x !== bt) : [...p.school_types, bt]
                                      }))}
                                      className={`text-xs px-2.5 py-1 rounded-full border-2 transition-all ${
                                        sel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : `border-[var(--border-color)] ${tk.t2} ${tk.hov}`
                                      }`}>
                                      {bt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <p className={`text-[10px] ${tk.tm} mb-1`}>Min. strength</p>
                                <input type="number" min="0" placeholder="e.g. 500"
                                  value={form.min_strength}
                                  onChange={e => setForm(p => ({ ...p, min_strength: e.target.value }))}
                                  className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                              </div>
                              <div className="flex-1">
                                <p className={`text-[10px] ${tk.tm} mb-1`}>Cities (comma-sep.)</p>
                                <input type="text" placeholder="Delhi, Mumbai"
                                  value={form.school_cities}
                                  onChange={e => setForm(p => ({ ...p, school_cities: e.target.value }))}
                                  className={`w-full text-xs px-2 py-1.5 rounded-lg border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} focus:outline-none focus:border-[var(--accent)]`} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Hand-pick contacts sub-selector */}
                        {opt.key === 'select_contacts' && form.audience === 'select_contacts' && (
                          <div className="mt-2 ml-7 space-y-2">
                            <div className="relative">
                              <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${tk.tm}`} />
                              <input type="text" placeholder="Search by name, phone, school…"
                                value={contactSearch}
                                onChange={e => setContactSearch(e.target.value)}
                                className={`w-full pl-8 pr-3 py-2 rounded-xl border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} text-xs focus:outline-none focus:border-[var(--accent)]`} />
                            </div>
                            {allTags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {allTags.map(tag => {
                                  const sel = contactTagFilter === tag.tag_id;
                                  return (
                                    <button key={tag.tag_id}
                                      onClick={() => setContactTagFilter(sel ? '' : tag.tag_id)}
                                      className={`text-[10px] px-2 py-0.5 rounded-full border-2 transition-all ${sel ? 'text-white border-transparent' : `border-[var(--border-color)] ${tk.t2}`}`}
                                      style={sel ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                                      {tag.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className={`text-[10px] font-semibold ${form.contact_ids.length > 0 ? 'text-[var(--accent)]' : tk.tm}`}>
                                {form.contact_ids.length > 0 ? `${form.contact_ids.length} selected` : 'Tap contacts to select'}
                              </span>
                              <div className="flex gap-3">
                                <button onClick={() => setForm(p => ({ ...p, contact_ids: filteredContactsForPicker().map(c => c.contact_id) }))}
                                  className={`text-[10px] font-semibold text-[var(--accent)]`}>Select All</button>
                                <button onClick={() => setForm(p => ({ ...p, contact_ids: [] }))}
                                  className={`text-[10px] font-semibold ${tk.tm}`}>Clear</button>
                              </div>
                            </div>
                            <div className={`max-h-52 overflow-y-auto border ${tk.bdr} rounded-xl divide-y divide-[var(--border-color)]`}>
                              {filteredContactsForPicker().slice(0, 150).map(c => {
                                const sel = form.contact_ids.includes(c.contact_id);
                                return (
                                  <button key={c.contact_id}
                                    onClick={() => setForm(p => ({
                                      ...p,
                                      contact_ids: sel
                                        ? p.contact_ids.filter(id => id !== c.contact_id)
                                        : [...p.contact_ids, c.contact_id]
                                    }))}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${sel ? 'bg-[var(--accent)]/8' : tk.hov}`}>
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${sel ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-color)]'}`}>
                                      {sel && <Check className="h-2.5 w-2.5 text-white" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-xs font-semibold ${tk.t1} truncate`}>{c.name}</p>
                                      <p className={`text-[10px] ${tk.tm} truncate`}>{c.phone}{c.company ? ` · ${c.company}` : ''}</p>
                                    </div>
                                    {c.designation && (
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] ${tk.tm} shrink-0`}>{c.designation}</span>
                                    )}
                                  </button>
                                );
                              })}
                              {filteredContactsForPicker().length === 0 && (
                                <p className={`text-xs ${tk.tm} text-center py-5`}>No contacts match your search</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Non-purchasers */}
                        {opt.key === 'not_purchased' && form.audience === 'not_purchased' && (
                          <div className="mt-2 ml-7 flex items-start gap-2 p-3 rounded-xl bg-orange-500/8 border border-orange-500/20">
                            <UserX className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <p className={`text-[11px] text-orange-400 leading-relaxed`}>
                              Sends to all contacts whose school does <strong>not</strong> have a "Won" lead — ideal for product launch blasts to prospects who haven't purchased yet.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 2 — Template selection */}
            {step === 2 && (
              <div className="space-y-3">
                <div>
                  <Label className={`${tk.t2} text-xs mb-1 block`}>Select a Template</Label>
                  <p className={`text-[11px] ${tk.tm} mb-2`}>Pick a SmartShape message template or write your own below</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {templates.filter(t => t.is_active).map(t => (
                      <button key={t.template_id} onClick={() => pickTemplate(t)}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                          form.template_id === t.template_id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          form.template_id === t.template_id ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                        }`}>
                          {form.template_id === t.template_id && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-semibold ${tk.t1}`}>{t.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium capitalize`}>
                              {TMPL_CAT_LABELS[t.category] || t.category}
                            </span>
                          </div>
                          <p className={`text-[11px] ${tk.tm} mt-0.5 line-clamp-2`}>{t.body}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className={`${tk.t2} text-xs mb-1 block`}>
                    Message / Template Base
                    <span className={`${tk.tm} font-normal ml-1`}>(Claude AI will personalise per recipient)</span>
                  </Label>
                  <textarea rows={5} className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                    placeholder="Write your message… Use {name} and {school_name} as variables."
                    value={form.message}
                    onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
                  <p className={`text-[11px] ${tk.tm} mt-0.5`}>{form.message.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> + <span className="font-mono text-[var(--accent)]">{'{school_name}'}</span> are auto-filled</p>
                </div>

                {/* AI Personalisation toggle */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${tk.bdr} bg-[var(--bg-primary)]`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${form.ai_personalization ? 'bg-violet-500/15' : 'bg-gray-500/10'}`}>
                      <Brain className={`h-4 w-4 ${form.ai_personalization ? 'text-violet-500' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${tk.t1}`}>Claude AI Personalisation</p>
                      <p className={`text-[10px] ${tk.tm}`}>
                        {form.ai_personalization
                          ? 'Unique message per contact (name, school, stage-aware)'
                          : 'Simple {name} substitution only'}
                      </p>
                    </div>
                  </div>
                  <Switch checked={form.ai_personalization}
                    onCheckedChange={v => setForm(p => ({ ...p, ai_personalization: v }))} />
                </div>

                {/* Attachment picker */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className={`${tk.t2} text-xs`}>Attachment (optional)</Label>
                    <label className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border ${tk.bdr} ${tk.t2} cursor-pointer hover:bg-[var(--bg-primary)] transition-colors`}>
                      {uploadingFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {uploadingFile ? 'Uploading…' : 'Upload File'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov" className="hidden" onChange={handleAttachFile} disabled={uploadingFile} />
                    </label>
                  </div>
                  {attachments.length > 0 ? (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      <button onClick={() => setForm(p => ({ ...p, attachment_id: null }))}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                          !form.attachment_id ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <X className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className={`text-xs ${tk.t2}`}>No attachment — text only</span>
                      </button>
                      {attachments.map(att => (
                        <button key={att.attachment_id}
                          onClick={() => setForm(p => ({ ...p, attachment_id: att.attachment_id }))}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                            form.attachment_id === att.attachment_id ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`
                          }`}>
                          <Paperclip className={`h-3.5 w-3.5 flex-shrink-0 ${att.attachment_type === 'image' ? 'text-blue-400' : att.attachment_type === 'video' ? 'text-purple-400' : 'text-red-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${tk.t1} truncate`}>{att.filename}</p>
                            <p className={`text-[10px] ${tk.tm}`}>{att.attachment_type} · {Math.round(att.size_bytes / 1024)} KB</p>
                          </div>
                          {form.attachment_id === att.attachment_id && <Check className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-[11px] ${tk.tm} text-center py-3`}>No attachments yet — upload a PDF, image, or video above</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <>
                <div>
                  <Label className={`${tk.t2} text-xs mb-2 block`}>When to send?</Label>
                  <div className="space-y-2">
                    {[
                      { key: 'draft',    label: 'Save as Draft',      desc: 'Launch manually when ready' },
                      { key: 'schedule', label: 'Schedule for Later',  desc: 'Pick a specific date and time' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => setForm(p => ({ ...p, schedule: opt.key }))}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                          form.schedule === opt.key
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : `border-[var(--border-color)] ${tk.hov}`
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          form.schedule === opt.key ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
                        }`}>
                          {form.schedule === opt.key && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${tk.t1}`}>{opt.label}</p>
                          <p className={`text-[11px] ${tk.tm}`}>{opt.desc}</p>
                        </div>
                      </button>
                    ))}
                    {form.schedule === 'schedule' && (
                      <Input type="datetime-local" className={`h-10 ${tk.inp}`}
                        value={form.schedule_at} onChange={e => setForm(p => ({ ...p, schedule_at: e.target.value }))} />
                    )}
                  </div>
                </div>

                {/* Review */}
                <div className="bg-[var(--bg-primary)] rounded-xl p-3.5 space-y-2">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${tk.tm} mb-2`}>Review</p>
                  {[
                    { label: 'Campaign',     value: form.name || 'Untitled' },
                    { label: 'Audience',     value: `${AUDIENCE_OPTS.find(a => a.key === form.audience)?.label || form.audience}${form.audience === 'role' && form.role_id ? ` — ${roles.find(r => r.role_id === form.role_id)?.name || ''}` : ''}${audienceCount !== null ? ` (~${audienceCount})` : ''}` },
                    { label: 'Template',     value: form.template_id ? (templates.find(t => t.template_id === form.template_id)?.name || 'Custom') : (form.message ? 'Custom message' : 'Not selected') },
                    { label: 'AI Personalise', value: form.ai_personalization ? '✓ Claude Haiku (unique per contact)' : '✗ Template substitution only' },
                    { label: 'Attachment',   value: form.attachment_id ? (attachments.find(a => a.attachment_id === form.attachment_id)?.filename || 'Attached') : 'None' },
                    { label: 'Schedule',     value: form.schedule === 'draft' ? 'Save as Draft' : (form.schedule_at || 'Not set') },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between">
                      <span className={`text-xs ${tk.tm}`}>{r.label}</span>
                      <span className={`text-xs font-medium ${tk.t2}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={step > 1 ? () => setStep(s => s - 1) : closeCreate}>
              {step > 1 ? 'Back' : 'Cancel'}
            </Button>
            {step < 3
              ? <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                  onClick={() => setStep(s => s + 1)}>Continue</Button>
              : <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                  disabled={saving} onClick={createCampaign}>
                  {saving ? 'Saving…' : 'Create Campaign'}
                </Button>
            }
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Campaign Preview Dialog */}
      {previewCamp && (
        <Dialog open={!!previewCamp} onOpenChange={() => setPreviewCamp(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
            <DialogHeader>
              <DialogTitle className={`${tk.t1} flex items-center gap-2`}>
                <MessageSquare className="h-4 w-4 text-green-500" />
                WhatsApp Preview
              </DialogTitle>
              <DialogDescription className={tk.tm}>{previewCamp.name}</DialogDescription>
            </DialogHeader>

            {sampleContacts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-[11px] ${tk.tm} flex-shrink-0`}>Preview as:</span>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {sampleContacts.map((c, i) => (
                    <button key={c.contact_id || i} onClick={() => setPreviewContact(i)}
                      className={`text-[10px] px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0 border transition-all ${
                        previewContact === i ? 'bg-green-500 border-green-500 text-white' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {(c.first_name || c.name?.split(' ')[0] || 'Contact')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* WhatsApp phone mock */}
            <div className="bg-[#0b141a] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3 opacity-60">
                <span className="text-white text-[10px] font-medium">9:41 AM</span>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-1.5 rounded-sm bg-white" /><div className="w-1 h-1 rounded-full bg-white" />
                </div>
              </div>
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <div className="w-8 h-8 rounded-full bg-green-500/30 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">SmartShape Team</p>
                  <p className="text-white/50 text-[10px]">Online</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="bg-[#005c4b] rounded-2xl rounded-tr-sm px-3 py-2.5 max-w-[85%]">
                  <p className="text-white text-[11px] leading-relaxed whitespace-pre-wrap">
                    {personalize(previewCamp.message, previewSample)}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    <span className="text-white/50 text-[9px]">Now</span>
                    <svg className="w-3 h-3 text-[#53bdeb]" viewBox="0 0 16 11" fill="currentColor">
                      <path d="M11.071.653a.75.75 0 0 1 1.06 1.06L5.243 8.6 3.12 6.477A.75.75 0 0 0 2.06 7.536l2.652 2.652a.75.75 0 0 0 1.06 0L12.132 3.8l.707-.707-.707-.707L11.07.653zM7.593 8.6 5.47 6.477a.75.75 0 0 0-1.06 1.06l2.652 2.652a.75.75 0 0 0 1.06 0L14.571 3.24l-1.06-1.06L7.593 8.6z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-between text-[11px] ${tk.tm}`}>
              <span>{previewCamp.audience_label} · {previewCamp.audience_count} contacts</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CHIP[previewCamp.status] || 'bg-gray-500/15 text-gray-400'}`}>
                {previewCamp.status}
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
                onClick={() => setPreviewCamp(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
