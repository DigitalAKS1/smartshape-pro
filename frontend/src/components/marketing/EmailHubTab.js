import React, { useState, useEffect } from 'react';
import {
  Megaphone, Send, Users, Plus, TrendingUp, CheckCircle, Clock,
  AlertCircle, BarChart2, RefreshCw, Play, Eye, Trash2,
  Check, Calendar, Key, Mail, AtSign,
  PieChart, Target, Inbox, X, Search, UserX,
  Smartphone as PhoneIcon, FileText, Star, Gift, Activity,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import { contactRoles as contactRolesApi, contacts as contactsApi, email as emailApi, tags as tagsApi } from '../../lib/api';
import { STATUS_CHIP, mapCampaign, personalize } from '../../lib/marketingUtils';
import AudienceFilterBuilder from './AudienceFilterBuilder';
import HtmlBodyEditor from '../email/HtmlBodyEditor';

const TMPL_CATS = ['All', 'intro', 'catalogue', 'offer', 'followup', 'reengagement', 'seasonal'];
const TMPL_CAT_META = {
  intro:        { label: 'Intro',          col: 'text-blue-500',   bg: 'bg-blue-500/15' },
  catalogue:    { label: 'Catalogue',      col: 'text-purple-500', bg: 'bg-purple-500/15' },
  offer:        { label: 'Offer',          col: 'text-green-500',  bg: 'bg-green-500/15' },
  followup:     { label: 'Follow-up',      col: 'text-orange-500', bg: 'bg-orange-500/15' },
  reengagement: { label: 'Re-engagement',  col: 'text-red-400',    bg: 'bg-red-400/15' },
  seasonal:     { label: 'Seasonal',       col: 'text-cyan-500',   bg: 'bg-cyan-500/15' },
};
const BLANK_EMAIL_TMPL = { name: '', category: 'intro', subject: '', body: '', body_html: '' };

// ── Email Campaigns Sub-Tab ────────────────────────────────────────────────────
function EmailCampaignsSubTab({ tk, campaigns, setCampaigns, roles, contacts, templates, allTags }) {
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [launching, setLaunching] = useState(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewCamp, setPreviewCamp] = useState(null);
  const [previewContact, setPreviewContact] = useState(0);
  const [eContactSearch, setEContactSearch] = useState('');
  const [eContactTagFilter, setEContactTagFilter] = useState('');
  const [form, setForm] = useState({ name: '', audience_mode: 'filter', audience_filter: {}, contact_ids: [], template_id: '', subject: '', message: '', body_html: '', schedule: 'draft', schedule_at: '' });

  function eFilteredContactsForPicker() {
    let result = contacts;
    if (eContactTagFilter) result = result.filter(c => (c.tag_ids || []).includes(eContactTagFilter));
    if (eContactSearch.trim()) {
      const q = eContactSearch.toLowerCase();
      result = result.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.company || '').toLowerCase().includes(q)
      );
    }
    return result;
  }

  const FILTERS = [
    { key: 'all',       label: 'All',       count: campaigns.length },
    { key: 'draft',     label: 'Draft',     count: campaigns.filter(c => c.status === 'draft').length },
    { key: 'queued',    label: 'Queued',    count: campaigns.filter(c => c.status === 'queued').length },
    { key: 'completed', label: 'Completed', count: campaigns.filter(c => c.status === 'completed').length },
  ];
  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);

  const sampleContacts = contacts.filter(c => c.email).slice(0, 5);
  const previewSampleE = sampleContacts[previewContact] || { name: 'Ramesh Kumar', first_name: 'Ramesh', company: 'Delhi Public School', email: 'ramesh@dpsdwarka.edu.in' };

  function closeCreate() {
    setShowCreate(false); setStep(1);
    setEContactSearch(''); setEContactTagFilter('');
    setForm({ name: '', audience_mode: 'filter', audience_filter: {}, contact_ids: [], template_id: '', subject: '', message: '', body_html: '', schedule: 'draft', schedule_at: '' });
  }

  function pickTemplate(tmpl) {
    setForm(p => ({ ...p, template_id: tmpl.template_id, subject: tmpl.subject || '', message: tmpl.body, body_html: tmpl.body_html || tmpl.body || '' }));
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return; }
    setSaving(true);
    try {
      let audience_filter = {};
      let audienceLabel = 'All Contacts';
      if (form.audience_mode === 'select_contacts') {
        audience_filter = { contact_ids: form.contact_ids };
        audienceLabel = `${form.contact_ids.length} selected contact${form.contact_ids.length !== 1 ? 's' : ''}`;
      } else if (form.audience_mode === 'not_purchased') {
        audience_filter = { not_purchased: true };
        audienceLabel = 'Non-purchasers (no won deal)';
      } else {
        audience_filter = form.audience_filter || {};
        const parts = [];
        if (audience_filter.sources?.length) parts.push(`Source: ${audience_filter.sources.join('/')}`);
        if (audience_filter.lead_stages?.length) parts.push(`Stage: ${audience_filter.lead_stages.join('/')}`);
        if (audience_filter.roles?.length) parts.push(audience_filter.roles.join('/'));
        if (audience_filter.min_strength) parts.push(`${audience_filter.min_strength}+ students`);
        if (audience_filter.school_types?.length) parts.push(audience_filter.school_types.join('/'));
        if (audience_filter.cities?.length) parts.push(audience_filter.cities.join('/'));
        if (audience_filter.tags?.length) parts.push(`${audience_filter.tags.length} tag(s)`);
        audienceLabel = parts.length ? parts.join(' · ') : 'All Contacts';
      }
      const res = await emailApi.createCampaign({
        name: form.name.trim(),
        template_id: form.template_id || null,
        subject: form.subject.trim(),
        message: form.message.trim(),
        body_html: form.body_html || '',
        audience_filter,
        audience_label: audienceLabel,
        scheduled_at: form.schedule === 'schedule' ? form.schedule_at : null,
      });
      setCampaigns(prev => [mapCampaign(res.data), ...prev]);
      closeCreate();
      toast.success('Email campaign created as draft');
    } catch { toast.error('Failed to create campaign'); }
    finally { setSaving(false); }
  }

  async function launch(camp) {
    setLaunching(camp.id);
    try {
      const res = await emailApi.launchCampaign(camp.campaign_id);
      const { queued, status } = res.data;
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status, stats: { ...c.stats, sent: queued } } : c));
      toast.success(`${queued} emails queued for ${camp.name}`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to launch campaign'); }
    finally { setLaunching(null); }
  }

  async function removeCampaign(camp) {
    if (!window.confirm(`Delete campaign "${camp.name}"?\nThis also stops any emails still queued to send.`)) return;
    try {
      await emailApi.deleteCampaign(camp.campaign_id);
      setCampaigns(prev => prev.filter(c => c.id !== camp.id));
      toast.success('Campaign deleted');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to delete campaign'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className={`flex items-center gap-0.5 p-1 bg-[var(--bg-primary)] border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar flex-shrink-0`}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                filter === f.key ? `${tk.card} ${tk.t1} shadow-sm` : `${tk.tm} ${tk.hov}`
              }`}>
              {f.label}
              <span className={`text-[10px] min-w-[16px] text-center px-1 rounded-full ${
                filter === f.key ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--border-color)]'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Email Campaign
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
          <Mail className={`h-10 w-10 ${tk.tm} mx-auto mb-3`} />
          <p className={`text-sm font-medium ${tk.t2}`}>No email campaigns yet</p>
          <p className={`text-xs ${tk.tm} mt-1`}>Create your first email campaign to start reaching school contacts</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(c => (
            <div key={c.id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  c.status === 'completed' ? 'bg-green-500/15' : c.status === 'queued' ? 'bg-blue-500/15' : 'bg-gray-500/15'
                }`}>
                  <Mail className={`h-4 w-4 ${c.status === 'completed' ? 'text-green-500' : c.status === 'queued' ? 'text-blue-500' : tk.tm}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${tk.t1}`}>{c.name}</p>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className={`flex items-center gap-3 mt-1 text-[11px] ${tk.tm} flex-wrap`}>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.audience_label} ({c.audience_count})</span>
                    {c.stats.sent > 0 && <span className="flex items-center gap-1"><Send className="h-3 w-3" />{c.stats.sent} sent</span>}
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{c.created_at}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.status === 'draft' && (
                    <Button size="sm" variant="outline"
                      className={`h-8 gap-1 text-xs border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10`}
                      disabled={!!launching} onClick={() => launch(c)}>
                      {launching === c.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Launch
                    </Button>
                  )}
                  <button onClick={() => { setPreviewCamp(c); setPreviewContact(0); }}
                    className={`h-8 w-8 rounded-lg ${tk.hov} flex items-center justify-center`} title="Preview email">
                    <Eye className={`h-4 w-4 ${tk.tm}`} />
                  </button>
                  <button onClick={() => removeCampaign(c)}
                    className={`h-8 w-8 rounded-lg ${tk.hov} flex items-center justify-center`}
                    title="Delete campaign (admin can delete launched/queued)">
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Email Campaign Preview Dialog */}
      {previewCamp && (
        <Dialog open={!!previewCamp} onOpenChange={() => setPreviewCamp(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto`}>
            <DialogHeader>
              <DialogTitle className={`${tk.t1} flex items-center gap-2`}>
                <Mail className="h-4 w-4 text-blue-500" />
                Email Preview
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
                        previewContact === i ? 'bg-blue-500 border-blue-500 text-white' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {(c.first_name || c.name?.split(' ')[0] || 'Contact')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Email client mock */}
            <div className={`border ${tk.bdr} rounded-xl overflow-hidden`}>
              <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-3 py-2 flex items-center gap-2">
                <div className="flex gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-400" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-400" /><div className="w-2.5 h-2.5 rounded-full bg-green-400" /></div>
                <span className={`text-[10px] ${tk.tm} flex-1 text-center`}>Gmail</span>
              </div>
              <div className="bg-white/3 border-b border-[var(--border-color)] px-4 py-3 space-y-1.5">
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>From</span>
                  <span className={`text-xs ${tk.t2}`}>SmartShape Team &lt;info@smartshape.in&gt;</span>
                </div>
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>To</span>
                  <span className={`text-xs ${tk.t2}`}>
                    {previewSampleE.name || `${previewSampleE.first_name} ${previewSampleE.last_name || ''}`} &lt;{previewSampleE.email || 'contact@school.edu.in'}&gt;
                  </span>
                </div>
                <div className="flex gap-3 items-baseline">
                  <span className={`text-[10px] font-semibold ${tk.tm} w-12 flex-shrink-0`}>Subject</span>
                  <span className={`text-xs font-semibold ${tk.t1} leading-tight`}>
                    {personalize(previewCamp.subject, previewSampleE) || '(No subject)'}
                  </span>
                </div>
              </div>
              <div className="p-4 min-h-[80px] bg-white">
                {previewCamp.body_html ? (
                  <div
                    className="text-[12px] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(personalize(previewCamp.body_html, previewSampleE)) }}
                  />
                ) : (
                  <p className={`text-[11px] ${tk.t2} whitespace-pre-wrap leading-relaxed`}>
                    {personalize(previewCamp.message, previewSampleE) || '(No body content)'}
                  </p>
                )}
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

      {/* Create dialog — 2-step */}
      <Dialog open={showCreate} onOpenChange={closeCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Email Campaign</DialogTitle>
            <DialogDescription className={tk.tm}>Step {step} of 2 — {step === 1 ? 'Audience & Content' : 'Preview & Schedule'}</DialogDescription>
          </DialogHeader>
          {step === 1 ? (
            <div className="space-y-4 py-1">
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Campaign Name *</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Annual Day ROI Pitch"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-2 block`}>Who do you want to reach?</Label>

                {/* Audience mode switch */}
                <div className={`inline-flex gap-0.5 p-1 rounded-xl border ${tk.bdr} bg-[var(--bg-primary)] mb-3`}>
                  {[
                    { id: 'filter', label: 'Filter builder' },
                    { id: 'select_contacts', label: 'Hand-pick' },
                    { id: 'not_purchased', label: 'Non-purchasers' },
                  ].map(m => (
                    <button key={m.id} type="button"
                      onClick={() => setForm(p => ({ ...p, audience_mode: m.id }))}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        form.audience_mode === m.id ? `${tk.card} ${tk.t1} shadow-sm` : `${tk.tm} ${tk.hov}`}`}>
                      {m.label}
                    </button>
                  ))}
                </div>

                {form.audience_mode === 'filter' && (
                  <AudienceFilterBuilder
                    value={form.audience_filter}
                    onChange={(f) => setForm(p => ({ ...p, audience_filter: f }))} />
                )}

                {form.audience_mode === 'not_purchased' && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-500/8 border border-orange-500/20">
                    <UserX className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-orange-300 leading-relaxed">
                      Targets all contacts whose school has <strong>no won deal</strong> — ideal for product launch email blasts.
                    </p>
                  </div>
                )}

                {form.audience_mode === 'select_contacts' && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${tk.tm}`} />
                      <input type="text" placeholder="Search by name, phone, school…"
                        value={eContactSearch} onChange={e => setEContactSearch(e.target.value)}
                        className={`w-full pl-8 pr-3 py-2 rounded-xl border ${tk.bdr} bg-[var(--bg-primary)] ${tk.t1} text-xs focus:outline-none focus:border-[var(--accent)]`} />
                    </div>
                    {(allTags || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(allTags || []).slice(0, 8).map(tag => (
                          <button key={tag.tag_id}
                            onClick={() => setEContactTagFilter(f => f === tag.tag_id ? '' : tag.tag_id)}
                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${eContactTagFilter === tag.tag_id ? 'text-white border-transparent' : `border-[var(--border-color)] ${tk.tm}`}`}
                            style={eContactTagFilter === tag.tag_id ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-semibold ${form.contact_ids.length > 0 ? 'text-[var(--accent)]' : tk.tm}`}>
                        {form.contact_ids.length > 0 ? `${form.contact_ids.length} selected` : 'Tap contacts to select'}
                      </span>
                      <div className="flex gap-3">
                        <button onClick={() => setForm(p => ({ ...p, contact_ids: eFilteredContactsForPicker().map(c => c.contact_id) }))}
                          className="text-[10px] font-semibold text-[var(--accent)]">Select All</button>
                        <button onClick={() => setForm(p => ({ ...p, contact_ids: [] }))}
                          className={`text-[10px] font-semibold ${tk.tm}`}>Clear</button>
                      </div>
                    </div>
                    <div className={`max-h-52 overflow-y-auto border ${tk.bdr} rounded-xl divide-y divide-[var(--border-color)]`}>
                      {eFilteredContactsForPicker().slice(0, 150).map(c => {
                        const sel = form.contact_ids.includes(c.contact_id);
                        return (
                          <button key={c.contact_id}
                            onClick={() => setForm(p => ({
                              ...p,
                              contact_ids: sel ? p.contact_ids.filter(id => id !== c.contact_id) : [...p.contact_ids, c.contact_id]
                            }))}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${sel ? 'bg-[var(--accent)]/8' : tk.hov}`}>
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${sel ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-color)]'}`}>
                              {sel && <Check className="h-2.5 w-2.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold ${tk.t1} truncate`}>{c.name}</p>
                              <p className={`text-[10px] ${tk.tm} truncate`}>{c.email || c.phone}{c.company ? ` · ${c.company}` : ''}</p>
                            </div>
                          </button>
                        );
                      })}
                      {eFilteredContactsForPicker().length === 0 && (
                        <p className={`text-xs ${tk.tm} text-center py-5`}>No contacts match your search</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Use Template (optional)</Label>
                <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
                  {templates.map(t => {
                    const m = TMPL_CAT_META[t.category] || { bg: 'bg-gray-400/15', col: 'text-gray-400', label: t.category };
                    const selected = form.template_id === t.template_id;
                    return (
                      <button key={t.template_id} onClick={() => selected ? setForm(p => ({ ...p, template_id: '', subject: '', message: '' })) : pickTemplate(t)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${selected ? 'border-[var(--accent)] bg-[var(--accent)]/5' : `border-[var(--border-color)] ${tk.hov}`}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col}`}>{m.label}</span>
                          <p className={`text-xs font-medium ${tk.t1} truncate`}>{t.name}</p>
                        </div>
                        {t.subject && <p className={`text-[10px] ${tk.tm} mt-1 truncate`}>✉ {t.subject}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Email Subject *</Label>
                <Input className={`h-10 ${tk.inp}`} placeholder="e.g. How 750+ Schools Save ₹2–5 Lakhs on Craft"
                  value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className={`${tk.t2} text-xs block`}>Email Design (rich text / paste HTML) *</Label>
                  <div className="flex gap-1">
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, body_html: (p.body_html || '') + '{name}' }))}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)] hover:bg-[var(--bg-hover)]">
                      + {'{name}'}
                    </button>
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, body_html: (p.body_html || '') + '{school_name}' }))}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)] hover:bg-[var(--bg-hover)]">
                      + {'{school_name}'}
                    </button>
                  </div>
                </div>
                <HtmlBodyEditor value={form.body_html} onChange={(html) => setForm(f => ({ ...f, body_html: html }))} />
                <p className={`text-[10px] ${tk.tm} mt-1.5`}>This is the design recipients see. Use {'{name}'} and {'{school_name}'} anywhere for personalisation.</p>
              </div>
              <details className="group">
                <summary className={`text-[11px] font-medium ${tk.tm} cursor-pointer select-none`}>Plain-text fallback (optional)</summary>
                <textarea rows={4} className={`w-full mt-2 rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                  placeholder="Plain-text version shown to inboxes that can't render HTML. Use {name} and {school_name} for personalisation."
                  value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
              </details>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className={`border ${tk.bdr} rounded-xl overflow-hidden`}>
                <div className={`bg-[var(--bg-primary)] border-b ${tk.bdr} px-4 py-3`}>
                  <p className={`text-[10px] ${tk.tm} mb-0.5`}>From: SmartShape Team &lt;info@smartshape.in&gt;</p>
                  <p className={`text-[10px] ${tk.tm} mb-0.5`}>To: audience resolved on launch</p>
                  <p className={`text-xs font-semibold ${tk.t1}`}>
                    {form.subject.replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School') || '(No subject)'}
                  </p>
                </div>
                <div className="p-4 bg-white">
                  {form.body_html ? (
                    <div className="text-xs leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(
                        form.body_html.replace(/\{name\}/g, 'Ramesh').replace(/\{school_name\}/g, 'Delhi Public School')) }} />
                  ) : (
                    <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                      {(form.message || '(No body)').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School').substring(0, 300)}
                      {form.message.length > 300 ? '…' : ''}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <Label className={`${tk.t2} text-xs mb-2 block`}>Schedule</Label>
                <div className="flex gap-2">
                  {[{ key: 'draft', label: 'Save as Draft' }, { key: 'now', label: 'Send Immediately' }].map(opt => (
                    <button key={opt.key} onClick={() => setForm(p => ({ ...p, schedule: opt.key }))}
                      className={`flex-1 py-2 rounded-xl border-2 text-xs font-medium transition-all ${
                        form.schedule === opt.key ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={step === 1 ? closeCreate : () => setStep(1)}>
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step === 1 ? (
              <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                onClick={() => setStep(2)} disabled={!form.name.trim()}>Next: Preview →</Button>
            ) : (
              <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
                onClick={createCampaign} disabled={saving}>{saving ? 'Saving…' : 'Create Campaign'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Email Templates Sub-Tab ───────────────────────────────────────────────────
function EmailTemplatesSubTab({ tk, templates, setTemplates }) {
  const [filterCat, setFilterCat] = useState('All');
  const [preview, setPreview] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_EMAIL_TMPL);
  const [saving, setSaving] = useState(false);

  const filtered = filterCat === 'All' ? templates : templates.filter(t => t.category === filterCat);

  async function create() {
    if (!form.name.trim()) { toast.error('Template name is required'); return; }
    if (!form.subject.trim()) { toast.error('Subject line is required'); return; }
    if (!form.body.trim() && !(form.body_html || '').trim()) { toast.error('Add an email design (HTML) or a plain body'); return; }
    setSaving(true);
    try {
      const all = `${form.subject} ${form.body} ${form.body_html || ''}`;
      const vars = [];
      if (all.includes('{name}')) vars.push('name');
      if (all.includes('{school_name}')) vars.push('school_name');
      const res = await emailApi.createTemplate({ ...form, variables: vars });
      setTemplates(prev => [...prev, res.data]);
      setShowCreate(false);
      setForm(BLANK_EMAIL_TMPL);
      toast.success('Email template saved');
    } catch { toast.error('Failed to save template'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Email Templates
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>{templates.length} total</span>
          </h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Reusable email messages — select when creating campaigns</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Template
        </Button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TMPL_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c ? 'bg-[var(--accent)] text-white' : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {TMPL_CAT_META[c]?.label || c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(t => {
          const m = TMPL_CAT_META[t.category] || { label: t.category, col: 'text-gray-400', bg: 'bg-gray-400/15' };
          return (
            <div key={t.template_id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex flex-col gap-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} leading-tight`}>{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium mt-1 inline-block`}>{m.label}</span>
                </div>
                <button onClick={() => setPreview(t)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                  <Eye className={`h-3.5 w-3.5 ${tk.tm}`} />
                </button>
              </div>
              {t.subject && <p className={`text-[11px] font-medium ${tk.t2} leading-tight`}>✉ {t.subject}</p>}
              <p className={`text-[11px] ${tk.tm} leading-relaxed line-clamp-3`}>{t.body}</p>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1.5">
                  {(t.variables || []).map(v => (
                    <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)]">
                      {'{' + v + '}'}
                    </span>
                  ))}
                </div>
                {t.usage_count > 0 && <span className={`text-[10px] ${tk.tm}`}>Used {t.usage_count}×</span>}
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto`}>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className={tk.t1}>{preview.name}</DialogTitle>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TMPL_CAT_META[preview.category]?.bg} ${TMPL_CAT_META[preview.category]?.col} font-medium`}>
                  {TMPL_CAT_META[preview.category]?.label || preview.category}
                </span>
              </div>
            </DialogHeader>
            <div className={`border ${tk.bdr} rounded-xl overflow-hidden text-xs`}>
              <div className={`bg-[var(--bg-primary)] border-b ${tk.bdr} px-4 py-3 space-y-1`}>
                <div className="flex gap-2"><span className={`${tk.tm} w-12`}>From</span><span className={`${tk.t2}`}>SmartShape Team &lt;info@smartshape.in&gt;</span></div>
                <div className="flex gap-2"><span className={`${tk.tm} w-12`}>To</span><span className={`${tk.t2}`}>Ramesh Kumar &lt;ramesh@dpsdwarka.edu.in&gt;</span></div>
                <div className="flex gap-2">
                  <span className={`${tk.tm} w-12`}>Subject</span>
                  <span className={`font-semibold ${tk.t1}`}>
                    {(preview.subject || '').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School')}
                  </span>
                </div>
              </div>
              <div className="p-4 bg-white">
                {preview.body_html ? (
                  <div className="text-[12px] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(
                      (preview.body_html || '').replace(/\{name\}/g, 'Ramesh').replace(/\{school_name\}/g, 'Delhi Public School')) }} />
                ) : (
                  <p className={`text-[11px] ${tk.t2} leading-relaxed whitespace-pre-wrap`}>
                    {(preview.body || '').replace('{name}', 'Ramesh').replace('{school_name}', 'Delhi Public School')}
                  </p>
                )}
              </div>
            </div>
            <p className={`text-[11px] ${tk.tm}`}>Variables auto-filled with sample data for preview</p>
            <DialogFooter>
              <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
                onClick={() => setPreview(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Email Template</DialogTitle>
            <DialogDescription className={tk.tm}>Reusable email for campaigns. Use {'{name}'} and {'{school_name}'} for personalisation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Template Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Principal ROI Pitch"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Category</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TMPL_CAT_META).map(([k, m]) => (
                  <button key={k} onClick={() => setForm(p => ({ ...p, category: k }))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border-2 transition-all ${
                      form.category === k ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                    }`}>{m.label}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Subject Line</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. How 750+ Schools Save ₹2–5 Lakhs on Craft"
                value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className={`${tk.t2} text-xs block`}>Email Design (rich text / paste HTML)</Label>
                <div className="flex gap-1">
                  <button type="button"
                    onClick={() => setForm(p => ({ ...p, body_html: (p.body_html || '') + '{name}' }))}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)] hover:bg-[var(--bg-hover)]">
                    + {'{name}'}
                  </button>
                  <button type="button"
                    onClick={() => setForm(p => ({ ...p, body_html: (p.body_html || '') + '{school_name}' }))}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)] hover:bg-[var(--bg-hover)]">
                    + {'{school_name}'}
                  </button>
                </div>
              </div>
              <HtmlBodyEditor value={form.body_html} onChange={(html) => setForm(f => ({ ...f, body_html: html }))} />
              <details className="group mt-2">
                <summary className={`text-[11px] font-medium ${tk.tm} cursor-pointer select-none`}>Plain-text fallback (optional)</summary>
                <textarea rows={5} className={`w-full mt-2 rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                  placeholder="Plain-text version for inboxes that can't render HTML. Use {name} and {school_name}."
                  value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
              </details>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Save Template'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Email Analytics Sub-Tab ───────────────────────────────────────────────────
function EmailAnalyticsSubTab({ tk, analytics }) {
  if (!analytics) {
    return (
      <div className={`${tk.card} border ${tk.bdr} rounded-xl py-16 text-center`}>
        <RefreshCw className={`h-8 w-8 ${tk.tm} mx-auto mb-3 animate-spin`} />
        <p className={`text-sm ${tk.t2}`}>Loading analytics…</p>
      </div>
    );
  }
  const { messages, campaigns: campData, by_type = {} } = analytics;
  const totalByType = Object.values(by_type).reduce((s, v) => s + v, 0);
  const kpis = [
    { label: 'Total Queued',       value: messages.total,     icon: Inbox,       col: 'text-blue-500',   bg: 'bg-blue-500/10' },
    { label: 'Emails Sent',        value: messages.sent,      icon: Send,        col: 'text-green-500',  bg: 'bg-green-500/10' },
    { label: 'Pending / In Queue', value: messages.pending,   icon: Clock,       col: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Failed',             value: messages.failed,    icon: AlertCircle, col: 'text-red-400',    bg: 'bg-red-400/10' },
    { label: 'Total Campaigns',    value: campData.total,     icon: Megaphone,   col: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: 'Live Campaigns',     value: campData.live,      icon: Activity,    col: 'text-cyan-500',   bg: 'bg-cyan-500/10' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4 w-4 ${k.col}`} />
              </div>
              <p className={`text-xl font-bold ${tk.t1} leading-none`}>{(k.value || 0).toLocaleString('en-IN')}</p>
              <p className={`text-[11px] ${tk.tm} mt-1 leading-tight`}>{k.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <PieChart className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Emails by Type</h3>
          </div>
          {totalByType === 0 ? (
            <p className={`text-xs ${tk.tm} py-4 text-center`}>No emails queued yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(by_type).map(([type, count]) => {
                const pctVal = Math.round((count / totalByType) * 100);
                const colors = { campaign: { bar: 'bg-purple-500', txt: 'text-purple-500', lbl: 'Campaigns' }, drip: { bar: 'bg-blue-500', txt: 'text-blue-500', lbl: 'Drip' }, other: { bar: 'bg-gray-400', txt: 'text-gray-400', lbl: 'Other' } };
                const m = colors[type] || colors.other;
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${tk.t2}`}>{m.lbl}</span>
                      <span className={`text-xs font-bold ${m.txt}`}>{count.toLocaleString('en-IN')} · {pctVal}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--bg-primary)]">
                      <div className={`h-2 rounded-full ${m.bar} transition-all`} style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`${tk.card} border ${tk.bdr} rounded-xl`}>
          <div className={`flex items-center gap-2 px-4 py-3 border-b ${tk.bdr}`}>
            <Target className={`h-4 w-4 ${tk.tm}`} />
            <h3 className={`text-sm font-semibold ${tk.t1}`}>Campaign Performance</h3>
          </div>
          {campData.list.length === 0 ? (
            <p className={`text-xs ${tk.tm} p-4 text-center`}>No campaigns yet</p>
          ) : (
            <div className={`divide-y divide-[var(--border-color)]`}>
              {campData.list.slice(0, 6).map(c => (
                <div key={c.campaign_id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${tk.t1} truncate`}>{c.name}</p>
                    <p className={`text-[11px] ${tk.tm} mt-0.5`}>{c.audience_count || 0} contacts</p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_CHIP[c.status] || 'bg-gray-500/15 text-gray-400'}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Email Setup Sub-Tab ───────────────────────────────────────────────────────
function EmailSetupSubTab({ tk }) {
  const SEQUENCE = [
    { day: 'Day 0',  icon: AtSign,      col: 'text-blue-500',   bg: 'bg-blue-500/10',   title: 'Cold Introduction',      desc: 'Principal First Touch or Teacher Introduction — machine intro, 750+ schools, offer to share ROI sheet.' },
    { day: 'Day 3',  icon: TrendingUp,  col: 'text-purple-500', bg: 'bg-purple-500/10', title: 'ROI Calculator',          desc: 'Send personalised ROI calculation: how much the school spends vs how much they could save with SMARTS-SHAPES.' },
    { day: 'Day 7',  icon: Calendar,    col: 'text-orange-500', bg: 'bg-orange-500/10', title: 'Demo Invitation',         desc: 'Invite for a 20-minute live demo at school — show the machine in action, no obligation.' },
    { day: 'Day 14', icon: FileText,    col: 'text-cyan-500',   bg: 'bg-cyan-500/10',   title: 'Die Library Catalogue',  desc: 'Share the 750+ die catalogue PDF — helps the school visualise activity planning for the full year.' },
    { day: 'Day 21', icon: Gift,        col: 'text-green-500',  bg: 'bg-green-500/10',  title: 'Bundle Offer',           desc: 'Academic Year Bundle: machine + free 50-die starter pack + priority installation + flexible EMI.' },
    { day: 'Day 30', icon: Star,        col: 'text-amber-500',  bg: 'bg-amber-500/10',  title: 'Peer Success Story',     desc: 'Share a story: a nearby similar school saving ₹4L/year — builds credibility and social proof.' },
    { day: 'Day 45', icon: RefreshCw,   col: 'text-red-400',    bg: 'bg-red-400/10',    title: 'Re-engagement',          desc: 'Cold Lead Revival: "It\'s been a while — here\'s what\'s new." New dies, better pricing, peer installs.' },
  ];
  return (
    <div className="space-y-5">
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${tk.t1}`}>SmartShape Email Marketing Blueprint</h3>
            <p className={`text-xs ${tk.tm}`}>7-touch cold-to-warm sequence for school B2B email outreach</p>
          </div>
        </div>
        <div className="space-y-3">
          {SEQUENCE.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <Icon className={`h-3.5 w-3.5 ${s.col}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${s.bg} ${s.col} font-semibold`}>{s.day}</span>
                    <p className={`text-xs font-semibold ${tk.t1}`}>{s.title}</p>
                  </div>
                  <p className={`text-[11px] ${tk.tm} mt-0.5 leading-relaxed`}>{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
        <h3 className={`text-sm font-semibold ${tk.t1} mb-3`}>Email Best Practices for School B2B</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Best Send Time',        value: 'Tue–Thu, 8–10am or 4–6pm',       icon: Clock },
            { label: 'Subject Line Length',   value: 'Under 60 characters',             icon: FileText },
            { label: 'Personalisation',       value: 'Always use {name} & school name', icon: Users },
            { label: 'Follow-up Timing',      value: '3–7 days after no reply',          icon: RefreshCw },
            { label: 'Unsubscribe Compliance', value: 'Always include opt-out link',     icon: CheckCircle },
            { label: 'Mobile Preview',        value: 'Test subject on mobile first',     icon: PhoneIcon },
          ].map(tip => {
            const Icon = tip.icon;
            return (
              <div key={tip.label} className={`flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-primary)] border ${tk.bdr}`}>
                <Icon className={`h-4 w-4 ${tk.tm} flex-shrink-0`} />
                <div>
                  <p className={`text-[11px] font-semibold ${tk.t2}`}>{tip.label}</p>
                  <p className={`text-[10px] ${tk.tm}`}>{tip.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Email Hub Tab (exported) ─────────────────────────────────────────────
export default function EmailHubTab({ tk }) {
  const [subTab, setSubTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [roles, setRoles] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);

  function reload() {
    emailApi.getCampaigns().then(r => setCampaigns((r.data || []).map(mapCampaign))).catch(() => {});
    emailApi.getTemplates().then(r => setTemplates(r.data || [])).catch(() => {});
    emailApi.getAnalytics().then(r => setAnalytics(r.data)).catch(() => {});
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
    tagsApi.getAll().then(r => setAllTags(r.data || [])).catch(() => {});
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line

  const EMAIL_SUBTABS = [
    { key: 'campaigns', label: 'Campaigns', Icon: Megaphone },
    { key: 'templates', label: 'Templates', Icon: FileText },
    { key: 'analytics', label: 'Analytics', Icon: PieChart },
    { key: 'setup',     label: 'Setup',     Icon: Key },
  ];

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-0.5 p-1 ${tk.card} border ${tk.bdr} rounded-xl overflow-x-auto no-scrollbar`}>
        {EMAIL_SUBTABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              subTab === key
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                : `${tk.tm} ${tk.hov} hover:text-[var(--text-secondary)]`
            }`}>
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={reload} className={`h-8 w-8 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${tk.tm}`} />
        </button>
      </div>

      {subTab === 'campaigns' && <EmailCampaignsSubTab tk={tk} campaigns={campaigns} setCampaigns={setCampaigns} roles={roles} contacts={contacts} templates={templates} allTags={allTags} />}
      {subTab === 'templates' && <EmailTemplatesSubTab tk={tk} templates={templates} setTemplates={setTemplates} />}
      {subTab === 'analytics' && <EmailAnalyticsSubTab tk={tk} analytics={analytics} />}
      {subTab === 'setup'     && <EmailSetupSubTab     tk={tk} />}
    </div>
  );
}
