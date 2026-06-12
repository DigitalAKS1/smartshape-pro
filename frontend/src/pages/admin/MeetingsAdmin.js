import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminMeetings, schools as schoolsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { CalendarClock, Plus, ExternalLink } from 'lucide-react';

const EMPTY = { school_id: '', title: '', description: '', scheduled_at: '', platform: 'zoom', meeting_link: '', location: '', create_zoom: false };

export default function MeetingsAdmin() {
  const [schoolList, setSchoolList] = useState([]);
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const load = () => adminMeetings.list().then(r => setList(r.data || [])).catch(() => {});
  useEffect(() => {
    schoolsApi.getAll().then(r => setSchoolList(r.data || [])).catch(() => {});
    load();
  }, []);

  const schoolName = (id) => schoolList.find(s => s.school_id === id)?.school_name || id;

  const create = async () => {
    if (!form.school_id) return toast.error('Pick a school');
    if (!form.title.trim() || !form.scheduled_at) return toast.error('Title and date/time required');
    setSaving(true);
    try {
      await adminMeetings.create(form);
      toast.success('Meeting scheduled');
      setForm(EMPTY);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const setStatus = async (m, status) => {
    try { await adminMeetings.update(m.meeting_id, { status }); load(); }
    catch { toast.error('Failed'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className={`text-2xl font-semibold ${textPri} flex items-center gap-2`}><CalendarClock className="h-6 w-6" /> Meetings</h1>
          <p className={`text-sm ${textSec} mt-1`}>Schedule private 1:1 meetings with a school. They appear in that school's (and its teachers') portal.</p>
        </div>

        <div className={`${card} border rounded-md p-4 space-y-3`}>
          <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><Plus className="h-4 w-4" /> Schedule a meeting</h3>
          <div>
            <Label className={`text-xs ${textMuted}`}>School</Label>
            <select value={form.school_id} onChange={e => setForm({ ...form, school_id: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
              <option value="">Select a school…</option>
              {schoolList.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
            </select>
          </div>
          <Input placeholder="Title (e.g. Onboarding call)" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
          <Input placeholder="Notes / agenda (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className={`text-xs ${textMuted}`}>Date & time</Label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} className={inputCls} />
            </div>
            <div>
              <Label className={`text-xs ${textMuted}`}>Platform</Label>
              <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="zoom">Zoom</option>
                <option value="meet">Google Meet</option>
                <option value="physical">In person</option>
              </select>
            </div>
          </div>
          {form.platform === 'physical' ? (
            <Input placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={inputCls} />
          ) : (
            <>
              <Input placeholder="Meeting link (paste, or auto-create below)" value={form.meeting_link} onChange={e => setForm({ ...form, meeting_link: e.target.value })} className={inputCls} />
              {form.platform === 'zoom' && !form.meeting_link && (
                <label className={`flex items-center gap-2 text-sm ${textSec}`}>
                  <input type="checkbox" checked={form.create_zoom} onChange={e => setForm({ ...form, create_zoom: e.target.checked })} /> Auto-create a Zoom meeting (requires Zoom configured)
                </label>
              )}
            </>
          )}
          <Button onClick={create} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{saving ? 'Scheduling…' : 'Schedule meeting'}</Button>
        </div>

        {list.length === 0 ? (
          <div className={`${card} border rounded-md p-12 text-center`}><CalendarClock className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No meetings scheduled</p></div>
        ) : list.map(m => (
          <div key={m.meeting_id} className={`${card} border rounded-md p-4`}>
            <div className="flex items-center justify-between mb-1">
              <p className={`font-medium ${textPri}`}>{m.title}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${m.status === 'cancelled' ? 'bg-red-500/15 text-red-400' : m.status === 'done' ? 'bg-green-500/15 text-green-400' : 'bg-blue-500/15 text-blue-400'}`}>{m.status}</span>
            </div>
            <p className={`text-xs ${textMuted}`}>{schoolName(m.school_id)} • {m.scheduled_at} • {m.platform}</p>
            <div className="flex items-center gap-3 mt-2">
              {m.meeting_link && <a href={m.meeting_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#e94560] hover:underline"><ExternalLink className="h-3 w-3" /> Link</a>}
              {m.status === 'scheduled' && <>
                <button onClick={() => setStatus(m, 'done')} className="text-xs text-green-400 hover:underline">Mark done</button>
                <button onClick={() => setStatus(m, 'cancelled')} className="text-xs text-red-400 hover:underline">Cancel</button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}
