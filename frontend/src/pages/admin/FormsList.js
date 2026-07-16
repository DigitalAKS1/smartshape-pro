import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { FormInput, Plus, CalendarClock, Users, Link2 } from 'lucide-react';

export default function FormsList() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  const load = () => formsApi.list()
    .then(r => setList(Array.isArray(r.data) ? r.data : []))
    .catch(() => toast.error('Could not load forms'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const createForm = async (type) => {
    try {
      const r = await formsApi.create(
        type === 'event'
          ? { title: 'New Event Registration', type: 'event', event: { platform: 'zoom' } }
          : { title: 'New Form', type: 'general' });
      nav(`/forms/${r.data.form_id}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to create'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className={`text-2xl font-semibold ${textPri} flex items-center gap-2`}>
              <FormInput className="h-6 w-6" /> Forms
            </h1>
            <p className={`text-sm ${textSec} mt-1`}>
              Build registration forms, share a public link, and track responses.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => createForm('event')}>
              <CalendarClock className="h-4 w-4 mr-1" /> New Event Registration
            </Button>
            <Button variant="outline" onClick={() => createForm('general')}>
              <Plus className="h-4 w-4 mr-1" /> New Form
            </Button>
          </div>
        </div>

        <div className={`${card} border rounded-md overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`${textSec} text-left border-b border-[var(--border-color)]`}>
                <th className="p-3">Form</th><th className="p-3">Type</th>
                <th className="p-3">Event date</th><th className="p-3">Status</th>
                <th className="p-3">Responses</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(list || []).map(f => (
                <tr key={f.form_id}
                    className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-primary)] cursor-pointer`}
                    onClick={() => nav(`/forms/${f.form_id}`)}>
                  <td className={`p-3 font-medium ${textPri}`}>{f.title}</td>
                  <td className={`p-3 ${textSec}`}>{f.type === 'event' ? 'Event' : 'General'}</td>
                  <td className={`p-3 ${textSec}`}>{f.event?.date || '—'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      f.status === 'open' ? 'bg-green-500/15 text-green-500'
                                          : 'bg-gray-500/15 text-gray-400'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className={`p-3 ${textSec}`}>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {f.response_count ?? 0}
                    </span>
                  </td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost"
                            onClick={() => nav(`/forms/${f.form_id}/responses`)}>
                      <Link2 className="h-4 w-4 mr-1" /> Responses
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && (
                <tr><td colSpan={6} className={`p-8 text-center ${textSec}`}>
                  No forms yet — create your first Event Registration.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
