import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { stock, dies, salesPersons } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Plus, TrendingUp, TrendingDown, Users, Package, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

const MOVEMENT_LABELS = { stock_in: 'Stock In', stock_out: 'Stock Out', allocated_to_sales: 'Allocated', returned_from_sales: 'Returned', physical_adjustment: 'Adjustment' };
const MOVEMENT_COLORS = { stock_in: 'text-green-500', stock_out: 'text-red-400', allocated_to_sales: 'text-blue-400', returned_from_sales: 'text-purple-400', physical_adjustment: 'text-yellow-500' };

export default function StockManagement() {
  const [movements, setMovements] = useState([]);
  const [diesList, setDiesList] = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('history');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedSp, setExpandedSp] = useState(null);
  const [movementForm, setMovementForm] = useState({ die_id: '', movement_type: 'stock_in', quantity: 1, sales_person_id: '', notes: '' });

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [movRes, diesRes, spRes] = await Promise.all([stock.getMovements(), dies.getAll(), salesPersons.getAll()]);
      setMovements(movRes.data);
      setDiesList(diesRes.data);
      setSalesPersonsList(spRes.data);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };

  const fetchHoldings = async () => {
    setHoldingsLoading(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/sales-person-stock`, { credentials: 'include' });
      const data = await res.json();
      setHoldings(Array.isArray(data) ? data : []);
    } catch { toast.error('Failed to load holdings'); }
    finally { setHoldingsLoading(false); }
  };

  useEffect(() => { if (activeTab === 'holdings') fetchHoldings(); }, [activeTab]); // eslint-disable-line

  const handleCreateMovement = async (e) => {
    e.preventDefault();
    if (!movementForm.die_id) { toast.error('Select a die'); return; }
    if (movementForm.movement_type === 'allocated_to_sales' && !movementForm.sales_person_id) { toast.error('Select a sales person'); return; }
    try {
      await stock.createMovement({ ...movementForm, quantity: Number(movementForm.quantity) });
      toast.success('Stock movement recorded');
      setDialogOpen(false);
      setMovementForm({ die_id: '', movement_type: 'stock_in', quantity: 1, sales_person_id: '', notes: '' });
      fetchData();
      if (activeTab === 'holdings') fetchHoldings();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to record movement'); }
  };

  const stats = {
    total: movements.length,
    stockIn: movements.filter(m => m.movement_type === 'stock_in').length,
    stockOut: movements.filter(m => m.movement_type === 'stock_out').length,
    allocated: movements.filter(m => m.movement_type === 'allocated_to_sales').length,
  };

  const totalHeld = holdings.reduce((s, h) => s + (h.total_units || 0), 0);

  return (
    <AdminLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="stock-management-title">Stock Management</h1>
            <p className={`${textSec} mt-1 text-sm`}>Track movements, allocations and field team holdings</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-movement-button">
            <Plus className="mr-2 h-4 w-4" /> Record Movement
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Movements', value: stats.total, cls: textPri },
            { label: 'Stock In', value: stats.stockIn, cls: 'text-green-500' },
            { label: 'Stock Out', value: stats.stockOut, cls: 'text-red-400' },
            { label: 'Allocated to Field', value: stats.allocated, cls: 'text-blue-400' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-xl p-4`}>
              <p className={`text-2xl font-bold font-mono ${s.cls}`}>{s.value}</p>
              <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className={`flex ${card} border rounded-md p-1 gap-1`}>
          {[['history','Movement History'], ['holdings','Sales Team Holdings']].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${activeTab === id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Movement History ── */}
        {activeTab === 'history' && (
          <div className={`${card} border rounded-md overflow-hidden`} data-testid="movement-history">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>
            ) : movements.length === 0 ? (
              <div className="p-16 text-center"><TrendingUp className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No movements recorded yet</p></div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm" data-testid="movements-table">
                    <thead><tr className="bg-[var(--bg-primary)]">
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Die</th>
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Movement</th>
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Qty</th>
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Sales Person</th>
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Date</th>
                      <th className={`text-left text-xs uppercase py-3 px-4 ${textMuted}`}>Notes</th>
                    </tr></thead>
                    <tbody>
                      {movements.map(m => (
                        <tr key={m.movement_id} className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]`} data-testid={`movement-row-${m.movement_id}`}>
                          <td className="px-4 py-3">
                            <p className="font-mono text-[#e94560] text-xs font-medium">{m.die_code}</p>
                            <p className={`text-xs ${textMuted}`}>{m.die_name}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium ${MOVEMENT_COLORS[m.movement_type] || textSec}`}>{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</span>
                          </td>
                          <td className={`px-4 py-3 font-mono font-bold ${textPri}`}>{m.quantity}</td>
                          <td className={`px-4 py-3 text-sm ${textSec}`}>{m.sales_person_name || '—'}</td>
                          <td className={`px-4 py-3 text-sm ${textMuted}`}>{formatDate(m.movement_date)}</td>
                          <td className={`px-4 py-3 text-xs ${textMuted} max-w-[200px] truncate`}>{m.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-[var(--border-color)]">
                  {movements.map(m => (
                    <div key={m.movement_id} className="p-3 flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.movement_type === 'stock_in' || m.movement_type === 'returned_from_sales' ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                        {m.movement_type === 'stock_in' || m.movement_type === 'returned_from_sales'
                          ? <TrendingUp className="h-4 w-4 text-green-500" />
                          : <TrendingDown className="h-4 w-4 text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textPri}`}>{m.die_code} — {m.die_name}</p>
                        <p className={`text-xs ${MOVEMENT_COLORS[m.movement_type] || textSec}`}>{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</p>
                        {m.notes && <p className={`text-xs ${textMuted} truncate`}>{m.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className={`font-mono font-bold ${textPri}`}>{m.quantity}</p>
                        <p className={`text-[10px] ${textMuted}`}>{formatDate(m.movement_date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Sales Team Holdings ── */}
        {activeTab === 'holdings' && (
          <div className="space-y-3" data-testid="sales-holdings">
            {holdingsLoading ? (
              <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>
            ) : holdings.length === 0 ? (
              <div className={`${card} border rounded-md p-16 text-center`}>
                <Users className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
                <p className={textMuted}>No dies allocated to field team yet</p>
                <p className={`text-xs ${textMuted} mt-1`}>Record an "Allocate to Sales Person" movement to track field holdings</p>
              </div>
            ) : (
              <>
                <div className={`${card} border rounded-xl p-4 flex items-center gap-4`}>
                  <Package className="h-8 w-8 text-blue-400" />
                  <div>
                    <p className={`text-2xl font-bold font-mono text-blue-400`}>{totalHeld}</p>
                    <p className={`text-xs ${textMuted}`}>Total units with field team across {holdings.length} members</p>
                  </div>
                </div>
                {holdings.map(sp => (
                  <div key={sp.sales_person_id} className={`${card} border rounded-md overflow-hidden`}>
                    <button onClick={() => setExpandedSp(expandedSp === sp.sales_person_id ? null : sp.sales_person_id)}
                      className={`w-full flex items-center justify-between p-4 hover:bg-[var(--bg-hover)] transition-colors`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#e94560]/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-[#e94560]">{sp.sales_person_name?.charAt(0)}</span>
                        </div>
                        <div className="text-left">
                          <p className={`font-semibold text-sm ${textPri}`}>{sp.sales_person_name}</p>
                          <p className={`text-xs ${textMuted}`}>{sp.holdings?.length || 0} die types · {sp.total_units} units total</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-mono font-bold text-blue-400 text-lg`}>{sp.total_units}</span>
                        {expandedSp === sp.sales_person_id ? <ChevronUp className={`h-4 w-4 ${textMuted}`} /> : <ChevronDown className={`h-4 w-4 ${textMuted}`} />}
                      </div>
                    </button>
                    {expandedSp === sp.sales_person_id && sp.holdings?.length > 0 && (
                      <div className="border-t border-[var(--border-color)]">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-[var(--bg-primary)]">
                            <th className={`text-left text-xs uppercase py-2 px-4 ${textMuted}`}>Die Code</th>
                            <th className={`text-left text-xs uppercase py-2 px-4 ${textMuted}`}>Name</th>
                            <th className={`text-right text-xs uppercase py-2 px-4 ${textMuted}`}>Allocated</th>
                            <th className={`text-right text-xs uppercase py-2 px-4 ${textMuted}`}>Holding</th>
                          </tr></thead>
                          <tbody>
                            {sp.holdings.map(h => (
                              <tr key={`${sp.sales_person_id}-${h.die_id}`} className="border-t border-[var(--border-color)]">
                                <td className="px-4 py-2.5 font-mono text-[#e94560] text-xs">{h.die_code}</td>
                                <td className={`px-4 py-2.5 text-sm ${textPri}`}>{h.die_name}</td>
                                <td className={`px-4 py-2.5 text-right font-mono ${textSec}`}>{h.allocated_qty || 0}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <span className={`font-mono font-bold ${(h.current_holding || 0) > 0 ? 'text-blue-400' : textMuted}`}>{h.current_holding || 0}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sp.holdings.some(h => (h.current_holding || 0) === 0) && (
                          <p className={`text-xs ${textMuted} px-4 py-2 flex items-center gap-1`}><AlertTriangle className="h-3 w-3" /> Some dies fully returned</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Record Movement Dialog ── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md`}>
            <DialogHeader><DialogTitle className={textPri}>Record Stock Movement</DialogTitle></DialogHeader>
            <form onSubmit={handleCreateMovement} className="space-y-3 py-1">
              <div>
                <Label className={`${textSec} text-xs`}>Die *</Label>
                <select value={movementForm.die_id} onChange={e => setMovementForm({...movementForm, die_id: e.target.value})} required className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="">Select die…</option>
                  {diesList.map(d => <option key={d.die_id} value={d.die_id}>{d.code} — {d.name} (stock: {d.stock_qty})</option>)}
                </select>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Movement Type *</Label>
                <select value={movementForm.movement_type} onChange={e => setMovementForm({...movementForm, movement_type: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                  <option value="stock_in">Stock In (Received from supplier)</option>
                  <option value="stock_out">Stock Out (Consumed / sold)</option>
                  <option value="allocated_to_sales">Allocate to Sales Person</option>
                  <option value="returned_from_sales">Returned from Sales Person</option>
                </select>
              </div>
              {movementForm.movement_type === 'allocated_to_sales' && (
                <div>
                  <Label className={`${textSec} text-xs`}>Sales Person *</Label>
                  <select value={movementForm.sales_person_id} onChange={e => setMovementForm({...movementForm, sales_person_id: e.target.value})} required className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                    <option value="">Select sales person…</option>
                    {salesPersonsList.map(sp => <option key={sp.sales_person_id} value={sp.sales_person_id}>{sp.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label className={`${textSec} text-xs`}>Quantity *</Label>
                <Input type="number" min={1} value={movementForm.quantity} onChange={e => setMovementForm({...movementForm, quantity: e.target.value})} required className={inputCls} />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Notes</Label>
                <Input value={movementForm.notes} onChange={e => setMovementForm({...movementForm, notes: e.target.value})} className={inputCls} placeholder="PO number, reason, reference…" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                <Button type="submit" className="bg-[#e94560] hover:bg-[#f05c75] text-white">Record Movement</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </AdminLayout>
  );
}
