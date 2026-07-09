import { useState, useCallback } from 'react';
import { certsApi } from '../lib/api';
import { toast } from 'sonner';

export function useCertificates() {
  /* ── core state ── */
  const [templates, setTemplates]       = useState([]);
  const [batches, setBatches]           = useState([]);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [loading, setLoading]           = useState(false);

  /* ─────────────── loaders ──────────────────────────────────────────── */
  const loadTemplates = useCallback(async () => {
    try {
      const r = await certsApi.listTemplates();
      setTemplates(r.data || []);
    } catch {
      toast.error('Failed to load templates');
    }
  }, []);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await certsApi.listBatches();
      setBatches(r.data || []);
    } catch {
      toast.error('Failed to load batches');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBatch = useCallback(async (id) => {
    try {
      const r = await certsApi.getBatch(id);
      setCurrentBatch(r.data);
      return r.data;
    } catch {
      toast.error('Failed to load batch');
      return null;
    }
  }, []);

  /* ─────────────── actions ───────────────────────────────────────────── */
  const saveTemplate = async (id, body) => {
    try {
      if (id) {
        await certsApi.updateTemplate(id, body);
        toast.success('Template updated');
      } else {
        await certsApi.createTemplate(body);
        toast.success('Template created');
      }
      await loadTemplates();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save template');
    }
  };

  const createBatch = async (body) => {
    try {
      const r = await certsApi.createBatch(body);
      toast.success('Batch created');
      await loadBatches();
      return r.data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to create batch');
      return null;
    }
  };

  const addAttendees = async (id, attendees) => {
    try {
      await certsApi.addAttendees(id, attendees);
      toast.success('Attendees added');
      await loadBatch(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to add attendees');
    }
  };

  const generate = async (id) => {
    try {
      await certsApi.generate(id);
      toast.success('Generation queued');
      await loadBatch(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to queue generation');
    }
  };

  const send = async (id) => {
    try {
      await certsApi.send(id);
      toast.success('Delivery queued');
      await loadBatch(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to queue delivery');
    }
  };

  const stop = async (id) => {
    try {
      await certsApi.stop(id);
      toast.success('Batch stopped');
      await loadBatch(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to stop batch');
    }
  };

  const clearGenerated = async (id) => {
    try {
      const r = await certsApi.clearGenerated(id);
      toast.success(r?.data?.message || 'Certificate files deleted');
      await loadBatch(id);
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to delete certificate files');
      return false;
    }
  };

  const deleteBatch = async (id) => {
    try {
      await certsApi.deleteBatch(id);
      toast.success('Batch deleted');
      await loadBatches();
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to delete batch');
      return false;
    }
  };

  return {
    /* state */
    templates,
    batches,
    currentBatch,
    loading,
    /* loaders */
    loadTemplates,
    loadBatches,
    loadBatch,
    /* actions */
    saveTemplate,
    createBatch,
    addAttendees,
    generate,
    send,
    stop,
    clearGenerated,
    deleteBatch,
  };
}
