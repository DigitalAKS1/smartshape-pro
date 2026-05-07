import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import API, { quotations, companySettings } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Download, Edit2, ArrowLeft, Printer, GitBranch } from 'lucide-react';
import { toast } from 'sonner';

export default function ViewQuotation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quot, setQuot] = useState(null);
  const [company, setCompany] = useState({});
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingVersion, setCreatingVersion] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [quotRes, compRes] = await Promise.all([API.get('/quotations'), companySettings.get()]);
        const found = quotRes.data.find(q => q.quotation_id === id);
        if (found) {
          setQuot(found);
          // Load sibling versions
          try {
            const vRes = await quotations.getVersions(id);
            setVersions(vRes.data || []);
          } catch { /* versions are optional */ }
        }
        setCompany(compRes.data || {});
      } catch { toast.error('Failed to load'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  const handleNewVersion = async () => {
    if (!window.confirm('Create a new draft version of this quotation? The original will remain unchanged.')) return;
    setCreatingVersion(true);
    try {
      const res = await quotations.newVersion(id);
      toast.success(`Version ${res.data.version || 2} created — ${res.data.quote_number}`);
      navigate(`/edit-quotation/${res.data.quotation_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create new version');
    } finally {
      setCreatingVersion(false);
    }
  };

  const handlePrint = () => window.print();

  if (loading || !quot) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" /></div>;
  }

  const lines = quot.lines || [];
  const sub = quot.subtotal || 0;
  const gst = quot.gst_amount || 0;
  const twg = quot.total_with_gst || 0;
  const d1p = quot.discount1_pct || 0;
  const d1a = quot.disc1_amount || 0;
  const d2p = quot.discount2_pct || 0;
  const d2a = quot.disc2_amount || 0;
  const fr = quot.freight_total || 0;
  const gt = quot.grand_total || 0;

  return (
    <>
      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-page { box-shadow: none !important; margin: 0 !important; padding: 8mm 10mm !important; max-width: 100% !important; page-break-inside: avoid; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      {/* Action Bar */}
      <div className="no-print bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate('/quotations')} variant="ghost" size="sm" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <span className="text-[var(--text-primary)] font-medium">{quot.quote_number}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${quot.quotation_status === 'confirmed' ? 'bg-green-500/20 text-green-300' : quot.quotation_status === 'sent' ? 'bg-blue-500/20 text-blue-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
            {quot.quotation_status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleNewVersion}
            disabled={creatingVersion}
            variant="outline"
            size="sm"
            className="border-[#3b82f6]/50 text-[#3b82f6] hover:bg-[#3b82f6]/10"
            title="Clone this quotation as a new draft version"
          >
            <GitBranch className="mr-1.5 h-3 w-3" />
            {creatingVersion ? 'Creating…' : `New Version${quot?.version ? ` (V${quot.version})` : ''}`}
          </Button>
          <Link to={`/edit-quotation/${id}`}>
            <Button variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Edit2 className="mr-2 h-3 w-3" /> Edit
            </Button>
          </Link>
          <Button onClick={() => quotations.downloadPdf(id)} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" data-testid="download-pdf-btn">
            <Download className="mr-2 h-3 w-3" /> PDF
          </Button>
          <Button onClick={handlePrint} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="print-btn">
            <Printer className="mr-2 h-3 w-3" /> Print
          </Button>
        </div>
      </div>

      {/* Quotation Document - Light Theme, fits A4 */}
      <div className="min-h-screen bg-gray-100 py-8 flex justify-center no-print-bg">
        <div className="print-page bg-white w-[210mm] min-h-[297mm] max-h-[297mm] shadow-xl rounded overflow-hidden" style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", fontSize: '11px', color: '#1a1a2e' }}>
          <div className="p-[10mm]" style={{ height: '273mm', display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {company.logo_url && <img src={company.logo_url} alt="Logo" style={{ height: '36px', objectFit: 'contain' }} />}
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a2e' }}>{company.company_name || 'SmartShapes'}</div>
                  <div style={{ fontSize: '8px', color: '#888' }}>{company.email} {company.phone && `| ${company.phone}`}</div>
                  {company.gst_number && <div style={{ fontSize: '8px', color: '#888' }}>GST: {company.gst_number}</div>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#e94560', letterSpacing: '1px' }}>QUOTATION</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>{quot.quote_number}</div>
                <div style={{ fontSize: '8px', color: '#888' }}>Date: {(quot.created_at || '').slice(0, 10)}</div>
              </div>
            </div>

            {/* Accent line */}
            <div style={{ height: '2px', background: 'linear-gradient(90deg, #e94560, #1a1a2e)', marginBottom: '5mm' }} />

            {/* Bill To / Package */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5mm' }}>
              <div>
                <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Bill To</div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{quot.principal_name}</div>
                <div style={{ fontSize: '10px', color: '#444' }}>{quot.school_name}</div>
                {quot.address && <div style={{ fontSize: '9px', color: '#666' }}>{quot.address}</div>}
                {quot.customer_phone && <div style={{ fontSize: '9px', color: '#666' }}>Ph: {quot.customer_phone}</div>}
                {quot.customer_email && <div style={{ fontSize: '9px', color: '#666' }}>{quot.customer_email}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '8px', color: '#999', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Package</div>
                <div style={{ fontSize: '11px', fontWeight: 600 }}>{quot.package_name}</div>
                <div style={{ fontSize: '9px', color: '#666' }}>Sales: {quot.sales_person_name}</div>
              </div>
            </div>

            {/* Product Lines Table */}
            <div style={{ flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
                <thead>
                  <tr style={{ background: '#1a1a2e', color: 'white' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: '5%' }}>#</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>ITEM</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, width: '8%' }}>QTY</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: '15%' }}>UNIT PRICE</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: '12%' }}>GST</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: '15%' }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee', background: i % 2 === 1 ? '#f9f9fb' : 'white' }}>
                      <td style={{ padding: '5px 8px', textAlign: 'center', color: '#888' }}>{i + 1}</td>
                      <td style={{ padding: '5px 8px', fontWeight: 500 }}>{l.description}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>{l.qty}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(l.unit_price)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#666' }}>{formatCurrency(l.line_gst)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pricing Summary - Right aligned */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4mm' }}>
              <div style={{ width: '55%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', color: '#666' }}>
                  <span>Items Subtotal</span><span style={{ fontFamily: 'monospace' }}>{formatCurrency(sub)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', color: '#666' }}>
                  <span>GST</span><span style={{ fontFamily: 'monospace' }}>{formatCurrency(gst)}</span>
                </div>
                {d1p > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', color: '#16a34a' }}>
                    <span>Discount ({d1p}%)</span><span style={{ fontFamily: 'monospace' }}>-{formatCurrency(d1a)}</span>
                  </div>
                )}
                {d2p > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', color: '#16a34a' }}>
                    <span>Addl. Discount ({d2p}%)</span><span style={{ fontFamily: 'monospace' }}>-{formatCurrency(d2a)}</span>
                  </div>
                )}
                {fr > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', color: '#666' }}>
                    <span>Freight (incl. GST)</span><span style={{ fontFamily: 'monospace' }}>{formatCurrency(fr)}</span>
                  </div>
                )}
                <div style={{ borderTop: '2px solid #e94560', marginTop: '4px', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a2e' }}>TOTAL PAYABLE</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#e94560', fontFamily: 'monospace' }}>{formatCurrency(gt)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: '5mm', borderTop: '1px solid #eee', paddingTop: '3mm' }}>
              <div style={{ fontSize: '7px', color: '#999' }}>Terms: Prices valid for 30 days from quotation date. GST as applicable. Freight charges additional unless specified.</div>
              <div style={{ fontSize: '7px', color: '#999' }}>Generated by {company.company_name || 'SmartShapes'} | {company.email || ''}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
