import { useState, useEffect, useCallback, useRef } from 'react';
import { delegation as delApi } from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

// Local calendar date (NOT UTC) — due_dates are local dates, so comparing against
// a UTC "today" mis-bucketed tasks for anyone before ~5:30am IST.
const TODAY = (() => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
})();

const newRow = (delegatorId = '') => ({
  _id: Math.random().toString(36).slice(2),
  title: '', description: '', assignee_id: '', buddy_emp_id: '', priority: 'medium',
  task_type: 'onetime', frequency: 'daily', target_date: TODAY,
  start_date: TODAY, end_date: '', due_time: '', delegator_id: delegatorId,
  requires_image: false, require_verification: false, score: 0,
});

export function useDelegationApp() {
  const { user } = useAuth();

  /* ── core state ── */
  const [activeRole, setActiveRole] = useState('boss');
  const [viewTab,    setViewTab]    = useState('calendar');
  const [departments, setDepts]     = useState([]);
  const [employees,  setEmps]       = useState([]);
  const [instances,  setInstances]  = useState([]);
  const [teamSummary, setTeamSum]   = useState([]);
  const [dashboard,  setDash]       = useState(null);
  const [report,     setReport]     = useState(null);
  const [visitTasks, setVTasks]     = useState([]);
  const [calendarData, setCalData]  = useState(null);
  const [calYear,    setCalYear]    = useState(new Date().getFullYear());
  const [calMonth,   setCalMonth]   = useState(new Date().getMonth() + 1);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [reportPeriod, setRPeriod]  = useState('weekly');

  /* ── person drawer ── */
  const [drawer,        setDrawer]       = useState(null);
  const [drawerTasks,   setDrawerTasks]  = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerSearch,  setDrawerSearch] = useState('');
  const [drawerStatus,  setDrawerStatus] = useState('');

  /* ── edit-task dialog ── */
  const [editTask,   setEditTask]   = useState(null);   // task being edited, or null
  const [savingEdit, setSavingEdit] = useState(false);

  /* ── task submission dialog (Done / Not Done / Partial) ── */
  const [submitInst, setSubmitInst] = useState(null);   // instance being submitted, or null

  /* ── reassignment + approvals + notifications ── */
  const [reassignInst,     setReassignInst]     = useState(null);  // instance to reassign
  const [reassignRequests, setReassignRequests] = useState([]);
  const [notifications,    setNotifications]    = useState([]);

  /* ── personal planner (My Day / My Week) ── */
  const [plannerTasks, setPlannerTasks] = useState([]);   // instances I own
  const [buddyTasks,   setBuddyTasks]   = useState([]);   // instances I back up
  const [plannerLoading, setPlannerLoading] = useState(false);

  /* ── delegatee assigner filter ── */
  const [assignerFilter, setAssignerFilter] = useState('');

  /* ── task board filters ── */
  const [fStatus,   setFStatus]   = useState('');
  const [fPriority, setFPri]      = useState('');
  const [fEmp,      setFEmp]      = useState('');
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(new Set());

  /* ── assign table rows ── */
  const [rows, setRows] = useState([newRow()]);

  /* ── my delegation context ── */
  const [myContext, setMyContext] = useState(null);

  /* ── dept + employee dialogs ── */
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: '', description: '' });
  const [empOpen,  setEmpOpen]  = useState(false);
  const [editEmp,  setEditEmp]  = useState(null);
  const [empForm,  setEmpForm]  = useState({
    name: '', email: '', phone: '', department_id: '', department_name: '', roles: [], delegation_targets: [],
  });

  const myEmpRef = useRef(null);

  /* ─────────────── data loading ──────────────────────────────────────── */
  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e, ctx] = await Promise.all([
        delApi.departments.list(),
        delApi.employees.list(),
        delApi.myContext(),
      ]);
      setDepts(d.data || []);
      setEmps(e.data || []);
      setMyContext(ctx.data || null);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  const loadDash = useCallback(async () => {
    try { const r = await delApi.dashboard(); setDash(r.data); } catch { /* */ }
  }, []);

  const loadTeamSummary = useCallback(async () => {
    try { const r = await delApi.teamSummary(); setTeamSum(r.data || []); } catch { /* */ }
  }, []);

  const loadInstances = useCallback(async () => {
    const base = {};
    if (fStatus)   base.status   = fStatus;
    if (fPriority) base.priority = fPriority;
    const me = employees.find(e => e.email === user?.email);
    // Delegatee gets a unified "all my work" view: tasks assigned TO me, tasks
    // I assigned to others, and tasks I back up (buddy). /instances AND-filters,
    // so we union three calls and dedupe by instance_id.
    if (activeRole === 'delegatee') {
      if (!me) { setInstances([]); return; }
      try {
        const [mine, byMe, buddy] = await Promise.all([
          delApi.instances.list({ ...base, emp_id: me.emp_id }),
          delApi.instances.list({ ...base, delegator_id: me.emp_id }),
          delApi.instances.list({ ...base, buddy_emp_id: me.emp_id }),
        ]);
        const merged = {};
        [...(mine.data || []), ...(byMe.data || []), ...(buddy.data || [])]
          .forEach(i => { merged[i.instance_id] = i; });
        setInstances(Object.values(merged));
      } catch { /* */ }
      return;
    }
    const q = { ...base };
    if (fEmp && activeRole === 'boss') q.emp_id = fEmp;
    if (activeRole === 'delegator' && me) q.delegator_id = me.emp_id;
    try { const r = await delApi.instances.list(q); setInstances(r.data || []); } catch { /* */ }
  }, [fStatus, fPriority, fEmp, activeRole, user, employees]);

  const loadReport = useCallback(async () => {
    try { const r = await delApi.reports({ period: reportPeriod }); setReport(r.data); } catch { /* */ }
  }, [reportPeriod]);

  const loadVisitTasks = useCallback(async () => {
    try {
      const r = await delApi.instances.list({ linked_entity_type: 'visit_plan' });
      setVTasks(r.data || []);
    } catch { /* */ }
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      const r = await delApi.calendar({ year: calYear, month: calMonth });
      setCalData(r.data);
    } catch { /* */ }
  }, [calYear, calMonth]);

  /* ── effects ── */
  useEffect(() => {
    const me = employees.find(e => e.email === user?.email);
    myEmpRef.current = me;
    if ((activeRole === 'delegator' || activeRole === 'boss') && me) {
      setRows(rs => rs.map(r => r.delegator_id ? r : { ...r, delegator_id: me.emp_id }));
    }
  }, [activeRole, employees, user]);

  useEffect(() => {
    if (!myContext?.linked) return;
    const myRoles = myContext.roles || [];
    if (myRoles.length === 1) setActiveRole(myRoles[0]);
    else if (myRoles.length > 0 && !myRoles.includes(activeRole)) setActiveRole(myRoles[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myContext]);

  useEffect(() => { loadBase(); loadDash(); }, [loadBase, loadDash]);

  const refreshAll = useCallback(() => { loadBase(); loadDash(); loadTeamSummary(); }, [loadBase, loadDash, loadTeamSummary]);
  useDataSync('delegation', refreshAll);
  useAutoRefresh(refreshAll, 45000);

  useEffect(() => {
    if (viewTab === 'overview') { loadTeamSummary(); loadInstances(); }
    if (viewTab === 'assign')   { loadTeamSummary(); }
  }, [viewTab, activeRole, loadTeamSummary, loadInstances]);
  // Delegatee KPI strip + clickable cards need the unified instance set on every
  // tab (not just Overview), so load it whenever the delegatee role is active.
  useEffect(() => {
    if (activeRole === 'delegatee' && employees.length) loadInstances();
  }, [activeRole, employees, loadInstances]);
  useEffect(() => { if (viewTab === 'reports')  loadReport();     }, [viewTab, loadReport]);
  useEffect(() => { if (viewTab === 'visits')   loadVisitTasks(); }, [viewTab, loadVisitTasks]);
  useEffect(() => { if (viewTab === 'calendar') loadCalendar();   }, [viewTab, loadCalendar]);

  /* ─────────────── person drawer ─────────────────────────────────────── */
  const openDrawer = async (emp) => {
    setDrawer(emp);
    setDrawerSearch('');
    setDrawerStatus('');
    setDrawerLoading(true);
    try {
      const r = await delApi.instances.list({ emp_id: emp.emp_id });
      setDrawerTasks(r.data || []);
    } catch { toast.error('Failed to load tasks'); }
    finally { setDrawerLoading(false); }
  };

  const drawerFiltered = drawerTasks.filter(t => {
    if (drawerStatus && t.status !== drawerStatus) return false;
    if (drawerSearch) {
      const s = drawerSearch.toLowerCase();
      if (!t.task_title?.toLowerCase().includes(s) && !t.delegator_name?.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  /* ─────────────── task actions ──────────────────────────────────────── */
  // Opening the submit dialog (Done / Not Done / Partial) IS the "mark done"
  // action everywhere — every card/list/drawer calls completeInst(inst), so the
  // full submission flow (remark, photo, not-done reason, partial) is uniform.
  const completeInst = (inst) => setSubmitInst(inst);

  // Submit dialog → "Done": optional remark, or a photo when proof is required.
  const submitDone = async (inst, { note = '', file = null } = {}) => {
    try {
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await delApi.instances.completeWithImage(inst.instance_id, fd);
      } else {
        await delApi.instances.complete(inst.instance_id, { note });
      }
      toast.success('Marked done');
      setSubmitInst(null);
      loadInstances(); loadDash(); loadPlanner();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed');
      throw e;
    }
  };

  // Submit dialog → "Not Done" / "Partial".
  const reportInst = async (inst, payload) => {
    try {
      await delApi.instances.report(inst.instance_id, payload);
      toast.success(
        payload.outcome === 'partial'
          ? (payload.reassign_to_emp_id ? 'Progress saved — reassignment requested' : 'Progress saved')
          : 'Reported — assigner notified');
      setSubmitInst(null);
      loadInstances(); loadDash(); loadPlanner();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed');
      throw e;
    }
  };

  const verifyInst = async (id) => {
    await delApi.instances.verify(id);
    toast.success('Verified');
    loadInstances();
    if (drawer) {
      const r = await delApi.instances.list({ emp_id: drawer.emp_id });
      setDrawerTasks(r.data || []);
    }
  };

  const reopenInst = async (id) => {
    await delApi.instances.reopen(id);
    toast.success('Reopened');
    loadInstances();
    if (drawer) openDrawer(drawer);
  };

  const bulkClose = async () => {
    await delApi.instances.bulkComplete({ instance_ids: [...selected], note: 'Bulk closed' });
    toast.success(`${selected.size} tasks closed`);
    setSelected(new Set()); loadInstances(); loadDash();
  };

  const handleImageComplete = async (inst, file) => {
    const fd = new FormData();
    fd.append('file', file);
    await delApi.instances.completeWithImage(inst.instance_id, fd);
    toast.success('Completed with photo'); loadInstances(); loadDash();
  };

  /* ─────────────── task editing ──────────────────────────────────────── */
  // Open the edit dialog from an instance row. Owners load the full task
  // definition (so dates/assignees aren't wiped on save); delegatees soft-edit
  // their own instance (we stash __instanceId for patchInstance).
  const openEditTask = async (inst, role) => {
    if (role === 'delegatee') {
      setEditTask({
        __instanceId: inst.instance_id,
        task_id: inst.task_id,
        title: inst.task_title,
        priority: inst.priority,
      });
      return;
    }
    try {
      const r = await delApi.tasks.list({});
      const t = (r.data || []).find(x => x.task_id === inst.task_id);
      if (t) setEditTask(t);
      else toast.error('Task definition not found');
    } catch {
      toast.error('Failed to load task');
    }
  };

  const updateTask = async (taskId, payload) => {
    setSavingEdit(true);
    try {
      await delApi.tasks.update(taskId, payload);
      toast.success('Task updated');
      setEditTask(null);
      loadInstances(); loadDash(); loadTeamSummary();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const patchInstance = async (instanceId, payload) => {
    try {
      await delApi.instances.patch(instanceId, payload);
      toast.success('Saved');
      loadInstances();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    }
  };

  /* ─────────────── reassignment + approvals ──────────────────────────── */
  const submitReassign = async (instanceId, toEmpId, reason) => {
    try {
      await delApi.instances.reassignRequest(instanceId, { to_emp_id: toEmpId, reason });
      toast.success('Reassignment requested — awaiting approval');
      setReassignInst(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Request failed');
    }
  };

  const loadReassignRequests = useCallback(async (status = 'pending') => {
    try {
      const r = await delApi.reassignRequests.list(status ? { status } : {});
      setReassignRequests(r.data || []);
    } catch { /* silent */ }
  }, []);

  const decideReassign = async (requestId, decision, note = '') => {
    try {
      await delApi.reassignRequests.decide(requestId, { decision, note });
      toast.success(decision === 'approved' ? 'Approved' : 'Rejected');
      loadReassignRequests('pending');
      loadInstances();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Action failed');
    }
  };

  /* ─────────────── notifications ─────────────────────────────────────── */
  const loadNotifications = useCallback(async () => {
    try {
      const r = await delApi.notifications.list({});
      setNotifications(r.data || []);
    } catch { /* silent */ }
  }, []);

  const markNotifRead = async (notifId) => {
    try {
      await delApi.notifications.read(notifId);
      setNotifications(ns => ns.map(n => n.notif_id === notifId ? { ...n, is_read: true } : n));
    } catch { /* silent */ }
  };

  const markAllNotifsRead = async () => {
    try {
      await delApi.notifications.readAll();
      setNotifications(ns => ns.map(n => ({ ...n, is_read: true })));
    } catch { /* silent */ }
  };

  /* ─────────────── personal planner ─────────────────────────────────── */
  const loadPlanner = useCallback(async () => {
    // Resolve from employees/user (not myEmpRef) so this re-runs once the
    // employee list finishes loading — otherwise a delegatee who lands on the
    // planner before employees arrive sees a permanently empty planner.
    const me = employees.find(e => e.email === user?.email);
    const id = me?.emp_id;
    if (!id) return;
    setPlannerLoading(true);
    try {
      const [own, bud] = await Promise.all([
        delApi.instances.list({ emp_id: id }),
        delApi.instances.list({ buddy_emp_id: id }),
      ]);
      setPlannerTasks(own.data || []);
      setBuddyTasks((bud.data || []).filter(t => t.emp_id !== id));
    } catch { /* silent */ }
    finally { setPlannerLoading(false); }
  }, [employees, user]);

  /* ─── tab/load effects that depend on the loaders defined above ─────────
     (must come AFTER the useCallback definitions or their dep arrays hit the
     temporal dead zone and throw on render) */
  useEffect(() => { if (viewTab === 'approvals') loadReassignRequests('pending'); }, [viewTab, loadReassignRequests]);
  useEffect(() => { if (viewTab === 'planner')   loadPlanner();                   }, [viewTab, loadPlanner]);
  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  /* ─────────────── bulk assign ───────────────────────────────────────── */
  const updateRow = (id, field, val) =>
    setRows(rs => rs.map(r => r._id === id ? { ...r, [field]: val } : r));

  const saveAllRows = async () => {
    const valid = rows.filter(r => r.title.trim() && r.assignee_id);
    if (!valid.length) { toast.error('Add at least one row with title and assignee'); return; }
    setSaving(true);
    try {
      const autoDelId = myEmpRef.current?.emp_id || null;
      await delApi.tasks.bulkCreate(valid.map(r => ({
        title: r.title, description: r.description,
        task_type: r.task_type, frequency: r.task_type === 'recurring' ? r.frequency : 'custom',
        target_date: r.task_type === 'onetime' ? r.target_date : null,
        start_date:  r.task_type === 'recurring' ? r.start_date : null,
        end_date:    r.task_type === 'recurring' ? r.end_date   : null,
        due_time: r.due_time || '',
        priority: r.priority, assignee_ids: [r.assignee_id],
        buddy_emp_id: r.buddy_emp_id || '',
        delegator_id: r.delegator_id || autoDelId,
        requires_image: r.requires_image, score: r.score,
        require_verification: r.require_verification,
      })));
      toast.success(`${valid.length} task(s) assigned`);
      setRows([newRow()]); loadDash(); loadTeamSummary();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  /* ─────────────── employee CRUD ─────────────────────────────────────── */
  const toggleRole = r => setEmpForm(f => ({
    ...f, roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r],
  }));

  const saveEmp = async () => {
    if (!empForm.name.trim() || !empForm.roles.length) { toast.error('Name and at least one role required'); return; }
    const payload = { ...empForm };
    if (!payload.roles.includes('delegator') && !payload.roles.includes('boss')) {
      payload.delegation_targets = [];
    }
    try {
      if (editEmp) await delApi.employees.update(editEmp.emp_id, payload);
      else await delApi.employees.create(payload);
      toast.success(editEmp ? 'Updated' : 'Added');
      setEmpOpen(false); loadBase(); loadTeamSummary();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const saveDept = async () => {
    if (!deptForm.name.trim()) { toast.error('Name required'); return; }
    try { await delApi.departments.create(deptForm); toast.success('Department added'); setDeptOpen(false); loadBase(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  const syncUsersNow = async () => {
    setSyncing(true);
    try {
      const r = await delApi.syncUsers();
      const { synced, total } = r.data;
      toast.success(synced > 0 ? `Synced ${synced} new user(s) — ${total} total` : `All ${total} users already linked`);
      loadBase(); loadTeamSummary();
    } catch { toast.error('Sync failed'); }
    finally { setSyncing(false); }
  };

  /* ─────────────── computed helpers ──────────────────────────────────── */
  const myEmp = employees.find(e => e.email === user?.email);

  const ROLES = ['boss', 'delegator', 'delegatee'];
  const visibleRoles = (myContext?.linked && myContext.roles?.length > 0)
    ? ROLES.filter(r => myContext.roles.includes(r))
    : ROLES;

  const assignableEmployees = activeRole === 'boss'
    ? employees.filter(e => e.roles?.includes('delegatee'))
    : activeRole === 'delegator'
    ? (myContext?.delegation_targets?.length > 0
        ? employees.filter(e => myContext.delegation_targets.includes(e.emp_id))
        : employees.filter(e => e.roles?.includes('delegatee')))
    : employees;

  const leaders = teamSummary.filter(e => e.roles?.some(r => r === 'boss' || r === 'delegator'));
  const members = teamSummary.filter(e => e.roles?.includes('delegatee'));

  const myAssigneeIds = new Set(
    instances.filter(i => i.delegator_id === myEmp?.emp_id).map(i => i.emp_id)
  );
  const myAssignees = teamSummary.filter(e => myAssigneeIds.has(e.emp_id));

  // Delegatee sees the full unified set (assigned to me + assigned by me +
  // buddy); other roles see tasks owned by them.
  const myTasks = activeRole === 'delegatee'
    ? instances
    : instances.filter(i => i.emp_id === myEmp?.emp_id);
  const assignerGroups = {};
  myTasks.forEach(inst => {
    const key = inst.delegator_name || 'System';
    if (!assignerGroups[key]) assignerGroups[key] = [];
    assignerGroups[key].push(inst);
  });
  const filteredMyTasks = assignerFilter
    ? myTasks.filter(i => (i.delegator_name || 'System') === assignerFilter)
    : myTasks;

  const delegatees = employees.filter(e => e.roles?.includes('delegatee'));
  const delegators = employees.filter(e => e.roles?.includes('delegator') || e.roles?.includes('boss'));

  // For the delegatee, compute the KPI strip from the unified set so the cards
  // and the clickable filter operate on exactly the same tasks. Other roles use
  // the backend dashboard.
  const dashboardView = (activeRole === 'delegatee' && myEmp)
    ? {
        pending:   myTasks.filter(t => t.status === 'pending').length,
        completed: myTasks.filter(t => t.status === 'completed').length,
        verified:  myTasks.filter(t => t.status === 'verified').length,
        overdue:   myTasks.filter(t => t.status === 'pending' && (t.due_date || '') < TODAY).length,
        today:     myTasks.filter(t => t.due_date === TODAY).length,
        total_employees: dashboard?.total_employees ?? employees.length,
      }
    : dashboard;

  return {
    /* state */
    activeRole, setActiveRole,
    viewTab, setViewTab,
    departments, employees, instances, teamSummary,
    dashboard: dashboardView, report, visitTasks,
    calendarData, calYear, setCalYear, calMonth, setCalMonth,
    loading, saving, syncing,
    reportPeriod, setRPeriod,
    /* drawer */
    drawer, setDrawer,
    drawerTasks, drawerLoading, drawerSearch, setDrawerSearch,
    drawerStatus, setDrawerStatus, drawerFiltered,
    /* filters */
    assignerFilter, setAssignerFilter,
    fStatus, setFStatus, fPriority, setFPri, fEmp, setFEmp,
    search, setSearch, selected, setSelected,
    /* assign rows */
    rows, setRows, newRow, updateRow, saveAllRows,
    /* dialogs */
    deptOpen, setDeptOpen, deptForm, setDeptForm,
    empOpen, setEmpOpen, editEmp, setEditEmp, empForm, setEmpForm,
    /* edit task */
    editTask, setEditTask, savingEdit, openEditTask, updateTask, patchInstance,
    /* task submission dialog */
    submitInst, setSubmitInst, submitDone, reportInst,
    /* reassignment + approvals + notifications */
    reassignInst, setReassignInst, submitReassign,
    reassignRequests, loadReassignRequests, decideReassign,
    notifications, loadNotifications, markNotifRead, markAllNotifsRead,
    /* planner */
    plannerTasks, buddyTasks, plannerLoading, loadPlanner,
    /* handlers */
    openDrawer, completeInst, verifyInst, reopenInst, bulkClose,
    handleImageComplete, toggleRole, saveEmp, saveDept, syncUsersNow,
    loadCalendar, loadReport, loadVisitTasks,
    /* computed */
    myEmp, visibleRoles, assignableEmployees,
    leaders, members, myAssignees,
    myTasks, assignerGroups, filteredMyTasks,
    delegatees, delegators,
    TODAY,
  };
}
