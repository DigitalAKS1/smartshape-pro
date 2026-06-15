import React, { useEffect, useState, useMemo } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { procurement, dies as diesApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import {
  PackageOpen, Plus, Trash2, FileDown, Undo2, ArrowLeft, Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const REASONS = [
  { id: 'demo',       label: 'Demo' },
  { id: 'exhibition', label: 'Exhibition' },
  { id: 'sampling',   label: 'Sampling' },
  { id: 'other',      label: 'Other' },
];

const STATUS_CLS = {
  open:               'text-orange-400 bg-orange-500/10 border-orange-500/30',
  partially_returned: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  closed:             'text-green-400 bg-green-500/10 border-green-500/30',
};

export default function ReturnableChallans() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Creating new challans stays admin/store; accounts may record returns.
  const canCreate = ['admin', 'store'].includes(user?.role);
  const canRecordReturn = ['admin', 'store', 'accounts'].includes(user?.role);
  const todayStr = new Date().toISOString().slice(0, 10);

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls    = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const [challans, setChallans] = useState([]);
  const [dies, setDies] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [dieFilter, setDieFilter] = useState('');
  const [addDieId, setAddDieId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [saving, setSaving] = useState(false);

  // Return dialog
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnQty, setReturnQty] = useState({});

  const load = async () => {
    try {
      const [c, d] = await Promise.all([
        procurement.challans.getAll({ type: 'returnable_out' }),
        diesApi.getAll(),
      ]);
      setChallans(c.data || []);
      setDies((d.data || []).filter(x => x.is_active !== false));
    } catch { toast.error('Failed to load challans'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({
      party_name: '', reason: 'demo',
      challan_date: new Date().toISOString().split('T')[0],
      expected_return_date: '', notes: '', lines: [],
    });
    setDieFilter(''); setAddDieId(''); setAddQty(1);
    setCreateOpen(true);
  };

  const availableDies = useMemo(() => {
    const onForm = new Set((form?.lines || []).map(l => l.die_id));
    return dies.filter(d => !onForm.has(d.die_id) &&
      (!dieFilter || `${d.name} ${d.code}`.toLowerCase().includes(dieFilter.toLowerCase())));
  }, [dies, form, dieFilter]);

  const addLine = () => {
    if (!addDieId) return;
    const d = dies.find(x => x.die_id === addDieId);
    if (!d) return;
    setForm(f => ({ ...f, lines: [...f.lines, {
      die_id: d.die_id, name: d.name, code: d.code, uom: 'pcs',
      qty: Math.max(1, parseInt(addQty, 10) || 1),
    }] }));
    setAddDieId(''); setAddQty(1); setDieFilter('');
  };

  const removeLine = (dieId) => setForm(f => ({ ...f, lines: f.lines.filter(l => l.die_id !== dieId) }));

  const submitCreate = async () => {
    if (!form.party_name.trim()) { toast.error('Enter who the items are going to'); return; }
    if (form.lines.length === 0) { toast.error('Add at least one die'); return; }
    setSaving(true);
    try {
      await procurement.challans.create({
        type: 'returnable_out', direction: 'outbound', party_type: 'customer',
        reason: form.reason, party_name: form.party_name,
        challan_date: form.challan_date, expected_return_date: form.expected_return_date || null,
        notes: form.notes,
        lines: form.lines.map(l => ({
          item_ref: { source: 'die', id: l.die_id },
          name: l.name, code: l.code, uom: l.uom, qty: l.qty,
        })),
      });
      toast.success('Returnable challan created — stock moved out');
      setCreateOpen(false);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create challan'); }
    finally { setSaving(false); }
  };

  const openReturn = (c) => {
    setReturnTarget(c);
    const init = {};
    (c.lines || []).forEach((l, i) => { init[i] = 0; });
    setReturnQty(init);
  };

  const submitReturn = async () => {
    const lines = Object.entries(returnQty)
      .map(([index, q]) => ({ index: parseInt(index, 10), returned_qty: parseFloat(q) || 0 }))
      .filter(l => l.returned_qty > 0);
    if (lines.length === 0) { toast.error('Enter at least one returned quantity'); return; }
    try {
      await procurement.challans.recordReturn(returnTarget.challan_id, lines);
      toast.success('Return recorded — stock restored');
      setReturnTarget(null);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to record return'); }
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate('/inventory')} className={`p-1.5 rounded-md hover:bg-[var(--bg-hover)] ${textSec}`} title="Back to Inventory">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="p-2 rounded-xl bg-[#e94560]/10 hidden sm:flex">
              <PackageOpen className="h-5 w-5 text-[#e94560]" />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Returnable Challans</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>Demo · Exhibition · Sampling — items that go out and come back</p>
            </div>
          </div>
          {canCreate && (
            <Button onClick={openCreate} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="new-challan-btn">
              <Plus className="mr-1.5 h-4 w-4" /> New Challan
            </Button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className={`${card} border rounded-md p-12 text-center ${textMuted}`}>Loading…</div>
        ) : challans.length === 0 ? (
          <div className={`${card} border rounded-md p-12 text-center`}>
            <PackageOpen className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
            <p className={textMuted}>No returnable challans yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {challans.map(c => {
              const totalOut = (c.lines || []).reduce((s, l) => s + (l.qty || 0), 0);
              const totalBack = (c.lines || []).reduce((s, l) => s + (l.returned_qty || 0), 0);
              const dueDate = c.expected_return_date;
              const isOutstanding = c.status !== 'closed';
              const overdue = isOutstanding && dueDate && dueDate < todayStr;
              const dueToday = isOutstanding && dueDate && dueDate === todayStr;
              return (
                <div key={c.challan_id} className={`${card} border rounded-md p-3 sm:p-4`} data-testid={`challan-${c.challan_no}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-[#e94560]">{c.challan_no}</span>
                        {c.reason && <span className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize bg-[var(--bg-primary)] ${textSec}`}>{c.reason}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${STATUS_CLS[c.status] || textMuted}`}>
                          {(c.status || '').replace('_', ' ')}
                        </span>
                        {overdue && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border text-red-400 bg-red-500/10 border-red-500/30">
                            Overdue return
                          </span>
                        )}
                        {dueToday && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border text-amber-400 bg-amber-500/10 border-amber-500/30">
                            Due back today
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${textPri} mt-1`}>{c.party_name || '—'}</p>
                      <p className={`text-xs ${textMuted}`}>
                        Out {c.challan_date}{c.expected_return_date ? ` · expected back ${c.expected_return_date}` : ''} · {totalBack}/{totalOut} returned
                      </p>
                      <p className={`text-xs ${textMuted} mt-1 truncate`}>
                        {(c.lines || []).map(l => `${l.code || l.name} ×${l.qty}`).join(', ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {canRecordReturn && c.status !== 'closed' && (
                        <Button size="sm" variant="outline" onClick={() => openReturn(c)}
                          className={`h-8 text-xs border-[var(--border-color)] ${textSec}`} data-testid={`return-${c.challan_no}`}>
                          <Undo2 className="mr-1 h-3 w-3" /> Record Return
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => procurement.challans.downloadPdf(c.challan_id, c.challan_no)}
                        className={`h-8 text-xs border-[var(--border-color)] ${textSec}`}>
                        <FileDown className="mr-1 h-3 w-3" /> PDF
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>New Returnable Challan</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs ${textSec}`}>Reason</label>
                  <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                    className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="challan-reason">
                    {REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-xs ${textSec}`}>Going to (party)</label>
                  <Input value={form.party_name} onChange={e => setForm({ ...form, party_name: e.target.value })}
                    className={inputCls} placeholder="School / venue / person" data-testid="challan-party" />
                </div>
                <div>
                  <label className={`text-xs ${textSec}`}>Challan date</label>
                  <Input type="date" value={form.challan_date} onChange={e => setForm({ ...form, challan_date: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={`text-xs ${textSec}`}>Expected return</label>
                  <Input type="date" value={form.expected_return_date} onChange={e => setForm({ ...form, expected_return_date: e.target.value })} className={inputCls} />
                </div>
              </div>

              {/* Lines */}
              <div className="border border-[var(--border-color)] rounded-md p-2 space-y-2">
                <label className={`text-xs font-medium ${textSec}`}>Dies going out</label>
                {form.lines.map(l => (
                  <div key={l.die_id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${textPri} truncate`}>{l.name}</p>
                      <p className={`text-[10px] font-mono ${textMuted}`}>{l.code}</p>
                    </div>
                    <span className={`font-mono text-sm ${textPri}`}>×{l.qty}</span>
                    <button onClick={() => removeLine(l.die_id)} className="text-red-400 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <div className="flex-1 flex gap-2">
                    <div className="relative flex-1">
                      <Search className={`absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
                      <input type="text" placeholder="Search dies…" value={dieFilter} onChange={e => setDieFilter(e.target.value)}
                        className={`w-full h-9 pl-7 pr-2 rounded-md text-sm ${inputCls}`} />
                    </div>
                  </div>
                  <select value={addDieId} onChange={e => setAddDieId(e.target.value)} className={`flex-1 h-9 px-2 rounded-md text-sm ${inputCls}`} data-testid="challan-add-die">
                    <option value="">Select die…</option>
                    {availableDies.slice(0, 100).map(d => (
                      <option key={d.die_id} value={d.die_id}>{d.code} — {d.name} (stock {d.stock_qty})</option>
                    ))}
                  </select>
                  <input type="number" min="1" value={addQty} onChange={e => setAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={`w-20 h-9 px-2 text-center rounded-md text-sm ${inputCls}`} />
                  <Button onClick={addLine} disabled={!addDieId} className="bg-[#e94560] hover:bg-[#f05c75] text-white h-9">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <label className={`text-xs ${textSec}`}>Notes</label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} placeholder="Optional" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitCreate} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="challan-save">
              {saving ? 'Saving…' : 'Create & Move Stock Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record return dialog */}
      <Dialog open={!!returnTarget} onOpenChange={(o) => !o && setReturnTarget(null)}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>Record Return — {returnTarget?.challan_no}</DialogTitle></DialogHeader>
          {returnTarget && (
            <div className="space-y-2 py-2">
              {(returnTarget.lines || []).map((l, i) => {
                const outstanding = (l.qty || 0) - (l.returned_qty || 0);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${textPri} truncate`}>{l.name}</p>
                      <p className={`text-[10px] font-mono ${textMuted}`}>{l.code} • {outstanding} still out</p>
                    </div>
                    <Input type="number" min="0" max={outstanding} value={returnQty[i] ?? 0}
                      onChange={e => setReturnQty(q => ({ ...q, [i]: Math.max(0, Math.min(outstanding, parseFloat(e.target.value) || 0)) }))}
                      className={`w-24 h-9 text-center font-mono ${inputCls}`} disabled={outstanding <= 0} />
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitReturn} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
              <Undo2 className="mr-1.5 h-4 w-4" /> Record Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
