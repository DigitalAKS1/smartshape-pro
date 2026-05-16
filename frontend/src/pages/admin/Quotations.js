import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import API, { quotations as quotApi, salesPersons, exportData } from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import EmptyState, { EMPTY_STATES } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/input';
import {
  FileText, Search, Send, ArrowRight, Mail, Download, Edit2, Trash2,
  GitBranch, Link2, ShoppingCart, Eye, MessageCircle, Smartphone,
  Monitor, X, Copy, Check, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import SendEmailDialog from '../../components/SendEmailDialog';

// ── WhatsApp Picker Dialog ─────────────────────────────────
function WhatsAppDialog({ open, onClose, quot, link, generating }) {
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && quot) setPhone(quot.customer_phone || '');
  }, [open, quot]);

  const num = phone.replace(/\D/g, '');
  const e164 = num ? (num.startsWith('91') ? num : '91' + num) : '';
  const encoded = encodeURIComponent(message(quot, link));

  function message(q, l) {
    if (!q) return '';
    const name = q.principal_name || q.school_name || 'there';
    const total = `${q.currency_symbol || '₹'}${(q.grand_total || 0).toLocaleString('en-IN')}`;
    return (
`Hello ${name}! 👋

Greetings from SmartShape Pro!

We are pleased to share your personalized product catalogue.

🏫 *School:* ${q.school_name || ''}
📦 *Package:* ${q.package_name || ''}
💰 *Quote Total:* ${total}
🔖 *Quote No:* ${q.quote_number || ''}

Please browse and select your preferred dies from the link below:
👉 ${l || '(generating link…)'}

Feel free to reach out for any assistance.

Warm regards,
${q.sales_person_name || 'SmartShape Pro Team'}
SmartShape Pro 🎯`
    );
  }

  const openWa = (type) => {
    if (!e164) { toast.error('Please enter a phone number'); return; }
    const url = type === 'web'
      ? `https://web.whatsapp.com/send?phone=${e164}&text=${encoded}`
      : `https://wa.me/${e164}?text=${encoded}`;
    window.open(url, '_blank');
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-[var(--bg-card)] border border-[var(--border-color)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#25d366]/15 flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-[#25d366]" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">Send via WhatsApp</p>
              {quot && <p className="text-xs text-[var(--text-muted)] truncate max-w-[220px]">{quot.school_name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] p-1.5 rounded-lg hover:bg-[var(--bg-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Phone */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5 block">
              Phone Number <span className="font-normal text-[var(--text-muted)]">(auto-filled from quotation)</span>
            </label>
            <Input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] h-10"
            />
          </div>

          {/* Message preview */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Message Preview</label>
              {link && (
                <button onClick={copyLink} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                  {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy link</>}
                </button>
              )}
            </div>
            <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3.5 max-h-52 overflow-y-auto">
              {generating ? (
                <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating catalogue link…
                </div>
              ) : (
                <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                  {message(quot, link)}
                </pre>
              )}
            </div>
          </div>

          {/* Send buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => openWa('app')}
              disabled={generating || !link}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25d366] hover:bg-[#22c55e] text-white font-semibold text-sm disabled:opacity-40 transition-colors active:opacity-80"
            >
              <Smartphone className="h-4 w-4" />
              WhatsApp App
            </button>
            <button
              onClick={() => openWa('web')}
              disabled={generating || !link}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#075e54] hover:bg-[#065049] text-white font-semibold text-sm disabled:opacity-40 transition-colors active:opacity-80"
            >
              <Monitor className="h-4 w-4" />
              WhatsApp Web
            </button>
          </div>

          {!link && !generating && (
            <p className="text-xs text-amber-400 text-center">Link generation failed. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function Quotations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canDelete = user?.role === 'admin' || (user?.assigned_modules || []).includes('accounts');
  const [quotations, setQuotations] = useState([]);
  const [filteredQuotations, setFilteredQuotations] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedQuotations, setSelectedQuotations] = useState([]);
  const [catalogueDialog, setCatalogueDialog] = useState({ open: false, quot: null, sending: false });
  const [waDialog, setWaDialog] = useState({ open: false, quot: null, link: '', generating: false });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await quotApi.getAll();
        setQuotations(res.data);
        setFilteredQuotations(res.data);
      } catch (error) {
        toast.error('Failed to load quotations');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    let filtered = quotations;
    if (statusFilter !== 'all') filtered = filtered.filter(q => q.quotation_status === statusFilter);
    if (searchTerm) filtered = filtered.filter(q =>
      q.school_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.quote_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredQuotations(filtered);
  }, [searchTerm, statusFilter, quotations]);

  // ── WhatsApp ───────────────────────────────────────────────
  const handleOpenWhatsApp = async (quot) => {
    setWaDialog({ open: true, quot, link: '', generating: true });
    try {
      let link = '';
      if (quot.catalogue_token) {
        link = `${window.location.origin}/catalogue/${quot.catalogue_token}`;
      } else {
        const res = await API.post(`/quotations/${quot.quotation_id}/send-catalogue`);
        link = res.data.catalogue_url || '';
        const updatedRes = await quotApi.getAll();
        setQuotations(updatedRes.data);
      }
      setWaDialog(d => ({ ...d, link, generating: false }));
    } catch {
      toast.error('Failed to generate catalogue link');
      setWaDialog(d => ({ ...d, generating: false }));
    }
  };

  // ── Catalogue email dialog ─────────────────────────────────
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
      const updatedRes = await quotApi.getAll();
      setQuotations(updatedRes.data);
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
      setSelectedQuotations([]);
      const updatedRes = await quotApi.getAll();
      setQuotations(updatedRes.data);
    } catch { toast.error('Failed to send some catalogues'); }
  };

  const toggleSelection = (id) => setSelectedQuotations(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleDelete = async (quotationId) => {
    if (!window.confirm('Delete this quotation?')) return;
    try {
      await quotApi.delete(quotationId);
      toast.success('Quotation deleted');
      const updatedRes = await quotApi.getAll();
      setQuotations(updatedRes.data);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete'); }
  };

  const selectAll = () => {
    const unsent = filteredQuotations.filter(q => q.catalogue_status === 'not_sent').map(q => q.quotation_id);
    setSelectedQuotations(unsent);
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

  // ── Shared action cells ────────────────────────────────────
  const WaBtn = ({ quot, size = 'sm' }) => (
    <Button size={size} onClick={() => handleOpenWhatsApp(quot)}
      className="bg-[#25d366] hover:bg-[#22c55e] text-white h-8 px-2 gap-1"
      title="Send via WhatsApp">
      <MessageCircle className="h-3.5 w-3.5" />
      <span className="text-xs hidden sm:inline">WA</span>
    </Button>
  );

  return (
    <AdminLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="quotations-title">Quotations</h1>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">Manage all quotations, send catalogues and WhatsApp messages</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedQuotations.length > 0 && (
              <Button onClick={handleBulkSend} size="sm" className="bg-[#3b82f6] hover:bg-[#2563eb] text-white" data-testid="bulk-send-button">
                <Mail className="mr-1 h-3 w-3" /> Send {selectedQuotations.length}
              </Button>
            )}
            <Button onClick={() => { exportData.download('quotations'); toast.success('Exporting…'); }} variant="outline" size="sm"
              className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="export-quotations-button">
              <Download className="mr-1 h-3 w-3" /> Export CSV
            </Button>
            <Link to="/create-quotation">
              <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-quotation-button">
                Create Quotation <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <Input type="text" placeholder="Search by school or quote number..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                data-testid="quotations-search-input" />
            </div>
            <div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md"
                data-testid="quotations-status-filter">
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <Button onClick={selectAll} variant="outline" className="w-full border-[var(--border-color)] text-[var(--text-primary)]"
                data-testid="select-all-button">
                Select All Unsent
              </Button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
                <p className="mt-4 text-[var(--text-secondary)]">Loading...</p>
              </div>
            </div>
          ) : filteredQuotations.length === 0 ? (
            <EmptyState
              {...(searchTerm ? EMPTY_STATES.searchResult : EMPTY_STATES.quotations)}
              action={{ label: '+ Create Quotation', onClick: () => navigate('/create-quotation') }}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full" data-testid="quotations-table">
                  <thead className="bg-[var(--bg-primary)]/50">
                    <tr className="border-b border-[var(--border-color)]">
                      <th className="w-12 px-4 py-4" />
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Quote #</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">School</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Package</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Amount</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Status</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Catalogue</th>
                      <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-4 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotations.map((quot) => (
                      <tr key={quot.quotation_id}
                        className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors"
                        data-testid={`quotation-row-${quot.quote_number}`}>

                        {/* Checkbox */}
                        <td className="px-4 py-4">
                          {quot.catalogue_status === 'not_sent' && (
                            <input type="checkbox" checked={selectedQuotations.includes(quot.quotation_id)}
                              onChange={() => toggleSelection(quot.quotation_id)}
                              className="w-4 h-4 rounded border-[var(--border-color)] bg-[var(--bg-primary)]"
                              data-testid={`select-${quot.quote_number}`} />
                          )}
                        </td>

                        {/* Quote # */}
                        <td className="px-4 py-4 font-mono font-medium">
                          <div className="flex items-center gap-2">
                            <Link to={`/view-quotation/${quot.quotation_id}`} className="text-[#e94560] hover:underline"
                              data-testid={`view-quot-${quot.quote_number}`}>{quot.quote_number}</Link>
                            {quot.version && quot.version > 1 && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30">
                                <GitBranch className="h-2.5 w-2.5" />V{quot.version}
                              </span>
                            )}
                            {(!quot.version || quot.version === 1) && quot.parent_quotation_id === undefined && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]">V1</span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-4 text-[var(--text-primary)]">{quot.school_name}</td>
                        <td className="px-4 py-4 text-[var(--text-secondary)]">{quot.package_name}</td>
                        <td className="px-4 py-4 font-mono text-[var(--text-primary)] font-bold">{formatCurrency(quot.grand_total)}</td>

                        <td className="px-4 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(quot.quotation_status)}`}>
                            {quot.quotation_status}
                          </span>
                        </td>

                        {/* Catalogue status */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(quot.catalogue_status)}`}>
                              {quot.catalogue_status.replace('_', ' ')}
                            </span>
                            {quot.catalogue_token && (quot.catalogue_status === 'sent' || quot.catalogue_status === 'opened') && (
                              <button onClick={() => handleCopyLink(quot.catalogue_token)} title="Copy catalogue link"
                                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-xs">
                                <Link2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {quot.catalogue_status === 'submitted' && (
                              <Button size="sm" onClick={() => handleCreateOrder(quot.quotation_id)}
                                className="bg-green-600 hover:bg-green-700 text-white h-7 px-2 text-[11px]">
                                <ShoppingCart className="mr-1 h-3 w-3" /> Create Order
                              </Button>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Link to={`/view-quotation/${quot.quotation_id}`}>
                              <Button size="sm" variant="ghost" className="text-[var(--text-secondary)] hover:text-[#e94560] h-8 px-2" title="View">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                            <Button size="sm" variant="ghost" onClick={() => quotApi.downloadPdf(quot.quotation_id)}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] h-8 px-2" title="Download PDF"
                              data-testid={`download-pdf-${quot.quote_number}`}>
                              <Download className="h-3 w-3" />
                            </Button>
                            <Link to={`/edit-quotation/${quot.quotation_id}`}>
                              <Button size="sm" variant="ghost" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] h-8 px-2"
                                data-testid={`edit-quot-${quot.quote_number}`}>
                                <Edit2 className="h-3 w-3" />
                              </Button>
                            </Link>

                            {/* WhatsApp — available for all quotations */}
                            <WaBtn quot={quot} />

                            {/* Email — always available (send/resend catalogue + PDF) */}
                            <Button size="sm" onClick={() => openCatalogueDialog(quot)}
                              className="bg-[#3b82f6] hover:bg-[#2563eb] text-white h-8 px-2"
                              data-testid={`send-catalogue-button-${quot.quote_number}`}
                              title={quot.catalogue_status === 'not_sent' ? 'Send Catalogue + PDF' : 'Resend Catalogue + PDF'}>
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                            {canDelete && (
                              <Button size="sm" variant="ghost" onClick={() => handleDelete(quot.quotation_id)}
                                className="text-red-400 hover:text-red-300 h-8 px-2"
                                data-testid={`delete-quot-${quot.quote_number}`}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card view */}
              <div className="lg:hidden space-y-3 p-3">
                {filteredQuotations.map((quot) => (
                  <div key={quot.quotation_id}
                    className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-4"
                    data-testid={`quotation-card-${quot.quote_number}`}>

                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <Link to={`/view-quotation/${quot.quotation_id}`}
                          className="font-mono text-sm text-[#e94560] font-medium hover:underline">
                          {quot.quote_number}
                        </Link>
                        <h3 className="text-base font-medium text-[var(--text-primary)] truncate mt-0.5">{quot.school_name}</h3>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {quot.package_name}{quot.sales_person_name ? ` · ${quot.sales_person_name}` : ''}
                        </p>
                      </div>
                      <span className={`ml-2 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${getStatusColor(quot.quotation_status)}`}>
                        {quot.quotation_status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t border-[var(--border-color)]">
                      <span className="font-mono text-lg font-bold text-[var(--text-primary)]">{formatCurrency(quot.grand_total)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(quot.catalogue_status)}`}>
                        {quot.catalogue_status.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Mobile action row */}
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border-color)] flex-wrap">
                      <Link to={`/view-quotation/${quot.quotation_id}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full text-xs border-[var(--border-color)] text-[var(--text-secondary)]">
                          <Eye className="mr-1 h-3 w-3" /> View
                        </Button>
                      </Link>
                      <Button variant="outline" size="sm" onClick={() => quotApi.downloadPdf(quot.quotation_id)}
                        className="text-xs border-[var(--border-color)] text-[var(--text-secondary)]">
                        <Download className="h-3 w-3" />
                      </Button>

                      {/* WhatsApp — always visible */}
                      <Button size="sm" onClick={() => handleOpenWhatsApp(quot)}
                        className="bg-[#25d366] hover:bg-[#22c55e] text-white text-xs px-3 gap-1.5">
                        <MessageCircle className="h-3.5 w-3.5" /> WA
                      </Button>

                      {/* Email — always visible (send/resend catalogue + PDF) */}
                      <Button size="sm" onClick={() => openCatalogueDialog(quot)}
                        className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs px-3 gap-1.5"
                        title={quot.catalogue_status === 'not_sent' ? 'Send Catalogue + PDF' : 'Resend Catalogue + PDF'}>
                        <Mail className="h-3.5 w-3.5" /> Email
                      </Button>
                      {quot.catalogue_token && (quot.catalogue_status === 'sent' || quot.catalogue_status === 'opened') && (
                        <Button size="sm" variant="outline" onClick={() => handleCopyLink(quot.catalogue_token)}
                          className="border-blue-500/40 text-blue-400 text-xs px-3">
                          <Link2 className="mr-1 h-3 w-3" /> Copy
                        </Button>
                      )}
                      {quot.catalogue_status === 'submitted' && (
                        <Button size="sm" onClick={() => handleCreateOrder(quot.quotation_id)}
                          className="bg-green-600 hover:bg-green-700 text-white text-xs">
                          <ShoppingCart className="mr-1 h-3 w-3" /> Order
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Email dialog */}
      <SendEmailDialog
        open={catalogueDialog.open}
        onClose={() => setCatalogueDialog({ open: false, quot: null, sending: false })}
        onSend={handleSendCatalogue}
        title="Send Catalogue via Email"
        defaultTo={catalogueDialog.quot?.customer_email || ''}
        defaultCc={catalogueDialog.quot?.sales_person_email || ''}
        sending={catalogueDialog.sending}
      />

      {/* WhatsApp dialog */}
      <WhatsAppDialog
        open={waDialog.open}
        onClose={() => setWaDialog({ open: false, quot: null, link: '', generating: false })}
        quot={waDialog.quot}
        link={waDialog.link}
        generating={waDialog.generating}
      />
    </AdminLayout>
  );
}
