# FMS Action-Nodes + Flow-to-Flow Linking (Phase B) — Design Spec

**Date:** 2026-06-04
**Author:** Aman Shrivastava (with Claude)
**Status:** Approved for planning (expert mode)
**Scope:** Let an FMS stage fire actions on lifecycle events — spawn another flow (`start_flow`), generate certificates (`generate_certificate`), or send a message (`send_message`) — turning the FMS into a lightweight automation engine. Built in the isolated worktree where FMS + cert pipeline coexist.

---

## 1. Background & roadmap context

Phase B of the 3-phase automation program:
- **A = Certificates** — DONE on `feat/certs-build` (built, 6 unit + 7 integration tests green; awaiting merge).
- **B = FMS action-nodes + flow-to-flow linking** (this spec).
- **C = visual drag-and-drop builder** — later.

Phase B is the bridge from "FMS as tracker" to "FMS as automation." The user's words: "link one FMS to next FMS." It reuses two primitives already built this session: the cert pipeline (Phase A) and the notification engine (FMS fix-and-complete).

## 2. Build location & branch (expert decision)

Built on branch `feat/fms-action-nodes`, cut from `feat/certs-build` inside the worktree `.claude/worktrees/certs`. That branch contains BOTH the FMS (`fms_routes.py`, `scheduler.py` SLA loop) AND the cert pipeline (`cert_routes.py`, `cert_engine.py`, cert loop), so all three action types are buildable and testable without merging anything into `main`.

