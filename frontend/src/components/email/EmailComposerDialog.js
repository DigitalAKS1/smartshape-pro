import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Eye, Send, FlaskConical, Save } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { email as emailApi, contacts as contactsApi, tags as tagsApi, contactRoles as contactRolesApi } from '../../lib/api';
import HtmlBodyEditor from './HtmlBodyEditor';
import RecipientPicker from './RecipientPicker';

const FIELD_OPTS = [
  { key: '{name}', label: 'Contact name — {name}' },
  { key: '{school_name}', label: 'School name — {school_name}' },
];

const inp = 'w-full h-10 px-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]';
const selectCls = 'h-9 px-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]';
const label = 'text-xs font-medium text-[var(--text-muted)] mb-1.5 block';

/**
 * EmailComposerDialog — reusable ad-hoc email composer.
 *
 * Props:
 *   open:           boolean — controls dialog visibility
 *   onClose:        () => void — called on cancel/close and after a successful send
 *   source:         string — origin tag sent to the backend for attribution (e.g. 'crm', 'school_profile')
 *   sourceId:       string|number — id of the origin record, sent alongside `source`
 *   initialSubject: string — subject seeded into state whenever the dialog opens
 *   initialHtml:    string — HTML body seeded into state whenever the dialog opens
 */
export default function EmailComposerDialog({ open, onClose, source, sourceId, initialSubject = '', initialHtml = '' }) {
  const [subject, setSubject] = useState(initialSubject);
  const [html, setHtml] = useState(initialHtml);
  const [insertField, setInsertField] = useState('');

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');

  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [roles, setRoles] = useState([]);
  const [recipientIds, setRecipientIds] = useState([]);
  const [loadedRecipients, setLoadedRecipients] = useState(false);

  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);

  // Seed/reset state whenever the dialog is opened.
  useEffect(() => {
    if (!open) return;
    setSubject(initialSubject || '');
    setHtml(initialHtml || '');
    setInsertField('');
    setTemplateId('');
    setRecipientIds([]);
    setShowPreview(false);
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load templates + recipients data once per open (guard against reload while open).
  useEffect(() => {
    if (!open || loadedRecipients) return;
    emailApi.getTemplates().then(r => setTemplates(r.data || [])).catch(() => {});
    contactsApi.getAll().then(r => setContacts(r.data || [])).catch(() => {});
    tagsApi.getAll().then(r => setAllTags(r.data || [])).catch(() => {});
    contactRolesApi.getAll().then(r => setRoles(r.data || [])).catch(() => {});
    setLoadedRecipients(true);
  }, [open, loadedRecipients]);

  useEffect(() => {
    if (!open) setLoadedRecipients(false);
  }, [open]);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose && onClose();
  }, [sending, onClose]);

  function applyInsertField(target) {
    if (!insertField) return;
    if (target === 'subject') {
      setSubject(prev => `${prev}${insertField}`);
    } else {
      setHtml(prev => `${prev || ''}${insertField}`);
    }
  }

  function loadTemplate(id) {
    setTemplateId(id);
    if (!id) return;
    const tmpl = templates.find(t => t.template_id === id);
    if (!tmpl) return;
    setSubject(tmpl.subject || '');
    setHtml(tmpl.body_html || tmpl.body || '');
  }

  async function saveAsTemplate() {
    const name = window.prompt('Template name?');
    if (!name || !name.trim()) return;
    try {
      await emailApi.createTemplate({ name: name.trim(), subject, body_html: html, category: 'custom' });
      toast.success('Saved as template');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save template');
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await emailApi.sendTest({ subject, body_html: html });
      toast.success('Test email sent');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to send test email');
    } finally {
      setTesting(false);
    }
  }

  function clickSend() {
    if (recipientIds.length === 0) { toast.error('Select at least one recipient'); return; }
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!html.trim()) { toast.error('Email body is required'); return; }
    setConfirming(true);
  }

  async function confirmSend() {
    setSending(true);
    try {
      const res = await emailApi.sendNow({
        subject,
        body_html: html,
        recipient_ids: recipientIds,
        source,
        source_id: sourceId,
      });
      toast.success(`Queued ${res.data?.queued ?? recipientIds.length}`);
      setConfirming(false);
      onClose && onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to send email');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#e94560]" />
            Compose Email
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Insert field */}
          <div className="flex items-center gap-2">
            <select value={insertField} onChange={e => setInsertField(e.target.value)} className={selectCls}>
              <option value="">Insert field…</option>
              {FIELD_OPTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <Button type="button" size="sm" variant="outline" className="h-9 border-[var(--border-color)] text-[var(--text-secondary)] text-xs"
              disabled={!insertField} onClick={() => applyInsertField('subject')}>
              → Subject
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-9 border-[var(--border-color)] text-[var(--text-secondary)] text-xs"
              disabled={!insertField} onClick={() => applyInsertField('html')}>
              → Body
            </Button>
          </div>

          {/* Subject */}
          <div>
            <label className={label}>Subject</label>
            <input className={inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…" />
          </div>

          {/* Content */}
          <div>
            <label className={label}>Content</label>
            <HtmlBodyEditor value={html} onChange={setHtml} />
          </div>

          {/* Template row */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border-color)] pt-3">
            <select value={templateId} onChange={e => loadTemplate(e.target.value)} className={`${selectCls} flex-1 min-w-[160px]`}>
              <option value="">Load template…</option>
              {templates.map(t => (
                <option key={t.template_id} value={t.template_id}>{t.name}</option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1 border-[var(--border-color)] text-[var(--text-secondary)] text-xs"
              onClick={saveAsTemplate}>
              <Save className="h-3.5 w-3.5" /> Save as template
            </Button>
          </div>

          {/* Recipients */}
          <RecipientPicker
            contacts={contacts}
            allTags={allTags}
            roles={roles}
            selectedIds={recipientIds}
            onChange={setRecipientIds}
          />

          {/* Guardrails row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" size="sm" variant="outline"
              className={`h-9 gap-1 text-xs border-[var(--border-color)] ${showPreview ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
              onClick={() => setShowPreview(p => !p)}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1 text-xs border-[var(--border-color)] text-[var(--text-secondary)]"
              disabled={testing} onClick={sendTest}>
              <FlaskConical className="h-3.5 w-3.5" /> {testing ? 'Sending…' : 'Send test to me'}
            </Button>
            <div className="flex-1" />
            <Button type="button" size="sm" className="h-9 gap-1 bg-[#e94560] hover:bg-[#f05c75] text-white text-xs"
              disabled={sending} onClick={clickSend}>
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </div>

          {showPreview && (
            <div className="border border-[var(--border-color)] rounded-xl p-4 bg-white/2">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">{subject || '(No subject)'}</p>
              <div
                className="text-sm text-[var(--text-secondary)] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html || '') }}
              />
            </div>
          )}

          {confirming && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#e94560]/40 bg-[#e94560]/5">
              <p className="text-xs text-[var(--text-primary)]">
                Send to {recipientIds.length} recipient{recipientIds.length !== 1 ? 's' : ''}?
              </p>
              <div className="flex gap-2 flex-shrink-0">
                <Button type="button" size="sm" variant="outline" className="h-8 border-[var(--border-color)] text-[var(--text-secondary)] text-xs"
                  disabled={sending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-8 bg-[#e94560] hover:bg-[#f05c75] text-white text-xs"
                  disabled={sending} onClick={confirmSend}>
                  {sending ? 'Sending…' : 'Confirm & Send'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
