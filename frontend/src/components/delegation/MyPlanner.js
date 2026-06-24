import React, { useMemo, useState } from 'react';
import {
  Check, Pencil, ArrowRightLeft, Flame, Sun, Sparkles,
  CalendarDays, LifeBuoy, ChevronLeft, ChevronRight,
} from 'lucide-react';

const PINK = '#e94560';
const GREEN = '#10b981';
const AMBER = '#f59e0b';

// "14:30" → "2:30 PM"; blank → ''
const fmtTime = (t) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':');
  const hh = +h, ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${m} ${ap}`;
};

/* ── date helpers (local, no deps) ───────────────────────────────────────── */
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const weekdayShort = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
const dayNum = (s) => new Date(s + 'T00:00:00').getDate();
const DONE = (t) => t.status === 'completed' || t.status === 'verified';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* streak = consecutive prior days (ending today) where every due task was done.
   Days with no tasks are skipped (neutral); the first day with an open task stops it. */
function computeStreak(tasks, today) {
  const byDay = {};
  tasks.forEach(t => { (byDay[t.due_date] ||= []).push(t); });
  let streak = 0;
  let cursor = today;
  for (let i = 0; i < 60; i++) {
    const list = byDay[cursor];
    if (list && list.length) {
      if (list.every(DONE)) streak += 1;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ── tiny presentational atoms ───────────────────────────────────────────── */
function ProgressRing({ done, total, textMuted }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: 76, height: 76 }}>
      <svg width="76" height="76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border-color)" strokeWidth="7" />
        <circle cx="38" cy="38" r={r} fill="none" stroke={pct === 100 ? GREEN : PINK}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100}
          style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black font-mono" style={{ color: pct === 100 ? GREEN : 'var(--text-primary)' }}>{pct}%</span>
        <span className={`text-[9px] ${textMuted}`}>{done}/{total}</span>
      </div>
    </div>
  );
}

function PriorityDot({ p }) {
  const c = p === 'high' ? PINK : p === 'low' ? GREEN : AMBER;
  return <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />;
}

/* ── task card ───────────────────────────────────────────────────────────── */
function TaskCard({ inst, idx, isBuddy, today, actions, card, textPri, textSec, textMuted }) {
  const overdue = inst.status === 'pending' && inst.due_date < today;
  const done = DONE(inst);
  const outcome = inst.status === 'pending' && ['not_done', 'partial'].includes(inst.last_outcome) ? inst.last_outcome : null;
  const lastSub = outcome ? (inst.submissions || []).filter(s => s.outcome === outcome).slice(-1)[0] : null;

  return (
    <div className={`${card} border rounded-xl p-3 flex items-center gap-3 group`}
      style={{ animation: `planner-rise .35s ease both`, animationDelay: `${idx * 35}ms`,
               borderColor: overdue ? AMBER + '55' : undefined }}>
      <PriorityDot p={inst.priority} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? `line-through ${textMuted}` : textPri} truncate`}>{inst.task_title}</p>
        <div className={`flex items-center gap-2 mt-0.5 text-[11px] ${textMuted} flex-wrap`}>
          <span>{inst.due_date === today ? 'Today' : inst.due_date}{inst.due_time ? ` · ${fmtTime(inst.due_time)}` : ''}</span>
          {isBuddy && <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">backup for {inst.emp_name}</span>}
          {inst.delegator_name && <span>· from {inst.delegator_name}</span>}
          {done && <span style={{ color: GREEN }}>· done{inst.completed_by === 'buddy' ? ' by buddy' : ''}</span>}
          {outcome && (
            <span title={lastSub?.note || ''}
              className={`px-1.5 py-0.5 rounded ${outcome === 'partial' ? 'bg-amber-500/15 text-amber-600' : 'bg-red-500/15 text-red-500'}`}>
              {outcome === 'partial' ? `partial${lastSub?.expected_date ? ` · by ${lastSub.expected_date}` : ''}` : 'reported not done'}
            </span>
          )}
        </div>
      </div>

      {inst.status === 'pending' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => actions.onSubmit(inst)} title="Submit task"
            className="h-8 px-3 rounded-lg flex items-center justify-center gap-1 text-white text-xs font-semibold" style={{ background: GREEN }}>
            <Check className="h-3.5 w-3.5" /> Submit
          </button>
          {!isBuddy && (
            <>
              <button onClick={() => actions.onEdit(inst)} title="Edit"
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${textMuted} hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => actions.onReassign(inst)} title="Request reassignment"
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${textMuted} hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity`}>
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── main planner ────────────────────────────────────────────────────────── */
export default function MyPlanner({
  myEmp, plannerTasks = [], buddyTasks = [], loading, TODAY,
  onSubmit, onEditTask, onReassign,
  card, textPri, textSec, textMuted,
}) {
  const [mode, setMode] = useState('day');           // 'day' | 'week'
  const [weekStart, setWeekStart] = useState(TODAY);

  const actions = {
    onSubmit,
    onEdit: onEditTask,
    onReassign,
  };

  const day = useMemo(() => {
    const todays = plannerTasks.filter(t => t.due_date === TODAY);
    const overdue = plannerTasks.filter(t => t.status === 'pending' && t.due_date < TODAY)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const pord = { high: 0, medium: 1, low: 2 };
    const sortP = (a, b) => (pord[a.priority] ?? 1) - (pord[b.priority] ?? 1);
    const focus = todays.filter(t => t.status === 'pending').sort(sortP);
    const doneToday = todays.filter(DONE).sort(sortP);
    const myBuddyToday = buddyTasks.filter(
      t => t.status === 'pending' && t.due_date <= TODAY);
    return {
      todays, overdue, focus, doneToday, myBuddyToday,
      done: todays.filter(DONE).length, total: todays.length,
      streak: computeStreak(plannerTasks, TODAY),
    };
  }, [plannerTasks, buddyTasks, TODAY]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const list = plannerTasks.filter(t => t.due_date === d);
      return { date: d, list, done: list.filter(DONE).length };
    });
  }, [plannerTasks, weekStart]);

  if (!myEmp) {
    return (
      <div className={`${card} border rounded-xl text-center py-16`}>
        <Sun className={`h-10 w-10 mx-auto mb-2 opacity-20 ${textMuted}`} />
        <p className={`text-sm ${textMuted}`}>Your personal planner appears once your account is linked to the team.</p>
      </div>
    );
  }

  const allClear = day.total > 0 && day.done === day.total;

  return (
    <div className="space-y-4">
      <style>{`@keyframes planner-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>

      {/* Hero */}
      <div className={`${card} border rounded-2xl p-5 flex items-center gap-5 flex-wrap`}
        style={{ background: `linear-gradient(135deg, ${PINK}0d, transparent 60%)` }}>
        <ProgressRing done={day.done} total={day.total} textMuted={textMuted} />
        <div className="flex-1 min-w-[180px]">
          <p className={`text-xs ${textMuted}`}>{greeting()}, {(myEmp.name || '').split(' ')[0]}</p>
          <h2 className={`text-xl font-bold ${textPri} tracking-tight`}>
            {day.total === 0 ? 'Nothing scheduled today'
              : allClear ? 'Today is all done — nice work'
              : `${day.focus.length} ${day.focus.length === 1 ? 'task' : 'tasks'} to focus on`}
          </h2>
          <div className="flex items-center gap-3 mt-2">
            {day.streak > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: AMBER }}>
                <Flame className="h-3.5 w-3.5" /> {day.streak}-day streak
              </span>
            )}
            {day.overdue.length > 0 && (
              <span className="flex items-center gap-1 text-xs" style={{ color: AMBER }}>
                <Sparkles className="h-3.5 w-3.5" /> {day.overdue.length} need{day.overdue.length === 1 ? 's' : ''} attention
              </span>
            )}
          </div>
        </div>

        {/* Day / Week toggle */}
        <div className={`${card} border rounded-xl p-1 flex gap-0.5 self-start`}>
          {[['day', 'My Day', Sun], ['week', 'My Week', CalendarDays]].map(([m, label, Icon]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${mode === m ? 'text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              style={mode === m ? { background: PINK } : {}}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-7 w-7 border-4 border-[#e94560] border-t-transparent" />
        </div>
      )}

      {/* ── MY DAY ── */}
      {!loading && mode === 'day' && (
        <div className="space-y-5">
          {/* Needs attention (gentle) */}
          {day.overdue.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: AMBER }}>
                <Sparkles className="h-3.5 w-3.5" /> Needs attention
              </h3>
              <div className="space-y-2">
                {day.overdue.map((t, i) => (
                  <TaskCard key={t.instance_id} inst={t} idx={i} today={TODAY} actions={actions}
                    card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
                ))}
              </div>
            </section>
          )}

          {/* Today's focus */}
          <section>
            <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textMuted}`}>Today’s focus</h3>
            {day.focus.length === 0 ? (
              <div className={`${card} border rounded-xl text-center py-10`}>
                <Check className="h-8 w-8 mx-auto mb-2" style={{ color: GREEN, opacity: .6 }} />
                <p className={`text-sm ${textMuted}`}>{day.total === 0 ? 'No tasks scheduled for today.' : 'Everything for today is done.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {day.focus.map((t, i) => (
                  <TaskCard key={t.instance_id} inst={t} idx={i} today={TODAY} actions={actions}
                    card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
                ))}
              </div>
            )}
          </section>

          {/* Done today */}
          {day.doneToday.length > 0 && (
            <section>
              <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textMuted}`}>Completed today · {day.doneToday.length}</h3>
              <div className="space-y-2 opacity-70">
                {day.doneToday.map((t, i) => (
                  <TaskCard key={t.instance_id} inst={t} idx={i} today={TODAY} actions={actions}
                    card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
                ))}
              </div>
            </section>
          )}

          {/* Backing up */}
          {day.myBuddyToday.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5 text-violet-400">
                <LifeBuoy className="h-3.5 w-3.5" /> Backing up
              </h3>
              <div className="space-y-2">
                {day.myBuddyToday.map((t, i) => (
                  <TaskCard key={t.instance_id} inst={t} idx={i} isBuddy today={TODAY} actions={actions}
                    card={card} textPri={textPri} textSec={textSec} textMuted={textMuted} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── MY WEEK ── */}
      {!loading && mode === 'week' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setWeekStart(s => addDays(s, -7))}
              className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className={`text-sm font-semibold ${textPri}`}>
              {weekStart} → {addDays(weekStart, 6)}
            </span>
            <button onClick={() => setWeekStart(s => addDays(s, 7))}
              className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
            {weekDays.map((d, di) => {
              const isToday = d.date === TODAY;
              const load = d.list.length;
              return (
                <div key={d.date}
                  className={`${card} border rounded-xl p-2.5 min-h-[120px] flex flex-col`}
                  style={{ animation: 'planner-rise .35s ease both', animationDelay: `${di * 40}ms`,
                           borderColor: isToday ? PINK : undefined }}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className={`text-[10px] uppercase font-semibold ${isToday ? '' : textMuted}`}
                      style={isToday ? { color: PINK } : {}}>{weekdayShort(d.date)}</span>
                    <span className={`text-sm font-bold ${isToday ? '' : textSec}`} style={isToday ? { color: PINK } : {}}>{dayNum(d.date)}</span>
                  </div>
                  {/* load bar */}
                  <div className="h-1 rounded-full bg-[var(--bg-hover)] mb-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: load ? `${Math.round((d.done / load) * 100)}%` : '0%',
                      background: load && d.done === load ? GREEN : PINK,
                    }} />
                  </div>
                  <div className="space-y-1 flex-1">
                    {d.list.slice(0, 4).map(t => (
                      <div key={t.instance_id}
                        className={`text-[11px] px-1.5 py-1 rounded truncate flex items-center gap-1 ${DONE(t) ? `line-through ${textMuted}` : textSec}`}
                        style={{ background: 'var(--bg-hover)' }}>
                        <PriorityDot p={t.priority} /> <span className="truncate">{t.task_title}</span>
                      </div>
                    ))}
                    {load > 4 && <p className={`text-[10px] ${textMuted}`}>+{load - 4} more</p>}
                    {load === 0 && <p className={`text-[10px] ${textMuted} opacity-50`}>—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
