import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API, { quotations as quotApi, salesPersons, exportData } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { toast } from 'sonner';

export default function useQuotations() {
  const navigate = useNavigate();

  const [quotations, setQuotations] = useState([]);
  const [filteredQuotations, setFiltered] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedQuotations, setSelected] = useState([]);
  const [agentList, setAgentList] = useState([]);
  const [catalogueDialog, setCatalogueDialog] = useState({ open: false, quot: null, sending: false });
  const [waDialog, setWaDialog] = useState({ open: false, quot: null, link: '', generating: false });
  const [historyPanel, setHistoryPanel] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [qRes, spRes] = await Promise.all([quotApi.getAll(), salesPersons.getAll()]);
      const qList = Array.isArray(qRes.data) ? qRes.data : [];
      setQuotations(qList);
      setFiltered(qList);
      setAgentList(Array.isArray(spRes.data) ? spRes.data : []);
    } catch {
      toast.error('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useDataSync('quotations', loadData);
  useAutoRefresh(loadData, 60000);

  useEffect(() => {
    let f = Array.isArray(quotations) ? quotations : [];
    if (statusFilter !== 'all') f = f.filter(q => q.quotation_status === statusFilter);
    if (agentFilter !== 'all')  f = f.filter(q => q.sales_person_id === agentFilter || q.sales_person_email === agentFilter);
    if (dateFrom) f = f.filter(q => q.created_at >= dateFrom);
    if (dateTo)   f = f.filter(q => q.created_at <= dateTo + 'T23:59:59');
    if (searchTerm) f = f.filter(q =>
      q.school_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.quote_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.principal_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFiltered(f);
  }, [searchTerm, statusFilter, agentFilter, dateFrom, dateTo, quotations]);

  const handleOpenWhatsApp = async (quot) => {
    setWaDialog({ open: true, quot, link: '', generating: true });
    try {
      let link = '';
      if (quot.catalogue_token) {
        link = `${window.location.origin}/catalogue/${quot.catalogue_token}`;
      } else {
        const res = await API.post(`/quotations/${quot.quotation_id}/send-catalogue`);
        link = res.data.catalogue_url || '';
        const updated = await quotApi.getAll();
        setQuotations(updated.data);
      }
      setWaDialog(d => ({ ...d, link, generating: false }));
    } catch {
      toast.error('Failed to generate catalogue link');
      setWaDialog(d => ({ ...d, generating: false }));
    }
  };

  const openCatalogueDialog = (quot) => setCatalogueDialog({ open: true, quot, sending: false });

  const handleSendCatalogue = async ({ extraTo, extraCc }) => {
    const quot = catalogueDialog.quot;
    if (!quot) return;
    setCatalogueDialog(d => ({ ...d, sending: true }));
    try {
      const emailRes = await API.post(`/quotations/${quot.quotation_id}/send-catalogue-email`, {
        extra_to: extraTo, extra_cc: extraCc,
      });
      const url = emailRes.data.catalogue_url;
      if (emailRes.data.email_sent) {
        toast.success('Catalogue + PDF sent to customer!');
      } else {
        toast.success('Catalogue link generated!');
        const err = emailRes.data.email_error || '';
        if (err.includes('not configured') || err.includes('App Password')) {
          toast.warning('Email not sent — configure Gmail SMTP in Settings → Email.');
        } else if (err.includes('No recipient')) {
          toast.warning('Email not sent — no customer email on this quotation.');
        } else if (err) {
          toast.warning(`Email not sent: ${err}`);
        }
      }
      if (url) {
        navigator.clipboard.writeText(url).catch(() => {});
        toast.info('Link also copied to clipboard.');
      }
      setCatalogueDialog({ open: false, quot: null, sending: false });
      const updated = await quotApi.getAll();
      setQuotations(updated.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send catalogue');
      setCatalogueDialog(d => ({ ...d, sending: false }));
    }
  };

  const handleBulkSend = async () => {
    if (selectedQuotations.length === 0) { toast.error('Select quotations first'); return; }
    try {
      await Promise.all(selectedQuotations.map(id => quotApi.sendCatalogue(id)));
      toast.success(`Sent ${selectedQuotations.length} catalogue links!`);
      setSelected([]);
      const updated = await quotApi.getAll();
      setQuotations(updated.data);
    } catch {
      toast.error('Failed to send some catalogues');
    }
  };

  const toggleSelection = (id) => setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleDelete = async (quotationId) => {
    if (!window.confirm('Delete this quotation?')) return;
    try {
      await quotApi.delete(quotationId);
      toast.success('Quotation deleted');
      const updated = await quotApi.getAll();
      setQuotations(updated.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const selectAll = () => {
    const unsent = filteredQuotations.filter(q => q.catalogue_status === 'not_sent').map(q => q.quotation_id);
    setSelected(unsent);
  };

  const handleCopyLink = (token) => {
    const url = `${window.location.origin}/catalogue/${token}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copied!')).catch(() => toast.info(url));
  };

  const handleCreateOrder = async (quotationId) => {
    try {
      await API.post('/orders', { quotation_id: quotationId });
      toast.success('Order created!');
      navigate('/orders');
    } catch (err) {
      const msg = err.response?.data?.detail || '';
      if (msg.includes('already exists')) { toast.info('Order already exists'); navigate('/orders'); }
      else toast.error(msg || 'Failed to create order');
    }
  };

  const handleExport = () => { exportData.download('quotations'); toast.success('Exporting…'); };

  const clearFilters = () => {
    setStatusFilter('all'); setAgentFilter('all'); setDateFrom(''); setDateTo(''); setSearchTerm('');
  };

  const activeFilterCount = [
    statusFilter !== 'all', agentFilter !== 'all', !!dateFrom, !!dateTo,
  ].filter(Boolean).length;

  const totalValue = filteredQuotations.reduce((s, q) => s + (q.grand_total || 0), 0);
  const sentCount  = filteredQuotations.filter(q => q.catalogue_status !== 'not_sent').length;

  const catalogueLabel = (q) =>
    (q.catalogue_status === 'not_sent' && q.catalogue_token) ? 'ready' : (q.catalogue_status || 'not_sent');

  return {
    // data
    quotations, filteredQuotations, loading, agentList,
    totalValue, sentCount, activeFilterCount, catalogueLabel,
    // filters
    searchTerm, setSearchTerm, statusFilter, setStatusFilter,
    agentFilter, setAgentFilter, dateFrom, setDateFrom, dateTo, setDateTo,
    showFilters, setShowFilters, clearFilters,
    // selection
    selectedQuotations, setSelected, toggleSelection, selectAll,
    // whatsapp
    waDialog, setWaDialog, handleOpenWhatsApp,
    // catalogue email
    catalogueDialog, setCatalogueDialog, openCatalogueDialog, handleSendCatalogue,
    // history
    historyPanel, setHistoryPanel,
    // actions
    handleDelete, handleBulkSend, handleCopyLink, handleCreateOrder, handleExport,
  };
}
