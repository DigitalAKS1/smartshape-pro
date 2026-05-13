import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import API, { quotations, companySettings } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Download, Edit2, ArrowLeft, Printer, GitBranch } from 'lucide-react';
import { toast } from 'sonner';

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
