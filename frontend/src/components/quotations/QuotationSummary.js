import React from 'react';

const NAVY  = '#1a1a2e';
const GRAY  = '#666677';
const BORDER= '#c8c8d4';
const GREEN = '#16a34a';
const WHITE = '#ffffff';

const fmt = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

export default function QuotationSummary({ quot, company, terms, bankLines }) {
  const d1p      = quot.discount1_pct  || 0;
  const d1a      = quot.disc1_amount   || 0;
  const d2p      = quot.discount2_pct  || 0;
  const d2a      = quot.disc2_amount   || 0;
  const subDisc  = quot.subtotal_after_disc ?? quot.after_disc2 ?? (quot.subtotal - d1a - d2a);
  const gst      = quot.gst_amount     || 0;
  const freightBase = Number(quot.freight_amount) || 0;
  const subTotal = quot.sub_total ?? (subDisc + freightBase);
  const frw      = quot.freight_with_gst ?? quot.freight_total ?? 0;
  const gt       = quot.grand_total    || 0;
  const itemsTotal = quot.subtotal     || 0;
  const gstBreakup = (quot.gst_breakup && quot.gst_breakup.length > 0)
    ? quot.gst_breakup
    : (gst ? [{ rate: 18, amount: gst }] : []);
  // format_version >= 2: AMOUNT excl. GST, freight in Sub Total, GST by slab.
  // Older quotations keep the legacy layout (GST @ 18% + freight incl. GST).
  const isNew = (quot.format_version ?? 1) >= 2;

  const coName = company.company_name || 'Divine Computers Private Limited';

  return (
    <>
      {/* ── SUMMARY ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '5mm' }}>
        <div style={{ width: '94mm' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
            <span>Items Total</span>
            <span style={{ fontFamily: 'monospace', color: NAVY, fontWeight: 600 }}>{fmt(itemsTotal)}</span>
          </div>
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
          {isNew ? (
            <>
              {freightBase > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                  <span>Freight</span>
                  <span style={{ fontFamily: 'monospace' }}>+ {fmt(freightBase)}</span>
                </div>
              )}
              <div style={{ borderTop: `0.5px solid ${BORDER}`, marginTop: '3px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', fontWeight: 700, color: NAVY }}>
                <span>Sub Total</span>
                <span style={{ fontFamily: 'monospace' }}>{fmt(subTotal)}</span>
              </div>
              {gstBreakup.map((slab, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                  <span>GST @ {slab.rate}%</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmt(slab.amount)}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              {(d1p > 0 || d2p > 0) && (
                <>
                  <div style={{ borderTop: `0.5px solid ${BORDER}`, marginTop: '3px' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9px', fontWeight: 700, color: NAVY }}>
                    <span>Subtotal After Discounts</span>
                    <span style={{ fontFamily: 'monospace' }}>{fmt(subDisc)}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                <span>Total GST @ 18%</span>
                <span style={{ fontFamily: 'monospace' }}>{fmt(gst)}</span>
              </div>
              {frw > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                  <span>Freight Charge incl. 18% GST</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmt(frw)}</span>
                </div>
              )}
            </>
          )}
          {(() => {
            const roundedGt = Math.round(gt);
            const roundOff = roundedGt - gt;
            return (
              <>
                {Math.abs(roundOff) > 0.001 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8.5px', color: GRAY }}>
                    <span>Round Off</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {roundOff >= 0 ? '+ ' : '− '}{fmt(Math.abs(roundOff))}
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: NAVY, color: WHITE,
                  padding: '7px 8px', marginTop: '4px', borderRadius: '2px',
                }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 700 }}>TOTAL PAYABLE</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }}>
                    ₹ {roundedGt.toLocaleString('en-IN')}
                  </span>
                </div>
              </>
            );
          })()}
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
                <div style={{ fontSize: '7px', color: GRAY }}>Account: {coName}</div>
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
            For&nbsp;<strong>{coName}</strong>
          </div>
          <div style={{ borderTop: `0.5px solid ${GRAY}`, paddingTop: '3px' }}>
            <div style={{ fontSize: '7.5px', color: GRAY }}>Authorized Signatory</div>
          </div>
        </div>
      </div>
    </>
  );
}
