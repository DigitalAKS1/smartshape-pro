import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { whatsappTemplates, whatsappSend } from '../lib/api';
import { toast } from 'sonner';
import { MessageSquare, Send, ExternalLink, Save } from 'lucide-react';

/**
 * Reusable WhatsApp send dialog used across CRM, Visit, Order modules.
 * Props:
 *  - open, onOpenChange
 *  - module: one of 'lead'|'contact'|'school'|'visit'|'order'|'dispatch'|'quotation'|'general'
 *  - context: { lead_id?, contact_id?, school_id?, order_id?, phone?, contact_name?, school_name? }
 *  - title?: string
 */
export default function WhatsAppSendDialog({ open, onOpenChange, module = 'general', context = {}, title = 'Send WhatsApp' }) {
  const [templates, setTemplates] = useState([]);
  const [selTplId, setSelTplId] = useState('');
  const [body, setBody] = useState('');
  const [phone, setPhone] = useState(context.phone || '');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelTplId('');
    setBody('');
    setPhone(context.phone || '');
    setShowSaveAs(false);
    setNewName('');
    (async () => {
      try {
        const res = await whatsappTemplates.getAll({ module });
        const all = res.data || [];
        if (all.length === 0) {
          // fallback to general
          const g = await whatsappTemplates.getAll();
          setTemplates(g.data || []);
        } else {
          setTemplates(all);
        }
      } catch { setTemplates([]); }
    })();
  }, [open, module]); // eslint-disable-line

  const renderTemplate = async (templateId) => {
    setSelTplId(templateId);
    if (!templateId) { setBody(''); return; }
    setLoading(true);
    try {
      const res = await whatsappSend.render({
        template_id: templateId,
        phone,
        lead_id: context.lead_id,
        contact_id: context.contact_id,
        school_id: context.school_id,
        order_id: context.order_id,
      });
      setBody(res.data.body || '');
      if (!phone && res.data.phone) setPhone(res.data.phone);
    } catch { toast.error('Failed to render template'); }
    finally { setLoading(false); }
  };

  const sendViaApi = async () => {
    if (!phone || !body) { toast.error('Phone & message required'); return; }
    setSaving(true);
    try {
      const res = await whatsappSend.sendVia({
        template_id: selTplId || undefined,
        phone, body, send_mode: 'api',
        lead_id: context.lead_id, contact_id: context.contact_id,
        school_id: context.school_id, order_id: context.order_id,
      });
      const status = res.data?.status;
      if (status === 'sent') toast.success('WhatsApp sent via API');
      else if (status === 'wa_not_configured') toast.warning('WhatsApp API not configured. Use Open WhatsApp App instead.');
      else toast.error(`Send result: ${status}`);
      onOpenChange(false);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to send'); }
    finally { setSaving(false); }
  };

  const openWhatsAppApp = async () => {
    if (!phone || !body) { toast.error('Phone & message required'); return; }
    const cleaned = String(phone).replace(/\D/g, '');
    const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
    // Also log as manual sent
    try {
      await whatsappSend.sendVia({
        template_id: selTplId || undefined,
        phone, body, send_mode: 'manual',
        lead_id: context.lead_id, contact_id: context.contact_id,
        school_id: context.school_id, order_id: context.order_id,
      });
    } catch { /* non-blocking */ }
    onOpenChange(false);
  };

  const saveAsTemplate = async () => {
    const name = (newName || '').trim();
    if (!name || !body) { toast.error('Template name + body required'); return; }
    try {
      await whatsappTemplates.create({ name, module, body, category: 'custom' });
      toast.success('Template saved');
      const res = await whatsappTemplates.getAll({ module });
      setTemplates(res.data || []);
      setShowSaveAs(false); setNewName('');
    } catch { toast.error('Failed to save template'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-[var(--bg-card)] border-[var(--border-color)]" data-testid="whatsapp-send-dialog" aria-describedby="wa-dialog-desc">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-green-500" /> {title}
          </DialogTitle>
          <p id="wa-dialog-desc" className="sr-only">Choose a WhatsApp template or type a custom message and send via API or open in the WhatsApp app.</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Phone Number *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" placeholder="+91 98xxxxxxxx" data-testid="wa-phone-input" />
          </div>
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Choose Template</Label>
            <select value={selTplId} onChange={(e) => renderTemplate(e.target.value)} className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm" data-testid="wa-template-select">
              <option value="">-- Type custom message --</option>
              {templates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.name} ({t.category})
                </option>
              ))}
            </select>
            {loading && <p className="text-xs text-[var(--text-muted)] mt-1">Rendering...</p>}
          </div>
          <div>
            <Label className="text-[var(--text-secondary)] text-xs">Message *</Label>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md text-sm"
              placeholder="Type or pick a template above. Use {contact_name}, {school_name}, {my_name} as placeholders."
              data-testid="wa-body-input"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Tip: placeholders like {'{contact_name}'} are auto-resolved from selected template.</p>
          </div>
          {!showSaveAs ? (
            <button type="button" onClick={() => setShowSaveAs(true)} className="text-xs text-[#e94560] hover:underline flex items-center gap-1" data-testid="wa-save-as-btn">
              <Save className="h-3 w-3" /> Save current message as a template
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Template name" className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] text-sm h-9" data-testid="wa-new-template-name" />
              <Button size="sm" onClick={saveAsTemplate} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9" data-testid="wa-save-template-confirm">Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSaveAs(false)} className="text-[var(--text-muted)] h-9">Cancel</Button>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={openWhatsAppApp} variant="outline" className="border-green-600 text-green-500 hover:bg-green-500/10" data-testid="wa-open-app-btn">
            <ExternalLink className="mr-1 h-4 w-4" /> Open WhatsApp App
          </Button>
          <Button onClick={sendViaApi} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white" data-testid="wa-send-api-btn">
            <Send className="mr-1 h-4 w-4" /> {saving ? 'Sending...' : 'Send via API'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
