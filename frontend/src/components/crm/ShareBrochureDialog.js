import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { brochures } from '../../lib/api';
import { X, Link2, Copy, Check, MessageCircle, BookOpen, Eye } from 'lucide-react';

const LS_KEY = 'ss_last_brochure_url';

// Share a brochure as a TRACKED link. Opening it flips the share to "opened",
// logs a Timeline event and raises a hot call-back for the owner (Phase 3).
export default function ShareBrochureDialog({ open, onClose, context = {} }) {
  const { leadId = '', schoolId = '', contactId = '', schoolName = '', phone = '' } = context;
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('Brochure');
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [prior, setPrior] = useState([]);

  const loadPrior = useCallback(async () => {
    const params = {};
    if (leadId) params.lead_id = leadId;
    else if (schoolId) params.school_id = schoolId;
    else if (contactId) params.contact_id = contactId;
    if (!Object.keys(params).length) return;
    try { const r = await brochures.listShares(params); setPrior(Array.isArray(r.data) ? r.data : []); }
    catch { /* non-fatal */ }
  }, [leadId, schoolId, contactId]);

  useEffect(() => {
    if (!open) return;
    setShareUrl(''); setCopied(false);
    try { const last = localStorage.getItem(LS_KEY); if (last) setUrl(last); } catch { /* ignore */ }
    loadPrior();
  }, [open, loadPrior]);

  if (!open) return null;

  const create = async () => {
    if (!url.trim()) { toast.error('Paste the brochure link (PDF or web URL)'); return; }
    setBusy(true);
    try {
      const r = await brochures.share({
        brochure_url: url.trim(), title: title.trim() || 'Brochure',
        lead_id: leadId, school_id: schoolId, contact_id: contactId, school_name: schoolName,
      });
      setShareUrl(r.data.share_url);
      try { localStorage.setItem(LS_KEY, url.trim()); } catch { /* ignore */ }
      toast.success('Tracked link ready — share it');
      loadPrior();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to create link'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { toast.error('Copy failed — select and copy manually'); }
  };

  const wa = () => {
    const text = encodeURIComponent(`${title} — have a look: ${shareUrl}`);
    const to = (phone || '').replace(/[^\d]/g, '');
    window.open(to ? `https://wa.me/${to}?text=${text}` : `https://wa.me/?text=${text}`, '_blank');
  };

  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="share-brochure-dialog">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><BookOpen className="h-4 w-4 text-[#f97316]" /> Share Brochure</h3>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Tracked link{schoolName ? <> for <b className="text-[var(--text-secondary)]">{schoolName}</b></> : ''}. You'll know the moment they open it.
        </p>

        <div className="grid gap-2.5">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Brochure link (PDF or web)</label>
            <input className={inp + ' mt-1'} placeholder="https://…/brochure.pdf" value={url} onChange={e => setUrl(e.target.value)} data-testid="brochure-url" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">Title</label>
            <input className={inp + ' mt-1'} value={title} onChange={e => setTitle(e.target.value)} data-testid="brochure-title" />
          </div>

          {!shareUrl ? (
            <button className="h-10 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
              disabled={busy} onClick={create} data-testid="brochure-create">
              <Link2 className="h-4 w-4" /> {busy ? 'Creating…' : 'Create tracked link'}
            </button>
          ) : (
            <div className="rounded-lg border border-[var(--border-color)] p-2.5 space-y-2">
              <div className="text-[11px] break-all text-[var(--text-secondary)] font-mono bg-[var(--bg-primary)] rounded p-2">{shareUrl}</div>
              <div className="flex gap-2">
                <button onClick={copy} className="flex-1 h-9 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-semibold flex items-center justify-center gap-1.5">
                  {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
                <button onClick={wa} className="flex-1 h-9 rounded-lg bg-green-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>

        {prior.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">Previously shared</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {prior.map(s => {
                const opened = s.status === 'opened';
                return (
                  <div key={s.share_id} className="flex items-center gap-2 text-xs rounded-lg border border-[var(--border-color)] px-2.5 py-1.5">
                    <span className="flex-1 truncate text-[var(--text-secondary)]">{s.title}</span>
                    {opened ? (
                      <span className="flex items-center gap-1 text-green-500 font-semibold flex-shrink-0"><Eye className="h-3 w-3" /> Opened{s.open_count > 1 ? ` ×${s.open_count}` : ''}</span>
                    ) : (
                      <span className="text-[var(--text-muted)] flex-shrink-0">Not opened yet</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
