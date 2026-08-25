import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, ChevronRight, Inbox, Download } from 'lucide-react';

const KIND_ICON = { lead: '🎯', event: '✉️', brochure: '📖', activity: '🔥' };

const csvCell = (v) => {
  const s = (v == null ? '' : String(v)).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
};

function exportCsv(title, rows) {
  const head = ['Name', 'Detail', 'Tag', 'When', 'school_id', 'lead_id'];
  const lines = [head.join(',')];
  rows.forEach(r => lines.push([r.primary, r.secondary, r.badge, r.at, r.school_id, r.lead_id].map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(title || 'report').replace(/[^\w]+/g, '-').toLowerCase()}.csv`;
  document.body.appendChild(a);   // Firefox/Safari ignore a.click() unless attached
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return 'today';
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// Slide-over that lists the records behind a clicked dashboard number. Every row
// deep-links to the school (or lead) — clickable reporting, fully linkable.
export default function DrillDownPanel({ open, title, rows, loading, onClose }) {
  const nav = useNavigate();
  if (!open) return null;

  // Land on the most relevant data: a touch/brochure/hot-signal opens the
  // school's Timeline; a lead opens the Leads tab (or the lead detail).
  const TAB_FOR = { lead: 'leads', event: 'feed', brochure: 'feed', activity: 'feed' };
  const go = (r) => {
    if (r.school_id) nav(`/school-profile/${r.school_id}?tab=${TAB_FOR[r.kind] || 'overview'}`);
    else if (r.lead_id) nav(`/leads?lead=${r.lead_id}`);
    else return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-[var(--bg-card)] border-l border-[var(--border-color)] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{title || 'Details'}</p>
            {!loading && <p className="text-[11px] text-[var(--text-muted)]">{rows.length} record{rows.length === 1 ? '' : 's'} · tap to open</p>}
          </div>
          <div className="flex items-center gap-1">
            {!loading && rows.length > 0 && (
              <button onClick={() => exportCsv(title, rows)} title="Download CSV"
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" data-testid="drill-export">
                <Download className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-7 w-7 animate-spin text-[#e94560]" /></div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <Inbox className="h-8 w-8 mx-auto mb-2 text-[var(--text-muted)]" strokeWidth={1.2} />
              <p className="text-sm italic text-[var(--text-muted)]">Nothing here for this slice.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r, i) => {
                const clickable = r.school_id || r.lead_id;
                return (
                  <button key={r.lead_id || r.school_id || i} onClick={() => clickable && go(r)}
                    disabled={!clickable}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border border-[var(--border-color)] ${clickable ? 'hover:bg-[var(--bg-hover)] active:scale-[0.99]' : 'opacity-70'} transition-all`}>
                    <span className="text-base flex-shrink-0">{KIND_ICON[r.kind] || '•'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.primary}</p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        {r.secondary}{r.secondary && r.at ? ' · ' : ''}{relTime(r.at)}
                      </p>
                    </div>
                    {r.badge && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] text-[var(--text-secondary)] flex-shrink-0 max-w-[100px] truncate" title={r.badge}>
                        {r.badge}
                      </span>
                    )}
                    {clickable && <ChevronRight className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
