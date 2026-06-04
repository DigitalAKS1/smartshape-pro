# Delegation System Overhaul — Design Spec

**Date:** 2026-06-04
**Module:** SmartShape Pro — Delegation Management System
**Status:** Approved for planning

---

## 1. Problem & Goals

The Delegation System lets bosses/delegators assign tasks to delegatees, who execute and
(optionally) get verified. Today it has a hard bug and several missing capabilities:

1. **Tasks won't update** — the central complaint. Two stacked causes:
   - There is **no edit UI** for a task after creation.
   - `PUT /delegation/tasks/{id}` ([delegation_routes.py:433](../../../backend/routes/delegation_routes.py#L433))
     accepts only `title, description, priority, score, require_verification, is_active`.
     Assignees, dates, frequency, and task type cannot be changed — and **no edit
     propagates to already-generated instances**.
2. **No reassignment** — unlike CRM leads, a task instance cannot be handed to another person.
3. **Buddy is a dead field** — `buddy_emp_id` exists on employees but is never used.
4. **No personal planning view** — users cannot see "what's on my plate today / this week."
5. **Tone is task-tracking, not people-management** — no focus/momentum framing, no workload
   visibility to prevent overloading one person.

**Goal:** Fix updating, add a clean edit-permission model, reassignment-with-approval, buddy
backup coverage, and a redesigned personal planner — all framed around healthy task-management
psychology so the tool supports a smooth working culture rather than feeling like surveillance.

### Non-goals (YAGNI)
- No new auth provider / SSO work. Reuses existing `get_current_user`.
- No real-time push/websockets. In-app notifications are polled (an `is_read` flag), consistent
  with the current app.
- No analytics warehouse. Reports stay aggregate queries as today.
- No changes to the CRM task system (`tasks` collection) — out of scope.

---

## 2. Core architectural insight: Task vs. Instance

The system already separates the **task definition** (`del_tasks`) from per-person, per-date
**instances** (`del_task_instances`). The whole edit-permission model rides on this split:

| Actor | Edits | Mechanism | Approval |
|-------|-------|-----------|----------|
| **Delegatee** (instance owner) | Their own instance: status, completion note, proof image, **and** soft details — `due_date`, `priority` | `PATCH /instances/{id}` (logged) | None |
| **Delegator / boss** (task owner) | The task definition: title, description, dates, frequency, assignees, etc. — **propagated to pending instances** | `PUT /tasks/{id}` (expanded) | None |
| **Anyone** | Move an instance to a different person | Reassignment request → approval | Delegator **or** boss/manager |

**Decisions locked in brainstorming:**
- Delegatee edit rights = **progress + soft details** (cannot change who it's assigned to).
- Reassignment approver = **delegator OR manager/boss** (either can approve — no single bottleneck).
- Buddy = **backup owner** (sees the task, can complete it if the main owner is unavailable).
- Daily/weekly = a dedicated **personal My Day / My Week planner** as the landing view.

---

## 3. Data Model Changes

### 3.1 `del_tasks` — add fields
- `buddy_emp_id: str = ""` — optional backup person for the whole task.
- `updated_at`, `updated_by` — set on every task edit.

### 3.2 `del_task_instances` — add fields
- `buddy_emp_id: str = ""`, `buddy_name: str = ""` — backup for this instance (inherited from task, overridable).
- `completed_by: str = ""` — `"owner"` or `"buddy"` (who actually closed it).
- `change_log: List[dict]` — append-only audit of soft edits & reassignments. Each entry:
  `{ "at": iso, "by": email, "field": str, "from": any, "to": any, "note": str }`.
- `reassignment_count: int = 0` — mirrors the CRM-lead pattern; surfaced as a "frequent handoff"
  cue when > 2.
- `updated_at` — set on any instance mutation.

### 3.3 New collection: `del_reassign_requests`
```
request_id        (PK, gen_id("rr"))
instance_id       FK -> del_task_instances
task_id           (denormalised for listing)
task_title
from_emp_id, from_emp_name      # current owner
to_emp_id,   to_emp_name        # proposed new owner
requested_by      (email)
requested_by_name
reason            (required, non-empty)
status            "pending" | "approved" | "rejected"
approver          (email, set on decision)
approver_name
decided_at        (iso or null)
decision_note     (optional)
created_at
```

### 3.4 New collection: `del_notifications`
A lightweight in-app inbox (polled). Used for: reassignment requested / approved / rejected,
task reassigned to you, buddy added, verification done.
```
notif_id    (PK)
emp_id      (recipient)
type        "reassign_requested" | "reassign_decided" | "assigned" | "buddy_added" | "verified"
title, body
link_instance_id  (optional)
is_read     bool
created_at
```

### Migration / back-compat
All new fields are additive with safe defaults. Existing documents read fine; defaults are
applied lazily on read (helper `_inst_defaults(inst)`) and persisted on next write. No destructive
migration script required.

---

## 4. Backend API Changes (`backend/routes/delegation_routes.py`)

### 4.1 Fix task update + propagation
`PUT /delegation/tasks/{task_id}` — expand the whitelist to:
`title, description, priority, score, require_verification, requires_image, is_active,
task_type, frequency, target_date, start_date, end_date, assignee_ids, buddy_emp_id`.

On update:
1. Set `updated_at`, `updated_by`.
2. **Propagate to pending instances** of this task (status `pending` only — never touch
   `completed`/`verified`):
   - Field edits (title, priority, score, require_verification, requires_image, buddy) → `$set`
     on matching pending instances.
   - **Assignee change** → diff old vs new `assignee_ids`: create instances for added assignees
     (same dates as the task); **hard-delete only the `pending` instances** of removed assignees
     (they carry no history). `completed`/`verified` instances of removed assignees are **retained**
     for history.
   - **Date/frequency change** → regenerate the *pending* instance set for the new schedule;
     keep completed instances. (Documented helper: `_resync_pending_instances(task)`.)
3. Return the updated task.

### 4.2 Delegatee soft-edit
`PATCH /delegation/instances/{instance_id}` — allowed fields: `due_date`, `priority`,
`completion_note`. Each change appends a `change_log` entry and sets `updated_at`. Returns the
updated instance. (Status transitions keep their dedicated endpoints: complete/verify/reopen.)

### 4.3 Buddy completion
- `complete` / `complete-with-image` accept an optional `as_buddy: bool` (or infer from caller's
  emp_id vs instance owner/buddy). Set `completed_by = "buddy" | "owner"`.
- `GET /instances` gains a `buddy_emp_id` filter so a user's planner can pull "tasks I'm backup for."

### 4.4 Reassignment with approval
- `POST /delegation/instances/{instance_id}/reassign-request` — body `{ to_emp_id, reason }`.
  Validates reason non-empty and `to_emp_id` is an active employee. Creates a
  `del_reassign_requests` doc (`pending`) and notifies the delegator + all bosses/managers.
- `GET /delegation/reassign-requests?status=&approver_scope=` — list (for the approvals inbox).
  A user sees requests they can act on: ones for tasks they delegate, plus all if boss.
- `POST /delegation/reassign-requests/{request_id}/decide` — body `{ decision: "approved"|"rejected", note? }`.
  - **Authorization:** caller must be the task's `delegator` **or** hold a `boss` role. Otherwise 403.
  - On **approved**: set instance `emp_id`/`emp_name` to the new owner, increment
    `reassignment_count`, append `change_log`, notify both parties.
  - On **rejected**: record decision, notify requester.
- `del_reassign_requests` indexed on `status`, `instance_id`.

### 4.5 Notifications
- `GET /delegation/notifications?unread_only=` — current user's inbox.
- `POST /delegation/notifications/{id}/read` and `POST /delegation/notifications/read-all`.
- Internal helper `_notify(emp_id, type, title, body, link_instance_id=None)`.

### 4.6 Authorization helper (light RBAC)
Add `_resolve_actor(user)` → `{ emp_id, roles, is_boss, delegates_to: [...] }` from
`del_employees`. Used to gate `decide` (boss or delegator) and to scope inbox lists. Falls back to
boss-level when the user isn't linked (matches current `my-context` behavior). This closes the
"any authenticated user can approve anything" gap **for the new endpoints**; broad RBAC retrofit of
all existing endpoints stays out of scope.

---

## 5. Frontend Changes

### 5.1 New / changed files
- **`hooks/useDelegationApp.js`** — add: `updateTask`, `patchInstance`, `reassignRequest`,
  `decideReassign`, `loadReassignRequests`, `loadNotifications`, `markNotifRead`, buddy-aware
  instance loading. Add `myDay`/`myWeek` selectors.
- **`components/delegation/EditTaskDialog.js`** *(new)* — the missing edit UI. Used by both
  delegator (full task edit) and delegatee (soft-edit subset, fields disabled by role). Mirrors
  `DelegationTaskForm` field set; role-gates which inputs are editable.
- **`components/delegation/ReassignTaskDialog.js`** *(new)* — modeled on
  [ReassignLeadDialog.jsx](../../../frontend/src/components/ReassignLeadDialog.jsx): pick new owner,
  mandatory reason, warn if `reassignment_count > 2`. Submits a request (not an instant move).
- **`components/delegation/ApprovalsInbox.js`** *(new)* — pending reassign requests with
  Approve/Reject + note; visible to delegators/bosses.
- **`components/delegation/MyPlanner.js`** *(new)* — the **My Day / My Week** personal landing
  view (see §6).
- **`components/delegation/NotificationsBell.js`** *(new)* — polled unread count + dropdown.
- **`pages/admin/DelegationApp.js`** — add Planner as the default tab for delegatees; add Approvals
  tab for delegators/bosses; mount notifications bell.
- **`lib/api.js`** — extend `delApi` with the new endpoints.

### 5.2 Buddy in the assign form
`DelegationTaskForm` and `EditTaskDialog` gain a **Buddy** picker (single optional person) per
task row. Planner shows tasks where the user is buddy under a **"Backing up"** section with a
clear "Complete for {owner}" action.

---

## 6. Redesign — My Day / My Week + Psychology Layer (`/frontend-design`)

The redesign is the `frontend-design` skill's job at build time; this spec fixes **what** it shows
and the behavioral framing, not pixel-level styling.

### 6.1 My Day (default landing for a delegatee)
- **Today's focus**: today's instances, ordered high → low priority, overdue surfaced gently at top
  as "Needs attention" (not an angry red dump).
- **Progress ring**: completed / total today → a small win signal.
- **Streak**: consecutive days with all tasks done → momentum cue.
- **Backing up**: tasks where the user is buddy (collapsible, lower visual weight).
- Quick actions inline: complete, complete-with-photo, soft-edit, request reassign.

### 6.2 My Week
- 7-column week grid (or list grouped by day) of the user's instances.
- Per-day load indicator; the week shows where the user is heavy/light.
- Drag-free: soft-editing a due date moves a task between days (uses `PATCH /instances`).

### 6.3 Delegator/boss workload view
- When assigning (form) and in team overview: a **per-person open-task count** so a delegator can
  see who is overloaded before piling on more, with a hint to assign or buddy elsewhere.

### 6.4 Psychology principles (applied, not decorative)
- **Focus over backlog**: lead with "today," not the full overdue list.
- **Recognition over surveillance**: verification framed as "Reviewed & appreciated," streaks and
  progress celebrate completion.
- **Transparency over blame**: reassignment always carries a reason and is logged; frequent-handoff
  warning prompts a conversation, not punishment.
- **Coverage over heroics**: buddy backup makes it normal to have a safety net when someone's out.
- **Workload fairness**: visibility into per-person load discourages overloading one reliable person.

---

## 7. Error Handling & Edge Cases
- Reassign request to the **current owner** → reject with 400.
- Reassign on a **completed/verified** instance → 400 ("task already done").
- Approving a request whose instance was meanwhile completed → 409, mark request stale.
- Editing a task that has **only completed instances** → allowed for definition fields, but no
  pending instances to propagate to; surface "changes apply to future instances only."
- Buddy completion when no buddy set → 403.
- Soft-edit by a non-owner non-buddy → 403.
- Empty reason on reassign → 400.

## 8. Testing Strategy
Follow TDD per task. Backend (pytest, mirroring existing test setup):
- Task update propagation: field edit reaches pending instances, leaves completed untouched;
  assignee add/remove creates/removes pending instances; date/frequency resync.
- `PATCH /instances` logs change, gates by owner/buddy.
- Reassign request lifecycle: create → list scoped → approve moves owner + increments count;
  reject path; authorization (non-delegator non-boss → 403); stale-instance 409.
- Buddy completion sets `completed_by`.
- Notifications created on each event; read flips `is_read`.

Frontend: component tests for EditTaskDialog role-gating, ReassignTaskDialog reason-required,
ApprovalsInbox approve/reject calls, MyPlanner grouping (today/week/backing-up).

## 9. Build Sequence (all 5 parts, in order)
1. **Part 1 — Update fix:** expand `PUT /tasks`, add propagation + `_resync_pending_instances`,
   `PATCH /instances`, `EditTaskDialog`. *(Resolves the reported bug.)*
2. **Part 2 — Reassignment+approval:** `del_reassign_requests`, request/list/decide endpoints,
   `ReassignTaskDialog`, `ApprovalsInbox`, notifications collection + bell.
3. **Part 3 — Buddy:** instance buddy fields, buddy completion, buddy picker, "Backing up" section.
4. **Part 4 — Planner redesign:** `MyPlanner` (My Day/My Week), DelegationApp tab restructure.
5. **Part 5 — Psychology layer:** progress ring, streaks, gentle overdue framing, workload
   visibility — applied across Parts 1–4's surfaces via `frontend-design`.

Each part is independently shippable and testable.

## 10. Open Risks
- Instance resync on date/frequency change can churn many docs for long recurring ranges — bound by
  the existing recurrence generator; acceptable, but log counts.
- Light RBAC only guards new endpoints; existing endpoints remain trust-frontend (documented gap,
  not addressed here).
