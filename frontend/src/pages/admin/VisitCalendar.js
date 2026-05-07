import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { visitPlans, salesPersons as spApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Calendar, MapPin, Clock,
  User, CheckCircle, AlertTriangle, RefreshCw, Users,
} from 'lucide-react';
import { formatDate } from '../../lib/utils';

// Palette of colors for up to 10 salespersons
const SP_COLORS = [
  { bg: 'bg-[#3b82f6]/15', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/30' },
  { bg: 'bg-[#10b981]/15', text: 'text-[#10b981]', border: 'border-[#10b981]/30' },
  { bg: 'bg-[#f59e0b]/15', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/30' },
  { bg: 'bg-[#8b5cf6]/15', text: 'text-[#8b5cf6]', border: 'border-[#8b5cf6]/30' },
  { bg: 'bg-[#e94560]/15', text: 'text-[#e94560]', border: 'border-[#e94560]/30' },
  { bg: 'bg-[#ec4899]/15', text: 'text-[#ec4899]', border: 'border-[#ec4899]/30' },
  { bg: 'bg-[#14b8a6]/15', text: 'text-[#14b8a6]', border: 'border-[#14b8a6]/30' },
  { bg: 'bg-[#f97316]/15', text: 'text-[#f97316]', border: 'border-[#f97316]/30' },
  { bg: 'bg-[#6366f1]/15', text: 'text-[#6366f1]', border: 'border-[#6366f1]/30' },
  { bg: 'bg-[#84cc16]/15', text: 'text-[#84cc16]', border: 'border-[#84cc16]/30' },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getWeekDates(anchor) {
  const d = new Date(anchor);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function getStatusStyle(status) {
  if (status === 'visited') return 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20';
  if (status === 'cancelled') return 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20';
  if (status === 'rescheduled') return 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20';
  return 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20'; // planned
}

export default function VisitCalendar() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [spList, setSpList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(new Date());
  const [viewMode, setViewMode] = useState('week'); // week | month
  const [selectedSP, setSelectedSP] = useState('all');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Map salesperson email → color index
  const [spColorMap, setSpColorMap] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, spr] = await Promise.all([visitPlans.getAll(), spApi.getAll()]);
      const allPlans = pr.data || [];
      const allSP = spr.data || [];
      setPlans(allPlans);
      setSpList(allSP);
      // Assign colors to salespersons
      const colorMap = {};
      allSP.forEach((sp, i) => { colorMap[sp.email || sp.name] = i % SP_COLORS.length; });
      setSpColorMap(colorMap);
    } catch { toast.error('Failed to load visit plans'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const weekDates = getWeekDates(anchor);

  const filteredPlans = plans.filter(p => {
    if (selectedSP !== 'all' && p.assigned_to !== selectedSP && p.sales_person_email !== selectedSP) return false;
    return true;
  });

  const getPlansForDate = (dateStr) =>
    filteredPlans.filter(p => p.visit_date === dateStr || p.visit_date?.startsWith(dateStr));

  const spColor = (plan) => {
    const key = plan.assigned_to || plan.sales_person_email || '';
    const idx = spColorMap[key] ?? 0;
    return SP_COLORS[idx];
  };

  const prevWeek = () => { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d); };
  const nextWeek = () => { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d); };
  const goToday = () => setAnchor(new Date());

  const openDetail = (plan) => { setSelectedPlan(plan); setDetailOpen(true); };

  // Stats
  const stats = {
    total: filteredPlans.length,
    visited: filteredPlans.filter(p => p.status === 'visited').length,
    planned: filteredPlans.filter(p => p.status === 'planned').length,
    overdue: filteredPlans.filter(p => {
      if (p.status !== 'planned') return false;
      return p.visit_date < toDateStr(new Date());
    }).length,
  };

  const weekLabel = (() => {
    const first = weekDates[0];
    const last = weekDates[6];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
    }
    return `${first.getDate()} ${MONTH_NAMES[first.getMonth()]} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  })();

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">Visit Calendar</h1>
            <p className="text-[var(--text-secondary)] mt-1">Weekly view of all planned field visits</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="border-[var(--border-color)] text-[var(--text-secondary)]">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday} className="border-[var(--border-color)] text-[var(--text-secondary)]">Today</Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Visits', value: stats.total, color: 'text-[var(--text-primary)]' },
            { label: 'Completed', value: stats.visited, color: 'text-[#10b981]' },
            { label: 'Planned', value: stats.planned, color: 'text-[#3b82f6]' },
            { label: 'Overdue', value: stats.overdue, color: 'text-[#ef4444]' },
          ].map(s => (
            <div key={s.label} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
              <div className={`text-3xl font-mono font-bold ${s.color}`}>{s.value}</div>
              <p className="text-xs text-[var(--text-secondary)] mt-1 uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Controls row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4">
          {/* Week navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={prevWeek} className="border-[var(--border-color)] text-[var(--text-secondary)] h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium text-[var(--text-primary)] text-sm min-w-[220px] text-center">{weekLabel}</span>
            <Button variant="outline" size="sm" onClick={nextWeek} className="border-[var(--border-color)] text-[var(--text-secondary)] h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Salesperson filter */}
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--text-muted)]" />
            <select
              value={selectedSP}
              onChange={e => setSelectedSP(e.target.value)}
              className="h-8 px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md"
            >
              <option value="all">All Salespersons</option>
              {spList.map(sp => (
                <option key={sp.email || sp.name} value={sp.email || sp.name}>{sp.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Salesperson color legend */}
        {selectedSP === 'all' && spList.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {spList.slice(0, 10).map((sp, i) => {
              const c = SP_COLORS[i % SP_COLORS.length];
              return (
                <button
                  key={sp.email || sp.name}
                  onClick={() => setSelectedSP(sp.email || sp.name)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${c.bg} ${c.text} ${c.border} hover:opacity-80`}
                >
                  <User className="h-3 w-3" />{sp.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Week Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date, i) => {
              const dateStr = toDateStr(date);
              const dayPlans = getPlansForDate(dateStr);
              const isToday = dateStr === toDateStr(new Date());
              const isPast = date < new Date() && !isToday;
              return (
                <div
                  key={dateStr}
                  className={`bg-[var(--bg-card)] border rounded-md min-h-[180px] flex flex-col ${isToday ? 'border-[#e94560]' : 'border-[var(--border-color)]'}`}
                >
                  {/* Day header */}
                  <div className={`px-2 py-2 border-b border-[var(--border-color)] ${isToday ? 'bg-[#e94560]/10' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium uppercase tracking-wide ${isPast ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>
                        {DAY_LABELS[(i + 1) % 7]}
                      </span>
                      {dayPlans.length > 0 && (
                        <span className="text-[10px] font-bold text-[var(--text-muted)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded-full">{dayPlans.length}</span>
                      )}
                    </div>
                    <div className={`text-lg font-bold mt-0.5 ${isToday ? 'text-[#e94560]' : isPast ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                      {date.getDate()}
                    </div>
                  </div>

                  {/* Visit cards */}
                  <div className="p-1.5 flex-1 space-y-1 overflow-y-auto max-h-[280px]">
                    {dayPlans.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <span className="text-[10px] text-[var(--text-muted)]">—</span>
                      </div>
                    ) : (
                      dayPlans.map(plan => {
                        const c = spColor(plan);
                        return (
                          <button
                            key={plan.plan_id}
                            onClick={() => openDetail(plan)}
                            className={`w-full text-left p-1.5 rounded border text-[10px] leading-tight ${c.bg} ${c.text} ${c.border} hover:opacity-80 transition`}
                          >
                            <div className="font-semibold truncate">{plan.school_name}</div>
                            {plan.visit_time && (
                              <div className="flex items-center gap-0.5 mt-0.5 opacity-75">
                                <Clock className="h-2.5 w-2.5" />{plan.visit_time}
                              </div>
                            )}
                            <div className={`mt-0.5 inline-block px-1 py-0.5 rounded-sm text-[9px] font-medium border ${getStatusStyle(plan.status)}`}>
                              {plan.status}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List view below calendar — overdue visits */}
        {stats.overdue > 0 && (
          <div className="bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
              <span className="text-sm font-semibold text-[#ef4444]">{stats.overdue} Overdue Visit{stats.overdue !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {filteredPlans
                .filter(p => p.status === 'planned' && p.visit_date < toDateStr(new Date()))
                .slice(0, 5)
                .map(plan => {
                  const c = spColor(plan);
                  return (
                    <button
                      key={plan.plan_id}
                      onClick={() => openDetail(plan)}
                      className="w-full text-left flex items-center justify-between bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md px-4 py-3 hover:bg-[var(--bg-hover)] transition"
                    >
                      <div>
                        <p className="font-medium text-[var(--text-primary)] text-sm">{plan.school_name}</p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          Planned: {formatDate(plan.visit_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>{plan.assigned_name || plan.assigned_to}</span>
                        <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)] flex items-center gap-2">
              <Calendar className="h-5 w-5 text-[#e94560]" /> Visit Details
            </DialogTitle>
          </DialogHeader>
          {selectedPlan && (
            <div className="space-y-3 text-sm">
              <div className="bg-[var(--bg-primary)] rounded-md p-3 space-y-2">
                <p className="font-semibold text-[var(--text-primary)] text-base">{selectedPlan.school_name}</p>
                {selectedPlan.contact_person && (
                  <p className="text-[var(--text-secondary)] flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />{selectedPlan.contact_person}
                    {selectedPlan.contact_phone && <span className="text-[var(--text-muted)]">· {selectedPlan.contact_phone}</span>}
                  </p>
                )}
                <p className="text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />{formatDate(selectedPlan.visit_date)}
                  {selectedPlan.visit_time && <span>at {selectedPlan.visit_time}</span>}
                </p>
                {selectedPlan.planned_address && (
                  <p className="text-[var(--text-secondary)] flex items-start gap-1.5">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />{selectedPlan.planned_address}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] text-xs">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${getStatusStyle(selectedPlan.status)}`}>
                  {selectedPlan.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] text-xs">Assigned to</span>
                <span className="text-[var(--text-primary)] text-xs font-medium">{selectedPlan.assigned_name || selectedPlan.assigned_to || '—'}</span>
              </div>
              {selectedPlan.status === 'visited' && selectedPlan.visited_address && (
                <div className="bg-[#10b981]/10 border border-[#10b981]/20 rounded-md p-3">
                  <p className="text-[#10b981] text-xs font-medium flex items-center gap-1.5 mb-1">
                    <CheckCircle className="h-3.5 w-3.5" />Visit completed
                  </p>
                  <p className="text-[var(--text-secondary)] text-xs">{selectedPlan.visited_address}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
