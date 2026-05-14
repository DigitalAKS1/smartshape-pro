import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import API, { quotations, companySettings, dies as diesApi } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Download, Edit2, ArrowLeft, Printer, GitBranch, RefreshCw, X, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const addDays = (iso, days) => {
  try {
    const d = new Date(iso.slice(0, 10));
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '30 days from date';
  }
};

const fmtDate = (iso) => {
  try {
    return new Date(iso.slice(0, 10)).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso?.slice(0, 10) || ''; }
};

// ─── design tokens (inline styles for print fidelity) ────────────────────────
const BRAND = '#e94560';
const NAVY  = '#1a1a2e';
const GRAY  = '#666677';
const LGRAY = '#f4f4f7';
const BORDER= '#c8c8d4';
const ALT   = '#f8f8fb';
const GREEN = '#16a34a';
const WHITE = '#ffffff';

export default function ViewQuotation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quot, setQuot] = useState(null);
  const [company, setCompany] = useState({});
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingVersion, setCreatingVersion] = useState(false);

  // Manage Selection state
  const [selItems, setSelItems] = useState([]);
  const [allDies, setAllDies] = useState([]);
  const [dieSearch, setDieSearch] = useState('');
  const [replacingItem, setReplacingItem] = useState(null); // die_id being replaced
  const [replacements, setReplacements] = useState([]); // [{old_die_id, new_die_id, new_die_name, note}]
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
      const res = await API.put(`/customer-portal/${quot.catalogue_token}/update-selection`, {
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

  if (loading || !quot) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    );
  }

  const lines    = quot.lines || [];
  const d1p      = quot.discount1_pct  || 0;
  const d1a      = quot.disc1_amount   || 0;
  const d2p      = quot.discount2_pct  || 0;
  const d2a      = quot.disc2_amount   || 0;
  const subDisc  = quot.subtotal_after_disc ?? quot.after_disc2 ?? (quot.subtotal - d1a - d2a);
  const gst      = quot.gst_amount     || 0;
  const frw      = quot.freight_with_gst ?? quot.freight_total ?? 0;
  const gt       = quot.grand_total    || 0;
  const itemsTotal = quot.subtotal     || 0;

  const co = {
    name:  company.company_name || 'SmartShapes',
    addr:  company.address || '',
    city:  [company.city, company.state, company.pincode].filter(Boolean).join(', '),
    phone: company.phone || '',
    email: company.email || '',
    gst:   company.gst_number || '',
    logo:  company.logo_url || '',
  };

  const coContact = [co.phone && `Ph: ${co.phone}`, co.email].filter(Boolean).join('  |  ');

  const termsRaw = quot.terms_override || company.terms_conditions || '';
  const terms = termsRaw
    ? termsRaw.split('\n').filter(t => t.trim()).map(t => t.trim().replace(/^[\d.\s)-]+/, ''))
    : [
        'Payment: 50% advance and balance 50% against delivery',
        'Warranty: 1 year against any manufacturing defect',
        'Machine not to be used for commercial purpose',
        'Local duties/taxes extra to be borne by buyer',
      ];

  const bankRaw  = quot.bank_details_override || company.bank_details || '';
  const bankLines = bankRaw ? bankRaw.split('\n').filter(l => l.trim()) : [];

  return (
    <>
      {/* ── Print CSS ─────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; }
          @page { size: A4; margin: 10mm 12mm; }
        }
        .no-print-bg { background: #e8e8ee; }
      `}</style>

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div className="no-print bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate('/quotations')} variant="ghost" size="sm" className="text-[var(--text-secondary)]">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <span className="text-[var(--text-primary)] font-medium">{quot.quote_number}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            quot.quotation_status === 'confirmed' ? 'bg-green-500/20 text-green-300' :
            quot.quotation_status === 'sent'      ? 'bg-blue-500/20  text-blue-300'  :
            'bg-yellow-500/20 text-yellow-300'
          }`}>{quot.quotation_status}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleNewVersion} disabled={creatingVersion} variant="outline" size="sm"
            className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
            <GitBranch className="mr-1.5 h-3 w-3" />
            {creatingVersion ? 'Creating…' : `New Version${quot?.version ? ` (V${quot.version})` : ''}`}
          </Button>
          <Link to={`/edit-quotation/${id}`}>
            <Button variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]">
              <Edit2 className="mr-2 h-3 w-3" /> Edit
            </Button>
          </Link>
          <Button onClick={() => quotations.downloadPdf(id)} variant="outline" size="sm"
            className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="download-pdf-btn">
            <Download className="mr-2 h-3 w-3" /> PDF
          </Button>
          <Button onClick={() => window.print()} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="print-btn">
            <Printer className="mr-2 h-3 w-3" /> Print
          </Button>
        </div>
      </div>

      {/* ── Manage Selection (admin, when catalogue submitted) ─────────── */}
      {quot.catalogue_status === 'submitted' && (
        <div className="no-print bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-6 py-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">Catalogue Submitted</span>
                <span className="text-xs text-[var(--text-secondary)]">— {selItems.filter(i => i.status !== 'removed_by_admin').length} items selected by customer</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowManage(v => !v)}
                className="border-[var(--border-color)] text-[var(--text-secondary)]">
                <RefreshCw className="mr-1.5 h-3 w-3" />
                {showManage ? 'Hide' : 'Manage Selection'}
              </Button>
            </div>

            {showManage && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-4">
                {/* Reason */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reason for changes (sent to customer)</label>
                  <input
                    value={selReason}
                    onChange={e => setSelReason(e.target.value)}
                    placeholder="e.g. Some items are out of stock"
                    className="w-full h-9 px-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]"
                  />
                </div>

                {/* Pending replacements */}
                {replacements.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Queued replacements ({replacements.length}):</p>
                    {replacements.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                        <AlertTriangle className="h-3 w-3 text-yellow-400 flex-shrink-0" />
                        <span className="text-[var(--text-secondary)]">Remove <strong className="text-red-400">{r.old_die_name}</strong></span>
                        {r.new_die_id && <><span className="text-[var(--text-secondary)]">→ Add</span><strong className="text-green-400">{r.new_die_name}</strong></>}
                        <button onClick={() => setReplacements(prev => prev.filter((_, j) => j !== i))}
                          className="ml-auto text-[var(--text-secondary)] hover:text-red-400"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Items list */}
                <div>
                  <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Selected Items</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                    {selItems.map((item, i) => {
                      const isRemoved = item.status === 'removed_by_admin';
                      const isAdded   = item.status === 'added_by_admin';
                      const inQueue   = replacements.some(r => r.old_die_id === item.die_id);
                      return (
                        <div key={item.die_id || i}
                          className={`flex items-start gap-2 p-2 rounded-md border text-xs ${
                            isRemoved ? 'border-red-500/30 opacity-60' :
                            isAdded   ? 'border-yellow-400/30 bg-yellow-500/5' :
                            inQueue   ? 'border-orange-400/40 bg-orange-500/5' :
                                        'border-[var(--border-color)]'
                          }`}>
                          {item.die_image_url
                            ? <img src={`${BACKEND}${item.die_image_url}`} alt="" className="w-8 h-8 rounded object-contain bg-[var(--bg-primary)] flex-shrink-0" />
                            : <div className="w-8 h-8 rounded bg-[var(--bg-primary)] flex-shrink-0" />
                          }
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-[10px] text-[#e94560]">{item.die_code}</p>
                            <p className="text-[var(--text-primary)] font-medium leading-tight truncate">{item.die_name}</p>
                            <p className="text-[var(--text-secondary)] capitalize">{item.die_type}</p>
                            {isRemoved && <span className="text-red-400 font-medium">Removed</span>}
                            {isAdded && <span className="text-yellow-400 font-medium">Added by admin</span>}
                            {item.admin_note && <p className="text-yellow-400 italic truncate">Note: {item.admin_note}</p>}
                          </div>
                          {!isRemoved && !isAdded && !inQueue && (
                            <button
                              onClick={() => setReplacingItem(replacingItem === item.die_id ? null : item.die_id)}
                              className="flex-shrink-0 text-[10px] px-2 py-1 rounded bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 font-medium whitespace-nowrap">
                              Replace
                            </button>
                          )}
                          {inQueue && <span className="flex-shrink-0 text-[10px] text-orange-400 font-medium">Queued</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Die picker for replacement */}
                {replacingItem && (() => {
                  const srcItem = selItems.find(i => i.die_id === replacingItem);
                  const filteredDies = allDies.filter(d =>
                    d.die_id !== replacingItem &&
                    !selItems.some(i => i.die_id === d.die_id && i.status !== 'removed_by_admin') &&
                    (dieSearch === '' ||
                      d.name?.toLowerCase().includes(dieSearch.toLowerCase()) ||
                      d.code?.toLowerCase().includes(dieSearch.toLowerCase()))
                  ).slice(0, 20);
                  return (
                    <div className="border border-[var(--border-color)] rounded-lg p-3 bg-[var(--bg-primary)]">
                      <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                        Choose replacement for <strong className="text-[var(--text-primary)]">{srcItem?.die_name}</strong>
                        <button onClick={() => { setReplacingItem(null); setDieSearch(''); }}
                          className="ml-2 text-[var(--text-secondary)] hover:text-red-400"><X className="h-3 w-3 inline" /></button>
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-secondary)]" />
                          <input value={dieSearch} onChange={e => setDieSearch(e.target.value)}
                            placeholder="Search dies by name or code…"
                            className="w-full h-8 pl-7 pr-3 rounded border border-[var(--border-color)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#e94560]" />
                        </div>
                        <button
                          onClick={() => {
                            setReplacements(prev => [...prev, { old_die_id: replacingItem, old_die_name: srcItem?.die_name, new_die_id: null, new_die_name: null, note: '' }]);
                            setReplacingItem(null); setDieSearch('');
                          }}
                          className="text-[10px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 whitespace-nowrap">
                          Remove only
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                        {filteredDies.map(die => (
                          <button key={die.die_id}
                            onClick={() => {
                              setReplacements(prev => [...prev, { old_die_id: replacingItem, old_die_name: srcItem?.die_name, new_die_id: die.die_id, new_die_name: die.name, note: '' }]);
                              setReplacingItem(null); setDieSearch('');
                            }}
                            className="flex items-center gap-1.5 p-1.5 rounded border border-[var(--border-color)] hover:border-[#e94560]/50 hover:bg-[#e94560]/5 text-left transition-colors">
                            {die.image_url
                              ? <img src={`${BACKEND}${die.image_url}`} alt="" className="w-7 h-7 rounded object-contain bg-[var(--bg-primary)] flex-shrink-0" />
                              : <div className="w-7 h-7 rounded bg-[var(--bg-primary)] flex-shrink-0" />
                            }
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-[9px] text-[#e94560] leading-none">{die.code}</p>
                              <p className="text-[10px] text-[var(--text-primary)] leading-tight truncate">{die.name}</p>
                            </div>
                          </button>
                        ))}
                        {filteredDies.length === 0 && <p className="col-span-3 text-center text-xs text-[var(--text-secondary)] py-4">No dies found</p>}
                      </div>
                    </div>
                  );
                })()}

                {/* Save */}
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
                  <Button size="sm" variant="outline" onClick={() => { setShowManage(false); setReplacements([]); setReplacingItem(null); }}
                    className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
                  <Button size="sm" onClick={handleSaveSelection} disabled={savingSelection || replacements.length === 0}
                    className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                    {savingSelection ? 'Saving…' : `Save & Notify Customer (${replacements.length} change${replacements.length !== 1 ? 's' : ''})`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Quotation document ────────────────────────────────────────────── */}
      <div className="no-print-bg min-h-screen py-8 flex justify-center">
        <div
          className="print-page bg-white w-[210mm] shadow-xl rounded"
          style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif", color: NAVY, fontSize: '11px' }}
        >
          <div style={{ padding: '10mm 12mm' }}>

            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3mm' }}>
              {/* Left: logo + company */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                {co.logo && (
                  <img src={co.logo} alt="logo"
                    style={{ height: '36px', maxWidth: '60px', objectFit: 'contain', flexShrink: 0 }} />
                )}
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: NAVY, lineHeight: '1.2' }}>{co.name}</div>
                  {(co.addr || co.city) && (
                    <div style={{ fontSize: '7.5px', color: GRAY, marginTop: '1px' }}>
                      {[co.addr, co.city].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {coContact && <div style={{ fontSize: '7.5px', color: GRAY }}>{coContact}</div>}
                  {co.gst && <div style={{ fontSize: '7.5px', color: GRAY }}>GSTIN: {co.gst}</div>}
                </div>
              </div>
              {/* Right: QUOTATION title */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: BRAND, letterSpacing: '1px', lineHeight: 1 }}>
                  QUOTATION
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: NAVY, marginTop: '2px' }}>
                  {quot.quote_number}
                </div>
              </div>
            </div>

            {/* Dual accent lines */}
            <div style={{ height: '2.5px', background: BRAND, marginBottom: '1px' }} />
            <div style={{ height: '0.5px', background: NAVY, marginBottom: '4mm' }} />

            {/* ── INFO BLOCK ─────────────────────────────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '82mm 1fr',
              border: `0.5px solid ${BORDER}`, background: LGRAY,
              marginBottom: '4mm',
            }}>
              {/* Quote details */}
              <div style={{ padding: '6px 8px', borderRight: `0.5px solid ${BORDER}` }}>
                <div style={{ fontSize: '7px', fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>
                  Quote Details
                </div>
                {[
                  ['Quote No',    quot.quote_number],
                  ['Date',        fmtDate(quot.created_at)],
                  ['Valid Till',  addDays(quot.created_at, 30)],
                  ['Sales Person',quot.sales_person_name || '—'],
                  ...(quot.package_name ? [['Package', quot.package_name]] : []),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: '4px', fontSize: '8px', marginBottom: '1.5px' }}>
                    <span style={{ color: GRAY, minWidth: '60px' }}>{k}</span>
                    <span style={{ fontWeight: 600, color: NAVY }}>{v}</span>
                  </div>
                ))}
              </div>
              {/* Bill To */}
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: '7px', fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>
                  Bill To
                </div>
                {quot.school_name && (
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: NAVY }}>{quot.school_name}</div>
                )}
                {quot.principal_name && (
                  <div style={{ fontSize: '9px', color: NAVY }}>{quot.principal_name}</div>
                )}
                {quot.address && (
                  <div style={{ fontSize: '8px', color: GRAY, marginTop: '1px' }}>{quot.address}</div>
                )}
                {quot.customer_phone && (
                  <div style={{ fontSize: '8px', color: GRAY }}>Ph: {quot.customer_phone}</div>
                )}
                {quot.customer_email && (
                  <div style={{ fontSize: '8px', color: GRAY }}>{quot.customer_email}</div>
                )}
                {quot.customer_gst && (
                  <div style={{ fontSize: '8px', color: GRAY }}>GSTIN: {quot.customer_gst}</div>
                )}
              </div>
            </div>

            {/* ── ITEMS TABLE ────────────────────────────────────────────── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5px', marginBottom: '3mm' }}>
              <thead>
                <tr style={{ background: NAVY, color: WHITE }}>
                  {[
                    { label: 'SR',           align: 'center', w: '5%'  },
                    { label: 'DESCRIPTION',  align: 'left',   w: '49%' },
                    { label: 'QTY',          align: 'center', w: '7%'  },
                    { label: 'RATE (₹)',     align: 'right',  w: '15%' },
                    { label: 'GST (₹)',      align: 'right',  w: '11%' },
                    { label: 'AMOUNT (₹)',   align: 'right',  w: '13%' },
                  ].map(col => (
                    <th key={col.label} style={{
                      padding: '5px 6px', fontWeight: 700, fontSize: '7.5px',
                      textAlign: col.align, width: col.w,
                    }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{
                    background: i % 2 === 1 ? ALT : WHITE,
                    borderBottom: `0.3px solid ${BORDER}`,
                  }}>
                    <td style={{ padding: '4px 6px', textAlign: 'center', color: GRAY }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px', fontWeight: 500 }}>{l.description}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>{l.qty}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {(l.unit_price || 0).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: GRAY }}>
                      {(l.line_gst || 0).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {(l.line_total || 0).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── SUMMARY ────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '5mm' }}>
              <div style={{ width: '94mm' }}>
                {/* Line items */}
                {/* Items Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                  <span>Items Total</span>
                  <span style={{ fontFamily: 'monospace', color: NAVY, fontWeight: 600 }}>{fmt(itemsTotal)}</span>
                </div>
                {/* Discounts */}
                {d1p > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GREEN }}>
                    <span>Discount ({d1p}%)</span>
                    <span style={{ fontFamily: 'monospace' }}>− {fmt(d1a)}</span>
                  </div>
                )}
                {d2p > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GREEN }}>
                    <span>Additional Discount ({d2p}%)</span>
                    <span style={{ fontFamily: 'monospace' }}>− {fmt(d2a)}</span>
                  </div>
                )}
                {/* Subtotal after discounts — only shown when discounts exist */}
                {(d1p > 0 || d2p > 0) && (
                  <>
                    <div style={{ borderTop: `0.5px solid ${BORDER}`, marginTop: '3px' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', fontWeight: 700, color: NAVY }}>
                      <span>Subtotal After Discounts</span>
                      <span style={{ fontFamily: 'monospace' }}>{fmt(subDisc)}</span>
                    </div>
                  </>
                )}
                {/* Total GST */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                  <span>Total GST @ 18%</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmt(gst)}</span>
                </div>
                {/* Freight */}
                {frw > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                    <span>Freight Charge incl. 18% GST</span>
                    <span style={{ fontFamily: 'monospace' }}>{fmt(frw)}</span>
                  </div>
                )}

                {/* Grand total — navy box */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: NAVY, color: WHITE,
                  padding: '7px 8px', marginTop: '4px', borderRadius: '2px',
                }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 700 }}>TOTAL PAYABLE</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }}>₹ {fmt(gt)}</span>
                </div>
              </div>
            </div>

            {/* ── TERMS & BANK ───────────────────────────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '110mm 1fr',
              border: `0.5px solid ${BORDER}`, marginBottom: '6mm',
            }}>
              <div style={{ padding: '6px 8px', borderRight: `0.5px solid ${BORDER}` }}>
                <div style={{ fontSize: '8.5px', fontWeight: 700, color: NAVY, marginBottom: '3px' }}>
                  Terms &amp; Conditions
                </div>
                {terms.map((t, i) => (
                  <div key={i} style={{ fontSize: '7px', color: GRAY, marginBottom: '1.5px' }}>
                    {i + 1}.&nbsp; {t}
                  </div>
                ))}
              </div>
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: '8.5px', fontWeight: 700, color: NAVY, marginBottom: '3px' }}>
                  Bank Details
                </div>
                {bankLines.length > 0
                  ? bankLines.map((ln, i) => (
                      <div key={i} style={{ fontSize: '7px', color: GRAY, marginBottom: '1.5px' }}>{ln}</div>
                    ))
                  : (
                    <>
                      <div style={{ fontSize: '7px', color: GRAY }}>Account: {co.name}</div>
                      <div style={{ fontSize: '7px', color: GRAY, fontStyle: 'italic' }}>
                        Bank details will be shared separately.
                      </div>
                    </>
                  )
                }
              </div>
            </div>

            {/* ── SIGNATURE ──────────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: '70mm', textAlign: 'right' }}>
                <div style={{ fontSize: '8.5px', fontWeight: 700, color: NAVY, marginBottom: '12mm' }}>
                  For&nbsp;<strong>{co.name}</strong>
                </div>
                <div style={{ borderTop: `0.5px solid ${GRAY}`, paddingTop: '3px' }}>
                  <div style={{ fontSize: '7.5px', color: GRAY }}>Authorized Signatory</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
