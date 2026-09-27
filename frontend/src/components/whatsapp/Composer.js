// Team inbox — the reply box: Enter sends, Shift+Enter breaks the line, a paperclip uploads a
// file and sends it with the text as caption, and the template picker pre-fills the box
// (rendered server-side for this chat's contact/school) so the rep can edit before sending.
// Disabled, with the reason shown, when the chat's number is not connected.
import React, { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, FileText, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { waInbox } from '../../lib/api';

const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};

export const STATE_REASON = {
  qr: 'This number is waiting for a QR scan',
  disconnected: 'This number is disconnected — ask its owner to relink it',
  paused: 'This number is paused — ask an admin to resume it',
  unlinked: 'This number is not linked',
};

/** Why the box is off, or '' when it may send. `instanceState` is the live state of the
 *  chat's number (undefined = not known → allowed). */
export function disabledReason({ chat, instanceState } = {}) {
  if (!chat) return 'Pick a chat first';
  if (chat.opted_out) return 'This number opted out of WhatsApp messages';
  const state = instanceState || chat.instance_state;
  if (state && state !== 'connected') return STATE_REASON[state] || `This number is ${state}`;
  return '';
}

/**
 * Props: chat, instanceState, sending, onSend({text, attachment_id, template_id}).
 */
export default function Composer({ chat, instanceState, sending, onSend }) {
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState(null);      // null = not loaded yet
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState('');                  // 'upload' | 'render' | ''
  const fileInput = useRef(null);
  const textarea = useRef(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setText(''); setPickerOpen(false); }, [chat?.chat_id]);

  const reason = disabledReason({ chat, instanceState });
  const off = !!reason || !!busy;

  const loadTemplates = async () => {
    if (templates !== null) return;
    try {
      const res = await waInbox.templates();
      if (alive.current) setTemplates(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      if (alive.current) { setTemplates([]); toast.error(errText(e, 'Could not load templates')); }
    }
  };

  const openPicker = () => {
    setPickerOpen((o) => !o);
    loadTemplates();
  };

  const pickTemplate = async (tpl) => {
    setPickerOpen(false);
    setBusy('render');
    try {
      const res = await waInbox.renderTemplate({
        template_id: tpl.template_id, contact_id: chat?.contact_id || undefined,
        school_id: chat?.school_id || undefined, lead_id: chat?.lead_id || undefined,
      });
      const body = res?.data?.body;
      if (alive.current) {
        setText(typeof body === 'string' ? body : (tpl.body || ''));
        textarea.current?.focus();
      }
    } catch (e) {
      if (alive.current) { setText(tpl.body || ''); toast.error(errText(e, 'Could not render the template')); }
    } finally {
      if (alive.current) setBusy('');
    }
  };

  const submit = () => {
    const value = text.trim();
    if (!value || off || sending) return;
    onSend?.({ text: value });
    setText('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || off) return;
    setBusy('upload');
    try {
      const res = await waInbox.uploadAttachment(file);
      const id = res?.data?.attachment_id;
      if (!id) throw new Error('no attachment id');
      const caption = text.trim();
      onSend?.({ text: caption || undefined, attachment_id: id });
      if (alive.current) setText('');
    } catch (err) {
      toast.error(errText(err, 'Could not upload the file'));
    } finally {
      if (alive.current) setBusy('');
    }
  };

  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--bg-card)] p-2" data-testid="composer">
      {reason && (
        <p data-testid="composer-reason" className="px-1 pb-1.5 text-[11px] text-red-500">{reason}</p>
      )}
      {pickerOpen && (
        <div data-testid="template-picker"
          className="mb-2 max-h-48 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-sm">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-color)]">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Templates</span>
            <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close templates"
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          {templates === null && <p className="px-3 py-2 text-xs text-[var(--text-secondary)]">Loading…</p>}
          {templates && templates.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-secondary)]">No templates yet</p>}
          {templates && templates.map((t) => (
            <button key={t.template_id} type="button" data-testid="template-option" onClick={() => pickTemplate(t)}
              className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-[var(--bg-hover)] border-b border-[var(--border-color)] last:border-b-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name || t.template_id}</p>
              {t.body && <p className="text-[11px] text-[var(--text-secondary)] truncate">{t.body}</p>}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input ref={fileInput} type="file" className="hidden" data-testid="composer-file"
          accept="image/jpeg,image/png,video/mp4,application/pdf" onChange={onFile} />
        <button type="button" data-testid="composer-attach" onClick={() => fileInput.current?.click()}
          disabled={off || sending} title="Attach a file" aria-label="Attach a file"
          className="w-11 h-11 flex items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed">
          {busy === 'upload' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
        </button>
        <button type="button" data-testid="composer-template" onClick={openPicker}
          disabled={off || sending} title="Use a template" aria-label="Use a template" aria-expanded={pickerOpen}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed">
          {busy === 'render' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
        </button>
        <textarea ref={textarea} data-testid="composer-text" value={text} rows={1}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          disabled={!!reason} placeholder={reason ? 'Sending is off' : 'Type a message'}
          aria-label="Message"
          className="flex-1 min-h-[44px] max-h-40 resize-y rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-60" />
        <button type="button" data-testid="composer-send" onClick={submit}
          disabled={off || sending || !text.trim()} title="Send" aria-label="Send"
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-[#e94560] hover:bg-[#f05c75] text-white disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
