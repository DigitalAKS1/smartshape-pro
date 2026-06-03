import { useState, useEffect } from 'react';
import {
  attendance as attendanceApi, visits as visitsApi,
  leads as leadsApi, tasks as tasksApi, quotations as quotationsApi,
} from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { getSalesPermissions } from '../lib/salesPermissions';

export function useSalesHome() {
  const { user } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const perms = getSalesPermissions(user?.sales_role);

  const [data, setData] = useState({
    attendance: null, visits: [], leads: [],
    quotations: [], overdue: [], allLeads: [],
  });
  const [loading, setLoading] = useState(true);
  const [punchOpen, setPunchOpen] = useState(false);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  const fetchAll = async () => {
    try {
      const [att, vis, ldr, tsk, qts] = await Promise.all([
        attendanceApi.getToday().catch(() => ({ data: null })),
        perms.visits_log     ? visitsApi.getAll().catch(() => ({ data: [] }))     : Promise.resolve({ data: [] }),
        perms.leads_view     ? leadsApi.getAll().catch(() => ({ data: [] }))      : Promise.resolve({ data: [] }),
        tasksApi.getAll().catch(() => ({ data: [] })),
        perms.quotation_view ? quotationsApi.getAll().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);

      const allLeads = ldr.data || [];
      const allTasks = tsk.data || [];

      setData({
        attendance:  att.data,
        visits:      (vis.data || []).filter(v => v.visit_date === today),
        leads:       allLeads.filter(l => !['won', 'lost'].includes(l.stage)),
        allLeads,
        quotations:  (qts.data || []).filter(q => ['draft', 'sent'].includes(q.quotation_status)),
        overdue:     allTasks.filter(t => t.status === 'pending' && t.due_date <= today),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const priorityLeads = data.leads
    .filter(l =>
      l.lead_type === 'hot' ||
      (l.lead_type === 'warm' && l.next_followup_date && l.next_followup_date <= today)
    )
    .sort((a, b) => {
      if (a.lead_type === 'hot' && b.lead_type !== 'hot') return -1;
      if (b.lead_type === 'hot' && a.lead_type !== 'hot') return 1;
      return 0;
    })
    .slice(0, 5);

  const weekLeadsActive = data.allLeads.filter(l => !['won', 'lost'].includes(l.stage)).length;
  const weekWon = data.allLeads.filter(l => l.stage === 'won').length;

  return {
    user, today, perms, data,
    loading, punchOpen, setPunchOpen,
    priorityLeads, weekLeadsActive, weekWon,
    fetchAll,
  };
}
