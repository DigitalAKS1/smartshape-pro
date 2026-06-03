import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API, { quotations, companySettings, dies as diesApi } from '../lib/api';
import { toast } from 'sonner';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

export function useViewQuotation() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [quot, setQuot] = useState(null);
  const [company, setCompany] = useState({});
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(true);

  // Manage Selection state
  const [selItems, setSelItems] = useState([]);
  const [allDies, setAllDies] = useState([]);
  const [dieSearch, setDieSearch] = useState('');
  const [replacingItem, setReplacingItem] = useState(null);
  const [replacements, setReplacements] = useState([]);
  const [selReason, setSelReason] = useState('');
  const [savingSelection, setSavingSelection] = useState(false);
  const [showManage, setShowManage] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [quotRes, compRes] = await Promise.all([API.get('/quotations'), companySettings.get()]);
        const found = quotRes.data.find(q => q.quotation_id === id);
        if (found) {
          setQuot(found);
          try {
            const vRes = await quotations.getVersions(id);
            setVersions(vRes.data || []);
          } catch { /* versions optional */ }
        }
        setCompany(compRes.data || {});
      } catch { toast.error('Failed to load'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setPdfLoading(true);
    fetch(`${BACKEND}/api/quotations/${id}/pdf`, { credentials: 'include' })
      .then(r => r.ok ? r.blob() : Promise.reject(r.status))
      .then(blob => {
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      })
      .catch(() => {})
      .finally(() => setPdfLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchSelectionItems = useCallback(async (token) => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND}/api/customer-portal/${token}`);
      if (!res.ok) return;
      const data = await res.json();
      setSelItems(data.selection_items || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (quot?.catalogue_token && quot?.catalogue_status === 'submitted') {
      fetchSelectionItems(quot.catalogue_token);
      diesApi.getAll().then(r => setAllDies(r.data || [])).catch(() => {});
    }
  }, [quot?.catalogue_token, quot?.catalogue_status, fetchSelectionItems]);

  const handleNewVersion = async () => {
    if (!window.confirm('Create a new draft version of this quotation? The original will remain unchanged.')) return;
    setCreatingVersion(true);
    try {
      const res = await quotations.newVersion(id);
      toast.success(`Version ${res.data.version || 2} created — ${res.data.quote_number}`);
      navigate(`/edit-quotation/${res.data.quotation_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create new version');
    } finally { setCreatingVersion(false); }
  };

  const handleSaveSelection = async () => {
    if (replacements.length === 0) { toast.error('No replacements added'); return; }
    setSavingSelection(true);
    try {
      await API.put(`/customer-portal/${quot.catalogue_token}/update-selection`, {
        replacements: replacements.map(r => ({ old_die_id: r.old_die_id, new_die_id: r.new_die_id, note: r.note || selReason })),
        reason: selReason,
      });
      toast.success('Selection updated & customer notified');
      setReplacements([]);
      setSelReason('');
      setReplacingItem(null);
      setShowManage(false);
      await fetchSelectionItems(quot.catalogue_token);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update selection');
    } finally { setSavingSelection(false); }
  };

  return {
    id,
    navigate,
    quot,
    company,
    versions,
    loading,
    creatingVersion,
    pdfBlobUrl,
    pdfLoading,
    selItems,
    allDies,
    dieSearch,
    setDieSearch,
    replacingItem,
    setReplacingItem,
    replacements,
    setReplacements,
    selReason,
    setSelReason,
    savingSelection,
    showManage,
    setShowManage,
    handleNewVersion,
    handleSaveSelection,
    fetchSelectionItems,
  };
}
