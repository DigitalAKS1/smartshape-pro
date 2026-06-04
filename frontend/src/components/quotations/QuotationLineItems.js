import React from 'react';

const NAVY  = '#1a1a2e';
const GRAY  = '#666677';
const BORDER= '#c8c8d4';
const ALT   = '#f8f8fb';
const WHITE = '#ffffff';

export default function QuotationLineItems({ lines, formatVersion }) {
  // format_version >= 2: AMOUNT = qty × rate (excl. GST), no per-item GST column.
  // Older quotations keep the legacy GST (₹) column with GST-inclusive amounts.
  const isNew = (formatVersion ?? 1) >= 2;

  const cols = isNew
    ? [
        { label: 'SR',          align: 'center', w: '5%'  },
        { label: 'DESCRIPTION', align: 'left',   w: '60%' },
        { label: 'QTY',         align: 'center', w: '7%'  },
        { label: 'RATE (₹)',    align: 'right',  w: '14%' },
        { label: 'AMOUNT (₹)',  align: 'right',  w: '14%' },
      ]
    : [
        { label: 'SR',          align: 'center', w: '5%'  },
        { label: 'DESCRIPTION', align: 'left',   w: '49%' },
        { label: 'QTY',         align: 'center', w: '7%'  },
        { label: 'RATE (₹)',    align: 'right',  w: '15%' },
        { label: 'GST (₹)',     align: 'right',  w: '11%' },
        { label: 'AMOUNT (₹)',  align: 'right',  w: '13%' },
      ];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5px', marginBottom: '3mm' }}>
      <thead>
        <tr style={{ background: NAVY, color: WHITE }}>
          {cols.map(col => (
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
        {lines.map((l, i) => {
          const amount = isNew
            ? (l.line_subtotal ?? (l.qty || 0) * (l.unit_price || 0))
            : (l.line_total || 0);
          return (
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
              {!isNew && (
                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: GRAY }}>
                  {(l.line_gst || 0).toLocaleString('en-IN')}
                </td>
              )}
              <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                {amount.toLocaleString('en-IN')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
