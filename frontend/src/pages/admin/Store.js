import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, stock, alerts, procurement, holds as holdsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { formatDate } from '../../lib/utils';
import { Package, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Warehouse, PackageX, RefreshCw } from 'lucide-react';
import ShortfallDetailModal, { ProductThumb } from '../../components/inventory/ShortfallDetailModal';
import { signedQtyLabel, STOCK_INCREASE_TYPES } from '../../lib/stockMath';

// Store table sort options (item code is the natural default for a stock sheet).
const SORT_OPTIONS = [
  { id: 'code',      label: 'Item Code' },
  { id: 'name',      label: 'Name' },
  { id: 'available', label: 'Available (lowest first)' },
  { id: 'shortfall', label: 'Shortfall (highest first)' },
  { id: 'stock',     label: 'Stock (lowest first)' },
];

const firstImage = (d) => d.image_url
  || (Array.isArray(d.images) && d.images.length
    ? (typeof d.images[0] === 'string' ? d.images[0] : d.images[0]?.url)
    : null);

export default function Store() {
  const { user } = useAuth();
  const canRecompute = ['admin', 'accounts'].includes(user?.role);
  const [diesList, setDiesList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [alertsList, setAlertsList] = useState([]);
  const [demandMap, setDemandMap] = useState({});
  const [detailDie, setDetailDie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('code');
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [diesRes, movRes, alertsRes, demandRes] = await Promise.all([
        diesApi.getAll(),
        stock.getMovements(),
        alerts.getAll('pending'),
        procurement.demand(false).catch(() => ({ data: [] })),
      ]);
      setDiesList(diesRes.data);
      setMovements(movRes.data);
      setAlertsList(alertsRes.data);
      // die_id -> {required_qty, shortfall_qty} from open sales orders (same source as Procurement)
      const map = {};
      (demandRes.data || []).forEach(r => { map[r.die_id] = r; });
      setDemandMap(map);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const r = await holdsApi.recomputeReservations();
      const n = r.data?.dies_fixed ?? 0;
      toast.success(n > 0 ? `Reservations recomputed — ${n} item(s) corrected` : 'Reservations already accurate');
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  };

  const totalStock = diesList.reduce((s, d) => s + d.stock_qty, 0);
  const lowStock = diesList.filter(d => d.stock_qty < d.min_level);
  const totalReserved = diesList.reduce((s, d) => s + d.reserved_qty, 0);
  const shortItems = diesList.filter(d => (demandMap[d.die_id]?.shortfall_qty || 0) > 0);

  const sortedDies = [...diesList].sort((a, b) => {
    const avA = (a.stock_qty || 0) - (a.reserved_qty || 0);
    const avB = (b.stock_qty || 0) - (b.reserved_qty || 0);
    switch (sortBy) {
      case 'name':      return (a.name || '').localeCompare(b.name || '');
      case 'available': return avA - avB;                                   // most over-committed first
      case 'shortfall': return (demandMap[b.die_id]?.shortfall_qty || 0) - (demandMap[a.die_id]?.shortfall_qty || 0);
      case 'stock':     return (a.stock_qty || 0) - (b.stock_qty || 0);
      case 'code':
      default:          return (a.code || '').localeCompare(b.code || '', undefined, { numeric: true });
    }
  });

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="store-title">Store</h1>
            <p className="text-[var(--text-secondary)] mt-1">Warehouse overview — stock, movements, and alerts</p>
          </div>
          {canRecompute && (
            <button onClick={handleRecompute} disabled={recomputing}
              title="Rebuild reserved counts from live orders — fixes inflated 'short'/'available' numbers"
              data-testid="recompute-reservations-btn"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${recomputing ? 'animate-spin' : ''}`} />
              {recomputing ? 'Recomputing…' : 'Fix stock reservations'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="store-stats">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Package className="h-8 w-8 text-[#e94560]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Items</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{diesList.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Warehouse className="h-8 w-8 text-[#10b981]" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Stock</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{totalStock}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <ArrowUpCircle className="h-8 w-8 text-blue-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Reserved</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{totalReserved}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <AlertTriangle className="h-8 w-8 text-yellow-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Low Stock</span>
            </div>
            <div className="text-5xl font-mono font-bold text-[var(--text-primary)]">{lowStock.length}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-amber-500/30 rounded-md p-6">
            <div className="flex items-center justify-between mb-4">
              <PackageX className="h-8 w-8 text-amber-400" strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Short from SOs</span>
            </div>
            <div className="text-5xl font-mono font-bold text-amber-400">{shortItems.length}</div>
          </div>
        </div>

        {alertsList.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-md p-6">
            <h2 className="text-lg font-medium text-red-400 mb-3">Pending Purchase Alerts ({alertsList.length})</h2>
            <div className="space-y-2">
              {alertsList.slice(0, 5).map(a => (
                <div key={a.alert_id} className="flex items-center justify-between text-sm bg-[var(--bg-card)] rounded p-3">
                  <span className="text-[var(--text-primary)]">{a.die_name} ({a.die_code})</span>
                  <span className="text-red-400">Shortage: {a.shortage_qty} units</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Stock Overview</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)]">Sort by</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                data-testid="store-sort"
                className="h-8 px-2 rounded-md text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="store-stock-table">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="py-3 w-10"></th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Code</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Name</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Stock</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Reserved</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Available</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Required</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Shortfall</th>
                </tr>
              </thead>
              <tbody>
                {sortedDies.map((d) => {
                  const available = d.stock_qty - d.reserved_qty;
                  const isLow = d.stock_qty < d.min_level;
                  const dem = demandMap[d.die_id] || {};
                  const required = dem.required_qty || 0;
                  const shortfall = dem.shortfall_qty || 0;
                  return (
                    <tr key={d.die_id} className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] ${shortfall > 0 ? 'bg-amber-500/5' : isLow ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2"><ProductThumb url={firstImage(d)} size={32} /></td>
                      <td className="py-3 font-mono text-[var(--text-primary)]">{d.code}</td>
                      <td className="py-3 text-[var(--text-primary)]">{d.name}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-primary)]">{d.stock_qty}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-secondary)]">{d.reserved_qty}</td>
                      <td className={`py-3 text-right font-mono font-bold ${available < 0 ? 'text-red-400' : 'text-[var(--text-primary)]'}`}
                        title={available < 0 ? `Over-committed by ${Math.abs(available)}` : ''}>{available}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-secondary)]">{required || '—'}</td>
                      <td className="py-3 text-right">
                        {shortfall > 0 ? (
                          <button onClick={() => setDetailDie(d.die_id)} title="Click to see which schools need it"
                            className="font-mono font-bold text-amber-400 hover:text-amber-300 underline decoration-dotted underline-offset-2">
                            {shortfall}
                          </button>
                        ) : <span className="font-mono text-[var(--text-muted)]">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {movements.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Recent Movements</h2>
            <div className="space-y-2">
              {movements.slice(0, 10).map(m => (
                <div key={m.movement_id} className="flex items-center justify-between text-sm bg-[var(--bg-primary)] rounded p-3 border border-[var(--border-color)]">
                  <div className="flex items-center gap-3">
                    {STOCK_INCREASE_TYPES.includes(m.movement_type) ? (
                      <ArrowDownCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 text-red-400" />
                    )}
                    <span className="text-[var(--text-primary)]">{m.die_name}</span>
                    <span className="text-[var(--text-muted)]">{m.movement_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`font-mono font-bold ${STOCK_INCREASE_TYPES.includes(m.movement_type) ? 'text-green-400' : 'text-red-400'}`}>{signedQtyLabel(m.movement_type, m.quantity)}</span>
                    <span className="text-[var(--text-muted)] text-xs">{formatDate(m.movement_date)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <ShortfallDetailModal dieId={detailDie} open={!!detailDie} onClose={() => setDetailDie(null)} />
    </AdminLayout>
  );
}
