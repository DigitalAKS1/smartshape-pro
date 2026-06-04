import React, { useRef } from 'react';
import {
  Check, Camera, Calendar, AlertTriangle, Users, ClipboardList,
  UserCheck, MapPin, RefreshCw, Link2, User, RotateCcw, Eye,
  CheckSquare, ChevronRight, Pencil, ArrowRightLeft,
} from 'lucide-react';

const PINK = '#e94560';

const PRIORITY_STYLE = {
  high:   { dot: 'bg-red-500',   badge: 'bg-red-500/15 text-red-500 border-red-500/20',       label: 'High'   },
  medium: { dot: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-500 border-amber-500/20', label: 'Medium' },
  low:    { dot: 'bg-green-500', badge: 'bg-green-500/15 text-green-500 border-green-500/20', label: 'Low'    },
};
const STATUS_STYLE = {
  pending:   'bg-orange-500/15 text-orange-500',
  completed: 'bg-blue-500/15 text-blue-500',
  verified:  'bg-green-500/15 text-green-500',
};
const FREQ_STYLE = {
  daily:   'bg-violet-500/15 text-violet-400',
  weekly:  'bg-cyan-500/15 text-cyan-400',
  monthly: 'bg-rose-500/15 text-rose-400',
  onetime: 'bg-[var(--bg-hover)] text-[var(--text-muted)]',
  custom:  'bg-[var(--bg-hover)] text-[var(--text-muted)]',
};

function empColor(id = '') {
  const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `hsl(${(n * 47) % 360}, 55%, 42%)`;
}
function empInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function StatMini({ label, value, cls }) {
  return (
    <div className="rounded-lg bg-[var(--bg-primary)] py-2 text-center">
      <p className={`text-sm font-black font-mono ${cls}`}>{value}</p>
      <p className="text-[9px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function Avatar({ emp, size = 10 }) {
  return (
    <div className={`w-${size} h-${size} rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white`}
      style={{ background: empColor(emp.emp_id) }}>
      {empInitials(emp.name)}
    </div>
  );
}

function RoleTag({ role }) {
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
      style={{ background: PINK + '18', color: PINK }}>{role}</span>
  );
}

function PersonCard({ emp, onOpen, card, textPri, textMuted }) {
  const overdue = emp.overdue || 0;
  return (
    <button onClick={() => onOpen(emp)}
      className={`${card} border rounded-xl p-4 text-left w-full hover:border-[#e94560]/40 active:scale-[0.98] transition-all`}>
      <div className="flex items-start gap-3 mb-3">
        <Avatar emp={emp} size={10} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${textPri} truncate`}>{emp.name}</p>
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {(emp.roles || []).map(r => <RoleTag key={r} role={r} />)}
          </div>
        </div>
        {overdue > 0 && (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-500 flex-shrink-0">
            {overdue} late
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <StatMini label="Pending"  value={emp.pending   || 0} cls="text-orange-500" />
        <StatMini label="Done"     value={(emp.completed || 0) + (emp.verified || 0)} cls="text-blue-500" />
        <StatMini label="Verified" value={emp.verified  || 0} cls="text-green-500" />
      </div>
      {(emp.assignee_ids?.length > 0) && (
        <p className={`text-[10px] ${textMuted} mt-2.5 pt-2 border-t border-[var(--border-color)]`}>
          Assigned to <strong className={textPri}>{emp.assignee_ids.length}</strong> member{emp.assignee_ids.length !== 1 ? 's' : ''}
          <ChevronRight className="h-3 w-3 inline ml-1 opacity-50" />
        </p>
      )}
    </button>
  );
}

function TaskCard({ inst, onComplete, onImageComplete, card, textPri, textMuted, textSec, TODAY }) {
  const fileRef = useRef(null);
  const isOverdue = inst.status === 'pending' && inst.due_date < TODAY;
  const p = PRIORITY_STYLE[inst.priority] || PRIORITY_STYLE.medium;

  return (
    <div className={`${card} border rounded-xl overflow-hidden flex flex-col`}>
      <div className={`h-1 ${p.dot}`} />
      <div className="p-4 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.badge} capitalize`}>{inst.priority}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${FREQ_STYLE[inst.frequency] || FREQ_STYLE.onetime}`}>{inst.frequency}</span>
              {inst.requires_image && <Camera className={`h-3 w-3 ${textMuted}`} />}
              {inst.linked_entity_type === 'visit_plan' && <Link2 className="h-3 w-3 text-blue-400" />}
            </div>
            <h3 className={`text-sm font-semibold ${textPri} leading-snug`}>{inst.task_title}</h3>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: inst.status === 'pending' ? '#f97316' + '20' : inst.status === 'completed' ? '#3b82f6' + '20' : '#22c55e' + '20',
              color: inst.status === 'pending' ? '#f97316' : inst.status === 'completed' ? '#3b82f6' : '#22c55e',
            }}>
            {inst.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-semibold' : textMuted}`}>
            <Calendar className="h-3 w-3" />
            {inst.due_date === TODAY ? 'Today' : inst.due_date}
            {isOverdue && ' — Overdue'}
          </span>
          {inst.delegator_name && (
            <span className={`flex items-center gap-1 ${textMuted}`}>
              <UserCheck className="h-3 w-3" />{inst.delegator_name}
            </span>
          )}
        </div>
      </div>
      {inst.status === 'pending' && (
        <div className="border-t border-[var(--border-color)] flex">
          <button onClick={() => onComplete(inst)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-white"
            style={{ background: '#10b981' }}>
            <Check className="h-4 w-4" /> Mark Done
          </button>
          {inst.requires_image && (
            <>
              <div className="w-px bg-[var(--border-color)]" />
              <button onClick={() => fileRef.current?.click()}
                className={`px-4 flex items-center justify-center hover:bg-[var(--bg-hover)] ${textMuted}`}>
                <Camera className="h-4 w-4" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { if (e.target.files?.[0]) onImageComplete(inst, e.target.files[0]); e.target.value = ''; }} />
            </>
          )}
        </div>
      )}
      {inst.status === 'completed' && (
        <div className="border-t border-[var(--border-color)] px-4 py-2.5 flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-blue-500" />
          <span className={`text-xs ${textSec}`}>Completed{inst.completed_at ? ` · ${new Date(inst.completed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
      )}
      {inst.status === 'verified' && (
        <div className="border-t border-[var(--border-color)] px-4 py-2.5 flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-green-500" />
          <span className={`text-xs ${textSec}`}>Verified by {inst.verified_by || 'Boss'}</span>
        </div>
      )}
    </div>
  );
}

/* ── Overview Tab (Boss / Delegator / Delegatee views) ─────────────────────── */
export function DelegationOverviewTab({
  activeRole, myEmp, user,
  leaders, members, myAssignees,
  myTasks, filteredMyTasks, assignerGroups, assignerFilter, setAssignerFilter,
  drawerStatus, setDrawerStatus,
  openDrawer, completeInst, handleImageComplete,
  card, textPri, textSec, textMuted, TODAY,
  setViewTab,
}) {
  return (
    <>
      {activeRole === 'boss' && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>Team Leaders</h2>
                <p className={`text-xs ${textMuted}`}>Delegators who assign and manage work</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted} font-mono`}>{leaders.length}</span>
            </div>
            {leaders.length === 0 ? (
              <div className={`${card} border rounded-xl p-10 text-center`}>
                <UserCheck className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
                <p className={`text-sm ${textMuted}`}>No team leaders yet — add members with Boss or Delegator role</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {leaders.map(emp => (
                  <PersonCard key={emp.emp_id} emp={emp} onOpen={openDrawer}
                    card={card} textPri={textPri} textMuted={textMuted} />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>Team Members</h2>
                <p className={`text-xs ${textMuted}`}>Delegatees who execute tasks — click any card to see all their work</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted} font-mono`}>{members.length}</span>
            </div>
            {members.length === 0 ? (
              <div className={`${card} border rounded-xl p-10 text-center`}>
                <Users className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
                <p className={`text-sm ${textMuted}`}>No team members yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {members.map(emp => (
                  <PersonCard key={emp.emp_id} emp={emp} onOpen={openDrawer}
                    card={card} textPri={textPri} textMuted={textMuted} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeRole === 'delegator' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-base sm:text-lg font-semibold ${textPri}`}>People I Assigned Work To</h2>
              <p className={`text-xs ${textMuted}`}>Click any member to see all tasks you assigned them</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${card} border ${textMuted} font-mono`}>
              {myAssignees.length} member{myAssignees.length !== 1 ? 's' : ''}
            </span>
          </div>

          {!myEmp ? (
            <div className={`${card} border rounded-xl p-10 text-center`}>
              <AlertTriangle className={`h-10 w-10 mx-auto mb-2 text-yellow-500 opacity-60`} />
              <p className={`text-sm font-medium ${textPri} mb-1`}>Account not linked</p>
              <p className={`text-xs ${textMuted}`}>Your SmartShape login ({user?.email}) is not yet linked as a delegation employee.</p>
              <button onClick={() => setViewTab('team')}
                className="mt-3 text-xs font-semibold text-white px-4 py-2 rounded-lg"
                style={{ background: PINK }}>Go to Team tab to sync</button>
            </div>
          ) : myAssignees.length === 0 ? (
            <div className={`${card} border rounded-xl p-10 text-center`}>
              <ClipboardList className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
              <p className={`text-sm ${textMuted}`}>You haven't assigned any tasks yet</p>
              <button onClick={() => setViewTab('assign')}
                className="mt-3 text-xs font-semibold text-white px-4 py-2 rounded-lg"
                style={{ background: PINK }}>Assign Tasks</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myAssignees.map(emp => (
                <PersonCard key={emp.emp_id} emp={emp} onOpen={openDrawer}
                  card={card} textPri={textPri} textMuted={textMuted} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeRole === 'delegatee' && (
        <div className="space-y-4">
          {!myEmp ? (
            <div className={`${card} border rounded-xl p-10 text-center`}>
              <AlertTriangle className={`h-10 w-10 mx-auto mb-2 text-yellow-500 opacity-60`} />
              <p className={`text-sm font-medium ${textPri} mb-1`}>Account not linked</p>
              <p className={`text-xs ${textMuted}`}>Your email ({user?.email}) isn't linked to a delegation employee yet.</p>
            </div>
          ) : (
            <>
              {Object.keys(assignerGroups).length > 0 && (
                <div>
                  <p className={`text-xs font-semibold ${textMuted} uppercase tracking-wider mb-2`}>Assigned By</p>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setAssignerFilter('')}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all
                        ${!assignerFilter ? 'text-white border-transparent' : `${card} border ${textMuted} hover:border-[#e94560]/40`}`}
                      style={!assignerFilter ? { background: PINK } : {}}>
                      All · {myTasks.length}
                    </button>
                    {Object.entries(assignerGroups).map(([name, tasks]) => (
                      <button key={name} onClick={() => setAssignerFilter(assignerFilter === name ? '' : name)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95
                          ${assignerFilter === name ? 'text-white border-transparent' : `${card} border ${textMuted} hover:border-[#e94560]/40`}`}
                        style={assignerFilter === name ? { background: PINK } : {}}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ background: assignerFilter === name ? 'rgba(255,255,255,0.3)' : empColor(name) }}>
                          {name[0]?.toUpperCase()}
                        </div>
                        {name}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          assignerFilter === name ? 'bg-white/20 text-white' : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'
                        }`}>{tasks.length}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-sm font-semibold ${textPri}`}>
                    {assignerFilter ? `Tasks from ${assignerFilter}` : 'All My Tasks'}
                    <span className={`ml-2 text-xs font-normal ${textMuted}`}>({filteredMyTasks.length})</span>
                  </p>
                  <div className="flex gap-1">
                    {['', 'pending', 'completed', 'verified'].map(s => (
                      <button key={s} onClick={() => setDrawerStatus(s === drawerStatus ? '' : s)}
                        className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors
                          ${drawerStatus === s && s ? 'text-white' : `${textMuted} hover:bg-[var(--bg-hover)]`}`}
                        style={drawerStatus === s && s ? { background: PINK } : {}}>
                        {s || 'All'}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredMyTasks.length === 0 ? (
                  <div className={`${card} border rounded-xl p-10 text-center`}>
                    <CheckSquare className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
                    <p className={`text-sm ${textMuted}`}>No tasks assigned to you yet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredMyTasks
                      .filter(t => !drawerStatus || t.status === drawerStatus)
                      .map(inst => (
                        <TaskCard key={inst.instance_id} inst={inst}
                          onComplete={completeInst} onImageComplete={handleImageComplete}
                          card={card} textPri={textPri} textMuted={textMuted} textSec={textSec}
                          TODAY={TODAY} />
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ── Visit Tasks Tab ─────────────────────────────────────────────────────────── */
export function DelegationVisitsTab({
  visitTasks, loadVisitTasks, completeInst, nav,
  card, textPri, textMuted, TODAY,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-lg font-semibold ${textPri}`}>Visit-Linked Tasks</h2>
          <p className={`text-xs ${textMuted} mt-0.5`}>Tasks auto-created from visit plans</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/visit-planning')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)]`}>
            <MapPin className="h-3.5 w-3.5" /> Visit Planning
          </button>
          <button onClick={loadVisitTasks} className={`p-2 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)]`}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>
      {visitTasks.length === 0 ? (
        <div className={`${card} border rounded-xl py-16 text-center`}>
          <MapPin className="h-10 w-10 mx-auto mb-2 opacity-30" style={{ color: PINK }} />
          <p className={`text-sm ${textMuted}`}>No visit-linked tasks yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visitTasks.map(inst => (
            <div key={inst.instance_id} className={`${card} border rounded-xl p-4 space-y-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                  <p className={`text-sm font-semibold ${textPri} leading-snug`}>{inst.task_title}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[inst.status]}`}>{inst.status}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={`flex items-center gap-1 ${textMuted}`}><User className="h-3 w-3" />{inst.emp_name}</span>
                <span className={`flex items-center gap-1 ${textMuted}`}><Calendar className="h-3 w-3" />{inst.due_date}</span>
              </div>
              {inst.status === 'pending' && (
                <button onClick={() => completeInst(inst)}
                  className="w-full h-8 rounded-lg text-xs font-semibold text-white" style={{ background: '#10b981' }}>
                  <Check className="h-3.5 w-3.5 inline mr-1" /> Mark Visit Done
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Reports Tab ──────────────────────────────────────────────────────────────── */
export function DelegationReportsTab({
  report, reportPeriod, setRPeriod, loadReport,
  card, textPri, textSec, textMuted,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className={`text-lg font-semibold ${textPri}`}>Completion Report</h2>
        <div className="flex gap-1.5">
          {['daily', 'weekly', 'monthly'].map(p => (
            <button key={p} onClick={() => setRPeriod(p)}
              className={`h-8 px-4 rounded-lg text-xs font-semibold capitalize transition-all ${reportPeriod === p ? 'text-white' : `border border-[var(--border-color)] ${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={reportPeriod === p ? { background: PINK } : {}}>
              {p}
            </button>
          ))}
          <button onClick={loadReport} className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {report && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: 'Total',     value: report.total,                 cls: textPri           },
              { label: 'Completed', value: report.completed,             cls: 'text-blue-500'   },
              { label: 'Verified',  value: report.verified,              cls: 'text-green-500'  },
              { label: 'Pending',   value: report.pending,               cls: 'text-orange-500' },
              { label: 'Overdue',   value: report.overdue,               cls: 'text-red-500'    },
              { label: 'Rate',      value: `${report.completion_rate}%`, cls: `text-[${PINK}]`  },
            ].map(s => (
              <div key={s.label} className={`${card} border rounded-xl p-4 text-center`}>
                <p className={`text-2xl font-black font-mono ${s.cls}`}>{s.value}</p>
                <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
              </div>
            ))}
          </div>
          <div className={`${card} border rounded-xl px-4 py-3 flex items-center gap-4 text-xs ${textMuted}`}>
            <Calendar className="h-3.5 w-3.5" style={{ color: PINK }} />
            <span>Period: <strong className={textSec}>{report.start}</strong> → <strong className={textSec}>{report.end}</strong></span>
            <span className="ml-auto font-semibold capitalize" style={{ color: PINK }}>{report.period}</span>
          </div>
          {report.by_employee?.length > 0 && (
            <div className={`${card} border rounded-xl overflow-hidden`}>
              <div className={`px-4 py-3 border-b border-[var(--border-color)]`}>
                <h3 className={`text-sm font-semibold ${textPri}`}>By Team Member</h3>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)] border-b border-[var(--border-color)]">
                  {['Name','Pending','Completed','Verified','Total','Rate'].map(h => (
                    <th key={h} className={`py-3 px-4 text-left text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {report.by_employee.map(row => {
                    const total = (row.pending||0) + (row.completed||0) + (row.verified||0);
                    const done  = (row.completed||0) + (row.verified||0);
                    const rate  = total ? Math.round(done / total * 100) : 0;
                    return (
                      <tr key={row.name} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                        <td className={`px-4 py-3 font-semibold ${textPri}`}>{row.name}</td>
                        <td className="px-4 py-3 text-orange-500 font-mono text-xs">{row.pending||0}</td>
                        <td className="px-4 py-3 text-blue-500 font-mono text-xs">{row.completed||0}</td>
                        <td className="px-4 py-3 text-green-500 font-mono text-xs">{row.verified||0}</td>
                        <td className={`px-4 py-3 font-mono text-xs ${textSec}`}>{total}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden max-w-24">
                              <div className="h-full rounded-full" style={{ width: `${rate}%`, background: PINK }} />
                            </div>
                            <span className="text-xs font-bold" style={{ color: PINK }}>{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Calendar Tab ──────────────────────────────────────────────────────────────── */
export function DelegationCalendarTab({
  calendarData, calYear, setCalYear, calMonth, setCalMonth, loadCalendar,
  card, textPri, textSec, textMuted, TODAY,
}) {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-lg font-semibold ${textPri}`}>{MONTH_NAMES[calMonth - 1]} {calYear}</h2>
          <p className={`text-xs ${textMuted}`}>All team tasks by date</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(calYear, calMonth - 2, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth() + 1); }}
            className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>‹</button>
          <button onClick={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth() + 1); }}
            className={`h-8 px-3 rounded-lg border border-[var(--border-color)] text-xs font-semibold ${textSec} hover:bg-[var(--bg-hover)]`}>Today</button>
          <button onClick={() => { const d = new Date(calYear, calMonth, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth() + 1); }}
            className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>›</button>
          <button onClick={loadCalendar} className={`h-8 w-8 rounded-lg border border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)] flex items-center justify-center`}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className={`${card} border rounded-xl overflow-hidden`}>
        <div className="grid grid-cols-7 border-b border-[var(--border-color)]">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className={`py-2.5 text-center text-[10px] font-bold uppercase tracking-wider ${textMuted} bg-[var(--bg-primary)]`}>{d}</div>
          ))}
        </div>
        {calendarData && (() => {
          const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
          const daysInMonth = new Date(calYear, calMonth, 0).getDate();
          const cells = [];
          for (let i = 0; i < firstDay; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);
          const weeks = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
          return weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-[var(--border-color)] last:border-0">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="h-24 bg-[var(--bg-primary)] border-r border-[var(--border-color)] last:border-0" />;
                const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const dayTasks = calendarData.days?.[dateStr] || [];
                const isToday = dateStr === TODAY;
                const hasPending = dayTasks.some(t => t.status === 'pending');
                const isPast = dateStr < TODAY && hasPending;
                return (
                  <div key={di} className={`h-24 p-1.5 border-r border-[var(--border-color)] last:border-0 overflow-hidden flex flex-col transition-colors hover:bg-[var(--bg-hover)] ${isToday ? 'bg-[var(--bg-hover)]' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'text-white' : isPast ? 'text-red-500' : textSec}`}
                        style={isToday ? { background: PINK } : {}}>{day}</span>
                      {dayTasks.length > 0 && (
                        <span className={`text-[9px] font-bold px-1 rounded ${hasPending ? 'text-orange-500 bg-orange-500/10' : 'text-green-500 bg-green-500/10'}`}>
                          {dayTasks.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 overflow-hidden flex-1">
                      {dayTasks.slice(0, 3).map(t => (
                        <div key={t.instance_id}
                          className={`text-[9px] px-1.5 py-0.5 rounded truncate font-medium leading-tight
                            ${t.status === 'verified'  ? 'bg-green-500/15 text-green-600' :
                              t.status === 'completed' ? 'bg-blue-500/15 text-blue-600'   :
                              t.priority === 'high'    ? 'bg-red-500/15 text-red-600'     :
                              t.priority === 'medium'  ? 'bg-amber-500/15 text-amber-600' :
                                                         'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}
                          title={`${t.task_title} — ${t.emp_name}`}>
                          {t.task_title}
                        </div>
                      ))}
                      {dayTasks.length > 3 && <p className={`text-[9px] ${textMuted} pl-1`}>+{dayTasks.length - 3} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

/* ── Person Drawer ───────────────────────────────────────────────────────────── */
export function DelegationPersonDrawer({
  drawer, setDrawer,
  drawerTasks, drawerLoading, drawerFiltered,
  drawerSearch, setDrawerSearch,
  drawerStatus, setDrawerStatus,
  completeInst, verifyInst, reopenInst, onEditTask, onReassign,
  card, textPri, textSec, textMuted, inputCls, TODAY,
}) {
  if (!drawer) return null;

  function empColor(id = '') {
    const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return `hsl(${(n * 47) % 360}, 55%, 42%)`;
  }
  function empInitials(name = '') {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  }

  const PRIORITY_STYLE_LOCAL = {
    high:   { dot: 'bg-red-500',   badge: 'bg-red-500/15 text-red-500 border-red-500/20' },
    medium: { dot: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-500 border-amber-500/20' },
    low:    { dot: 'bg-green-500', badge: 'bg-green-500/15 text-green-500 border-green-500/20' },
  };
  const FREQ_STYLE_LOCAL = {
    daily: 'bg-violet-500/15 text-violet-400', weekly: 'bg-cyan-500/15 text-cyan-400',
    monthly: 'bg-rose-500/15 text-rose-400', onetime: 'bg-[var(--bg-hover)] text-[var(--text-muted)]',
    custom: 'bg-[var(--bg-hover)] text-[var(--text-muted)]',
  };
  const STATUS_STYLE_LOCAL = {
    pending: 'bg-orange-500/15 text-orange-500', completed: 'bg-blue-500/15 text-blue-500', verified: 'bg-green-500/15 text-green-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={() => setDrawer(null)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className={`relative w-full max-w-lg bg-[var(--bg-card)] border-l border-[var(--border-color)] flex flex-col shadow-2xl overflow-hidden`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
          <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
            style={{ background: empColor(drawer.emp_id) }}>
            {empInitials(drawer.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-semibold ${textPri} truncate`}>{drawer.name}</p>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {(drawer.roles || []).map(r => (
                <span key={r} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize"
                  style={{ background: PINK + '18', color: PINK }}>{r}</span>
              ))}
            </div>
          </div>
          <button onClick={() => setDrawer(null)} className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted}`}>
            <Eye className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 px-5 py-3 border-b border-[var(--border-color)]">
          {[
            { label: 'Pending',   value: drawerTasks.filter(t => t.status === 'pending').length,   cls: 'text-orange-500' },
            { label: 'Completed', value: drawerTasks.filter(t => t.status === 'completed').length, cls: 'text-blue-500'   },
            { label: 'Verified',  value: drawerTasks.filter(t => t.status === 'verified').length,  cls: 'text-green-500'  },
            { label: 'Overdue',   value: drawerTasks.filter(t => t.status === 'pending' && t.due_date < TODAY).length, cls: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-xl py-2.5 text-center`}>
              <p className={`text-lg font-black font-mono ${s.cls}`}>{s.value}</p>
              <p className={`text-[9px] ${textMuted}`}>{s.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-color)]">
          <div className="relative flex-1">
            <Eye className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${textMuted}`} />
            <input value={drawerSearch} onChange={e => setDrawerSearch(e.target.value)}
              placeholder="Search tasks…"
              className={`w-full pl-8 h-8 text-xs rounded-md border px-2 focus:outline-none ${inputCls}`} />
          </div>
          <select value={drawerStatus} onChange={e => setDrawerStatus(e.target.value)}
            className={`h-8 px-2 text-xs rounded-lg border border-[var(--border-color)] ${inputCls}`}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="verified">Verified</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {drawerLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
            </div>
          ) : drawerFiltered.length === 0 ? (
            <div className="text-center py-16">
              <CheckSquare className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
              <p className={`text-sm ${textMuted}`}>No tasks found</p>
            </div>
          ) : drawerFiltered.map(inst => {
            const p = PRIORITY_STYLE_LOCAL[inst.priority] || PRIORITY_STYLE_LOCAL.medium;
            const isOverdue = inst.status === 'pending' && inst.due_date < TODAY;
            return (
              <div key={inst.instance_id} className={`${card} border rounded-xl overflow-hidden`}>
                <div className={`h-0.5 ${p.dot}`} />
                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.badge} capitalize`}>{inst.priority}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${FREQ_STYLE_LOCAL[inst.frequency] || FREQ_STYLE_LOCAL.onetime}`}>{inst.frequency}</span>
                        {inst.requires_image && <Camera className={`h-3 w-3 ${textMuted}`} />}
                      </div>
                      <p className={`text-sm font-semibold ${textPri} leading-snug`}>{inst.task_title}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE_LOCAL[inst.status]}`}>{inst.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-semibold' : textMuted}`}>
                      <Calendar className="h-3 w-3" />
                      {inst.due_date === TODAY ? 'Today' : inst.due_date}
                      {isOverdue && ' — Overdue'}
                    </span>
                    {inst.delegator_name && (
                      <span className={`flex items-center gap-1 ${textMuted}`}>
                        <UserCheck className="h-3 w-3" />{inst.delegator_name}
                      </span>
                    )}
                    {inst.buddy_name && (
                      <span className={`flex items-center gap-1 ${textMuted}`} title="Backup owner">
                        <Users className="h-3 w-3" />Backup: {inst.buddy_name}
                      </span>
                    )}
                    {inst.completed_by === 'buddy' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                        done by buddy
                      </span>
                    )}
                  </div>
                </div>
                <div className="border-t border-[var(--border-color)] flex">
                  {inst.status === 'pending' && (
                    <button onClick={() => completeInst(inst)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-white hover:opacity-90"
                      style={{ background: '#10b981' }}>
                      <Check className="h-3.5 w-3.5" /> Mark Done
                    </button>
                  )}
                  {inst.status === 'completed' && (
                    <button onClick={() => verifyInst(inst.instance_id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-blue-500 hover:bg-blue-500/10">
                      <Eye className="h-3.5 w-3.5" /> Verify
                    </button>
                  )}
                  {inst.status !== 'pending' && (
                    <button onClick={() => reopenInst(inst.instance_id)}
                      className={`px-4 flex items-center justify-center gap-1.5 py-2.5 text-xs ${textMuted} hover:bg-[var(--bg-hover)] border-l border-[var(--border-color)]`}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </button>
                  )}
                  {onEditTask && (
                    <button onClick={() => onEditTask(inst)}
                      className={`px-4 flex items-center justify-center gap-1.5 py-2.5 text-xs ${textMuted} hover:bg-[var(--bg-hover)] border-l border-[var(--border-color)]`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  {onReassign && inst.status === 'pending' && (
                    <button onClick={() => onReassign(inst)}
                      className={`px-4 flex items-center justify-center gap-1.5 py-2.5 text-xs ${textMuted} hover:bg-[var(--bg-hover)] border-l border-[var(--border-color)]`}>
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Reassign
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
