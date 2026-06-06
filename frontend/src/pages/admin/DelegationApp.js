import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AdminLayout from '../../components/layouts/AdminLayout';
import { useDelegationApp } from '../../hooks/useDelegationApp';
import DelegationDashboard from '../../components/delegation/DelegationDashboard';
import DelegationTaskForm from '../../components/delegation/DelegationTaskForm';
import DelegationDepartmentManager from '../../components/delegation/DelegationDepartmentManager';
import EditTaskDialog from '../../components/delegation/EditTaskDialog';
import ReassignTaskDialog from '../../components/delegation/ReassignTaskDialog';
import ApprovalsInbox from '../../components/delegation/ApprovalsInbox';
import NotificationsBell from '../../components/delegation/NotificationsBell';
import MyPlanner from '../../components/delegation/MyPlanner';
import {
  DelegationOverviewTab, DelegationVisitsTab, DelegationReportsTab,
  DelegationCalendarTab, DelegationPersonDrawer,
} from '../../components/delegation/DelegationTaskList';
import DelegationCalendar from '../../components/delegation/calendar/DelegationCalendar';
import {
  LayoutGrid, ClipboardList, Calendar, CalendarDays, Users, MapPin, BarChart2, Briefcase, Shield, UserCheck, User, CheckCircle2, Sun,
} from 'lucide-react';

const PINK = '#e94560';

const VIEWS = [
  { id: 'overview', label: 'Overview',     icon: LayoutGrid    },
  { id: 'assign',   label: 'Assign Tasks', icon: ClipboardList },
  { id: 'team',     label: 'Team',         icon: Users         },
  { id: 'visits',   label: 'Visit Tasks',  icon: MapPin        },
  { id: 'reports',  label: 'Reports',      icon: BarChart2     },
];
const ROLE_META = {
  boss:      { Icon: Shield,    label: 'Boss',      desc: 'Full team visibility' },
  delegator: { Icon: UserCheck, label: 'Delegator', desc: 'Tasks I assigned'     },
  delegatee: { Icon: User,      label: 'Delegatee', desc: 'Work assigned to me'  },
};

