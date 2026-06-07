import { useCallback, useEffect, useState } from 'react';
import { delegation as delApi } from '../lib/api';
import { toast } from 'sonner';

/** SP5 — reminders manager state + actions. */
export function useReminders() {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await delApi.reminders.list();
      setReminders((r?.data || r)?.reminders || []);
    } catch (e) {
      toast.error('Could not load reminders');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (payload) => {
    try { await delApi.reminders.create(payload); toast.success('Reminder created'); load(); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed to create'); return false; }
  };
  const update = async (id, payload) => {
    try { await delApi.reminders.update(id, payload); toast.success('Saved'); load(); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed to save'); return false; }
  };
  const remove = async (id) => {
    try { await delApi.reminders.delete(id); toast.success('Deleted'); load(); return true; }
    catch (e) { toast.error('Failed to delete'); return false; }
  };
  const setPaused = async (id, paused) => {
    try {
      paused ? await delApi.reminders.pause(id) : await delApi.reminders.resume(id);
      toast.success(paused ? 'Paused' : 'Resumed'); load(); return true;
    } catch (e) { toast.error('Failed'); return false; }
  };
  const bulk = async (rows) => {
    try {
      const r = await delApi.reminders.bulk(rows); const d = r?.data || r;
      toast.success(`Imported ${d.created}${d.errors?.length ? ` · ${d.errors.length} errors` : ''}`);
      load(); return d;
    } catch (e) { toast.error(e?.response?.data?.detail || 'Import failed'); return null; }
  };

  return { reminders, loading, reload: load, create, update, remove, setPaused, bulk };
}
