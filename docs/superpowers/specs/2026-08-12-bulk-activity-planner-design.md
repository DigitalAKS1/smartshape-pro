# Bulk Activity Planner — Design Spec

**Date:** 2026-08-12
**Owner:** SmartShape (info@smartshape.in)
**Status:** Draft for review

## 1. Goal

Let a **manager** (e.g. Vikas Sir) plan tasks/activities for a **batch of schools** in
one action — "send a newsletter to these 40 schools" — with each activity
**auto-assigned to that school's own account manager** (e.g. Parul), visible on the
school's 360 with done/not-done status, and monitorable team-wide.

## 2. What it reuses (build on, don't rebuild)

- **Schools tab filter + multi-select** (`LeadsCRM` + `FilterRail`): tag · city ·
  deal-type · source · stage · owner + manual search + a bulk-action bar already
  exist. The planner is a new **bulk action** on that bar.
- **School owner** (`school.assigned_to`) — the auto-assignment target.
- **360-block pattern** (`fms_flows` / `deal_types` rollups) — for the school's
  "Planned Activities" list.
- **CRM Masters pattern** (Deal Types) — for the editable Activity Types list.

## 3. Data model

**`activity_types`** (editable master, cloned from `deal_types`):
`{activity_type_id, name, is_active, created_at}`. Seed: Newsletter, Call, Visit,
WhatsApp, Sample, Meeting.

**`crm_activities`** (one per school per plan):
`{activity_id, batch_id, school_id, school_name, activity_type, title, notes,
due_date, assigned_to, assigned_name, status: "pending"|"done", created_by,
created_at, done_at?}`. `batch_id` groups one bulk plan (for reporting/undo).

## 4. Flows

### Plan (manager)
1. On the **Schools tab**, filter + multi-select schools (existing).
2. Click **"Plan Activity"** (new bulk-action button).
3. Dialog: **activity type** (from the editable master), **title**, **due date**,
   **notes**, and **assignment**:
   - **Default: auto — each school's own account manager** (`school.assigned_to`).
   - Override: assign all to **one chosen person**.
4. `POST /crm/activities/bulk` → creates one `crm_activities` doc per school. Schools
   with no owner (auto mode) fall back to the plan's creator, and are flagged so the
   manager can reassign.

### Do (the assigned rep)
- The activity shows on the **school 360 → "Planned Activities"** block and in the
  rep's context; a **mark-done** toggle sets `status="done", done_at=now`.

### Monitor (manager)
- A dedicated **Activity Monitor** page: every activity across schools, filter by
  **rep · type · status** (pending · done · overdue = pending && due_date past).
  Shows counts + a table; a row can be reassigned or marked done.

## 5. Endpoints

- `GET/POST/PUT/DELETE /crm/activity-types` — the editable master (clone deal-types).
- `POST /crm/activities/bulk` — body `{school_ids[], activity_type, title, notes,
  due_date, assign_mode: "owner"|"person", assigned_to?}`. Returns `{batch_id,
  created, unassigned_fallback}`.
- `GET /crm/activities?status=&assigned_to=&activity_type=&overdue=` — monitor list.
- `PUT /crm/activities/{id}` — mark done / edit / reassign.
- `DELETE /crm/activities/{id}`.
- `get_school_profile` — add `activities` array (pending first) to the 360 return.

## 6. Frontend surfaces

1. **Schools tab** — "Plan Activity" bulk button + the plan dialog.
2. **CRM Masters** — "Activity Types" tab (add/edit/delete), cloned from Deal Types.
3. **School 360** — "Planned Activities" block + mark-done toggle.
4. **Activity Monitor page** (`/activity-monitor`, nav under CRM) — filters + table.

## 7. Acceptance criteria

- A manager filters schools (e.g. deal-type = "New Machine", city = Delhi),
  multi-selects 20, plans "Send newsletter" due next Friday → 20 activities are
  created, each assigned to its school's owner.
- Each such school's 360 shows the activity as *pending*; the owning rep marks it
  done; status flips and `done_at` is stamped.
- The Activity Monitor lists all 20, filterable by rep/type/status, and flags any
  that go overdue.
- Activity Types are editable in CRM Masters and drive the plan dialog's dropdown.

## 8. Decisions (locked)

- **Activity types:** editable master in CRM Masters.
- **Monitoring:** dedicated Activity Monitor page.
- **Assignment default:** auto to each school's owner; override to one person.
- **Entity:** a purpose-built `crm_activities` collection (not the heavier
  employee-delegation system) — it's per-school, owner-assigned, 360-visible, with a
  simple pending/done status, which is exactly what this needs.

## 9. Build sequence (each ships independently, test-first)

1. **Backend** — activity_types master + crm_activities + bulk endpoint (auto-assign
   to owner) + 360 block. *(tested first)*
2. **Plan dialog** — the Schools-tab bulk action + dialog.
3. **360 block** — Planned Activities + mark-done.
4. **Activity Monitor page** + CRM Masters "Activity Types" tab.
