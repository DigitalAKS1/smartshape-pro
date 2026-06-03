import { useState, useEffect } from 'react';
import { leads as leadsApi } from '../lib/api';
import { toast } from 'sonner';

export function useSalesLeads() {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('leads_view') || 'list'
  );
  const [selectedLead, setSelectedLead] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { fetchLeads(); }, []);

  const fetchLeads = async () => {
    try {
      const res = await leadsApi.getAll();
      setLeads(res.data || []);
    } catch {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

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
    return matchSearch && matchStage;
  });

  return {
    leads, filtered, counts, activeCount, today,
    search, setSearch,
    stageFilter, setStageFilter,
    loading,
    viewMode, switchView,
    selectedLead, sheetOpen,
    openSheet, closeSheet,
    handleStageChange,
    fetchLeads,
  };
}