**Explicit non-goals (require the user's go-ahead, NOT part of this work):**
- Merging into `main` (which auto-deploys to production via the VPS poller).
- Deploying to production.
- The cert frontend has not been browser-verified; do not gate production on this work.

## 3. Goals

1. Each FMS stage can carry an optional `actions` list; actions fire on `on_complete`, `on_overdue`, or `on_reject`.
2. **`start_flow`** — completing a stage can spawn a new FMS flow from a target template, carrying customer/reference data, with parent↔child linkage recorded.
3. **`generate_certificate`** — a stage event can create + trigger a certificate batch (Phase A) for the flow's customer.
4. **`send_message`** — a stage event can send a templated WhatsApp/email to the customer or a staff member.
5. Actions are **idempotent** (each `(stage_id, action_index, event)` fires at most once) and **audited** (`fms_action_logs`).
6. Optional simple **condition** gating per action (e.g., only if `amount > 50000`).
7. Admin can attach actions to stages in the FMS template builder.

## 4. Non-goals

- No visual canvas / node editor (Phase C).
- No arbitrary scripting; actions are a fixed, safe set of three types.
- No loops/branching beyond the single optional condition per action.
- No webhook/external-HTTP action yet (future).

## 5. Architecture

Reuses existing infrastructure on the branch:
- FMS stage progression: `complete_stage`, `reject_stage`, `_advance_flow` in `backend/routes/fms_routes.py`.
- Overdue detection: the FMS SLA loop in `backend/scheduler.py`.
- Cert pipeline: `cert_routes.py` batch create + `scheduler.run_cert_pass` (for `generate_certificate`).
- Notification send: the FMS notification helpers / `evolution` + SMTP (for `send_message`).
- Idempotency/audit pattern: same as `fms_notifications` / `cert_items.delivery`.

### 5.1 Data model

Extend stage definitions (the `*_STAGES` constants AND template `stages` entries) with an optional `actions` array; `create_flow` copies it into each `fms_stages` doc (exactly like the existing `customer_notify` copy):
```
actions: [
  {
    event: "on_complete" | "on_overdue" | "on_reject",
    type:  "start_flow" | "generate_certificate" | "send_message",
    params: { ... type-specific ... },
    condition: { field, op, value } | null     # op in: ">", ">=", "<", "<=", "==", "!="
  }
]
```

`params` per type:
- `start_flow`: `{ template_id, title_suffix?, carry: ["customer_name","customer_phone","customer_email","reference_id","amount"] }`
- `generate_certificate`: `{ cert_template_id, shared_values: {date?, theme, expert}, channels: ["whatsapp","email"] }` (attendee = the flow's customer)
- `send_message`: `{ to: "customer" | "staff", channels: ["whatsapp","email"], template: "..." with {customer_name}/{title}/{ref}/{stage} placeholders }`

New collection **`fms_action_logs`** (idempotency + audit):
```
{ log_id, flow_id, stage_id, action_index, event, type,
  status: "fired" | "skipped_condition" | "failed",
  result_ref,            # e.g. spawned flow_id, cert batch_id, or notif id
  error, at }
```
Unique guard: a given `(stage_id, action_index, event)` is fired at most once.
Flow doc gains `parent_flow_id` (nullable) and `spawned_flow_ids: []` for linkage.

Index: `fms_action_logs` on `{stage_id, action_index, event}`.

### 5.2 Dispatcher

A single async function in `fms_routes.py` (or a focused `fms_actions.py` to keep `fms_routes.py` from growing further):
```
async def run_stage_actions(flow: dict, stage: dict, event: str):
    for idx, action in enumerate(stage.get("actions", [])):
        if action.get("event") != event: continue
        if await _action_already_fired(stage["stage_id"], idx, event): continue
        if not _eval_condition(action.get("condition"), flow): 
            log skipped_condition; continue
        try:
            ref = await _execute_action(action, flow, stage)
            log fired (result_ref=ref)
        except Exception as e:
            log failed (error=e)
```
- `_eval_condition(cond, flow)` — pure function; null condition → True; compares `flow[field]` against `value` with `op`. Unit-tested.
- `_execute_action` dispatches by `type`:
  - `start_flow` → build a `FlowCreate`-equivalent from the target template, carry whitelisted fields, set `parent_flow_id`, append to parent's `spawned_flow_ids`, reuse the existing flow-creation path. Returns new `flow_id`.
  - `generate_certificate` → create a cert batch (source manual, one attendee = flow customer) via the cert layer, set its status to generating+sending so `cert_loop` processes it. Returns `batch_id`.
  - `send_message` → resolve recipient (customer from flow, or stage staff), render template, send via WhatsApp/email (dry-run aware). Returns a notif id.

### 5.3 Wiring (where the dispatcher is called)

- `complete_stage`: after a stage is marked done (non-approval path) and in `approve_stage`, call `run_stage_actions(flow, stage, "on_complete")` — alongside the existing `_maybe_notify_customer`.
- `reject_stage`: call `run_stage_actions(flow, stage, "on_reject")`.
- SLA loop overdue branch (`scheduler.py`): when a stage first goes overdue, call `run_stage_actions(flow, stage, "on_overdue")` (idempotency log prevents repeat every 5 min).

To avoid an import cycle, `scheduler.py` imports the dispatcher locally inside the loop (same pattern already used for `run_fms_sla_check` ↔ `cert`/`fms_routes`).

### 5.4 Admin UI

Extend the FMS template builder (`frontend/src/components/fms/FlowFormDialog.js` or the template editor): per stage, an "Actions" sub-editor — add action → choose event + type → fill type-specific params (template pickers for `start_flow`/`generate_certificate`, a textarea for `send_message`), optional condition row. Persist within the stage object in the template `stages` array (no new endpoint — templates already round-trip `stages`).

## 6. Testing

- **Unit (pure):** `_eval_condition` across ops + null; carry-field selection for `start_flow`.
- **Idempotency:** dispatch the same `(stage, action, event)` twice → fires once (`fms_action_logs`).
- **Integration (HTTP, test backend, dry-run):**
  - `start_flow`: a stage with an `on_complete: start_flow` action → completing it creates a child flow with carried customer data; parent has `spawned_flow_ids`, child has `parent_flow_id`.
  - `generate_certificate`: completing the stage creates a cert batch for the customer; after a cert-loop pass, an item is generated (dry-run).
  - `send_message`: completing fires a recorded message (dry-run).
  - `condition`: action with a failing condition logs `skipped_condition` and does not execute.
- Tests local-only (`tests/` gitignored); commit implementation only. Backend run with `DB_NAME=smartshape_test FMS_NOTIFY_DRY_RUN=1 CERT_DRY_RUN=1`, no `--reload`.

## 7. Risks / open items

- **Recursion/loops:** `start_flow` could chain into another flow that also spawns — could loop. Mitigate: actions only fire on explicit events and dedupe per stage; do not auto-spawn from a spawned flow's first stage unless its template says so. Add a `spawn_depth` guard on the flow (cap, e.g., 5) to be safe.
- **`generate_certificate` needs a cert template** to exist; if `cert_template_id` is missing/invalid, the action logs `failed` (does not crash the stage completion).
- **Single-worker constraint:** the SLA-loop `on_overdue` dispatch, like the other loops, must run in one process (already a documented constraint).
- **Merge ordering:** this branch sits on `feat/certs-build`; final integration to `main` (and production deploy) is a separate, user-approved step — and Phase A should land first.
