import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Send, Edit2, Trash2, Eye, Search } from 'lucide-react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { catalogues as catApi, productTypes as ptApi, schools as schoolsApi } from '../../lib/api';
import useLookup from '../../hooks/useLookup';

const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto';
const BLANK = { name: '', intro: '', categories: [], product_type_ids: [], die_ids: [] };

function Chips({ options, values, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = values.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${on ? 'bg-[#e94560] border-[#e94560] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function EditDialog({ open, onOpenChange, existing, onSaved }) {
  const cats = useLookup('product_category');
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(existing ? { ...BLANK, ...existing } : BLANK);
    ptApi.getAll().then(r => setTypes(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [open, existing]);
  const tog = (k, id) => setForm(f => ({ ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id] }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Give the catalogue a name'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name, intro: form.intro, categories: form.categories, product_type_ids: form.product_type_ids, die_ids: form.die_ids };
      if (existing) await catApi.update(existing.catalogue_id, payload); else await catApi.create(payload);
      toast.success(existing ? 'Catalogue updated' : 'Catalogue created');
      onOpenChange(false); onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dlgCls}>
        <DialogHeader><DialogTitle>{existing ? 'Edit catalogue' : 'New catalogue'}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div><Label className="text-xs text-[var(--text-secondary)]">Name *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Flowers & Leaves 2026" data-testid="cat-name" /></div>
          <div><Label className="text-xs text-[var(--text-secondary)]">Intro for the school (optional)</Label>
            <textarea rows={3} value={form.intro} onChange={e => setForm({ ...form, intro: e.target.value })}
              className={`w-full rounded-md px-3 py-2 text-sm border ${inputCls}`} placeholder="Shown at the top of the catalogue and in the email" /></div>
          <div>
            <Label className="text-xs text-[var(--text-secondary)]">Categories</Label>
            <Chips options={cats.activeItems.map(c => ({ id: c.value, label: c.name }))} values={form.categories} onToggle={id => tog('categories', id)} />
          </div>
          {types.length > 0 && (
            <div>
              <Label className="text-xs text-[var(--text-secondary)]">Product types</Label>
              <Chips options={types.filter(t => t.visible_to_schools !== false).map(t => ({ id: t.product_type_id, label: t.name }))}
                values={form.product_type_ids} onToggle={id => tog('product_type_ids', id)} />
            </div>
          )}
          <p className="text-[11px] text-[var(--text-muted)]">A product is included if it matches ANY chosen category or type. Choose nothing to include every product schools can see.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="cat-save">{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({ open, onOpenChange, catalogue, onSent }) {
  const [schools, setSchools] = useState([]);
  const [q, setQ] = useState('');
  const [school, setSchool] = useState(null);
  const [emails, setEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('email');            // email | whatsapp | link
  const [phone, setPhone] = useState('');
  const [made, setMade] = useState(null);               // {link, ...} once a link share exists
  useEffect(() => {
    if (!open) return;
    setQ(''); setSchool(null); setEmails(''); setMode('email'); setPhone(''); setMade(null);
    schoolsApi.getAll().then(r => setSchools(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => {});
  }, [open]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return schools.filter(s => (s.school_name || '').toLowerCase().includes(t)).slice(0, 8);
  }, [q, schools]);

  const pick = (s) => { setSchool(s); setQ(s.school_name); setEmails(s.email || ''); setPhone(s.phone || ''); setMade(null); };

  const message = (link) => `Namaste${school?.school_name ? ` ${school.school_name}` : ''}! Here is our "${catalogue?.name}" catalogue — tap the dies you like and send your selection, we'll reply with a quotation:\n${link}`;
  const waNumber = (p) => {
    const d = String(p || '').replace(/\D/g, '');
    return d.length === 10 ? `91${d}` : d;
  };
  const makeLink = async () => {
    setSending(true);
    try {
      const r = await catApi.send(catalogue.catalogue_id, { mode: 'link', channel: mode, school_id: school?.school_id || null });
      setMade(r.data);
      if (!phone && r.data.school_phone) setPhone(r.data.school_phone);
      onSent();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not create link'); } finally { setSending(false); }
  };
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); } catch { toast.error('Copy failed — select and copy manually'); }
  };

  const send = async () => {
    setSending(true);
    try {
      const r = await catApi.send(catalogue.catalogue_id, { school_id: school?.school_id || null, emails });
      const d = r.data;
      if (d.sent.length) toast.success(`Catalogue sent to ${d.sent.join(', ')}`);
      if (d.failed?.length) toast.error(`Could not send to ${d.failed.join(', ')} — check email settings`);
      if (d.invalid?.length) toast.error(`Skipped invalid: ${d.invalid.join(', ')}`);
      onOpenChange(false); onSent();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Send failed'); } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dlgCls}>
        <DialogHeader><DialogTitle>Send "{catalogue?.name}"</DialogTitle></DialogHeader>
        <p className="text-xs text-[var(--text-muted)] -mt-1">What the school chooses arrives in Quotation Requests — no quotation needed first.</p>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-md border border-[var(--border-color)]">
          {[['email', 'Email'], ['whatsapp', 'WhatsApp'], ['link', 'Copy link']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setMode(k); setMade(null); }} data-testid={`cat-mode-${k}`}
              className={`py-1.5 rounded text-sm font-medium ${mode === k ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>{l}</button>
          ))}
        </div>
        <div className="space-y-3 py-1">
          <div className="relative">
            <Label className="text-xs text-[var(--text-secondary)]">School (optional — links the request and shows what they already own)</Label>
            <Search className="absolute left-2.5 top-[30px] h-3.5 w-3.5 text-[var(--text-muted)]" />
            <Input value={q} onChange={e => { setQ(e.target.value); setSchool(null); }} className={`${inputCls} pl-8`} placeholder="Type a school name…" data-testid="cat-send-school" />
            {!school && matches.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] shadow-lg max-h-56 overflow-y-auto">
                {matches.map(s => (
                  <button key={s.school_id} type="button" onClick={() => pick(s)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]">
                    {s.school_name}{s.city ? <span className="text-[var(--text-muted)]"> · {s.city}</span> : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mode === 'email' && (
            <div><Label className="text-xs text-[var(--text-secondary)]">Email ID(s) *</Label>
              <Input value={emails} onChange={e => setEmails(e.target.value)} className={inputCls} placeholder="principal@school.in, office@school.in" data-testid="cat-send-emails" /></div>
          )}
          {mode === 'whatsapp' && (
            <div><Label className="text-xs text-[var(--text-secondary)]">WhatsApp number {school ? '' : '(optional — leave blank to choose the chat in WhatsApp)'}</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="98xxxxxxxx" data-testid="cat-send-phone" /></div>
          )}
          {mode !== 'email' && !school && (
            <p className="text-[11px] text-amber-500">No school picked → a <b>common link</b> for broadcasts / WhatsApp marketing. Each school that opens it gives its own name and email.</p>
          )}
          {made && (
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 space-y-2" data-testid="cat-made-link">
              <p className="text-xs break-all font-mono text-[var(--text-primary)]">{made.link}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 border-[var(--border-color)] text-[var(--text-secondary)]" onClick={() => copy(made.link, 'Link')}>Copy link</Button>
                <Button size="sm" variant="outline" className="h-8 border-[var(--border-color)] text-[var(--text-secondary)]" onClick={() => copy(message(made.link), 'Message')}>Copy message</Button>
                {mode === 'whatsapp' && (
                  <a href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(message(made.link))}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-green-600 hover:bg-green-700 text-white" data-testid="cat-open-wa">
                    Open WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">{made ? 'Done' : 'Cancel'}</Button>
          {mode === 'email' ? (
            <Button onClick={send} disabled={sending || !emails.trim()} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="cat-send-btn">
              <Send className="h-3.5 w-3.5 mr-1" /> {sending ? 'Sending…' : 'Send'}
            </Button>
          ) : !made && (
            <Button onClick={makeLink} disabled={sending} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="cat-make-link">
              {sending ? 'Creating…' : mode === 'whatsapp' ? 'Create link for WhatsApp' : 'Create link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CatalogueMaster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState({ open: false, existing: null });
  const [sendFor, setSendFor] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    catApi.list().then(r => setRows(Array.isArray(r.data) ? r.data : [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"? Links already sent will stop working.`)) return;
    try { await catApi.remove(c.catalogue_id); toast.success('Deleted'); load(); } catch (e) { toast.error(e?.response?.data?.detail || 'Delete failed'); }
  };
  const showPreview = async (c) => {
    try { const r = await catApi.preview(c.catalogue_id); setPreview(r.data); } catch { toast.error('Could not load preview'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="catalogue-master-title">Catalogue Master</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Make catalogues once, then email them to any school — no quotation needed. Their picks land in Quotation Requests.</p>
          </div>
          <Button onClick={() => setEdit({ open: true, existing: null })} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="cat-new">
            <Plus className="h-4 w-4 mr-1" /> New catalogue
          </Button>
        </div>

        {loading ? <p className="text-sm text-[var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md py-14 text-center">
            <BookOpen className="h-10 w-10 mx-auto mb-2 text-[var(--text-muted)] opacity-40" />
            <p className="text-sm text-[var(--text-muted)]">No catalogues yet. Create one — e.g. "Full range" or "Flowers only".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map(c => (
              <div key={c.catalogue_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`cat-row-${c.catalogue_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{c.die_count} products · sent {c.shares?.sent + c.shares?.opened + c.shares?.submitted || 0} · opened {(c.shares?.opened || 0) + (c.shares?.submitted || 0)} · replied {c.shares?.submitted || 0}</p>
                  </div>
                  <div className="flex shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-[var(--text-secondary)]" title="Preview" onClick={() => showPreview(c)}><Eye className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-[var(--text-secondary)]" title="Edit" onClick={() => setEdit({ open: true, existing: c })}><Edit2 className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-red-400" title="Delete" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                {c.intro && <p className="text-xs text-[var(--text-secondary)] mt-2 line-clamp-2">{c.intro}</p>}
                <Button size="sm" onClick={() => setSendFor(c)} className="mt-3 bg-[#e94560] hover:bg-[#f05c75] text-white h-8" data-testid={`cat-send-${c.catalogue_id}`}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Send to school
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <EditDialog open={edit.open} existing={edit.existing} onOpenChange={v => setEdit(s => ({ ...s, open: v }))} onSaved={load} />
      <SendDialog open={!!sendFor} catalogue={sendFor} onOpenChange={v => { if (!v) setSendFor(null); }} onSent={load} />
      <Dialog open={!!preview} onOpenChange={v => { if (!v) setPreview(null); }}>
        <DialogContent className={dlgCls}>
          <DialogHeader><DialogTitle>{preview?.catalogue?.name} · {preview?.dies?.length || 0} products</DialogTitle></DialogHeader>
          <div className="max-h-[60dvh] overflow-y-auto divide-y divide-[var(--border-color)]">
            {(preview?.dies || []).map(d => (
              <div key={d.die_id} className="py-1.5 text-sm flex gap-2">
                <span className="font-mono text-xs text-[#e94560] w-20 shrink-0">{d.code}</span><span className="truncate">{d.name}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
