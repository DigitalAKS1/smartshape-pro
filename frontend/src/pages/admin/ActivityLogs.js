import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { activityLogs } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Activity, RefreshCw, Package, ShoppingCart, User, FileText, Truck } from 'lucide-react';

const ENTITY_ICONS = { order: ShoppingCart, die: Package, user: User, quotation: FileText, dispatch: Truck, contact: User };

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [limit, setLimit] = useState(100);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const fetchLogs = async () => {
    setLoading(true);
    try { const res = await activityLogs.getAll(entityFilter || undefined, limit); setLogs(res.data); }
    catch {}
    setLoading(false);
  };
  useEffect(() => { fetchLogs(); }, [entityFilter, limit]);

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="activity-logs-title">Activity Logs</h1>
            <p className={`${textSec} mt-1 text-sm`}>Audit trail of all system actions</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLogs} className={`border-[var(--border-color)] ${textSec}`}>
            <RefreshCw className="mr-1.5 h-3 w-3" /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {['', 'order', 'quotation', 'dispatch', 'contact', 'die', 'user'].map(et => (
            <button key={et} onClick={() => setEntityFilter(et)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${entityFilter === et ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textSec}`}`}
              data-testid={`filter-${et || 'all'}`}>
              {et ? et.charAt(0).toUpperCase() + et.slice(1) : 'All'}
            </button>
          ))}
        </div>

        <div className={`${card} border rounded-md overflow-hidden`} data-testid="activity-logs-table">
          {loading ? (
            <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" /></div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center"><Activity className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>No activity logs yet</p></div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {logs.map(log => {
                const Icon = ENTITY_ICONS[log.entity_type] || Activity;
                return (
                  <div key={log.log_id} className="flex items-start gap-3 p-4 hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#e94560]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-[#e94560]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${textPri}`}>
                        <span className="font-medium">{log.user_email}</span>{' '}
                        <span className={textSec}>{log.action}</span>{' '}
                        <span className={`${textPri} font-mono text-xs`}>{log.entity_type}/{log.entity_id}</span>
                      </p>
                      {log.details && <p className={`text-xs ${textMuted} mt-0.5`}>{log.details}</p>}
                    </div>
                    <span className={`text-[10px] ${textMuted} whitespace-nowrap flex-shrink-0`}>{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
