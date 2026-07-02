import React, { useState, useEffect, useRef } from 'react';
import {
  Users, BookOpen, AlignLeft, Calendar, Tag, UserCheck, Send, X, MessageSquare,
  Upload, Plus, Trash2, Video, Sparkles, Settings, Loader2,
} from 'lucide-react';
import { certsApi, schools as schoolsApi } from '../../lib/api';
import { toast } from 'sonner';
import axios from 'axios';

const PINK = '#e94560';
const TITLE_OPTS = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.'];

/* Proper-Case a name (mirrors backend cert_engine.clean_name) */
const cleanNameJS = (s) =>
  (s || '').replace(/[ \t]+/g, ' ').trim().split(' ')
    .map(w => w.replace(/[A-Za-z]+/g, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))
    .join(' ');

/* Smart CSV/paste → rows. Detects email (@) and phone (digits) in any column order;
   the remaining text columns map to name (first) then school (second+). */
const parseRows = (text) =>
  (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const cells = line.split(',').map(c => c.trim()).filter(c => c !== '');
    if (cells.length === 0) return null;
    // skip a header row (e.g. "Name,School,Email,...") with no long digit run
    if (/^(name|full ?name|attendee|participant)/i.test(cells[0]) && !cells.some(c => /\d{6,}/.test(c))) return null;
    let email = '', phone = '';
    const rest = [];
    cells.forEach(c => {
      if (!email && c.includes('@')) email = c;
      else if (!phone && /^[+()\-\s]*\d[\d()\-\s]{5,}$/.test(c)) phone = c.replace(/[^\d+]/g, '');
      else rest.push(c);
    });
    // first free-text column = name, any further free-text column(s) = school
    const name = (rest[0] || cells[0]).trim();
    const school = rest.slice(1).join(' ').trim();
    return name ? { title: '', name, phone, email, school } : null;
  }).filter(Boolean);

/**
 * BatchCreator — create a certificate batch with an editable attendee review table.
 * Sources: Manual/CSV (paste or file), Zoom meeting (live fetch), Training Session.
 */
