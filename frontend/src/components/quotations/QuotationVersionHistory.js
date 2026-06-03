import React, { useState, useEffect } from 'react';
import { X, History, Loader2, MessageCircle, Smartphone, Monitor, Check, Copy } from 'lucide-react';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import API from '../../lib/api';

const fmtRound = (n) =>
  typeof n === 'number' ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';

const fmtDateTime = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso?.slice(0, 10) || ''; }
};

// ── Version / Edit History Panel ───────────────────────────────────────────────
export function HistoryPanel({ quotId, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/quotations/${quotId}/history`)
      .then(r => setHistory(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [quotId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-[var(--bg-card)] border border-[var(--border-color)] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-blue-400" />
            <span className="font-bold text-[var(--text-primary)]">Edit History</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] p-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">No edit history for this quotation</div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {history.map((h, i) => (
                <div key={h.history_id || i} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {history.length - i}
                    </span>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{h.edited_by_name || h.edited_by}</span>
                    <span className="text-xs text-[var(--text-muted)] ml-auto">{fmtDateTime(h.edited_at)}</span>
                  </div>
                  {h.edit_reason && (
                    <p className="text-xs text-[var(--text-secondary)] ml-8">{h.edit_reason}</p>
                  )}
                  {h.previous_snapshot?.grand_total != null && (
                    <p className="text-xs text-[var(--text-muted)] ml-8 mt-0.5">
                      Previous total: {fmtRound(h.previous_snapshot.grand_total)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WhatsApp Picker Dialog ─────────────────────────────────────────────────────
function buildMessage(q, l) {
  if (!q) return '';
  const name = q.principal_name || q.school_name || 'there';
  const total = `${q.currency_symbol || '₹'}${Math.round(q.grand_total || 0).toLocaleString('en-IN')}`;
  return (
`Dear ${name},

Greetings from *SMARTS-SHAPES*! 🎓

We are delighted to share your personalized quotation and product catalogue. Please find the details below:

🏫 *School:* ${q.school_name || ''}
📦 *Package:* ${q.package_name || ''}
💰 *Total Amount:* ${total}
🔖 *Quotation No:* ${q.quote_number || ''}

Please browse your personalised catalogue and select your preferred dies:
👉 ${l || '(generating link…)'}

SMARTS-SHAPES is a zero-maintenance die-cutting solution trusted by schools across India to create engaging, visually enriched classrooms — saving teachers up to *80% of preparation time*.

For any queries or to confirm your order, feel free to reach out.

Warm regards,
*${q.sales_person_name || 'SMARTS-SHAPES Team'}*
SMARTS-SHAPES
_A smarter way to create engaging classrooms_ ✨`
  );
}

export function WhatsAppDialog({ open, onClose, quot, link, generating }) {
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && quot) setPhone(quot.customer_phone || '');
  }, [open, quot]);

  const num = phone.replace(/\D/g, '');
  const e164 = num ? (num.startsWith('91') ? num : '91' + num) : '';
  const encoded = encodeURIComponent(buildMessage(quot, link));

  const openWa = (type) => {
    if (!e164) { toast.error('Please enter a phone number'); return; }
    const url = type === 'web'
      ? `https://web.whatsapp.com/send?phone=${e164}&text=${encoded}`
      : `https://wa.me/${e164}?text=${encoded}`;
    window.open(url, '_blank');
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-[var(--bg-card)] border border-[var(--border-color)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#25d366]/15 flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-[#25d366]" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">Send via WhatsApp</p>
              {quot && <p className="text-xs text-[var(--text-muted)] truncate max-w-[220px]">{quot.school_name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] p-1.5 rounded-lg hover:bg-[var(--bg-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">Phone Number</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210"
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] h-10" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Message Preview</label>
              {link && (
                <button onClick={copyLink} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                  {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy link</>}
                </button>
              )}
            </div>
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3.5 max-h-52 overflow-y-auto">
              {generating ? (
                <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating catalogue link…
                </div>
              ) : (
                <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                  {buildMessage(quot, link)}
                </pre>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => openWa('app')} disabled={generating || !link}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25d366] hover:bg-[#22c55e] text-white font-semibold text-sm disabled:opacity-40 transition-colors active:opacity-80">
              <Smartphone className="h-4 w-4" /> WhatsApp App
            </button>
            <button onClick={() => openWa('web')} disabled={generating || !link}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#075e54] hover:bg-[#065049] text-white font-semibold text-sm disabled:opacity-40 transition-colors active:opacity-80">
              <Monitor className="h-4 w-4" /> WhatsApp Web
            </button>
          </div>
          {!link && !generating && (
            <p className="text-xs text-amber-400 text-center">Link generation failed. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  );
}
