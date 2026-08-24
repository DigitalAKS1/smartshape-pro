import { useState, useEffect, useMemo } from 'react';
import { leads as leadsApi, dealTypes as dealTypesApi } from '../lib/api';
import { toast } from 'sonner';

export function useSalesLeads() {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('active');
  const [dealFilter, setDealFilter] = useState('all');
  const [dealTypesList, setDealTypesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('leads_view') || 'list'
  );
  const [selectedLead, setSelectedLead] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { fetchLeads(); }, []);
  useEffect(() => {
    dealTypesApi.getAll().then(r => setDealTypesList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const fetchLeads = async () => {
    try {
      const res = await leadsApi.getAll();
      setLeads(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  // Deal-type options = seeded master ∪ any values already on leads (so nothing hides).
  const dealOptions = useMemo(() => {
    const set = new Set();
    dealTypesList.forEach(d => set.add(d.name || d));
    leads.forEach(l => { if ((l.deal_type || '').trim()) set.add(l.deal_type.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dealTypesList, leads]);

  const switchView = (v) => {
    setViewMode(v);
    localStorage.setItem('leads_view', v);
  };

  const openSheet = (lead) => {
    setSelectedLead(lead);
    setSheetOpen(true);
  };

  const closeSheet = () => setSheetOpen(false);

  const handleStageChange = (leadId, newStage) =>
    setLeads(prev => prev.map(l => l.lead_id === leadId ? { ...l, stage: newStage } : l));

  const counts = {};
  leads.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  const activeCount = leads.filter(l => !['won', 'lost'].includes(l.stage)).length;

  const today = new Date().toISOString().split('T')[0];

  const filtered = leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s ||
      l.company_name?.toLowerCase().includes(s) ||
      l.contact_name?.toLowerCase().includes(s) ||
      l.contact_phone?.includes(s);
    const matchStage =
      stageFilter === 'all'    ? true :
      stageFilter === 'active' ? !['won', 'lost'].includes(l.stage) :
      l.stage === stageFilter;
    const matchDeal = dealFilter === 'all' || (l.deal_type || '').trim() === dealFilter;
    return matchSearch && matchStage && matchDeal;
  });

  return {
    leads, filtered, counts, activeCount, today,
    search, setSearch,
    stageFilter, setStageFilter,
    dealFilter, setDealFilter, dealOptions,
    loading,
    viewMode, switchView,
    selectedLead, sheetOpen,
    openSheet, closeSheet,
    handleStageChange,
    fetchLeads,
  };
}
