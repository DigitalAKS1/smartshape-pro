import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { dies as diesApi, stock, alerts } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { Package, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Warehouse } from 'lucide-react';

export default function Store() {
  const [diesList, setDiesList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [alertsList, setAlertsList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [diesRes, movRes, alertsRes] = await Promise.all([
          diesApi.getAll(),
          stock.getMovements(),
          alerts.getAll('pending'),
        ]);
        setDiesList(diesRes.data);
        setMovements(movRes.data);
        setAlertsList(alertsRes.data);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const totalStock = diesList.reduce((s, d) => s + d.stock_qty, 0);
  const lowStock = diesList.filter(d => d.stock_qty < d.min_level);
  const totalReserved = diesList.reduce((s, d) => s + d.reserved_qty, 0);

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
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="store-title">Store</h1>
          <p className="text-[var(--text-secondary)] mt-1">Warehouse overview — stock, movements, and alerts</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="store-stats">
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
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Stock Overview</h2>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="store-stock-table">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Code</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Name</th>
                  <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Type</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Stock</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Reserved</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Available</th>
                  <th className="text-right text-xs uppercase tracking-wide text-[var(--text-secondary)] py-3">Min Level</th>
                </tr>
              </thead>
              <tbody>
                {diesList.map((d) => {
                  const available = d.stock_qty - d.reserved_qty;
                  const isLow = d.stock_qty < d.min_level;
                  return (
                    <tr key={d.die_id} className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] ${isLow ? 'bg-red-500/5' : ''}`}>
                      <td className="py-3 font-mono text-[var(--text-primary)]">{d.code}</td>
                      <td className="py-3 text-[var(--text-primary)]">{d.name}</td>
                      <td className="py-3 text-[var(--text-secondary)] capitalize">{d.type}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-primary)]">{d.stock_qty}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-secondary)]">{d.reserved_qty}</td>
                      <td className={`py-3 text-right font-mono font-bold ${available < 0 ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{available}</td>
                      <td className="py-3 text-right font-mono text-[var(--text-muted)]">{d.min_level}</td>
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
                    {m.movement_type === 'stock_in' ? (
                      <ArrowDownCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 text-red-400" />
                    )}
                    <span className="text-[var(--text-primary)]">{m.die_name}</span>
                    <span className="text-[var(--text-muted)]">{m.movement_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[var(--text-primary)]">{m.quantity} units</span>
                    <span className="text-[var(--text-muted)] text-xs">{formatDate(m.movement_date)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