export default function DelegationApp() {
  const { user } = useAuth();
  const nav      = useNavigate();
  const s        = useDelegationApp();

  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls    = `bg-[var(--bg-card)] border-[var(--border-color)] ${textPri}`;

  const sharedTheme = { card, textPri, textSec, textMuted, inputCls, dlgCls };

  return (
    <AdminLayout>
      <div className="space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl hidden sm:flex" style={{ background: PINK + '18' }}>
              <Briefcase className="h-5 w-5" style={{ color: PINK }} />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${textPri} tracking-tight`}>Delegation System</h1>
              <p className={`${textMuted} text-xs mt-0.5`}>Assign · track · verify team work</p>
            </div>
          </div>
          <NotificationsBell
            notifications={s.notifications}
            markNotifRead={s.markNotifRead} markAllNotifsRead={s.markAllNotifsRead}
            {...sharedTheme}
          />
        </div>

        {/* Role switcher */}
        <div className={`grid gap-2 sm:gap-3 ${s.visibleRoles.length === 1 ? 'grid-cols-1' : s.visibleRoles.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {s.visibleRoles.map(r => {
            const { Icon, label, desc } = ROLE_META[r];
            const active = s.activeRole === r;
            return (
              <button key={r} onClick={() => { s.setActiveRole(r); s.setViewTab(r === 'delegatee' ? 'planner' : 'calendar'); s.setAssignerFilter(''); }}
                className={`border rounded-xl p-3 sm:p-4 text-center transition-all active:scale-[0.97]
                  ${active ? 'text-white shadow-lg' : `${card} ${textMuted} hover:border-[#e94560]/40`}`}
                style={active ? { background: PINK, borderColor: PINK } : {}}>
                <Icon className="h-5 w-5 sm:h-6 sm:w-6 mx-auto mb-1.5" />
                <p className="text-sm font-bold capitalize">{label}</p>
                <p className={`text-[10px] hidden sm:block mt-0.5 ${active ? 'text-white/80' : textMuted}`}>{desc}</p>
              </button>
            );
          })}
        </div>

        {/* KPI strip */}
        <DelegationDashboard dashboard={s.dashboard} {...sharedTheme} />

        {/* Tab bar */}
        <div className={`${card} border rounded-xl p-1 flex gap-0.5 overflow-x-auto`}>
          {[
            { id: 'calendar', label: 'Calendar', icon: CalendarDays },
            { id: 'planner', label: 'My Planner', icon: Sun },
            ...VIEWS,
            ...((s.activeRole === 'boss' || s.activeRole === 'delegator')
              ? [{ id: 'approvals', label: 'Approvals', icon: CheckCircle2 }]
              : []),
          ].map(v => (
            <button key={v.id} onClick={() => s.setViewTab(v.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex-shrink-0
                ${s.viewTab === v.id ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={s.viewTab === v.id ? { background: PINK } : {}}>
              <v.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        {/* My Planner */}
        {s.viewTab === 'planner' && (
          <MyPlanner
            myEmp={s.myEmp}
            plannerTasks={s.plannerTasks} buddyTasks={s.buddyTasks}
            loading={s.plannerLoading} TODAY={s.TODAY}
            completeInst={s.completeInst} handleImageComplete={s.handleImageComplete}
            onEditTask={(inst) => s.openEditTask(inst, s.activeRole)}
            onReassign={(inst) => s.setReassignInst(inst)}
            {...sharedTheme}
          />
        )}

        {/* Overview */}
        {s.viewTab === 'overview' && (
          <DelegationOverviewTab
            activeRole={s.activeRole} myEmp={s.myEmp} user={user}
            leaders={s.leaders} members={s.members} myAssignees={s.myAssignees}
            myTasks={s.myTasks} filteredMyTasks={s.filteredMyTasks}
            assignerGroups={s.assignerGroups} assignerFilter={s.assignerFilter}
            setAssignerFilter={s.setAssignerFilter}
            drawerStatus={s.drawerStatus} setDrawerStatus={s.setDrawerStatus}
            openDrawer={s.openDrawer} completeInst={s.completeInst}
            handleImageComplete={s.handleImageComplete}
            setViewTab={s.setViewTab} TODAY={s.TODAY}
            {...sharedTheme}
          />
        )}

        {/* Assign Tasks */}
        {s.viewTab === 'assign' && (
          <DelegationTaskForm
            rows={s.rows} setRows={s.setRows}
            updateRow={s.updateRow} saveAllRows={s.saveAllRows} newRow={s.newRow}
            saving={s.saving} activeRole={s.activeRole} myEmp={s.myEmp}
            assignableEmployees={s.assignableEmployees} delegators={s.delegators}
            teamSummary={s.teamSummary}
            {...sharedTheme}
          />
        )}

        {/* Calendar */}
        {s.viewTab === 'calendar' && (
          <DelegationCalendar
            onEventClick={() => {}}
            card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} inputCls={inputCls}
          />
        )}

        {/* Team */}
        {s.viewTab === 'team' && (
          <DelegationDepartmentManager
            employees={s.employees} departments={s.departments}
            syncing={s.syncing} syncUsersNow={s.syncUsersNow}
            setDeptOpen={s.setDeptOpen} setEmpOpen={s.setEmpOpen}
            setEditEmp={s.setEditEmp} setEmpForm={s.setEmpForm}
            deptOpen={s.deptOpen} deptForm={s.deptForm} setDeptForm={s.setDeptForm}
            saveDept={s.saveDept}
            empOpen={s.empOpen} editEmp={s.editEmp} empForm={s.empForm}
            saveEmp={s.saveEmp} toggleRole={s.toggleRole}
            {...sharedTheme}
          />
        )}

        {/* Visit Tasks */}
        {s.viewTab === 'visits' && (
          <DelegationVisitsTab
            visitTasks={s.visitTasks} loadVisitTasks={s.loadVisitTasks}
            completeInst={s.completeInst} nav={nav}
            TODAY={s.TODAY} {...sharedTheme}
          />
        )}

        {/* Reports */}
        {s.viewTab === 'reports' && (
          <DelegationReportsTab
            report={s.report} reportPeriod={s.reportPeriod}
            setRPeriod={s.setRPeriod} loadReport={s.loadReport}
            {...sharedTheme}
          />
        )}

        {/* Approvals */}
        {s.viewTab === 'approvals' && (
          <ApprovalsInbox
            requests={s.reassignRequests} decideReassign={s.decideReassign}
            {...sharedTheme}
          />
        )}
      </div>

      {/* Person drawer */}
      <DelegationPersonDrawer
        drawer={s.drawer} setDrawer={s.setDrawer}
        drawerTasks={s.drawerTasks} drawerLoading={s.drawerLoading}
        drawerFiltered={s.drawerFiltered}
        drawerSearch={s.drawerSearch} setDrawerSearch={s.setDrawerSearch}
        drawerStatus={s.drawerStatus} setDrawerStatus={s.setDrawerStatus}
        completeInst={s.completeInst} verifyInst={s.verifyInst} reopenInst={s.reopenInst}
        onEditTask={(inst) => s.openEditTask(inst, s.activeRole)}
        onReassign={(inst) => s.setReassignInst(inst)}
        TODAY={s.TODAY} {...sharedTheme}
      />

      {/* Reassign dialog */}
      {s.reassignInst && (
        <ReassignTaskDialog
          instance={s.reassignInst}
          employees={s.employees}
          onSubmit={s.submitReassign}
          onClose={() => s.setReassignInst(null)}
          {...sharedTheme}
        />
      )}

      {/* Edit task dialog */}
      {s.editTask && (
        <EditTaskDialog
          task={s.editTask}
          role={s.activeRole}
          assignableEmployees={s.assignableEmployees}
          saving={s.savingEdit}
          onSubmit={async (payload) => {
            if (s.activeRole === 'delegatee') {
              await s.patchInstance(s.editTask.__instanceId, payload);
              s.setEditTask(null);
            } else {
              await s.updateTask(s.editTask.task_id, payload);
            }
          }}
          onClose={() => s.setEditTask(null)}
          {...sharedTheme}
        />
      )}
    </AdminLayout>
  );
}
