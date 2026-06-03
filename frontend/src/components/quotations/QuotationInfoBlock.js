import React from 'react';

const BRAND = '#e94560';
const NAVY  = '#1a1a2e';
const GRAY  = '#666677';
const LGRAY = '#f4f4f7';
const BORDER= '#c8c8d4';

/**
 * QuotationInfoBlock — the print header: company logo/details + quote meta + customer block.
 * Also renders the dual accent lines separating header from body.
 */
export default function QuotationInfoBlock({ quot, co, coContact, versions, fmtDate, addDays }) {
  return (
    <>
      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3mm' }}>
        {/* Left: logo + company block */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          {co.logo && (
            <div style={{
              width: '54px', height: '54px', flexShrink: 0,
              borderRadius: '6px', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#fff5eb',
              border: `1px solid ${BORDER}`,
            }}>
              <img src={co.logo} alt="logo"
                style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
            </div>
          )}
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: NAVY, letterSpacing: '0.2px', lineHeight: '1.15' }}>
              {co.name}
            </div>
            <div style={{ fontSize: '7.5px', color: GRAY, marginTop: '2px', lineHeight: '1.5' }}>
              {co.addr}
            </div>
            <div style={{ fontSize: '7.5px', color: GRAY, lineHeight: '1.5' }}>
              {co.city}
            </div>
            {coContact && (
              <div style={{ fontSize: '7.5px', color: GRAY, lineHeight: '1.5' }}>{coContact}</div>
            )}
            <div style={{
              display: 'inline-block', marginTop: '3px',
              fontSize: '7px', fontWeight: 700, letterSpacing: '0.5px',
              color: '#fff', background: NAVY,
              padding: '1px 6px', borderRadius: '2px',
            }}>
              GSTIN:&nbsp;{co.gst}
            </div>
          </div>
        </div>

        {/* Right: QUOTATION title block */}
        <div style={{
          textAlign: 'right', flexShrink: 0,
          borderLeft: `2px solid ${BRAND}`,
          paddingLeft: '14px',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: BRAND, letterSpacing: '2px', lineHeight: 1 }}>
            QUOTATION
          </div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: NAVY, marginTop: '3px', letterSpacing: '0.5px' }}>
            {quot.quote_number}
          </div>
          {versions.length > 0 && (
            <div style={{ fontSize: '7.5px', color: GRAY, marginTop: '1px' }}>
              Version {versions.length + 1}
            </div>
          )}
        </div>
      </div>

      {/* Dual accent lines */}
      <div style={{ height: '3px', background: `linear-gradient(to right, ${BRAND}, ${NAVY})`, marginBottom: '1px', borderRadius: '1px' }} />
      <div style={{ height: '0.5px', background: NAVY, marginBottom: '4mm', opacity: 0.3 }} />

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
            ['Valid Till',  quot.valid_until ? fmtDate(quot.valid_until) : addDays(quot.created_at, 30)],
            ['Sales Person',quot.sales_person_name || '—'],
            ...(quot.package_name ? [['Package', quot.package_name]] : []),
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: '4px', fontSize: '8px', marginBottom: '1.5px' }}>
              <span style={{ color: GRAY, minWidth: '60px' }}>{k}</span>
              <span style={{ fontWeight: 600, color: NAVY }}>{v}</span>
            </div>
          ))}
        </div>
        {/* Customer Name */}
        <div style={{ padding: '6px 8px' }}>
          <div style={{ fontSize: '7px', fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>
            Customer Name
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
          {(quot.city || quot.state || quot.pincode) && (
            <div style={{ fontSize: '8px', color: GRAY }}>
              {[quot.city, quot.state, quot.pincode].filter(Boolean).join(', ')}
            </div>
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
    </>
  );
}
