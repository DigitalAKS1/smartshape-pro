import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminContent } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Trophy, Plus, ChevronLeft } from 'lucide-react';

const EMPTY = { title: '', theme: '', description: '', start_date: '', end_date: '', rules: '', prizes: '' };

export default function CompetitionsAdmin() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [entries, setEntries] = useState([]);
  const [winners, setWinners] = useState([]);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const load = () => adminContent.listCompetitions().then(r => setList(r.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title.trim()) return toast.error('Title required');
    setCreating(true);
    try { await adminContent.createCompetition(form); toast.success('Competition created'); setForm(EMPTY); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setCreating(false); }
  };

  const openEntries = async (comp) => {
    setSelected(comp); setWinners(comp.winner_video_ids || []);
    try { const r = await adminContent.competitionEntries(comp.competition_id); setEntries(r.data || []); }
    catch { setEntries([]); }
  };

  const toggleWinner = (id) => setWinners(w => w.includes(id) ? w.filter(x => x !== id) : [...w, id]);

  const saveWinners = async () => {
    try { await adminContent.setWinners(selected.competition_id, winners); toast.success('Winners saved & teachers notified'); load(); setSelected(null); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  if (selected) {
    return (
      <AdminLayout>
        <div className="max-w-4xl mx-auto space-y-4">
          <button onClick={() => setSelected(null)} className={`flex items-center gap-1 text-sm ${textSec}`}><ChevronLeft className="h-4 w-4" /> Back</button>
          <h1 className={`text-2xl font-semibold ${textPri}`}>{selected.title} — entries</h1>
          <p className={`text-sm ${textMuted}`}>Tick the winner(s), then save. Only approved entries are shown.</p>
          {entries.length === 0 ? <p className={textMuted}>No approved entries yet.</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {entries.map(v => (
                <div key={v.video_id} className={`${card} border rounded-md overflow-hidden ${winners.includes(v.video_id) ? 'ring-2 ring-[#e94560]' : ''}`}>
                  {v.video_url && <video src={v.video_url} controls poster={v.thumbnail_url} className="w-full bg-black" />}
                  <div className="p-3 flex items-center justify-between">
                    <div><p className={`text-sm ${textPri}`}>{v.title}</p><p className={`text-xs ${textMuted}`}>{v.teacher_name}</p></div>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={winners.includes(v.video_id)} onChange={() => toggleWinner(v.video_id)} /> Winner
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button onClick={saveWinners} className="bg-[#e94560] hover:bg-[#f05c75] text-white"><Trophy className="h-4 w-4 mr-1" /> Save winners</Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div><h1 className={`text-2xl font-semibold ${textPri}`}>Competitions</h1>
          <p className={`text-sm ${textSec} mt-1`}>Run competitions teachers can enter from their portal.</p></div>

        <div className={`${card} border rounded-md p-4 space-y-3`}>
          <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><Plus className="h-4 w-4" /> New competition</h3>
          <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
          <Input placeholder="Theme" value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })} className={inputCls} />
          <Input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <div><Label className={`text-xs ${textMuted}`}>Start date</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inputCls} /></div>
            <div><Label className={`text-xs ${textMuted}`}>End date</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className={inputCls} /></div>
          </div>
          <Input placeholder="Prizes (optional)" value={form.prizes} onChange={e => setForm({ ...form, prizes: e.target.value })} className={inputCls} />
          <Button onClick={create} disabled={creating} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{creating ? 'Creating…' : 'Create competition'}</Button>
        </div>

        {list.length === 0 ? (
          <div className={`${card} border rounded-md p-12 text-center`}><Trophy className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No competitions yet</p></div>
        ) : list.map(c => (
          <div key={c.competition_id} className={`${card} border rounded-md p-4 flex items-center justify-between`}>
            <div>
              <p className={`font-medium ${textPri}`}>{c.title} <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${c.computed_status === 'open' ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>{c.computed_status}</span></p>
              <p className={`text-xs ${textMuted}`}>{c.theme} • {c.start_date} → {c.end_date}</p>
            </div>
            <Button onClick={() => openEntries(c)} variant="outline">View entries</Button>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}
