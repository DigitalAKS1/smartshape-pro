import React, { useState, useEffect, useRef } from 'react';
import { Users, BookOpen, AlignLeft, Calendar, Tag, UserCheck, Send, X, MessageSquare } from 'lucide-react';
import { certsApi } from '../../lib/api';
import { toast } from 'sonner';
import axios from 'axios';

const PINK = '#e94560';

/**
 * BatchCreator — form to create a new certificate batch.
 * Props:
 *   templates  — array from useCertificates hook
 *   onCreated  — callback(batch) called after successful create
 *   onCancel   — callback to close / dismiss the creator
 */
export default function BatchCreator({ templates = [], onCreated, onCancel }) {
  /* ── theme helpers ── */
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560] w-full';
  const labelCls  = `block text-xs ${textSec} mb-1`;

  /* ── form state ── */
  const [templateId, setTemplateId]   = useState('');
  const [source, setSource]           = useState('manual');   // 'manual' | 'session'
  const [sessions, setSessions]       = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionId, setSessionId]     = useState('');
  const [csvText, setCsvText]         = useState('');
  const [date, setDate]               = useState('');
  const [theme, setTheme]             = useState('');
  const [expert, setExpert]           = useState('');
  const [channels, setChannels]       = useState({ whatsapp: true, email: true });
  const [title, setTitle]             = useState('');
  const [submitting, setSubmitting]   = useState(false);

  /* ── mail-merge message templates (empty → backend defaults) ── */
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody]       = useState('');
  const [waCaption, setWaCaption]       = useState('');
  const subjectRef = useRef(null);
  const bodyRef    = useRef(null);
  const captionRef = useRef(null);
  const [activeField, setActiveField] = useState('email_body');

  const TOKENS = ['{Name}', '{Date}', '{Theme}', '{Conducted By}'];
  const MSG_FIELDS = {
    email_subject: { ref: subjectRef, set: setEmailSubject },
    email_body:    { ref: bodyRef,    set: setEmailBody    },
    wa_caption:    { ref: captionRef, set: setWaCaption    },
  };

  /* insert a {Token} at the caret of the last-focused message field */
  const insertToken = (tok) => {
    const f = MSG_FIELDS[activeField] || MSG_FIELDS.email_body;
    const el = f.ref.current;
    if (!el) { f.set(prev => prev + tok); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const next  = el.value.slice(0, start) + tok + el.value.slice(end);
    f.set(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tok.length;
      try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  /* ── load sessions when source switches to 'session' ── */
  useEffect(() => {
    if (source !== 'session') return;
    if (sessions.length > 0) return; // already loaded
    setSessionsLoading(true);
    axios
      .get(`${process.env.REACT_APP_BACKEND_URL}/api/training/sessions`, { withCredentials: true })
      .then(r => setSessions(r.data || []))
      .catch(() => toast.error('Failed to load training sessions'))
      .finally(() => setSessionsLoading(false));
  }, [source, sessions.length]);

  /* ── parse CSV textarea → attendee objects ── */
  const parseCsv = (text) => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          name:  parts[0] || '',
          phone: parts[1] || '',
          email: parts[2] || '',
        };
      })
      .filter(a => a.name);
  };

  /* ── channel toggle ── */
  const toggleChannel = (ch) =>
    setChannels(prev => ({ ...prev, [ch]: !prev[ch] }));

  /* ── submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim())      { toast.error('Batch title is required');   return; }
    if (!templateId)        { toast.error('Select a template');          return; }
    if (!channels.whatsapp && !channels.email) {
      toast.error('Select at least one delivery channel');
      return;
    }

    const chosenChannels = Object.entries(channels)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const body = {
      title: title.trim(),
      template_id: templateId,
      source,
      shared_values: {
        date:   date.trim(),
        theme:  theme.trim(),
        expert: expert.trim(),
      },
      channels: chosenChannels,
      email_subject: emailSubject.trim() || undefined,
      email_body:    emailBody.trim()    || undefined,
      wa_caption:    waCaption.trim()     || undefined,
    };

    if (source === 'session') {
      if (!sessionId) { toast.error('Select a training session'); return; }
      body.session_id = sessionId;
    } else {
      const attendees = parseCsv(csvText);
      if (attendees.length === 0) {
        toast.error('Enter at least one attendee (name,phone,email per line)');
        return;
      }
      body.attendees = attendees;
    }

    setSubmitting(true);
    try {
      const r = await certsApi.createBatch(body);
      const created = r?.data || r;
      toast.success(`Batch "${body.title}" created`);
      onCreated?.(created);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to create batch');
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── render ─── */
  return (
    <div className={`${card} border rounded-xl p-5 space-y-5`}>

      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: PINK + '18' }}>
            <Users className="h-4 w-4" style={{ color: PINK }} />
          </div>
          <p className={`font-semibold text-sm ${textPri}`}>New Certificate Batch</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={`p-1 rounded-lg ${textMuted} hover:bg-[var(--bg-hover)] transition-colors`}
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Title + Template */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Batch Title *</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. June 2026 Sales Workshop"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Template *</label>
            <select
              className={inputCls}
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
            >
              <option value="">— Select template —</option>
              {templates.map(t => (
                <option key={t.template_id || t._id} value={t.template_id || t._id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className={`text-xs ${textMuted} mt-1`}>No templates yet — create one in the Templates tab first.</p>
            )}
          </div>
        </div>

        {/* Shared values: Date / Theme / Expert */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={`${labelCls} flex items-center gap-1`}>
              <Calendar className="h-3 w-3" /> Date
            </label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. 10 June 2026"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className={`${labelCls} flex items-center gap-1`}>
              <Tag className="h-3 w-3" /> Theme / Topic
            </label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Sales Excellence"
              value={theme}
              onChange={e => setTheme(e.target.value)}
            />
          </div>
          <div>
            <label className={`${labelCls} flex items-center gap-1`}>
              <UserCheck className="h-3 w-3" /> Expert / Trainer
            </label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Ramesh Verma"
              value={expert}
              onChange={e => setExpert(e.target.value)}
            />
          </div>
        </div>

        {/* Source toggle */}
        <div>
          <label className={`${labelCls} mb-2`}>Attendee Source</label>
          <div className="flex gap-2">
            {[
              { id: 'manual',  label: 'Manual / CSV',      icon: AlignLeft  },
              { id: 'session', label: 'Training Session',  icon: BookOpen   },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${source === id
                    ? 'text-white border-transparent'
                    : `${textSec} border-[var(--border-color)] hover:bg-[var(--bg-hover)]`
                  }`}
                style={source === id ? { background: PINK } : {}}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Source: Training Session */}
        {source === 'session' && (
          <div>
            <label className={labelCls}>Training Session *</label>
            {sessionsLoading ? (
              <p className={`text-sm ${textMuted}`}>Loading sessions…</p>
            ) : (
              <select
                className={inputCls}
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
              >
                <option value="">— Select session —</option>
                {sessions.map(s => (
                  <option key={s._id || s.session_id || s.id} value={s._id || s.session_id || s.id}>
                    {s.name || s.title || s.topic || s._id}
                    {s.date ? ` — ${s.date}` : ''}
                  </option>
                ))}
              </select>
            )}
            {!sessionsLoading && sessions.length === 0 && (
              <p className={`text-xs ${textMuted} mt-1`}>No training sessions found.</p>
            )}
          </div>
        )}

        {/* Source: Manual / CSV */}
        {source === 'manual' && (
          <div>
            <label className={labelCls}>
              Attendees — one per line: <code className="text-xs font-mono">name, phone, email</code>
            </label>
            <textarea
              className={`${inputCls} font-mono resize-y`}
              rows={5}
              placeholder={'Amit Sharma, 9000000001, amit@example.com\nBina Rao, 9000000002, bina@example.com'}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
            />
            {csvText.trim() && (
              <p className={`text-xs ${textMuted} mt-1`}>
                {parseCsv(csvText).length} valid attendee{parseCsv(csvText).length !== 1 ? 's' : ''} parsed
              </p>
            )}
          </div>
        )}

        {/* Delivery channels */}
        <div>
          <label className={`${labelCls} mb-2`}>
            <Send className="h-3 w-3 inline mr-1" />
            Delivery Channels
          </label>
          <div className="flex gap-4">
            {[
              { key: 'whatsapp', label: 'WhatsApp' },
              { key: 'email',    label: 'Email'     },
            ].map(({ key, label }) => (
              <label key={key} className={`flex items-center gap-2 cursor-pointer text-sm ${textSec}`}>
                <input
                  type="checkbox"
                  checked={channels[key]}
                  onChange={() => toggleChannel(key)}
                  className="accent-[#e94560] h-4 w-4"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Message templates (mail-merge) */}
        <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className={`${labelCls} mb-0 flex items-center gap-1`}>
              <MessageSquare className="h-3 w-3" /> Message to attendee (optional)
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-xs ${textMuted}`}>Insert:</span>
              {TOKENS.map(tok => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => insertToken(tok)}
                  className={`px-1.5 py-0.5 rounded border border-[var(--border-color)] text-xs font-mono ${textSec} hover:bg-[var(--bg-hover)] transition-colors`}
                  title={`Insert ${tok} into the last-focused field`}
                >
                  {tok}
                </button>
              ))}
            </div>
          </div>
          <p className={`text-xs ${textMuted} -mt-1`}>
            Placeholders auto-fill per attendee. Leave blank to use the default message.
          </p>

          <div>
            <label className={labelCls}>Email subject</label>
            <input
              ref={subjectRef}
              type="text"
              className={inputCls}
              placeholder="Your Certificate — {Theme}"
              value={emailSubject}
              onFocus={() => setActiveField('email_subject')}
              onChange={e => setEmailSubject(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Email body</label>
            <textarea
              ref={bodyRef}
              className={`${inputCls} resize-y`}
              rows={4}
              placeholder={'Dear {Name},\n\nThank you for attending {Theme} on {Date}, conducted by {Conducted By}. Please find your certificate attached.'}
              value={emailBody}
              onFocus={() => setActiveField('email_body')}
              onChange={e => setEmailBody(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>WhatsApp caption</label>
            <input
              ref={captionRef}
              type="text"
              className={inputCls}
              placeholder="Dear {Name}, please find your certificate for {Theme} attached."
              value={waCaption}
              onFocus={() => setActiveField('wa_caption')}
              onChange={e => setWaCaption(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={`px-4 py-1.5 rounded-lg border border-[var(--border-color)] text-sm ${textSec} hover:bg-[var(--bg-hover)] transition-colors`}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: PINK }}
          >
            <Users className="h-4 w-4" />
            {submitting ? 'Creating…' : 'Create Batch'}
          </button>
        </div>

      </form>
    </div>
  );
}
