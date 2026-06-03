import React from 'react';
import { Link } from 'react-router-dom';
import {
  Eye, Download, Edit2, Trash2, MessageCircle, Mail, ShoppingCart,
  GitBranch, Link2, History, Clock,
} from 'lucide-react';
import { getStatusColor } from '../../lib/utils';

const STATUS_BORDER = { draft:'#6b7280', sent:'#3b82f6', pending:'#f59e0b', confirmed:'#22c55e', cancelled:'#ef4444' };
const CATALOGUE_DOT = { not_sent:'#6b7280', ready:'#8b5cf6', sent:'#3b82f6', opened:'#f59e0b', submitted:'#22c55e' };

const fmtRound = (n) =>
  typeof n === 'number' ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';

const fmtDateTime = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso?.slice(0, 10) || ''; }
};

const initials = (name) =>
  (name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';

// ── Desktop table row ──────────────────────────────────────────────────────────
export function QuotationRow({
  quot, isSelected, onToggle, catalogueLabel,
  onWhatsApp, onEmail, onDelete, onHistory, onCopyLink, onCreateOrder,
  canDelete, quotApi,
}) {
  return (
    <tr className="group hover:bg-[var(--bg-hover)] transition-colors">
      <td className="px-4 py-3.5">
        <input type="checkbox" checked={isSelected} onChange={onToggle}
          className="w-4 h-4 rounded border-[var(--border-color)] accent-[#e94560] cursor-pointer" />
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Link to={`/view-quotation/${quot.quotation_id}`}
            className="font-mono text-sm font-bold text-[#e94560] hover:underline underline-offset-2">
            {quot.quote_number}
          </Link>
          {quot.version > 1 ? (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/25">
              <GitBranch className="h-2.5 w-2.5" />V{quot.version}
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]">V1</span>
          )}
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
          {quot.created_at ? new Date(quot.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
        </p>
      </td>
      <td className="px-4 py-3.5 max-w-[200px]">
        <p className="font-semibold text-[var(--text-primary)] truncate">{quot.school_name}</p>
        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
          {[quot.principal_name, quot.sales_person_name].filter(Boolean).join(' · ')}
        </p>
      </td>
      <td className="px-4 py-3.5">
        <span className="font-mono font-bold text-[var(--text-primary)] text-base">{fmtRound(quot.grand_total)}</span>
      </td>
      <td className="px-4 py-3.5">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${getStatusColor(quot.quotation_status)}`}>
          {quot.quotation_status}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CATALOGUE_DOT[catalogueLabel(quot)] || '#6b7280' }} />
            <span className="text-xs capitalize text-[var(--text-secondary)]">{catalogueLabel(quot).replace('_', ' ')}</span>
          </span>
          {quot.catalogue_token && ['sent','opened','ready'].includes(catalogueLabel(quot)) && (
            <button onClick={() => onCopyLink(quot.catalogue_token)} className="text-[var(--text-muted)] hover:text-blue-400 transition-colors" title="Copy catalogue link">
              <Link2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5">
        {quot.catalogue_sent_at ? (
          <div>
            <p className="text-xs font-medium text-[var(--text-secondary)] truncate max-w-[130px]">{quot.catalogue_sent_by_name || '—'}</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{fmtDateTime(quot.catalogue_sent_at)}</p>
          </div>
        ) : <span className="text-xs text-[var(--text-muted)]">—</span>}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-0.5">
          <Link to={`/view-quotation/${quot.quotation_id}`}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#e94560] hover:bg-[#e94560]/8 transition-colors" title="View">
            <Eye className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => quotApi.downloadPdf(quot.quotation_id)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors" title="Download PDF">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onHistory(quot.quotation_id)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-400/8 transition-colors" title="Edit history">
            <History className="h-3.5 w-3.5" />
          </button>
          <Link to={`/edit-quotation/${quot.quotation_id}`}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors" title="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => onWhatsApp(quot)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#25d366] hover:bg-[#25d366]/8 transition-colors" title="WhatsApp">
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onEmail(quot)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[#3b82f6] hover:bg-[#3b82f6]/8 transition-colors" title="Send Email">
            <Mail className="h-3.5 w-3.5" />
          </button>
          {quot.catalogue_status === 'submitted' && (
            <button onClick={() => onCreateOrder(quot.quotation_id)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-green-400 hover:bg-green-400/10 transition-colors" title="Create Order">
              <ShoppingCart className="h-3.5 w-3.5" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => onDelete(quot.quotation_id)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/8 transition-colors" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Mobile card ────────────────────────────────────────────────────────────────
export function QuotationMobileCard({
  quot, catalogueLabel, onWhatsApp, onEmail, onCreateOrder,
}) {
  const fmtDateTime = (iso) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso?.slice(0, 10) || ''; }
  };

  return (
    <div className="bg-[var(--bg-card)]"
      style={{ borderLeft: `3px solid ${STATUS_BORDER[quot.quotation_status] || '#6b7280'}` }}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-2">
        <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
          style={{ background: STATUS_BORDER[quot.quotation_status] || '#6b7280' }}>
          {initials(quot.school_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-[var(--text-primary)] leading-tight truncate">{quot.school_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Link to={`/view-quotation/${quot.quotation_id}`} className="font-mono text-xs text-[#e94560] font-semibold">{quot.quote_number}</Link>
                {quot.version > 1 && <span className="text-[9px] px-1 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6] font-bold border border-[#3b82f6]/25">V{quot.version}</span>}
                {quot.sales_person_name && <span className="text-[10px] text-[var(--text-muted)]">· {quot.sales_person_name}</span>}
              </div>
            </div>
            <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${getStatusColor(quot.quotation_status)}`}>
              {quot.quotation_status}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-color)]/50">
        <span className="font-mono text-xl font-bold text-[var(--text-primary)]">{fmtRound(quot.grand_total)}</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATALOGUE_DOT[quot.catalogue_status] || '#6b7280' }} />
          <span className="text-xs text-[var(--text-muted)] capitalize">{quot.catalogue_status?.replace('_', ' ')}</span>
        </div>
      </div>
      {quot.catalogue_sent_at && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-[var(--border-color)]/50">
          <Clock className="h-3 w-3 text-[var(--text-muted)] flex-shrink-0" />
          <span className="text-[11px] text-[var(--text-muted)] truncate">{fmtDateTime(quot.catalogue_sent_at)} · {quot.catalogue_sent_by_name || '—'}</span>
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3 pt-2 border-t border-[var(--border-color)]/50">
        <Link to={`/view-quotation/${quot.quotation_id}`}>
          <button className="w-full flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] active:opacity-70">
            <Eye className="h-3.5 w-3.5" /> View
          </button>
        </Link>
        <button onClick={() => onWhatsApp(quot)}
          className="flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[#25d366]/10 border border-[#25d366]/30 text-xs font-semibold text-[#25d366] active:opacity-70">
          <MessageCircle className="h-3.5 w-3.5" /> WA
        </button>
        <button onClick={() => onEmail(quot)}
          className="flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-xs font-semibold text-[#3b82f6] active:opacity-70">
          <Mail className="h-3.5 w-3.5" /> Email
        </button>
        <Link to={`/edit-quotation/${quot.quotation_id}`}>
          <button className="w-full flex items-center justify-center gap-1 py-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs font-semibold text-[var(--text-muted)] active:opacity-70">
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </button>
        </Link>
      </div>
      {quot.catalogue_status === 'submitted' && (
        <div className="px-3 pb-3">
          <button onClick={() => onCreateOrder(quot.quotation_id)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-sm font-semibold text-green-400 active:opacity-70">
            <ShoppingCart className="h-4 w-4" /> Convert to Order
          </button>
        </div>
      )}
    </div>
  );
}
