import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminAnalytics } from '../../lib/api';
import { toast } from 'sonner';
import { TrendingUp, Target, Package, Truck, UserCog, ArrowRight, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AdminControl() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  useEffect(() => {
    adminAnalytics.funnel()
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;
  if (!data) return <AdminLayout><div className="p-6 text-[var(--text-muted)]">No data</div></AdminLayout>;

  const { totals, lead_stages, order_stages, lead_to_order_ratio, order_to_dispatch_ratio, reassignment_leaderboard, recent_movements } = data;

  const Stat = ({ icon: Icon, label, value, color = 'text-[#e94560]' }) => (
    <div className={`${card} border rounded-md p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-xs uppercase tracking-wider ${textMuted}`}>{label}</p>
          <p className={`text-3xl font-semibold ${textPri} mt-1`}>{value}</p>
        </div>
        <Icon className={`h-8 w-8 ${color}`} />
      </div>
    </div>
  );

  const stageOrderLead = ['new', 'contacted', 'followup', 'online_demo', 'visit_plan', 'visit_done', 'quotation_sent', 'negotiation', 'won', 'lost'];
  const stageOrderProd = ['order_created', 'in_production', 'ready_to_dispatch', 'dispatched'];

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`}>Admin Control Panel</h1>
          <p className={`${textSec} mt-1 text-sm`}>Live sales funnel, movement tracking, and assignment insights.</p>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={Target} label="Leads" value={totals.leads} />
          <Stat icon={Package} label="Orders" value={totals.orders} color="text-blue-400" />
          <Stat icon={Truck} label="Dispatches" value={totals.dispatches} color="text-green-400" />
          <Stat icon={TrendingUp} label="L → O Ratio" value={`${(lead_to_order_ratio * 100).toFixed(1)}%`} color="text-purple-400" />
        </div>

        {/* Lead stage funnel */}
        <div className={`${card} border rounded-md p-5`}>
          <h2 className={`text-lg font-medium ${textPri} mb-4`}>Lead Funnel</h2>
          <div className="space-y-2">
            {stageOrderLead.map((s) => {
              const count = lead_stages[s] || 0;
              const max = Math.max(1, ...Object.values(lead_stages));
              const pct = (count / max) * 100;
              return (
                <div key={s} className="flex items-center gap-3">
                  <span className={`${textSec} text-xs capitalize w-32 truncate`}>{s.replace(/_/g, ' ')}</span>
                  <div className="flex-1 bg-[var(--bg-primary)] rounded h-6 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#e94560] to-[#f05c75] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`${textPri} font-mono text-sm w-10 text-right`}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order stage + conversion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${card} border rounded-md p-5`}>
            <h2 className={`text-lg font-medium ${textPri} mb-3`}>Order Production Pipeline</h2>
            <div className="space-y-2">
              {stageOrderProd.map((s) => (
                <div key={s} className="flex items-center justify-between">
                  <span className={`${textSec} text-sm capitalize`}>{s.replace(/_/g, ' ')}</span>
                  <span className={`${textPri} font-mono font-semibold`}>{order_stages[s] || 0}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`${card} border rounded-md p-5`}>
            <h2 className={`text-lg font-medium ${textPri} mb-3`}>Conversion Ratios</h2>
            <div className="space-y-3">
              <div>
                <div className={`flex justify-between text-sm ${textSec}`}><span>Lead → Order</span><span className={`font-mono ${textPri}`}>{(lead_to_order_ratio * 100).toFixed(1)}%</span></div>
                <div className="bg-[var(--bg-primary)] h-2 rounded mt-1"><div className="bg-[#e94560] h-2 rounded" style={{ width: `${Math.min(100, lead_to_order_ratio * 100)}%` }} /></div>
              </div>
              <div>
                <div className={`flex justify-between text-sm ${textSec}`}><span>Order → Dispatch</span><span className={`font-mono ${textPri}`}>{(order_to_dispatch_ratio * 100).toFixed(1)}%</span></div>
                <div className="bg-[var(--bg-primary)] h-2 rounded mt-1"><div className="bg-green-400 h-2 rounded" style={{ width: `${Math.min(100, order_to_dispatch_ratio * 100)}%` }} /></div>
              </div>
            </div>
          </div>
        </div>

        {/* Reassignment Leaderboard */}
        <div className={`${card} border rounded-md p-5`}>
          <h2 className={`text-lg font-medium ${textPri} mb-3 flex items-center gap-2`}><UserCog className="h-5 w-5 text-[#e94560]" /> Reassignment Leaderboard</h2>
          {reassignment_leaderboard.length === 0 ? (
            <p className={`text-xs ${textMuted} text-center py-6`}>No reassignments yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>Lead</th>
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>Current Agent</th>
                  <th className={`text-center text-xs uppercase py-2.5 px-3 ${textMuted}`}>Reassigned</th>
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>Last Reason</th>
                </tr></thead>
                <tbody>
                  {reassignment_leaderboard.map((l) => (
                    <tr key={l.lead_id} className="border-t border-[var(--border-color)]">
                      <td className={`py-2.5 px-3 ${textPri}`}>{l.company_name || l.contact_name}</td>
                      <td className={`py-2.5 px-3 ${textSec}`}>{l.assigned_name || '—'}</td>
                      <td className={`py-2.5 px-3 text-center`}><span className={`font-mono px-2 py-0.5 rounded text-xs ${l.reassignment_count > 2 ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{l.reassignment_count}×</span></td>
                      <td className={`py-2.5 px-3 ${textMuted} text-xs italic truncate max-w-xs`}>{l.last_reassignment_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Movement Tracker */}
        <div className={`${card} border rounded-md p-5`}>
          <h2 className={`text-lg font-medium ${textPri} mb-3 flex items-center gap-2`}><Activity className="h-5 w-5 text-[#e94560]" /> Recent Movement Tracker</h2>
          {recent_movements.length === 0 ? (
            <p className={`text-xs ${textMuted} text-center py-6`}>No movements yet</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {recent_movements.map((m) => (
                <div key={m.log_id} className={`flex items-center gap-3 text-sm border-b border-[var(--border-color)] pb-1.5 last:border-0`}>
                  <span className={`text-[10px] px-2 py-0.5 rounded bg-[#e94560]/10 text-[#e94560] whitespace-nowrap`}>{m.action.replace(/_/g, ' ')}</span>
                  <span className={`${textSec} flex-1 truncate`}>{m.details}</span>
                  <span className={`${textMuted} text-xs whitespace-nowrap`}>{m.user_email.split('@')[0]}</span>
                  <span className={`${textMuted} text-xs whitespace-nowrap`}>{new Date(m.timestamp).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => nav('/leads')} className="text-xs text-[#e94560] hover:underline inline-flex items-center gap-1">Open Leads <ArrowRight className="h-3 w-3" /></button>
          <button onClick={() => nav('/orders')} className="text-xs text-[#e94560] hover:underline inline-flex items-center gap-1">Open Orders <ArrowRight className="h-3 w-3" /></button>
        </div>
      </div>
    </AdminLayout>
  );
}
