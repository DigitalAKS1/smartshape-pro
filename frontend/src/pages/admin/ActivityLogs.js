import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Activity, RefreshCw, Package, ShoppingCart, User, FileText, Truck,
  Target, Search, X, ChevronDown, Calendar
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import API from '../../lib/api';

const ENTITY_ICONS = {
  order: ShoppingCart, die: Package, user: User, quotation: FileText,
  dispatch: Truck, contact: User, lead: Target, school: Activity,
};

const ACTION_COLOR = (action = '') => {
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('add') || a.includes('convert') || a.includes('check_in')) return 'text-green-400 bg-green-500/10';
  if (a.includes('update') || a.includes('edit') || a.includes('reassign') || a.includes('assign') || a.includes('stage')) return 'text-yellow-400 bg-yellow-500/10';
  if (a.includes('delete') || a.includes('remove') || a.includes('check_out')) return 'text-red-400 bg-red-500/10';
  return 'text-blue-400 bg-blue-500/10';
};

const relativeTime = (iso) => {
  if (!iso) return '';
  const diff = Math.floor((new Date() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

const PAGE_SIZE = 50;

export default function ActivityLogs() {
  const { isDark } = useTheme();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [entityFilter, setEntityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const fetchLogs = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      setOffset(0);
    } else {
      setLoadingMore(true);
    }
    try {
      const params = { limit: PAGE_SIZE, offset: reset ? 0 : offset };
      if (entityFilter) params.entity_type = entityFilter;
      if (search) params.search = search;
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const res = await API.get('/activity-logs', { params });
      const data = res.data;
      if (reset) {
        setLogs(data.logs || data);
        setTotal(data.total || (data.logs || data).length);
      } else {
        setLogs(prev => [...prev, ...(data.logs || data)]);
        setOffset(prev => prev + PAGE_SIZE);
      }
    } catch {}
    setLoading(false);
    setLoadingMore(false);
  }, [entityFilter, search, fromDate, toDate, offset]);

  useEffect(() => { fetchLogs(true); }, [entityFilter, search, fromDate, toDate]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };
  const clearSearch = () => { setSearch(''); setSearchInput(''); };
  const clearDates = () => { setFromDate(''); setToDate(''); };

  const hasActiveFilter = entityFilter || search || fromDate || toDate;

  // Group logs by date
  const grouped = [];
  let lastDate = null;
  logs.forEach(log => {
    const d = log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown';
    if (d !== lastDate) { grouped.push({ type: 'date', label: d }); lastDate = d; }
    grouped.push({ type: 'log', data: log });
  });

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Activity Logs</h1>
            <p className={`${textSec} mt-0.5 text-sm`}>
              {total > 0 ? `${total.toLocaleString()} total entries` : 'Audit trail of all system actions'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(s => !s)}
              className={`border-[var(--border-color)] ${textSec} ${hasActiveFilter ? 'border-[#e94560] text-[#e94560]' : ''}`}>
              <Calendar className="mr-1.5 h-3.5 w-3.5" />
              Filters {hasActiveFilter && '•'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchLogs(true)} className={`border-[var(--border-color)] ${textSec}`}>
              <RefreshCw className="mr-1.5 h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by user, action, entity ID..."
              className={`pl-9 pr-9 ${inputCls}`}
            />
            {searchInput && (
              <button type="button" onClick={clearSearch} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textMuted}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button type="submit" size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">Search</Button>
        </form>

        {/* Expanded filters */}
        {showFilters && (
          <div className={`${card} border rounded-md p-3 space-y-3`}>
            <p className={`text-xs font-semibold uppercase ${textMuted}`}>Date Range</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className={`text-xs ${textSec}`}>From</label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={`${inputCls} h-8 text-sm w-36`} />
              </div>
              <div className="flex items-center gap-2">
                <label className={`text-xs ${textSec}`}>To</label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={`${inputCls} h-8 text-sm w-36`} />
              </div>
              {(fromDate || toDate) && (
                <Button variant="ghost" size="sm" onClick={clearDates} className={`text-xs ${textMuted} h-8`}>
                  <X className="h-3 w-3 mr-1" /> Clear dates
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Entity type filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {['', 'order', 'lead', 'contact', 'quotation', 'dispatch', 'die', 'school', 'user'].map(et => (
            <button key={et} onClick={() => setEntityFilter(et)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${entityFilter === et ? 'bg-[#e94560] text-white border-[#e94560]' : `${card} border ${textSec}`}`}>
              {et ? et.charAt(0).toUpperCase() + et.slice(1) : 'All'}
            </button>
          ))}
        </div>

        {/* Log list */}
        <div className={`${card} border rounded-md overflow-hidden`}>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <Activity className={`h-10 w-10 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
              <p className={textMuted}>No activity logs found</p>
              {hasActiveFilter && (
                <button onClick={() => { setEntityFilter(''); clearSearch(); clearDates(); }} className="mt-2 text-xs text-[#e94560] underline">
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div>
              {grouped.map((item, idx) => {
                if (item.type === 'date') {
                  return (
                    <div key={`date-${idx}`} className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider ${textMuted} bg-[var(--bg-primary)] border-b border-[var(--border-color)] sticky top-0`}>
                      {item.label}
                    </div>
                  );
                }
                const log = item.data;
                const Icon = ENTITY_ICONS[log.entity_type] || Activity;
                const actionCls = ACTION_COLOR(log.action);
                return (
                  <div key={log.log_id} className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors last:border-0`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${actionCls}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className={`text-sm font-semibold ${textPri}`}>{log.user_email?.split('@')[0]}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${actionCls}`}>{log.action?.replace(/_/g, ' ')}</span>
                        <span className={`text-[11px] font-mono ${textMuted}`}>{log.entity_type}/{log.entity_id?.slice(0, 16)}</span>
                      </div>
                      {log.details && <p className={`text-xs ${textMuted} truncate`}>{log.details}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className={`text-[10px] font-medium ${textSec}`}>{relativeTime(log.timestamp)}</span>
                      <span className={`text-[10px] ${textMuted}`}>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                  </div>
                );
              })}

              {/* Load more */}
              {logs.length < total && (
                <div className="p-4 text-center border-t border-[var(--border-color)]">
                  <Button variant="outline" size="sm" onClick={() => fetchLogs(false)} disabled={loadingMore}
                    className={`border-[var(--border-color)] ${textSec}`}>
                    {loadingMore
                      ? <><RefreshCw className="mr-1.5 h-3 w-3 animate-spin" /> Loading...</>
                      : <><ChevronDown className="mr-1.5 h-3 w-3" /> Load more ({total - logs.length} remaining)</>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
