# Flow Management System (FMS) — Handbook

> A plain-English guide to how SmartShape Pro's FMS works. Written for the whole team,
> not just developers. The authoritative logic lives in
> [`backend/routes/fms_routes.py`](../backend/routes/fms_routes.py) and
> [`backend/fms_actions.py`](../backend/fms_actions.py); this doc explains *what it does and why*.

---

## 1. The core idea

Every order, purchase, dispatch, and payment is a tracked **FLOW**. Each flow answers four questions:

> **What → Who → How → When (Planned) vs When (Actual)**

The last part is the whole point. FMS doesn't only track *that* work happens — it tracks whether it
happened **on time**, and holds the right person accountable with a simple green/red score.

A **flow** is made of **stages** in order (Stage 1 → Stage 2 → Stage 3 …). Each stage has:

- a **label** (what to do),
- an **assignee** (who / which team),
- a **TAT** — Turn-Around-Time, the allowed hours to finish,
- optional **actions** that fire automatically (notify, generate certificate, start the next flow).

---

## 2. The seven mechanics ("the science")

### 1. The TAT clock only ticks during working hours
TAT is measured in **office minutes**, not wall-clock. The engine works in **IST (UTC+5:30)**, counts
only **10am–6pm**, and **skips Sundays and holidays**.

> A 4-hour task assigned at 5pm Saturday is due about **2pm Monday** — not 9pm Saturday.

### 2. Stages run in sequence
Finishing one stage activates the next and **recalculates its deadline from *now***. A late stage pushes
the rest honestly, instead of measuring against a schedule that's already broken.

### 3. Traffic-light accountability
Each stage is scored by how much of its TAT window has elapsed:

| Colour | Meaning |
|--------|---------|
| 🟢 green | comfortably within time |
| 🟠 orange | getting close to the deadline |
| 🔴 red | over the deadline |
| ⏰ overdue | well past, needs attention |

When the flow finishes, the stage scores average into one **overall score** for the flow.

### 4. Reminders at 50% / 80% / 100% of TAT
The system auto-sends WhatsApp / email nudges as a deadline approaches — so people are warned **before**
they're late, not blamed after.

### 5. Honest pause
A stage can be **paused** (e.g. waiting on a customer). Paused time is **subtracted** from the TAT, so the
clock stops and nobody is unfairly marked red for a delay outside their control. Resume restarts the clock.

### 6. Quality gates
- **Approval gates** — critical stages must be approved (or rejected) before the flow moves on.
- **QC eye-button** — inspect each item pass/fail; a fail spawns a **rework stage** (8-hour TAT).
- **Pre-dispatch checklist** — every item must be ticked before dispatch is allowed.

### 7. Action-nodes — stages that act, and flows that chain
A stage can carry **actions** that fire on an event (e.g. when the stage completes):

- **`send_message`** — auto WhatsApp / email to the customer or to staff.
- **`generate_certificate`** — kicks off the certificate pipeline (inherits the certificate designer's
  fonts and drag-positioned PDF templates automatically).
- **`start_flow`** — **links one flow into the next**, carrying data forward. (Chain depth is capped at 5
  so flows can't loop forever.)

**Fire-once safety:** every action is "claimed" before it runs, using a unique key per
stage+action+event. This guarantees an expensive action (like spawning a child flow or sending a
certificate) **never double-fires**, even if the system re-checks the same stage twice. Every action is
recorded in an audit log.

---

## 3. The process, end to end

```
Create flow from a template
   → Stage 1 goes ACTIVE, deadline computed in office hours (IST, skip Sun + holidays)
   → it appears as a task in the assignee's "My Tasks"
   → reminders fire at 50% / 80% / 100% of TAT
   → assignee completes it   (or, if it's a gate → approve / reject)
   → stage scored 🟢/🔴; any actions fire (notify / certificate / start next flow)
   → the next stage activates and its deadline is recalculated from now
   → … repeat for every stage …
   → QC eye-button + pre-dispatch checklist gate the finish
   → all stages done → flow COMPLETED with an overall score
```

---

## 4. Worked example — a Sales Order flow

Imagine a flow template **"Sales Order Fulfilment"** with four stages:

| # | Stage | Assignee | TAT | Action on completion |
|---|-------|----------|-----|----------------------|
| 1 | Confirm order & payment | Accounts | 4h | `send_message` → WhatsApp customer: "Order confirmed" |
| 2 | Production / dispatch prep | Store | 16h | — (QC eye-button + pre-dispatch checklist here) |
| 3 | Dispatch | Store | 4h | `send_message` → email customer tracking details |
| 4 | Training session | Sales | 8h | `generate_certificate` → cert to every attendee; then `start_flow` → "Feedback follow-up" |

**How it plays out:**

1. A new Sales Order creates the flow. **Stage 1** goes active. Because it's created Friday 5pm, the 4h TAT
   lands the deadline around **Monday 1pm** (Saturday/Sunday skipped).
2. Accounts confirms payment Monday morning → Stage 1 turns 🟢, the customer gets an automatic
   "Order confirmed" WhatsApp, and **Stage 2** activates with a fresh 16h deadline.
3. Store runs **QC** (eye-button) on the items. One fails → an **8h rework stage** is inserted. Once it
   passes, the **pre-dispatch checklist** must be fully ticked before dispatch.
4. **Stage 3** dispatches; the customer is emailed tracking details automatically.
5. **Stage 4** training completes → **certificates are generated and delivered** to every attendee (using
   whatever font/PDF template you designed), and a **"Feedback follow-up" flow is started automatically**,
   carrying the customer's details forward.
6. All stages done → the flow is **COMPLETED** with an overall green/red score showing how well the team
   hit its deadlines.

---

## 5. Roles (RBAC)

Stages are owned by teams. Only the assigned team (or an admin) can complete/approve a given stage, so
the accountability score maps to the team that actually owns the work. See the 4-team role system
(admin / accounts / store / sales).

---

## 6. Where things live (for developers)

| Concern | Location |
|---------|----------|
| Flow lifecycle, stages, TAT engine, QC, checklist, notifications | `backend/routes/fms_routes.py` |
| Action-nodes (send_message / generate_certificate / start_flow), fire-once claim, audit | `backend/fms_actions.py` |
| Reminder sweeps + action firing on a timer | `backend/scheduler.py` |
| Flow builder + action editor UI | `frontend/src/components/fms/FlowFormDialog.js` |
| Audit trails | `fms_action_logs` (actions), per-stage history logs |

**Key safety properties to preserve when editing:**
- TAT math must stay office-hour / IST / holiday aware — don't switch to wall-clock.
- Actions must keep the deterministic-claim guard (`stage:action:event`) so they stay fire-once.
- Pause time must keep being subtracted from TAT, or scoring becomes unfair.
- `start_flow` depth cap (5) prevents infinite chains.
