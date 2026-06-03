import React from 'react';
import { useViewQuotation } from '../../hooks/useViewQuotation';
import QuotationHeader from '../../components/quotations/QuotationHeader';
import QuotationLineItems from '../../components/quotations/QuotationLineItems';
import QuotationSummary from '../../components/quotations/QuotationSummary';
import ManageSelection from '../../components/quotations/ManageSelection';
import QuotationInfoBlock from '../../components/quotations/QuotationInfoBlock';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

// ─── design tokens ────────────────────────────────────────────────────────────
const NAVY = '#1a1a2e';

const fmtDate = (iso) => {
  try {
    return new Date(iso.slice(0, 10)).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso?.slice(0, 10) || ''; }
};

const addDays = (iso, days) => {
  try {
    const d = new Date(iso.slice(0, 10));
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '30 days from date'; }
};

export default function ViewQuotation() {
  const state = useViewQuotation();
  const {
    id, quot, company, versions, loading,
    creatingVersion, pdfBlobUrl, pdfLoading,
    handleNewVersion,
  } = state;

  if (loading || !quot) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
      </div>
    );
  }

  const co = {
    name:  company.company_name || 'Divine Computers Private Limited',
    addr:  company.address     || '1st Floor 601, Sector 16A Road, Nearby Rama Palace',
    city:  [company.city, company.state, company.pincode].filter(Boolean).join(', ') || 'Faridabad – 121002',
    phone: company.phone || '',
    email: company.email || '',
    gst:   company.gst_number || '06AABCD6116E1Z5',
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
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; }
          @page { size: A4; margin: 10mm 12mm; }
        }
        .no-print-bg { background: #e8e8ee; }
      `}</style>

      <QuotationHeader
        quot={quot}
        id={id}
        creatingVersion={creatingVersion}
        onNewVersion={handleNewVersion}
      />

      <ManageSelection state={state} />

      {/* ── PDF Preview ─────────────────────────────────────────────────── */}
      <div className="no-print-bg bg-[#e8e8ee] min-h-screen py-6 flex flex-col items-center">
        {pdfLoading ? (
          <div className="flex flex-col items-center justify-center mt-24 gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
            <span className="text-sm text-gray-500">Loading PDF preview…</span>
          </div>
        ) : pdfBlobUrl ? (
          <iframe
            src={pdfBlobUrl}
            title="Quotation PDF"
            className="w-full shadow-2xl rounded"
            style={{ maxWidth: '860px', height: '100vh', minHeight: '900px', border: 'none', background: '#fff' }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center mt-24 gap-3 text-gray-400">
            <span className="text-5xl">📄</span>
            <span className="text-sm">PDF preview unavailable — click Download PDF above</span>
          </div>
        )}

        {/* Hidden print-only document */}
        <div style={{ display: 'none' }}>
          <div
            className="print-page bg-white w-[210mm] shadow-xl rounded"
            style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif", color: NAVY, fontSize: '11px' }}
          >
            <div style={{ padding: '10mm 12mm' }}>
              <QuotationInfoBlock
                quot={quot}
                co={co}
                coContact={coContact}
                versions={versions}
                fmtDate={fmtDate}
                addDays={addDays}
              />
              <QuotationLineItems lines={quot.lines || []} />
              <QuotationSummary
                quot={quot}
                company={company}
                terms={terms}
                bankLines={bankLines}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