export default function BatchCreator({ templates = [], onCreated, onCancel }) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560] w-full';
  const labelCls  = `block text-xs ${textSec} mb-1`;
  const cellInput = 'bg-transparent border-0 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560] rounded px-1 py-0.5 w-full';

  /* ── batch meta ── */
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle]           = useState('');
  const [date, setDate]             = useState('');
  const [theme, setTheme]           = useState('');
  const [expert, setExpert]         = useState('');
  const [channels, setChannels]     = useState({ whatsapp: true, email: true });
  const [submitting, setSubmitting] = useState(false);

  /* ── attendee source + editable rows ── */
  const [source, setSource]   = useState('manual');   // manual | zoom | session
  const [rows, setRows]       = useState([]);          // [{title,name,phone,email}]
  const [autoClean, setAutoClean] = useState(true);
  const [pasteText, setPasteText] = useState('');
  const [bulkTitle, setBulkTitle] = useState('');
  const [bulkSchool, setBulkSchool] = useState('');
  const [schoolOpts, setSchoolOpts] = useState([]);   // school names from the CRM database
  const fileRef = useRef(null);

  /* ── Zoom ── */
  const [zoomCfg, setZoomCfg]           = useState(null);   // {configured, account_id, client_id, has_secret}
  const [zoomMeetingId, setZoomMeetingId] = useState('');
  const [zoomFetching, setZoomFetching] = useState(false);
  const [showZoomCfg, setShowZoomCfg]   = useState(false);
  const [zAccount, setZAccount] = useState('');
  const [zClient, setZClient]   = useState('');
  const [zSecret, setZSecret]   = useState('');
  const [savingZoom, setSavingZoom] = useState(false);

  /* ── training session ── */
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');

  /* ── mail-merge message templates ── */
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody]       = useState('');
  const [waCaption, setWaCaption]       = useState('');
  const subjectRef = useRef(null), bodyRef = useRef(null), captionRef = useRef(null);
  const [activeField, setActiveField] = useState('email_body');
  const TOKENS = ['{Name}', '{School}', '{Date}', '{Theme}', '{Conducted By}'];
  const MSG_FIELDS = {
    email_subject: { ref: subjectRef, set: setEmailSubject },
    email_body:    { ref: bodyRef,    set: setEmailBody    },
    wa_caption:    { ref: captionRef, set: setWaCaption    },
  };
  const insertToken = (tok) => {
    const f = MSG_FIELDS[activeField] || MSG_FIELDS.email_body;
    const el = f.ref.current;
    if (!el) { f.set(prev => prev + tok); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    f.set(el.value.slice(0, start) + tok + el.value.slice(end));
    requestAnimationFrame(() => { el.focus(); const p = start + tok.length; try { el.setSelectionRange(p, p); } catch { /* noop */ } });
  };

  /* ── load school names from the CRM database (for the per-attendee picker) ── */
  useEffect(() => {
    let alive = true;
    schoolsApi.getAll()
      .then(r => {
        if (!alive) return;
        const names = Array.from(new Set(
          (r.data || []).map(s => (s.school_name || s.name || '').trim()).filter(Boolean)
        )).sort((a, b) => a.localeCompare(b));
        setSchoolOpts(names);
      })
      .catch(() => { /* non-fatal — free text still works */ });
    return () => { alive = false; };
  }, []);

  /* ── load training sessions on demand ── */
  useEffect(() => {
    if (source !== 'session' || sessions.length > 0) return;
    setSessionsLoading(true);
    axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/training/sessions`, { withCredentials: true })
      .then(r => setSessions(r.data || []))
      .catch(() => toast.error('Failed to load training sessions'))
      .finally(() => setSessionsLoading(false));
  }, [source, sessions.length]);

  /* ── load Zoom config when Zoom source opens ── */
  useEffect(() => {
    if (source !== 'zoom' || zoomCfg !== null) return;
    certsApi.zoomConfigGet()
      .then(r => {
        const c = r.data || {};
        setZoomCfg(c);
        setZAccount(c.account_id || '');
        setZClient(c.client_id || '');
        if (!c.configured) setShowZoomCfg(true);
      })
      .catch(() => setZoomCfg({ configured: false }));
  }, [source, zoomCfg]);

  /* ── row helpers ── */
  const maybeClean = (list) => autoClean ? list.map(r => ({ ...r, name: cleanNameJS(r.name) })) : list;
  const addRows    = (list, replace = true) => {
    const cleaned = maybeClean(list);
    setRows(prev => replace ? cleaned : [...prev, ...cleaned]);
  };
  const updateRow  = (i, field, val) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const removeRow  = (i) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const addBlank   = () => setRows(prev => [...prev, { title: '', name: '', phone: '', email: '', school: '' }]);
  const cleanAll   = () => setRows(prev => prev.map(r => ({ ...r, name: cleanNameJS(r.name) })));
  const applyTitleAll = () => setRows(prev => prev.map(r => ({ ...r, title: bulkTitle })));
  const applySchoolAll = () => setRows(prev => prev.map(r => ({ ...r, school: bulkSchool })));

  const handlePaste = () => {
    const parsed = parseRows(pasteText);
    if (!parsed.length) { toast.error('No attendees found — use name, phone, email per line'); return; }
    addRows(parsed, false);
    setPasteText('');
    toast.success(`${parsed.length} added`);
  };
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRows(String(reader.result || ''));
      if (!parsed.length) { toast.error('No rows found in that CSV'); return; }
      addRows(parsed, false);
      toast.success(`${parsed.length} imported from ${file.name}`);
    };
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsText(file);
    e.target.value = '';
  };

  const fetchZoom = async () => {
    if (!zoomMeetingId.trim()) { toast.error('Enter the Zoom meeting ID'); return; }
    setZoomFetching(true);
    try {
      const r = await certsApi.zoomParticipants(zoomMeetingId.trim());
      const people = (r.data?.participants || []).map(p => ({ title: '', name: p.name, phone: p.phone || '', email: p.email || '', school: '' }));
      if (!people.length) { toast.error('No participants returned for that meeting'); return; }
      addRows(people, true);
      toast.success(`${people.length} participants fetched from Zoom`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Zoom fetch failed');
    } finally {
      setZoomFetching(false);
    }
  };

  const saveZoom = async () => {
    if (!zAccount.trim() || !zClient.trim() || (!zSecret.trim() && !zoomCfg?.has_secret)) {
      toast.error('Enter Account ID, Client ID and Client Secret'); return;
    }
    setSavingZoom(true);
    try {
      const r = await certsApi.zoomConfigSave({ account_id: zAccount.trim(), client_id: zClient.trim(), client_secret: zSecret.trim() || undefined });
      toast.success('Zoom credentials saved');
      setZoomCfg({ configured: r.data?.configured, account_id: zAccount.trim(), client_id: zClient.trim(), has_secret: true });
      setZSecret('');
      if (r.data?.configured) setShowZoomCfg(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save Zoom credentials');
    } finally {
      setSavingZoom(false);
    }
  };

  const toggleChannel = (ch) => setChannels(prev => ({ ...prev, [ch]: !prev[ch] }));

  /* ── submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim())   { toast.error('Batch title is required'); return; }
    if (!templateId)     { toast.error('Select a template');       return; }
    if (!channels.whatsapp && !channels.email) { toast.error('Select at least one delivery channel'); return; }

    const chosenChannels = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
    const body = {
      title: title.trim(),
      template_id: templateId,
      source,
      shared_values: { date: date.trim(), theme: theme.trim(), expert: expert.trim() },
      channels: chosenChannels,
      email_subject: emailSubject.trim() || undefined,
      email_body:    emailBody.trim()    || undefined,
      wa_caption:    waCaption.trim()     || undefined,
    };

    if (source === 'session') {
      if (!sessionId) { toast.error('Select a training session'); return; }
      body.session_id = sessionId;
    } else {
      const attendees = rows.map(r => {
        const nm = (autoClean ? cleanNameJS(r.name) : r.name || '').trim();
        const t = (r.title || '').trim();
        return { name: t && nm ? `${t} ${nm}` : nm, phone: (r.phone || '').trim(), email: (r.email || '').trim(), school: (r.school || '').trim() };
      }).filter(a => a.name);
      if (!attendees.length) { toast.error('Add at least one attendee'); return; }
      body.attendees = attendees;
    }

    setSubmitting(true);
    try {
      const r = await certsApi.createBatch(body);
      toast.success(`Batch "${body.title}" created`);
      onCreated?.(r?.data || r);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to create batch');
    } finally {
      setSubmitting(false);
    }
  };

  const SOURCES = [
    { id: 'manual',  label: 'Manual / CSV',     icon: AlignLeft },
    { id: 'zoom',    label: 'Zoom Meeting',      icon: Video     },
    { id: 'session', label: 'Training Session',  icon: BookOpen  },
  ];

  /* ─── render ─── */
  return (
    <div className={`${card} border rounded-xl p-5 space-y-5`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: PINK + '18' }}>
            <Users className="h-4 w-4" style={{ color: PINK }} />
          </div>
          <p className={`font-semibold text-sm ${textPri}`}>New Certificate Batch</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`p-1 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)] transition-colors`} title="Cancel">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title + Template */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Batch Title *</label>
            <input type="text" className={inputCls} placeholder="e.g. June 2026 Sales Workshop" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Template *</label>
            <select className={inputCls} value={templateId} onChange={e => setTemplateId(e.target.value)}>
              <option value="">— Select template —</option>
              {templates.map(t => (
                <option key={t.template_id || t._id} value={t.template_id || t._id}>{t.name}</option>
              ))}
            </select>
            {templates.length === 0 && <p className={`text-xs ${textMuted} mt-1`}>No templates yet — create one in the Templates tab first.</p>}
          </div>
        </div>

        {/* Shared values */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={`${labelCls} flex items-center gap-1`}><Calendar className="h-3 w-3" /> Date</label>
            <input type="text" className={inputCls} placeholder="e.g. 10 June 2026" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className={`${labelCls} flex items-center gap-1`}><Tag className="h-3 w-3" /> Theme / Topic</label>
            <input type="text" className={inputCls} placeholder="e.g. Sales Excellence" value={theme} onChange={e => setTheme(e.target.value)} />
          </div>
          <div>
            <label className={`${labelCls} flex items-center gap-1`}><UserCheck className="h-3 w-3" /> Expert / Trainer</label>
            <input type="text" className={inputCls} placeholder="e.g. Ramesh Verma" value={expert} onChange={e => setExpert(e.target.value)} />
          </div>
        </div>

        {/* Source toggle */}
        <div>
          <label className={`${labelCls} mb-2`}>Attendee Source</label>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setSource(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${source === id ? 'text-white border-transparent' : `${textSec} border-[var(--border-color)] hover:bg-[var(--bg-hover)]`}`}
                style={source === id ? { background: PINK } : {}}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        </div>

        {/* Source: Training Session (server-side, no table) */}
        {source === 'session' && (
          <div>
            <label className={labelCls}>Training Session *</label>
            {sessionsLoading ? <p className={`text-sm ${textMuted}`}>Loading sessions…</p> : (
              <select className={inputCls} value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">— Select session —</option>
                {sessions.map(s => (
                  <option key={s._id || s.session_id || s.id} value={s._id || s.session_id || s.id}>
                    {s.name || s.title || s.topic || s._id}{s.date ? ` — ${s.date}` : ''}
                  </option>
                ))}
              </select>
            )}
            {!sessionsLoading && sessions.length === 0 && <p className={`text-xs ${textMuted} mt-1`}>No training sessions found.</p>}
          </div>
        )}

        {/* Source: Manual / CSV import controls */}
        {source === 'manual' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-color)] text-sm ${textSec} hover:bg-[var(--bg-hover)]`}>
                <Upload className="h-4 w-4" /> Upload CSV
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={handleFile} />
              <span className={`text-xs ${textMuted}`}>columns auto-detected: name, school, phone, email (phone/email any order)</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <textarea className={`${inputCls} font-mono resize-y flex-1`} rows={2}
                placeholder={'Paste rows: Amit Sharma, Delhi Public School, 9000000001, amit@example.com'} value={pasteText} onChange={e => setPasteText(e.target.value)} />
              <button type="button" onClick={handlePaste}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-sm ${textSec} hover:bg-[var(--bg-hover)] self-start`}>
                <Plus className="h-4 w-4" /> Add to list
              </button>
            </div>
          </div>
        )}

        {/* Source: Zoom */}
        {source === 'zoom' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs ${textMuted}`}>
                {zoomCfg?.configured ? 'Zoom connected — fetch participants by meeting ID.' : 'Connect your Zoom API to fetch participants.'}
              </span>
              <button type="button" onClick={() => setShowZoomCfg(v => !v)}
                className={`inline-flex items-center gap-1 text-xs ${textSec} hover:underline`}>
                <Settings className="h-3.5 w-3.5" /> {zoomCfg?.configured ? 'Zoom settings' : 'Add credentials'}
              </button>
            </div>

            {showZoomCfg && (
              <div className={`${card} border rounded-lg p-3 space-y-2`}>
                <p className={`text-xs font-medium ${textPri}`}>Zoom Server-to-Server OAuth credentials</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input className={inputCls} placeholder="Account ID" value={zAccount} onChange={e => setZAccount(e.target.value)} />
                  <input className={inputCls} placeholder="Client ID" value={zClient} onChange={e => setZClient(e.target.value)} />
                  <input className={inputCls} type="password" placeholder={zoomCfg?.has_secret ? '•••• (unchanged)' : 'Client Secret'} value={zSecret} onChange={e => setZSecret(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={saveZoom} disabled={savingZoom}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: PINK }}>
                    {savingZoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <input className={`${inputCls} flex-1`} placeholder="Zoom meeting ID (e.g. 851 2345 6789)" value={zoomMeetingId} onChange={e => setZoomMeetingId(e.target.value)} />
              <button type="button" onClick={fetchZoom} disabled={zoomFetching || !zoomCfg?.configured}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 self-start" style={{ background: PINK }}>
                {zoomFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Fetch participants
              </button>
            </div>
            <p className={`text-xs ${textMuted}`}>Past meeting only. Phone numbers aren't shared by Zoom — add them in the table for WhatsApp.</p>
          </div>
        )}

        {/* Editable attendee review table (manual + zoom) */}
        {source !== 'session' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-xs font-medium ${textPri}`}>{rows.length} attendee{rows.length !== 1 ? 's' : ''}</span>
              <div className="flex flex-wrap items-center gap-2">
                <label className={`flex items-center gap-1 text-xs ${textSec} cursor-pointer`}>
                  <input type="checkbox" className="accent-[#e94560] h-3.5 w-3.5" checked={autoClean} onChange={() => setAutoClean(v => !v)} />
                  Auto-clean names
                </label>
                <button type="button" onClick={cleanAll} className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-color)] text-xs ${textSec} hover:bg-[var(--bg-hover)]`}>
                  <Sparkles className="h-3.5 w-3.5" /> Clean all
                </button>
                <input list="titleopts" value={bulkTitle} onChange={e => setBulkTitle(e.target.value)} placeholder="Title…" className={`${inputCls} w-20 py-1`} />
                <button type="button" onClick={applyTitleAll} className={`px-2 py-1 rounded border border-[var(--border-color)] text-xs ${textSec} hover:bg-[var(--bg-hover)]`}>Apply to all</button>
                <input list="schoolopts" value={bulkSchool} onChange={e => setBulkSchool(e.target.value)} placeholder="School…" className={`${inputCls} w-32 py-1`} />
                <button type="button" onClick={applySchoolAll} className={`px-2 py-1 rounded border border-[var(--border-color)] text-xs ${textSec} hover:bg-[var(--bg-hover)]`}>Apply to all</button>
              </div>
            </div>

            <datalist id="titleopts">{TITLE_OPTS.map(t => <option key={t} value={t} />)}</datalist>
            <datalist id="schoolopts">{schoolOpts.map(s => <option key={s} value={s} />)}</datalist>

            {rows.length > 0 ? (
              <div className={`${card} border rounded-lg overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]">
                      {['Title', 'Name', 'School', 'Phone', 'Email', ''].map((h, i) => (
                        <th key={i} className={`px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide ${textMuted}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-[var(--bg-hover)]">
                        <td className="px-2 py-1 w-20"><input list="titleopts" className={`${cellInput} w-16`} value={r.title} onChange={e => updateRow(i, 'title', e.target.value)} /></td>
                        <td className="px-2 py-1"><input className={cellInput} value={r.name} onChange={e => updateRow(i, 'name', e.target.value)} onBlur={e => autoClean && updateRow(i, 'name', cleanNameJS(e.target.value))} placeholder="Full name" /></td>
                        <td className="px-2 py-1"><input list="schoolopts" className={cellInput} value={r.school || ''} onChange={e => updateRow(i, 'school', e.target.value)} placeholder="School" /></td>
                        <td className="px-2 py-1 w-36"><input className={cellInput} value={r.phone} onChange={e => updateRow(i, 'phone', e.target.value)} placeholder="Phone" /></td>
                        <td className="px-2 py-1"><input className={cellInput} value={r.email} onChange={e => updateRow(i, 'email', e.target.value)} placeholder="Email" /></td>
                        <td className="px-2 py-1 w-8">
                          <button type="button" onClick={() => removeRow(i)} className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`${card} border border-dashed rounded-lg p-4 text-center text-xs ${textMuted}`}>
                No attendees yet — {source === 'zoom' ? 'fetch from a Zoom meeting' : 'upload a CSV, paste rows, or add manually'}.
              </div>
            )}

            <button type="button" onClick={addBlank} className={`inline-flex items-center gap-1 text-xs ${textSec} hover:underline`}>
              <Plus className="h-3.5 w-3.5" /> Add row
            </button>
          </div>
        )}

        {/* Delivery channels */}
        <div>
          <label className={`${labelCls} mb-2`}><Send className="h-3 w-3 inline mr-1" />Delivery Channels</label>
          <div className="flex gap-4">
            {[{ key: 'whatsapp', label: 'WhatsApp' }, { key: 'email', label: 'Email' }].map(({ key, label }) => (
              <label key={key} className={`flex items-center gap-2 cursor-pointer text-sm ${textSec}`}>
                <input type="checkbox" checked={channels[key]} onChange={() => toggleChannel(key)} className="accent-[#e94560] h-4 w-4" />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Message templates (mail-merge) */}
        <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className={`${labelCls} mb-0 flex items-center gap-1`}><MessageSquare className="h-3 w-3" /> Message to attendee (optional)</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-xs ${textMuted}`}>Insert:</span>
              {TOKENS.map(tok => (
                <button key={tok} type="button" onClick={() => insertToken(tok)}
                  className={`px-1.5 py-0.5 rounded border border-[var(--border-color)] text-xs font-mono ${textSec} hover:bg-[var(--bg-hover)]`}>{tok}</button>
              ))}
            </div>
          </div>
          <p className={`text-xs ${textMuted} -mt-1`}>Placeholders auto-fill per attendee. Leave blank to use the default message.</p>
          <div>
            <label className={labelCls}>Email subject</label>
            <input ref={subjectRef} type="text" className={inputCls} placeholder="Your Certificate — {Theme}" value={emailSubject} onFocus={() => setActiveField('email_subject')} onChange={e => setEmailSubject(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Email body</label>
            <textarea ref={bodyRef} className={`${inputCls} resize-y`} rows={4} placeholder={'Dear {Name},\n\nThank you for attending {Theme} on {Date}, conducted by {Conducted By}.'} value={emailBody} onFocus={() => setActiveField('email_body')} onChange={e => setEmailBody(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>WhatsApp caption</label>
            <input ref={captionRef} type="text" className={inputCls} placeholder="Dear {Name}, please find your certificate for {Theme} attached." value={waCaption} onFocus={() => setActiveField('wa_caption')} onChange={e => setWaCaption(e.target.value)} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {onCancel && (
            <button type="button" onClick={onCancel} className={`px-4 py-1.5 rounded-lg border border-[var(--border-color)] text-sm ${textSec} hover:bg-[var(--bg-hover)]`}>Cancel</button>
          )}
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: PINK }}>
            <Users className="h-4 w-4" />{submitting ? 'Creating…' : 'Create Batch'}
          </button>
        </div>
      </form>
    </div>
  );
}
