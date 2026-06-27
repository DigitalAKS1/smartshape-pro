import { useState, useEffect, useCallback } from 'react';
import { todayActions, delegation as delegationApi } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

/**
 * Hook encapsulating all state + API calls for TodayDashboard.
 * Returns: data, loading, refreshing, delgData, markDoneCard, markNote,
 *          markFollowup, markSaving, waOpen, waCtx, load, openMarkDone,
 *          saveMarkDone, openWa, setMarkDoneCard, setMarkNote,
 *          setMarkFollowup, setWaOpen
 */
export function useTodayDashboard() {
  const { user } = useAuth();
  const isSales = user?.role === 'sales';

  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [delgData, setDelgData]   = useState(null);

  // Mark-done dialog state
  const [markDoneCard, setMarkDoneCard] = useState(null);
  const [markNote, setMarkNote]         = useState('');
  const [markFollowup, setMarkFollowup] = useState('');
  const [markSaving, setMarkSaving]     = useState(false);

  // WhatsApp dialog state
  const [waOpen, setWaOpen] = useState(false);
  const [waCtx, setWaCtx]   = useState({ module: 'lead', context: {}, title: '' });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await todayActions.get();
      setData(r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {});
    } catch {
      toast.error('Failed to load today actions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataSync('today', load);
  useDataSync('visits', load);
  useDataSync('crm', load);
  useAutoRefresh(load, 30000);

  // Load delegation data for admins
  useEffect(() => {
    if (!isSales) {
      delegationApi.dashboard().then(r => setDelgData(r.data)).catch(() => {});
    }
  }, [isSales]);

  // WebSocket for real-time badge counts — falls back to 60s polling if WS unavailable
  useEffect(() => {
    const base = (process.env.REACT_APP_BACKEND_URL || '').replace(/^http/, 'ws');
    let ws = null;
    let retries = 0;
    const maxRetries = 3;

    const connect = () => {
      try {
        ws = new WebSocket(`${base}/api/ws/today-actions`);
        ws.onopen = () => { retries = 0; };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'today_actions_update') load(true);
          } catch { /* ignore malformed */ }
        };
        ws.onclose = () => {
          if (retries < maxRetries) {
            retries++;
            setTimeout(connect, retries * 2000);
          } else {
            const t = setInterval(() => load(true), 60_000);
            return () => clearInterval(t);
          }
        };
        ws.onerror = () => { ws.close(); };
      } catch { /* WS not available */ }
    };

    connect();
    const t = setInterval(() => load(true), 90_000);
    return () => { ws?.close(); clearInterval(t); };
  }, [load]);

  const openMarkDone = (card) => {
    setMarkDoneCard(card);
    setMarkNote('');
    setMarkFollowup('');
  };

  const saveMarkDone = async () => {
    if (!markNote.trim()) { toast.error('Activity note is required'); return; }
    const isVisit = (markDoneCard.kind || '').includes('visit');
    if (!isVisit && !markFollowup) { toast.error('Next follow-up date is mandatory'); return; }
    setMarkSaving(true);
    try {
      await todayActions.markDone({
        kind: markDoneCard.kind,
        note: markNote,
        next_followup_date: markFollowup,
        lead_id: markDoneCard.lead_id,
        plan_id: markDoneCard.plan_id,
      });
      toast.success('Marked done');
      setMarkDoneCard(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to mark done');
    } finally {
      setMarkSaving(false);
    }
  };

  const openWa = (card) => {
    setWaCtx({
      module: card.kind.includes('visit') ? 'visit' : 'lead',
      title: `WhatsApp - ${card.contact_name || card.school_name}`,
      context: {
        lead_id: card.lead_id, school_id: card.school_id,
        phone: card.contact_phone, contact_name: card.contact_name,
        school_name: card.school_name,
      },
    });
    setWaOpen(true);
  };

  return {
    data, loading, refreshing, delgData, isSales,
    markDoneCard, markNote, markFollowup, markSaving,
    waOpen, waCtx,
    load, openMarkDone, saveMarkDone, openWa,
    setMarkDoneCard, setMarkNote, setMarkFollowup, setWaOpen,
  };
}
