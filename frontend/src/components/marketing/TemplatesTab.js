import React, { useState } from 'react';
import { Plus, Eye } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import RichMessageEditor from '../RichMessageEditor';
import { whatsApp as waApi } from '../../lib/api';

const TMPL_CATS = ['All', 'intro', 'catalogue', 'offer', 'followup', 'reengagement', 'seasonal'];
const TMPL_CAT_META = {
  intro:        { label: 'Intro',          col: 'text-blue-500',   bg: 'bg-blue-500/15' },
  catalogue:    { label: 'Catalogue',      col: 'text-purple-500', bg: 'bg-purple-500/15' },
  offer:        { label: 'Offer',          col: 'text-green-500',  bg: 'bg-green-500/15' },
  followup:     { label: 'Follow-up',      col: 'text-orange-500', bg: 'bg-orange-500/15' },
  reengagement: { label: 'Re-engagement',  col: 'text-red-400',    bg: 'bg-red-400/15' },
  seasonal:     { label: 'Seasonal',       col: 'text-cyan-500',   bg: 'bg-cyan-500/15' },
};
const BLANK_TMPL = { name: '', category: 'intro', body: '' };

export default function TemplatesTab({ tk, templates, setTemplates }) {
  const [filterCat, setFilterCat] = useState('All');
  const [preview, setPreview] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_TMPL);
  const [saving, setSaving] = useState(false);

  const filtered = filterCat === 'All' ? templates : templates.filter(t => t.category === filterCat);

  async function create() {
    if (!form.name.trim()) { toast.error('Template name is required'); return; }
    if (!form.body.trim()) { toast.error('Message body is required'); return; }
    setSaving(true);
    try {
      const vars = [];
      if (form.body.includes('{name}')) vars.push('name');
      if (form.body.includes('{school_name}')) vars.push('school_name');
      const res = await waApi.createTemplate({ ...form, variables: vars });
      setTemplates(prev => [...prev, res.data]);
      setShowCreate(false);
      setForm(BLANK_TMPL);
      toast.success('Template saved');
    } catch { toast.error('Failed to save template'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Message Templates
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>{templates.length} total</span>
          </h3>
          <p className={`text-xs ${tk.tm} mt-0.5`}>Reusable WhatsApp messages — select when creating campaigns or drip steps</p>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Template
        </Button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TMPL_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c
                ? 'bg-[var(--accent)] text-white'
                : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {TMPL_CAT_META[c]?.label || c}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(t => {
          const m = TMPL_CAT_META[t.category] || { label: t.category, col: 'text-gray-400', bg: 'bg-gray-400/15' };
          return (
            <div key={t.template_id} className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex flex-col gap-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tk.t1} leading-tight`}>{t.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium mt-1 inline-block`}>
                    {m.label}
                  </span>
                </div>
                <button onClick={() => setPreview(t)}
                  className={`h-7 w-7 rounded-lg ${tk.hov} flex items-center justify-center flex-shrink-0`}>
                  <Eye className={`h-3.5 w-3.5 ${tk.tm}`} />
                </button>
              </div>
              <p className={`text-[11px] ${tk.tm} leading-relaxed line-clamp-3`}>{t.body}</p>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1.5">
                  {(t.variables || []).map(v => (
                    <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--accent)]">
                      {'{' + v + '}'}
                    </span>
                  ))}
                </div>
                {t.usage_count > 0 && (
                  <span className={`text-[10px] ${tk.tm}`}>Used {t.usage_count}×</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview dialog */}
      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-md`}>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className={tk.t1}>{preview.name}</DialogTitle>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TMPL_CAT_META[preview.category]?.bg} ${TMPL_CAT_META[preview.category]?.col} font-medium`}>
                  {TMPL_CAT_META[preview.category]?.label || preview.category}
                </span>
              </div>
            </DialogHeader>
            {/* WhatsApp bubble mock */}
            <div className="bg-[#0f1117] rounded-xl p-4 my-2">
              <div className="bg-[#1f5c37] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%]">
                <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">
                  {preview.body
                    .replace('{name}', 'Ramesh')
                    .replace('{school_name}', 'Delhi Public School')}
                </p>
                <p className="text-white/50 text-[10px] text-right mt-1.5">12:34 PM ✓✓</p>
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

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Message Template</DialogTitle>
            <DialogDescription className={tk.tm}>Reusable WhatsApp message for campaigns and drip sequences</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Template Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali Special Offer"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Category</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TMPL_CAT_META).map(([k, m]) => (
                  <button key={k} onClick={() => setForm(p => ({ ...p, category: k }))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border-2 transition-all ${
                      form.category === k
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                        : `border-[var(--border-color)] ${tk.t2}`
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Message Body</Label>
              <RichMessageEditor
                value={form.body}
                onChange={html => setForm(p => ({ ...p, body: html }))}
                placeholder="Write your WhatsApp message. Paste from ChatGPT or Claude — bold, emojis and formatting preserved."
              />
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
