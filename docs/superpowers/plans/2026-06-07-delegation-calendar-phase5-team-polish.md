# Delegation Calendar — Phase 5 (Team Picker + Polish) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Let bosses/delegators view a team member's calendar via a header picker (read-only for that person — no plan-block creation when viewing others), and apply a tasteful visual polish pass to the calendar within the app's existing design system.

**Architecture:** Hook loads the actor's delegation context once → exposes `teamOptions` + `canViewTeam`; the existing `subjectEmp`/`setSubjectEmp` already re-fetch the agenda for the chosen person. `DelegationCalendar` adds the picker + a "viewing X" banner and hides block-creation when `subjectEmp` is set (plan blocks belong to the logged-in user). Polish = header layout, today emphasis, empty states, subtle reveal animation — consistent with the pink/`#e94560` dark theme.

**Tech Stack:** React/CRA. Verify with `DISABLE_ESLINT_PLUGIN=true react-scripts build`.

---

### Task 1: Team picker + polish

**Files:** `frontend/src/hooks/useDelegationCalendar.js`, `frontend/src/components/delegation/calendar/DelegationCalendar.js`.

- [ ] **Step 1: Hook — load team options**

In `useDelegationCalendar.js` add state + an effect (uses existing `delApi` import which has `myContext` and `employees.list`):
```javascript
  const [teamOptions, setTeamOptions] = useState([]);
  const [canViewTeam, setCanViewTeam] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ctx = (await delApi.myContext()).data || {};
        const roles = ctx.roles || [];
        if (roles.includes('boss')) {
          const emps = (await delApi.employees.list()).data || [];
          setTeamOptions(emps.map(e => ({ emp_id: e.emp_id, name: e.name })));
          setCanViewTeam(true);
        } else if (roles.includes('delegator') && (ctx.target_employees || []).length) {
          setTeamOptions(ctx.target_employees.map(e => ({ emp_id: e.emp_id, name: e.name })));
          setCanViewTeam(true);
        }
      } catch { /* not linked / no team */ }
    })();
  }, []);
```
Add `teamOptions, canViewTeam` to the returned object (alongside the existing `subjectEmp, setSubjectEmp`).

- [ ] **Step 2: DelegationCalendar — picker, banner, guard, polish**

In `DelegationCalendar.js`:
(a) **Team picker** in the header (right cluster, before the view switch). Only when `c.canViewTeam`:
```javascript
        {c.canViewTeam && (
          <select value={c.subjectEmp} onChange={(e) => c.setSubjectEmp(e.target.value)}
            className={`h-9 px-2.5 rounded-lg text-xs border border-[var(--border-color)] ${inputCls}`}>
            <option value="">My calendar</option>
            {c.teamOptions.map(o => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}
          </select>
        )}
```
(`inputCls` is already a prop.)
(b) **Viewing banner** + **guard block-add**: when `c.subjectEmp` is set, show a small banner and DON'T render the header "Block" button. Wrap the existing day-view "Block" button condition `c.view === 'day'` to also require `!c.subjectEmp`. Add the banner right under the header row:
```javascript
        {c.subjectEmp && (
          <div className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-2"
            style={{ background: '#e9456012', color: '#e94560' }}>
            Viewing {(c.teamOptions.find(o => o.emp_id === c.subjectEmp) || {}).name || 'team member'}'s calendar (read-only).
          </div>
        )}
```
Also pass `readOnly={!!c.subjectEmp}` to `CalendarDay` and inside `CalendarDay` hide the per-hour "+" add button and disable drag when `readOnly` is true. (Add `readOnly` to CalendarDay's props; guard `onAddBlock` button with `{!readOnly && (...)}` and set `draggable={isBlock && !readOnly}` / skip `onDropItem`/`onMoveBlock` handlers when readOnly.)
(c) **Polish:**
  - Add a subtle reveal: wrap the month/day/week body in a `div` with `key={c.view + c.range.from}` and className `cal-reveal`, and inject once:
    `<style>{`@keyframes calReveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}} .cal-reveal{animation:calReveal .2s ease both}`}</style>`
  - Make the header title weight `font-bold` and add `tracking-tight`.
  - Ensure the source-chip row wraps cleanly and is slightly tighter (`gap-1.5`, already).

- [ ] **Step 3: Build** — `cd "f:/SMARTSHAPE APP/frontend" && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build 2>&1 | grep -E "Compiled|Failed|Error|Module not found" | head` → `Compiled successfully.`; `rm -rf build`. Fix & rebuild on error.

- [ ] **Step 4: Commit** — `git add frontend/src/hooks/useDelegationCalendar.js frontend/src/components/delegation/calendar/DelegationCalendar.js frontend/src/components/delegation/calendar/CalendarDay.js && git commit -m "feat(delegation): calendar team-member picker (read-only) + polish"`

---

## Self-Review (Phase 5)
- **Spec coverage:** §7 team viewing (picker → `subjectEmp` → agenda reload; backend already enforces auth + hides others' plan blocks); read-only guard prevents creating personal blocks while viewing others. Polish pass within existing design system.
- **Placeholders:** none.
- **Type consistency:** `teamOptions:[{emp_id,name}]`, `canViewTeam:bool`, `subjectEmp` string; `CalendarDay` gains `readOnly` prop, guarded consistently.
