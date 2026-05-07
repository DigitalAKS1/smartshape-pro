import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { quotations as quotApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate, getStatusColor } from '../../lib/utils';
import { FileText, Eye, Edit3, Download, Plus, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import API from '../../lib/api';
import { toast } from 'sonner';

export default function SalesQuotations() {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchQuotations = async () => {
      try {
        const res = await quotApi.getAll();
        setQuotations(res.data);
      } catch (error) {
        console.error('Error fetching quotations:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchQuotations();
  }, []);

  const filtered = statusFilter === 'all'
    ? quotations
    : quotations.filter(q => q.quotation_status === statusFilter);

  const statuses = ['all', ...new Set(quotations.map(q => q.quotation_status))];

  const handleDownloadPdf = (id, quoteNum) => {
    quotApi.downloadPdf(id);
    toast.success(`Downloading ${quoteNum}...`);
  };

  const [sendingId, setSendingId] = useState(null);
  const handleSendCatalogue = async (quotationId, quoteNum) => {
    setSendingId(quotationId);
    try {
      await quotApi.sendCatalogue(quotationId);
      try {
        const emailRes = await API.post(`/quotations/${quotationId}/send-catalogue-email`);
        if (emailRes.data.email_sent) {
          toast.success(`Catalogue emailed for ${quoteNum}`);
        } else {
          toast.info(`Catalogue link generated for ${quoteNum}`);
          if (emailRes.data.email_error) toast.warning(emailRes.data.email_error);
        }
      } catch (emailError) {
        const msg = emailError?.response?.data?.detail || 'Email send failed. Ask admin to check Gmail SMTP.';
        toast.warning(msg);
      }
      const updatedRes = await quotApi.getAll();
      setQuotations(updatedRes.data);
    } catch (error) {
      toast.error('Failed to send catalogue');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <SalesLayout title="My Quotations" showBack>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]" data-testid="sales-quotations-title">My Quotations</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">{quotations.length} total</p>
          </div>
          <Link to="/create-quotation">
            <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="sales-create-quotation-btn">
              <Plus className="mr-1 h-4 w-4" /> New
            </Button>
          </Link>
        </div>

        {/* Status Filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-testid="quotation-status-filters">
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                statusFilter === s
                  ? 'bg-[#e94560] text-white border-[#e94560]'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[#e94560]'
              }`}
              data-testid={`filter-${s}`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-12 text-center">
            <FileText className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
            <p className="text-[var(--text-muted)]">{quotations.length === 0 ? 'No quotations yet' : 'No quotations match this filter'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((quot) => (
              <div key={quot.quotation_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`quotation-card-${quot.quote_number}`}>
                {/* Top row: quote number + status */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-[#e94560] font-medium">{quot.quote_number}</p>
                    <h3 className="text-base font-medium text-[var(--text-primary)] mt-0.5 truncate">{quot.school_name}</h3>
                    {quot.principal_name && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{quot.principal_name}</p>}
                  </div>
                  <span className={`ml-2 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${getStatusColor(quot.quotation_status)}`}>
                    {quot.quotation_status}
                  </span>
                </div>

                {/* Amount + Date */}
                <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Amount</p>
                    <p className="text-lg font-mono font-bold text-[var(--text-primary)]">{formatCurrency(quot.grand_total)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--text-muted)]">Date</p>
                    <p className="text-sm text-[var(--text-secondary)]">{formatDate(quot.created_at)}</p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
                  <Link to={`/view-quotation/${quot.quotation_id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560]" data-testid={`view-quotation-${quot.quote_number}`}>
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                    </Button>
                  </Link>
                  {(quot.quotation_status === 'draft' || quot.quotation_status === 'pending') && (
                    <Link to={`/edit-quotation/${quot.quotation_id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560]" data-testid={`edit-quotation-${quot.quote_number}`}>
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" /> Edit
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleDownloadPdf(quot.quotation_id, quot.quote_number)}
                    className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560]"
                    data-testid={`download-quotation-${quot.quote_number}`}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleSendCatalogue(quot.quotation_id, quot.quote_number)}
                    disabled={sendingId === quot.quotation_id}
                    className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#10b981] hover:border-[#10b981]"
                    data-testid={`send-quotation-${quot.quote_number}`}
                    title="Send catalogue via email">
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Catalogue Status */}
                {quot.catalogue_status && quot.catalogue_status !== 'not_sent' && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                    <p className="text-xs text-[var(--text-muted)]">Catalogue: <span className={`font-medium ${getStatusColor(quot.catalogue_status)}`}>{quot.catalogue_status.replace('_', ' ')}</span></p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SalesLayout>
  );
}
