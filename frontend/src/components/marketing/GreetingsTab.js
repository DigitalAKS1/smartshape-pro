import React, { useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { toast } from 'sonner';
import { greetingRules as greetingsApi } from '../../lib/api';
import { mapRule, catMeta } from '../../lib/marketingUtils';

const GREET_CATS = ['All', 'National', 'Festival', 'School', 'Global', 'Personal'];
const GREET_AUDIENCES = [
  { k: 'all_contacts',   l: 'All Contacts' },
  { k: 'role:Teacher',   l: 'Teachers Only' },
  { k: 'role:Principal', l: 'Principals Only' },
  { k: 'birthday_person', l: 'Birthday Person' },
];
const BLANK_GREET = { name: '', type: 'festival', category: 'Festival', trigger: 'fixed_date', fixed_date: '', audience: 'all_contacts', template_body: '' };

export default function GreetingsTab({ tk, greetings, setGreetings }) {
  const [filterCat, setFilterCat] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_GREET);
  const [saving, setSaving] = useState(false);

  async function toggle(g) {
    try {
      await greetingsApi.update(g.rule_id, { is_active: !g.active });
      setGreetings(prev => prev.map(x => x.id === g.id ? { ...x, active: !x.active } : x));
    } catch { toast.error('Failed to update rule'); }
  }

  async function create() {
    if (!form.name.trim()) { toast.error('Rule name is required'); return; }
    if (form.trigger === 'fixed_date' && !form.fixed_date.trim()) { toast.error('Date (MM-DD) is required'); return; }
    if (!form.template_body.trim()) { toast.error('Message template is required'); return; }
    setSaving(true);
    try {
      const res = await greetingsApi.create({ ...form, is_active: true });
      setGreetings(prev => [mapRule(res.data), ...prev]);
      setShowCreate(false);
      setForm(BLANK_GREET);
      toast.success('Greeting rule created');
    } catch { toast.error('Failed to create rule'); }
    finally { setSaving(false); }
  }

  const upcoming = [...greetings]
    .filter(g => g.active && g.trigger === 'fixed_date' && g.days_till < 60)
    .sort((a, b) => a.days_till - b.days_till)
    .slice(0, 4);

  const filtered = filterCat === 'All' ? greetings
    : greetings.filter(g => g.category === filterCat);

  return (
    <div className="space-y-4">

      {/* Upcoming strip */}
      {upcoming.length > 0 && (
        <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className={`h-4 w-4 ${tk.tm}`} />
            <span className={`text-sm font-semibold ${tk.t1}`}>Upcoming Auto-Greetings</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-medium">{upcoming.length} soon</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {upcoming.map(g => {
              const m = catMeta(g.category);
              const Icon = m.Icon;
              const urgent = g.days_till <= 3;
              return (
                <div key={g.id} className={`bg-[var(--bg-primary)] rounded-xl p-3 ${urgent ? 'ring-1 ring-[var(--accent)]/40' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg ${m.bg} flex items-center justify-center mb-2`}>
                    <Icon className={`h-4 w-4 ${m.col}`} />
                  </div>
                  <p className={`text-xs font-semibold ${tk.t1} leading-tight mb-0.5`}>{g.name}</p>
                  <p className={`text-[10px] font-medium ${urgent ? 'text-[var(--accent)]' : tk.tm}`}>{g.next}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header + category filter */}
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${tk.t1}`}>Greeting Rules
            <span className={`ml-2 text-xs font-normal ${tk.tm}`}>
              {greetings.filter(g => g.active).length} active · {greetings.filter(g => !g.active).length} paused
            </span>
          </h3>
        </div>
        <Button size="sm" className="h-8 gap-1 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs flex-shrink-0"
          onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> Add Rule
        </Button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {GREET_CATS.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
              filterCat === c
                ? 'bg-[var(--accent)] text-white'
                : `${tk.card} border ${tk.bdr} ${tk.t2} ${tk.hov}`
            }`}>
            {c}
          </button>
        ))}
      </div>

      {/* Rules list */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl divide-y divide-[var(--border-color)]`}>
        {filtered.length === 0 && (
          <div className={`px-4 py-8 text-center text-sm ${tk.tm}`}>No rules in this category</div>
        )}
        {filtered.map(g => {
          const m = catMeta(g.category);
          const Icon = m.Icon;
          return (
            <div key={g.id} className="flex items-center gap-3 px-4 py-3.5">
              <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${m.col}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={`text-sm font-semibold ${tk.t1}`}>{g.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.col} font-medium`}>{g.category}</span>
                  {!g.is_date_fixed && g.trigger === 'fixed_date' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 font-medium">Date varies</span>
                  )}
                </div>
                <div className={`text-[11px] ${tk.tm} mt-0.5 flex items-center gap-2 flex-wrap`}>
                  <span>{g.next}</span>
                  {g.sent_total > 0 && <span>· {g.sent_total.toLocaleString('en-IN')} sent total</span>}
                  {g.sent_this_year > 0 && <span className="text-green-500">· {g.sent_this_year} this year</span>}
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full hidden sm:block ${
                  g.active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-gray-400'
                }`}>{g.active ? 'Active' : 'Paused'}</span>
                <Switch checked={g.active} onCheckedChange={() => toggle(g)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className={`${tk.card} border ${tk.bdr} w-[calc(100vw-2rem)] max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={tk.t1}>New Greeting Rule</DialogTitle>
            <DialogDescription className={tk.tm}>Auto-send personalised WhatsApp greetings on special days</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto py-1 pr-1">
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Rule Name</Label>
              <Input className={`h-10 ${tk.inp}`} placeholder="e.g. Diwali 2026 Greetings"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`${tk.t2} text-xs mb-1.5 block`}>Type</Label>
                <div className="flex flex-col gap-1.5">
                  {[{ k: 'fixed_date', l: 'Festival / Event' }, { k: 'birthday', l: 'Birthday' }].map(t => (
                    <button key={t.k} onClick={() => setForm(p => ({ ...p, trigger: t.k, type: t.k === 'birthday' ? 'birthday' : 'festival' }))}
                      className={`py-2 rounded-lg text-xs font-medium border-2 transition-colors ${
                        form.trigger === t.k ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : `border-[var(--border-color)] ${tk.t2}`
                      }`}>
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {form.trigger === 'fixed_date' && (
                  <div>
                    <Label className={`${tk.t2} text-xs mb-1.5 block`}>Date (MM-DD)</Label>
                    <Input className={`h-10 ${tk.inp}`} placeholder="e.g. 10-20"
                      value={form.fixed_date} onChange={e => setForm(p => ({ ...p, fixed_date: e.target.value }))} />
                    <p className={`text-[10px] ${tk.tm} mt-1`}>Oct 20 → 10-20</p>
                  </div>
                )}
                <div>
                  <Label className={`${tk.t2} text-xs mb-1.5 block`}>Audience</Label>
                  <select className={`w-full h-10 rounded-lg border px-3 text-xs ${tk.inp}`}
                    value={form.audience} onChange={e => setForm(p => ({ ...p, audience: e.target.value }))}>
                    {GREET_AUDIENCES.map(a => <option key={a.k} value={a.k}>{a.l}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <Label className={`${tk.t2} text-xs mb-1.5 block`}>Message Template</Label>
              <textarea rows={5}
                className={`w-full rounded-xl border px-3 py-2.5 text-xs resize-none ${tk.inp}`}
                placeholder="Write your WhatsApp message. Use {name} for the contact's first name."
                value={form.template_body}
                onChange={e => setForm(p => ({ ...p, template_body: e.target.value }))} />
              <p className={`text-[11px] ${tk.tm} mt-1`}>
                {form.template_body.length} chars · <span className="font-mono text-[var(--accent)]">{'{name}'}</span> = contact's first name
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className={`border-[var(--border-color)] ${tk.t2}`}
              onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white"
              onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create Rule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
