import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, FilePlus2, X, History, Copy } from 'lucide-react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { quoteRequests } from '../../lib/api';

const STATUS_TABS = [
  { id: 'new', label: 'New' }, { id: 'quoted', label: 'Quoted' }, { id: 'closed', label: 'Closed' }, { id: '', label: 'All' },
];
const STATUS_CLS = {
  new: 'bg-[#e94560]/15 text-[#e94560]', quoted: 'bg-emerald-500/15 text-emerald-500', closed: 'bg-gray-500/15 text-gray-400',
};
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Team inbox for public "Request a Quotation" submissions. */
export default function QuotationRequests() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('new');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    quoteRequests.list(tab).then(r => setRows(Array.isArray(r.data) ? r.data : [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const close = async (r) => {
    try { await quoteRequests.update(r.request_id, { status: 'closed' }); toast.success('Closed'); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const publicLink = `${window.location.origin}/request-quote`;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="quote-requests-title">Quotation Requests</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Schools that asked for a quotation from the public form.</p>
          </div>
          <Button variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]"
            onClick={() => { navigator.clipboard?.writeText(publicLink); toast.success('Form link copied'); }}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy form link
          </Button>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-1 flex gap-1 overflow-x-auto no-scrollbar">
          {STATUS_TABS.map(t => (
            <button key={t.id || 'all'} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-4 py-2 rounded text-sm font-medium ${tab === t.id ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <p className="text-sm text-[var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md py-14 text-center">
            <Inbox className="h-10 w-10 mx-auto mb-2 text-[var(--text-muted)] opacity-40" />
            <p className="text-sm text-[var(--text-muted)]">No requests here. Share the form link with schools: <span className="font-mono">{publicLink}</span></p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(r => (
              <div key={r.request_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`qr-row-${r.request_id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">{r.school_name}</span>
                  {r.city && <span className="text-xs text-[var(--text-muted)]">{r.city}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_CLS[r.status] || ''}`}>{r.status}</span>
                  {r.bought_before && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-500 inline-flex items-center gap-1">
                      <History className="h-3 w-3" /> Bought before
                    </span>
                  )}
                  {r.school_id ? <span className="text-[10px] text-[var(--text-muted)]">· in CRM</span> : <span className="text-[10px] text-[var(--text-muted)]">· new school</span>}
                  <span className="ml-auto text-xs text-[var(--text-muted)]">{fmt(r.created_at)}</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  {r.name} · <a href={`mailto:${r.email}`} className="text-[#e94560]">{r.email}</a>{r.phone ? ` · ${r.phone}` : ''}
                  {r.principal_name ? ` · Principal: ${r.principal_name}` : ''}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{r.address}</p>
                {r.message && <p className="text-sm text-[var(--text-primary)] mt-2 italic">"{r.message}"</p>}
                {r.items?.length > 0 && (
                  <p className="text-xs text-[var(--text-secondary)] mt-2">
                    <b>Picked:</b> {r.items.map(i => `${i.die_code} ${i.name} ×${i.quantity}`).join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  {r.status !== 'quoted' && (
                    <Button size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8"
                      onClick={() => navigate(`/create-quotation?request_id=${r.request_id}${r.school_id ? `&school_id=${r.school_id}` : ''}`)}
                      data-testid={`qr-create-${r.request_id}`}>
                      <FilePlus2 className="h-3.5 w-3.5 mr-1" /> Create quotation
                    </Button>
                  )}
                  {r.status === 'quoted' && r.quotation_id && (
                    <Button size="sm" variant="outline" className="h-8 border-[var(--border-color)] text-[var(--text-secondary)]"
                      onClick={() => navigate(`/view-quotation/${r.quotation_id}`)}>
                      View {r.quote_number || 'quotation'}
                    </Button>
                  )}
                  {r.status === 'new' && (
                    <Button size="sm" variant="ghost" className="h-8 text-[var(--text-muted)]" onClick={() => close(r)}>
                      <X className="h-3.5 w-3.5 mr-1" /> Close
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
