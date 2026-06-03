import { useState, useEffect, useCallback } from 'react';
import { visitPlans, salesPersons as spApi } from '../lib/api';
import { toast } from 'sonner';

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

export { SP_COLORS };

export function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

export function getWeekDates(anchor) {
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

export function getStatusStyle(status) {
  if (status === 'visited') return 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20';
  if (status === 'cancelled') return 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20';
  if (status === 'rescheduled') return 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20';
  return 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20';
}

export function useVisitCalendar() {
  const [plans, setPlans] = useState([]);
  const [spList, setSpList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(new Date());
  const [selectedSP, setSelectedSP] = useState('all');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [spColorMap, setSpColorMap] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, spr] = await Promise.all([visitPlans.getAll(), spApi.getAll()]);
      const allPlans = pr.data || [];
      const allSP = spr.data || [];
      setPlans(allPlans);
      setSpList(allSP);
      const colorMap = {};
      allSP.forEach((sp, i) => { colorMap[sp.email || sp.name] = i % SP_COLORS.length; });
      setSpColorMap(colorMap);
    } catch {
      toast.error('Failed to load visit plans');
    } finally {
      setLoading(false);
    }
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
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const first = weekDates[0];
    const last  = weekDates[6];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
    }
    return `${first.getDate()} ${MONTH_NAMES[first.getMonth()]} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  })();

  return {
    plans, spList, loading,
    anchor, weekDates,
    selectedSP, setSelectedSP,
    selectedPlan, detailOpen, setDetailOpen,
    spColorMap, filteredPlans,
    stats, weekLabel,
    getPlansForDate,
    spColor,
    prevWeek, nextWeek, goToday,
    openDetail,
    fetchData,
  };
}
