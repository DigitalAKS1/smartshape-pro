# Drip ↔ Offline Mail — Sub-projects B, C, D — Implementation Plan

**Goal.** Make every drip-fired mailer a visible, tickable, reportable posting: a cross-run
"To post" queue with per-envelope ticks (B), one shared Materials catalogue that both the drip
step editor and the manual mail-run builder read from (C), and a single "Marketing sent" report
with school / contact / sequence roll-ups and CSV export (D).

**Architecture.** `mail_touches` becomes the one record of truth for "posted or not"
(`backend/routes/crm_routes.py:1459 VERIFY_STATUSES`), gaining `contact_ids`,
`recipient_names`, `dispatch_ids` and a new `needs_address` status, while
`physical_dispatches` gains a `touch_id` back-link that `create_physical_from_drip`
(`crm_routes.py:179-276`) writes on both sides in one call and `_do_verify`
(`crm_routes.py:1484`) mirrors onto. Two new read endpoints sit above the `/mail-runs/{run_id}`
catch-all — `GET /mail-runs/to-post` (cross-run queue, scoped by `_schools_visibility_or` /
`_contacts_visibility_or`) and `GET /reports/marketing-sent` (one aggregation over
`drip_step_logs` + `mail_touches` + `engagement_events`, grouped three ways, JSON or CSV) —
and a new `mail_materials` collection replaces the two disagreeing hard-coded lists
(`DripsTab.js:525-530`, `OfflineMail.js:15`, `ManualMailRunBuilder.js:6`). No new collection is
created for reporting; the front end gains a To-post tab, a Materials tab and a Marketing-sent
report page, all fed by `frontend/src/lib/api.js`.

**Spec (binding):** `F:\ss-drip2\docs\superpowers\specs\2026-09-22-drip-offline-mail-verification-reporting-design.md`

---

## Global Constraints

### Decisions D1–D6 (copied verbatim from the spec)

- **D1 — One envelope per school per item per day.** When several contacts at one school are in
  the same drip, one mailer row is created and it lists every recipient name. One tick covers the
  envelope. (Owner's decision 1; overrides nothing existing — `create_physical_from_drip` already
  dedupes touches on `run_id + school_id`.)
- **D2 — A contact with no school is never posted blindly.** The mailer row is still created, with
  `verify_status: "needs_address"`, so it appears in the queue flagged instead of vanishing. Giving
  the contact a school (or the school an address) moves it back to `pending` on the next executor
  pass. Nothing is cancelled.
- **D3 — One shared Materials list.** A `mail_materials` collection replaces both hard-coded lists.
  Drip steps and manual mail runs pick from it. Seeded with the union of today's values:
  `brochure, sample, catalogue, kit, newsletter, gift`, plus `other`. Legacy free-text values keep
  working (a step whose `material_type` is not in the list is shown as-is and flagged in the editor).
- **D4 — One posting, one record of truth.** The `mail_touches` row is the source of truth for
  "posted or not". `physical_dispatches` rows link to it (`touch_id`) and are updated from it, never
  the other way round. `needs_dispatch` is derived from `verify_status == "pending"`, not stored.
- **D5 — The verification queue is cross-run.** "To post" lists every pending/needs_address touch
  across all runs and drips, and a tick there is exactly `_do_verify` (`crm_routes.py:1484`) — no
  second verification path.
- **D6 — Reporting is one endpoint with a `group_by`.** School / contact / sequence roll-ups are the
  same query grouped differently, built on `drip_step_logs` + `mail_touches` + `engagement_events`,
  which already carry `sequence_id`, `enrollment_id`, `step_number`, `school_id`, `contact_id`,
  `touch_id`. No new data collection.

### Execution rules (binding for every task below)

1. **Never a bare `pytest tests/`.** Every backend test run is prefixed and names its files:
   `cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_x.py tests/test_y.py -q`
2. **`python`, never `python3`** (the Store `python3` stub is broken on this machine).
3. **Stage explicit filenames.** `git add backend/routes/crm_routes.py frontend/src/...` — never
   `git add -A`, never `git add .`.
4. **`git add -f` for new backend tests** (`backend/tests/` is gitignored in places; a new test
   file will silently not be staged otherwise).
5. **No new top-level third-party backend import.** Only stdlib (`csv`, `io`, `uuid`, `datetime`)
   and modules already imported in the file being edited.
6. **Tests must have no outward side effects.** Mock/monkeypatch SMTP (`sched._smtp_send`),
   WhatsApp (`sched._send_wa`) and push (`notify_user`) in every test that can reach the executor.
7. **Frontend bundle rebuild before merge** — `cd frontend && npx craco build`, then commit
   `frontend/build/`. Current live bundle: `main.cc2f3835.js`.
8. **Migration runs dry-run then `--apply` with owner confirmation before push.** It writes to
   production data.
9. Branch: `feat/drip-offline-mail-bcd` off `main`. Do not commit to `main` directly.

---

## Task B1 — Data: touch↔dispatch linking, `needs_address`, indexes

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/crm_routes.py` | `create_physical_from_drip` `:179-276`; `VERIFY_STATUSES` `:1459`; `_recompute_run_counts` `:1462-1481`; `get_physical_dispatches` `:7016-7026` |
| modify | `backend/scheduler.py` | physical branch `:559-568` |
| modify | `backend/database.py` | index block after `:244` (`_i()` helper at `:40`) |
| create | `backend/tests/test_to_post_linking.py` | new |

### Interfaces

**Consumes:** `create_physical_from_drip(lead, material_type, seq_name, material_name="",
sequence_id="", enrollment_id="", step_number=0, planned_date="")` — signature unchanged.

**Produces:**
- `mail_touches` doc gains `contact_ids: [str]`, `recipient_names: [str]`, `dispatch_ids: [str]`,
  `enrollment_ids: [str]`; `verify_status` may now be `"needs_address"`.
- `physical_dispatches` doc gains `touch_id: str`, `enrollment_id: str`, `step_number: int`;
  stops storing `needs_dispatch`.
- `VERIFY_STATUSES = ("pending", "needs_address", "sent", "not_sent", "skipped")`
- new `async def repair_needs_address_touches() -> dict` returning `{"repaired": int}`.
- `_recompute_run_counts` writes `counts.needs_address`.
- `GET /physical-dispatches` rows gain a derived `needs_dispatch: bool`.

### Steps

**1. Failing test first.** Create `backend/tests/test_to_post_linking.py`:

```python
"""B1: one posting, one record of truth (D4) and no school = flagged, not vanished (D2)."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _me)
    monkeypatch.setattr(drip, "get_current_user", _me)

    async def _no_wa(*a, **k):
        raise AssertionError("test tried to send WhatsApp")

    def _no_smtp(*a, **k):
        raise AssertionError("test tried to send email")
    monkeypatch.setattr(sched, "_send_wa", _no_wa, raising=False)
    monkeypatch.setattr(sched, "_smtp_send", _no_smtp, raising=False)
    return d


def _run(coro):
    return asyncio.run(coro)


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def test_a_fired_post_step_links_touch_and_dispatch_both_ways(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                     "address": "Rohini", "is_deleted": False})
        dispatch_id = await crm.create_physical_from_drip(
            {"lead_id": "l1", "contact_id": "c1", "contact_name": "R Sharma",
             "company_name": "DPS", "school_id": "s1", "assigned_to": "parul@smartshape.in"},
            "catalogue", "Principal Pitch", material_name="2026 Catalogue",
            sequence_id="seq1", enrollment_id="e1", step_number=1, planned_date=TODAY)

        d = await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t is not None
        assert d["touch_id"] == t["touch_id"], "dispatch does not point at its touch"
        assert dispatch_id in t["dispatch_ids"], "touch does not point back at its dispatch"
        assert d["enrollment_id"] == "e1" and d["step_number"] == 1
        assert "needs_dispatch" not in d, "needs_dispatch is derived (D4), not stored"
        assert t["contact_ids"] == ["c1"]
        assert t["recipient_names"] == ["R Sharma"]
    _run(go())


def test_three_contacts_at_one_school_make_one_touch_with_three_names(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
        for i, name in enumerate(["R Sharma", "K Verma", "A Menon"], start=1):
            await crm.create_physical_from_drip(
                {"lead_id": "", "contact_id": f"c{i}", "contact_name": name,
                 "company_name": "DPS", "school_id": "s1", "assigned_to": "parul@smartshape.in"},
                "catalogue", "Principal Pitch", material_name="2026 Catalogue",
                sequence_id="seq1", enrollment_id=f"e{i}", step_number=1, planned_date=TODAY)

        assert await db.mail_touches.count_documents({}) == 1, "D1: one envelope per school"
        t = await db.mail_touches.find_one({}, {"_id": 0})
        assert t["recipient_names"] == ["R Sharma", "K Verma", "A Menon"]
        assert t["contact_ids"] == ["c1", "c2", "c3"]
        assert len(t["dispatch_ids"]) == 3
        run = await db.mail_runs.find_one({}, {"_id": 0})
        assert run["counts"]["sent"] == 1, "one envelope, not three"
    _run(go())


def test_a_school_less_contact_still_gets_a_flagged_mailer(db):
    async def go():
        dispatch_id = await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", material_name="Quiz flyer",
            sequence_id="seq2", enrollment_id="e9", step_number=1, planned_date=TODAY)

        t = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t is not None, "D2: the mailer row must still be created"
        assert t["verify_status"] == "needs_address"
        assert t["school_id"] == ""
        d = await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
        assert d["touch_id"] == t["touch_id"]
    _run(go())


def test_two_school_less_contacts_get_two_envelopes_not_one(db):
    async def go():
        for i in (1, 2):
            await crm.create_physical_from_drip(
                {"lead_id": "", "contact_id": f"cx{i}", "contact_name": f"Person {i}",
                 "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
                "brochure", "Quiz Engage", material_name="Quiz flyer",
                sequence_id="seq2", enrollment_id=f"ex{i}", step_number=1, planned_date=TODAY)
        assert await db.mail_touches.count_documents({}) == 2, \
            "no school means no envelope to share — one per contact"
    _run(go())


def test_giving_the_contact_a_school_moves_the_touch_back_to_pending(db):
    async def go():
        await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", material_name="Quiz flyer",
            sequence_id="seq2", enrollment_id="e9", step_number=1, planned_date=TODAY)
        await db.schools.insert_one({"school_id": "s5", "school_name": "Lotus",
                                     "address": "Noida", "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c9", "name": "No School", "school_id": "s5"})

        out = await crm.repair_needs_address_touches()
        assert out["repaired"] == 1
        t = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t["verify_status"] == "pending"
        assert t["school_id"] == "s5"
        run = await db.mail_runs.find_one({"run_id": t["run_id"]}, {"_id": 0})
        assert "s5" in run["school_ids"]
    _run(go())


def test_run_counts_carry_needs_address_and_block_posted(db):
    async def go():
        await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", sequence_id="seq2", enrollment_id="e9",
            step_number=1, planned_date=TODAY)
        t = await db.mail_touches.find_one({}, {"_id": 0})
        run = await crm._recompute_run_counts(t["run_id"])
        assert run["counts"]["needs_address"] == 1
        assert run["status"] == "planned", "a needs_address piece is not posted"
    _run(go())
```

**2. Run it — expect failure.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_to_post_linking.py -q
```

**3. Implement.** In `backend/routes/crm_routes.py`, replace the body of
`create_physical_from_drip` from `dispatch_id = ...` (`:200`) to `return dispatch_id` (`:276`):

```python
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    recipient = (lead.get("contact_name") or "").strip()
    cid = lead.get("contact_id", "")
    await db.physical_dispatches.insert_one({
        "dispatch_id": dispatch_id,
        "lead_id": lead.get("lead_id", ""),
        **who,
        "lead_name": lead.get("contact_name", ""),
        "material_type": material_type or "brochure",
        "material_name": (material_name or "").strip(),
        "description": f"Auto-queued by drip: {seq_name}",
        "courier_name": "", "tracking_number": "", "sent_date": "",
        "received_confirmed": False,
        "auto_from_drip": True,
        # D4: `needs_dispatch` is DERIVED from the linked touch on read, never
        # stored — a stored flag was written once at :211 and read nowhere, so
        # 39 of 40 production rows sat "true" forever with nothing watching.
        "touch_id": "",                       # filled in below, same call
        "enrollment_id": enrollment_id, "step_number": step_number,
        "sequence_id": sequence_id,
        "created_by": "system", "created_at": now_iso,
    })
    await db.tasks.insert_one({
        "task_id": f"task_{uuid.uuid4().hex[:10]}",
        "title": f"Ship {item} → {lead.get('company_name', '')}",
        "description": f"Auto-created by drip sequence '{seq_name}'. Add courier + tracking after shipping.",
        "type": "other", "lead_id": lead.get("lead_id", ""), **who,
        "assigned_to": lead.get("assigned_to", ""),
        "due_date": "", "due_time": "", "priority": "medium",
        "status": "pending", "created_by": "system", "created_at": now_iso,
    })

    # A printable, QR-tracked mailer (Offline Mail). D2: this now runs even when
    # the recipient has no school — the row is created flagged `needs_address`
    # instead of silently not existing.
    sid = lead.get("school_id", "")
    try:
        today = now.strftime("%Y-%m-%d")
        piece = material_type or "brochure"
        planned = planned_date or today
        # One run per (sequence, piece, day), so a brochure step and a sample step
        # from two sequences don't collapse into one unprintable pile.
        run = await db.mail_runs.find_one(
            {"is_drip_run": True, "send_date": today,
             "sequence_id": sequence_id, "piece_type": piece},
            {"_id": 0, "run_id": 1})
        if not run:
            # Mid-day deploy safety: reuse a run made by the older, coarser key
            # rather than creating a second run and posting a school twice.
            run = await db.mail_runs.find_one(
                {"is_drip_run": True, "send_date": today, "piece_type": piece,
                 "sequence_id": {"$exists": False}},
                {"_id": 0, "run_id": 1})
        if not run:
            run_id = f"run_{uuid.uuid4().hex[:10]}"
            label = f"{seq_name} · {piece} — {today}" if seq_name else f"Drip Mailers — {today}"
            await db.mail_runs.insert_one({
                "run_id": run_id, "name": label, "area_id": "",
                "piece_type": piece, "deal_type_target": "", "school_ids": [],
                "send_date": today, "courier": "", "tracking_no": "", "courier_cost": 0,
                "status": "planned", "is_drip_run": True,
                "sequence_id": sequence_id, "sequence_name": seq_name,
                "created_by": "system", "created_at": now_iso,
                "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
        else:
            run_id = run["run_id"]

        # D1: one envelope per SCHOOL per run. With no school there is no envelope
        # to share, so a school-less recipient gets its own row keyed by contact —
        # otherwise every school-less contact in the run would collapse into one
        # mailer addressed to nobody.
        dedup = {"run_id": run_id, "school_id": sid} if sid \
            else {"run_id": run_id, "school_id": "", "contact_ids": cid}
        existing = await db.mail_touches.find_one(dedup, {"_id": 0, "touch_id": 1})
        if existing:
            touch_id = existing["touch_id"]
            add = {"dispatch_ids": dispatch_id, "enrollment_ids": enrollment_id}
            if cid:
                add["contact_ids"] = cid
            if recipient:
                add["recipient_names"] = recipient
            await db.mail_touches.update_one({"touch_id": touch_id}, {"$addToSet": add})
        else:
            touch_id = f"mt_{uuid.uuid4().hex[:10]}"
            await db.mail_touches.insert_one({
                "touch_id": touch_id, "run_id": run_id, "school_id": sid,
                "lead_id": lead.get("lead_id", ""), **who, "piece_type": piece,
                "item_name": item, "posted_at": None,
                "qr_token": uuid.uuid4().hex[:16], "delivery_status": "pending",
                "responded": False, "responded_at": None, "response_channel": "",
                "appointment": False, "next_action_date": "", "outcome_note": "",
                "owner": lead.get("assigned_to", "") or "system", "created_at": now_iso,
                # lifecycle + drip back-links
                "planned_date": planned,
                "verify_status": "pending" if sid else "needs_address",
                "printed_at": None, "print_batch_id": "", "replan_count": 0,
                "source": "drip", "sequence_id": sequence_id,
                "enrollment_id": enrollment_id, "step_number": step_number,
                # D1 roll-up + D4 back-link
                "contact_ids": [cid] if cid else [],
                "recipient_names": [recipient] if recipient else [],
                "dispatch_ids": [dispatch_id],
                "enrollment_ids": [enrollment_id] if enrollment_id else []})
            if sid:
                await db.mail_runs.update_one(
                    {"run_id": run_id},
                    {"$addToSet": {"school_ids": sid}, "$inc": {"counts.sent": 1}})
            else:
                await db.mail_runs.update_one(
                    {"run_id": run_id}, {"$inc": {"counts.sent": 1}})
        # D4: the dispatch points at its touch, written in the SAME call that
        # created the touch — the two records for one posting never drift again.
        await db.physical_dispatches.update_one(
            {"dispatch_id": dispatch_id}, {"$set": {"touch_id": touch_id}})
    except Exception:
        pass  # mailer is best-effort; the dispatch + task already exist
    return dispatch_id


async def repair_needs_address_touches() -> dict:
    """D2: a `needs_address` mailer is parked, never cancelled. Once the contact
    gains a school (or the school is created), the next executor pass moves the
    row back to `pending` and attaches it to its run's school list, so it drops
    into the ordinary To-post queue instead of staying flagged forever."""
    repaired = 0
    stuck = await db.mail_touches.find(
        {"verify_status": "needs_address"}, {"_id": 0}).to_list(2000)
    for t in stuck:
        sid = ""
        for cid in (t.get("contact_ids") or []):
            c = await db.contacts.find_one({"contact_id": cid}, {"_id": 0, "school_id": 1})
            sid = (c or {}).get("school_id") or ""
            if sid:
                break
        if not sid and t.get("lead_id"):
            l = await db.leads.find_one({"lead_id": t["lead_id"]}, {"_id": 0, "school_id": 1})
            sid = (l or {}).get("school_id") or ""
        if not sid:
            continue
        school = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_id": 1})
        if not school:
            continue
        await db.mail_touches.update_one(
            {"touch_id": t["touch_id"]},
            {"$set": {"school_id": sid, "verify_status": "pending"}})
        await db.mail_runs.update_one(
            {"run_id": t.get("run_id", "")}, {"$addToSet": {"school_ids": sid}})
        repaired += 1
    return {"repaired": repaired}
```

Then at `:1459` replace the constant and extend `_recompute_run_counts`:

```python
VERIFY_STATUSES = ("pending", "needs_address", "sent", "not_sent", "skipped")
```

and inside `_recompute_run_counts`, replace the `_set` dict and the status line
(`:1473-1479`) with:

```python
    _set = {
        "counts.verified_sent": tally["sent"],
        "counts.not_sent": tally["not_sent"],
        "counts.pending": tally["pending"],
        "counts.needs_address": tally["needs_address"],
    }
    if (run or {}).get("status") != "closed":
        unresolved = tally["pending"] + tally["needs_address"]
        _set["status"] = "posted" if (touches and unresolved == 0) else "planned"
```

Then in `get_physical_dispatches` (`:7016`), replace the final two lines with:

```python
    dispatches = await db.physical_dispatches.find(query, {"_id": 0}).sort("sent_date", -1).to_list(2000)
    # D4: `needs_dispatch` is derived from the linked touch, never stored. A row
    # with no touch (a manual dispatch) is never "owed to the post office".
    tids = [d["touch_id"] for d in dispatches if d.get("touch_id")]
    status_by_touch = {}
    if tids:
        async for t in db.mail_touches.find({"touch_id": {"$in": tids}},
                                            {"_id": 0, "touch_id": 1, "verify_status": 1,
                                             "posted_at": 1}):
            status_by_touch[t["touch_id"]] = t
    for d in dispatches:
        t = status_by_touch.get(d.get("touch_id", ""))
        d["verify_status"] = (t or {}).get("verify_status", "")
        d["needs_dispatch"] = bool(t) and t.get("verify_status") in ("pending", "needs_address")
        if t and t.get("posted_at") and not d.get("sent_date"):
            d["sent_date"] = str(t["posted_at"])[:10]
    return dispatches
```

In `backend/scheduler.py`, inside `run_drip_executor` immediately after the import-time
`create_physical_from_drip` is already available, add one call at the top of the executor body
(before the enrolment loop):

```python
    # D2: un-park any mailer whose recipient has since gained a school.
    try:
        from routes.crm_routes import repair_needs_address_touches
        await repair_needs_address_touches()
    except Exception as e:
        logging.getLogger("scheduler").warning("[drip] needs_address repair failed: %s", str(e)[:180])
```

In `backend/database.py`, after the `drip_enrollments` index block ending at `:244`, add:

```python
    # To-post queue (B): the cross-run "everything owed to the post office" scan.
    await _i(db.mail_touches.create_index([("verify_status", 1), ("planned_date", 1)],
                                          background=True))
    await _i(db.mail_touches.create_index("touch_id", background=True))
    await _i(db.mail_touches.create_index([("sequence_id", 1), ("step_number", 1)],
                                          background=True))
    # D4: the dispatch -> touch back-link, read on every dispatch list.
    await _i(db.physical_dispatches.create_index("touch_id", background=True))
```

**4. Run the tests again — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_to_post_linking.py tests/test_drip_physical_mailer.py tests/test_drip_to_offline_mail_chain.py -q
```
`test_drip_physical_mailer.py:77` ("a lead with no school still queues the dispatch") must be
updated in the same commit: it now also asserts a `needs_address` touch exists. Change its final
assertion to:

```python
        t = await db.mail_touches.find_one({}, {"_id": 0})
        assert t is not None and t["verify_status"] == "needs_address"
```

**5. Commit.**
```
git add backend/routes/crm_routes.py backend/scheduler.py backend/database.py backend/tests/test_drip_physical_mailer.py
git add -f backend/tests/test_to_post_linking.py
git commit -m "feat(mail): link every drip mailer to its dispatch; flag school-less sends needs_address"
```

---

## Task B2 — Backfill migration: link existing dispatches, flag school-less touches

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/migrations/link_dispatches_to_touches.py` | pattern: `backend/migrations/repair_orphaned_converted_leads.py:44,90,104-110` |
| create | `backend/tests/test_link_dispatches_migration.py` | new |

### Interfaces

**Consumes:** `db.physical_dispatches`, `db.mail_touches`, `db.contacts`, `db.leads`, `db.mail_runs`.

**Produces:** `async def link_dispatches_to_touches(db, apply: bool = False) -> dict` returning
exactly:
```python
{"linked": int, "touches_created": int, "marked_needs_address": int,
 "unset_needs_dispatch": int, "skipped_no_match": int, "total_dispatches_seen": int}
```
CLI: `cd backend && python migrations/link_dispatches_to_touches.py [--apply]`.

### Steps

**1. Failing test first.** Create `backend/tests/test_link_dispatches_migration.py`:

```python
"""B2 backfill: dry-run writes NOTHING; --apply links, flags and un-stores."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

from migrations.link_dispatches_to_touches import link_dispatches_to_touches


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c9", "name": "No School", "school_id": ""})
    await db.mail_runs.insert_one({"run_id": "run_old", "name": "Drip - brochure - 2026-09-01",
                                   "is_drip_run": True, "send_date": "2026-09-01",
                                   "sequence_id": "seq1", "piece_type": "brochure",
                                   "school_ids": ["s1"], "counts": {"sent": 1}})
    # A dispatch that DOES have a matching touch (same lead, same day, same piece).
    await db.mail_touches.insert_one({
        "touch_id": "mt_old1", "run_id": "run_old", "school_id": "s1",
        "lead_id": "l1", "piece_type": "brochure", "verify_status": "pending",
        "planned_date": "2026-09-01", "sequence_id": "seq1",
        "enrollment_id": "e1", "step_number": 1, "created_at": "2026-09-01T06:00:00+00:00"})
    await db.physical_dispatches.insert_one({
        "dispatch_id": "pd_1", "lead_id": "l1", "lead_name": "R Sharma",
        "material_type": "brochure", "auto_from_drip": True, "needs_dispatch": True,
        "created_at": "2026-09-01T06:00:00+00:00"})
    # A school-less dispatch with NO touch at all - the 39-row production case.
    await db.physical_dispatches.insert_one({
        "dispatch_id": "pd_2", "lead_id": "", "contact_id": "c9", "lead_name": "No School",
        "material_type": "brochure", "material_name": "Quiz flyer",
        "auto_from_drip": True, "needs_dispatch": True,
        "created_at": "2026-09-02T06:00:00+00:00"})


def test_dry_run_writes_nothing(db):
    async def go():
        await _seed(db)
        out = await link_dispatches_to_touches(db, apply=False)
        assert out["total_dispatches_seen"] == 2
        assert out["linked"] == 1 and out["touches_created"] == 1
        d1 = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert not d1.get("touch_id")
        assert d1.get("needs_dispatch") is True
        assert await db.mail_touches.count_documents({}) == 1
    _run(go())


def test_apply_links_creates_and_unsets(db):
    async def go():
        await _seed(db)
        await link_dispatches_to_touches(db, apply=True)
        d1 = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d1["touch_id"] == "mt_old1"
        assert "needs_dispatch" not in d1
        t1 = await db.mail_touches.find_one({"touch_id": "mt_old1"}, {"_id": 0})
        assert "pd_1" in t1["dispatch_ids"]

        t2 = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t2 is not None, "the school-less dispatch must become a visible flagged mailer"
        assert t2["verify_status"] == "needs_address"
        assert t2["recipient_names"] == ["No School"]
        d2 = await db.physical_dispatches.find_one({"dispatch_id": "pd_2"}, {"_id": 0})
        assert d2["touch_id"] == t2["touch_id"]
    _run(go())


def test_apply_is_idempotent(db):
    async def go():
        await _seed(db)
        await link_dispatches_to_touches(db, apply=True)
        second = await link_dispatches_to_touches(db, apply=True)
        assert second["linked"] == 0 and second["touches_created"] == 0
        assert await db.mail_touches.count_documents({}) == 2
    _run(go())


def test_existing_school_less_touch_is_flagged_not_duplicated(db):
    async def go():
        await db.mail_touches.insert_one({
            "touch_id": "mt_blank", "run_id": "run_old", "school_id": "",
            "contact_ids": ["c9"], "piece_type": "brochure", "verify_status": "pending",
            "planned_date": "2026-09-02", "created_at": "2026-09-02T06:00:00+00:00"})
        out = await link_dispatches_to_touches(db, apply=True)
        assert out["marked_needs_address"] == 1
        t = await db.mail_touches.find_one({"touch_id": "mt_blank"}, {"_id": 0})
        assert t["verify_status"] == "needs_address"
    _run(go())
```

**2. Run it — expect `ModuleNotFoundError`.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_link_dispatches_migration.py -q
```

**3. Implement.** Create `backend/migrations/link_dispatches_to_touches.py`:

```python
"""Backfill the touch <-> dispatch link, and give school-less sends a visible row.

Two production facts this repairs (both measured on 2026-09-22):
  - 40 `physical_dispatches` rows carry `needs_dispatch: True`, a flag written
    once at crm_routes.py:211 and read nowhere.
  - 39 of them are school-less drip sends that produced NO `mail_touches` row at
    all, because the whole Offline Mail leg was gated on `lead.school_id`
    (crm_routes.py:225-226). They are invisible in Offline Mail, the today
    queue and verification.

What it does, per `auto_from_drip` dispatch with no `touch_id` yet:
  1. LINK when a matching touch exists. The exact join key the spec names,
     (enrollment_id, step_number), only exists on dispatches written AFTER
     task B1 - historical dispatch rows never carried it. So the match is tried
     in order: (a) enrollment_id + step_number when the dispatch has them,
     (b) same lead_id/contact_id + same piece_type/material_type + same
     created_at calendar day. Anything still unmatched is counted as
     `skipped_no_match` and left alone rather than guessed at.
  2. CREATE the missing touch when the recipient has no school. Without this the
     39 invisible sends stay invisible, which is the defect being fixed - so the
     row is created with verify_status "needs_address" (D2) under the drip run
     for that piece + day, creating that run only if it is absent.
  3. FLAG an existing touch whose school_id is blank as "needs_address"
     (only when it is currently pending - never re-open a sent piece).
  4. UNSET the stored `needs_dispatch` (D4: it is derived on read now).

Dry-run by default (models repair_orphaned_converted_leads.py's --apply flag):
prints what it WOULD do for every dispatch and writes nothing unless invoked
with --apply. The function takes the same `apply: bool` switch so tests control
it explicitly.

Usage:  cd backend && python migrations/link_dispatches_to_touches.py [--apply]

Idempotent: a second --apply run links 0 and creates 0 (every dispatch it
touched now has a touch_id, so it no longer matches the filter).
"""
import uuid
from datetime import datetime, timezone


async def _find_matching_touch(db, d):
    eid, sn = d.get("enrollment_id"), d.get("step_number")
    if eid:
        t = await db.mail_touches.find_one(
            {"enrollment_id": eid, "step_number": sn}, {"_id": 0})
        if t:
            return t
    piece = d.get("material_type") or "brochure"
    day = str(d.get("created_at") or "")[:10]
    if not day:
        return None
    if d.get("lead_id"):
        who = {"lead_id": d["lead_id"]}
    elif d.get("contact_id"):
        who = {"contact_ids": d["contact_id"]}
    else:
        return None
    async for t in db.mail_touches.find({**who, "piece_type": piece}, {"_id": 0}):
        if str(t.get("created_at") or "")[:10] == day:
            return t
    return None


async def _ensure_drip_run(db, d, day, piece, apply):
    run = await db.mail_runs.find_one(
        {"is_drip_run": True, "send_date": day, "piece_type": piece},
        {"_id": 0, "run_id": 1})
    if run:
        return run["run_id"]
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    if apply:
        await db.mail_runs.insert_one({
            "run_id": run_id, "name": f"Drip Mailers - {day}", "area_id": "",
            "piece_type": piece, "deal_type_target": "", "school_ids": [],
            "send_date": day, "courier": "", "tracking_no": "", "courier_cost": 0,
            "status": "planned", "is_drip_run": True,
            "sequence_id": d.get("sequence_id", ""), "sequence_name": "",
            "created_by": "migration", "created_at": datetime.now(timezone.utc).isoformat(),
            "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
    return run_id


async def link_dispatches_to_touches(db, apply: bool = False) -> dict:
    linked = touches_created = marked_needs_address = skipped_no_match = 0

    dispatches = await db.physical_dispatches.find(
        {"auto_from_drip": True,
         "$or": [{"touch_id": {"$exists": False}}, {"touch_id": ""}]},
        {"_id": 0}).to_list(None)

    for d in dispatches:
        did = d["dispatch_id"]
        touch = await _find_matching_touch(db, d)
        if touch:
            print(f"{'APPLY ' if apply else 'DRY   '} link dispatch={did} -> touch={touch['touch_id']}")
            if apply:
                await db.physical_dispatches.update_one(
                    {"dispatch_id": did}, {"$set": {"touch_id": touch["touch_id"]}})
                await db.mail_touches.update_one(
                    {"touch_id": touch["touch_id"]}, {"$addToSet": {"dispatch_ids": did}})
            linked += 1
            continue

        # No touch at all. Only a school-less send is legitimately missing one -
        # anything else is a data shape this migration will not guess at.
        sid = ""
        if d.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": d["contact_id"]},
                                           {"_id": 0, "school_id": 1})
            sid = (c or {}).get("school_id") or ""
        elif d.get("lead_id"):
            l = await db.leads.find_one({"lead_id": d["lead_id"]}, {"_id": 0, "school_id": 1})
            sid = (l or {}).get("school_id") or ""
        if sid:
            print(f"SKIP   dispatch={did} has a school ({sid}) but no touch - not guessed")
            skipped_no_match += 1
            continue

        day = str(d.get("created_at") or "")[:10] or \
            datetime.now(timezone.utc).strftime("%Y-%m-%d")
        piece = d.get("material_type") or "brochure"
        run_id = await _ensure_drip_run(db, d, day, piece, apply)
        touch_id = f"mt_{uuid.uuid4().hex[:10]}"
        name = (d.get("lead_name") or "").strip()
        print(f"{'APPLY ' if apply else 'DRY   '} create needs_address touch={touch_id} "
              f"for dispatch={did} run={run_id}")
        if apply:
            await db.mail_touches.insert_one({
                "touch_id": touch_id, "run_id": run_id, "school_id": "",
                "lead_id": d.get("lead_id", ""),
                **({"contact_id": d["contact_id"]} if d.get("contact_id") else {}),
                "piece_type": piece,
                "item_name": (d.get("material_name") or piece),
                "posted_at": None, "qr_token": uuid.uuid4().hex[:16],
                "delivery_status": "pending", "responded": False, "responded_at": None,
                "response_channel": "", "appointment": False, "next_action_date": "",
                "outcome_note": "", "owner": d.get("created_by", "") or "system",
                "created_at": d.get("created_at") or day,
                "planned_date": day, "verify_status": "needs_address",
                "printed_at": None, "print_batch_id": "", "replan_count": 0,
                "source": "drip", "sequence_id": d.get("sequence_id", ""),
                "enrollment_id": d.get("enrollment_id", ""),
                "step_number": d.get("step_number", 0),
                "contact_ids": [d["contact_id"]] if d.get("contact_id") else [],
                "recipient_names": [name] if name else [],
                "dispatch_ids": [did],
                "enrollment_ids": [d["enrollment_id"]] if d.get("enrollment_id") else []})
            await db.physical_dispatches.update_one(
                {"dispatch_id": did}, {"$set": {"touch_id": touch_id}})
        touches_created += 1

    # Any pre-existing touch with no school is parked, not pending.
    blanks = await db.mail_touches.find(
        {"verify_status": "pending",
         "$or": [{"school_id": ""}, {"school_id": None}, {"school_id": {"$exists": False}}]},
        {"_id": 0, "touch_id": 1}).to_list(None)
    for t in blanks:
        print(f"{'APPLY ' if apply else 'DRY   '} flag touch={t['touch_id']} -> needs_address")
        if apply:
            await db.mail_touches.update_one(
                {"touch_id": t["touch_id"]}, {"$set": {"verify_status": "needs_address"}})
        marked_needs_address += 1

    stored = await db.physical_dispatches.count_documents({"needs_dispatch": {"$exists": True}})
    print(f"{'APPLY ' if apply else 'DRY   '} unset stored needs_dispatch on {stored} dispatches")
    if apply and stored:
        await db.physical_dispatches.update_many(
            {"needs_dispatch": {"$exists": True}}, {"$unset": {"needs_dispatch": ""}})

    return {
        "linked": linked,
        "touches_created": touches_created,
        "marked_needs_address": marked_needs_address,
        "unset_needs_dispatch": stored,
        "skipped_no_match": skipped_no_match,
        "total_dispatches_seen": len(dispatches),
    }


if __name__ == "__main__":
    import asyncio
    import sys
    from database import db

    result = asyncio.run(link_dispatches_to_touches(db, apply="--apply" in sys.argv))
    print(f"\n{result}")
```

**4. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_link_dispatches_migration.py -q
```

**5. Commit.**
```
git add backend/migrations/link_dispatches_to_touches.py
git add -f backend/tests/test_link_dispatches_migration.py
git commit -m "feat(migrations): backfill touch<->dispatch links and flag school-less mailers"
```

Do **not** run it against production here — that happens in the Deployment task, dry-run first,
`--apply` only after the owner confirms the dry-run output.

---

## Task B3 — `GET /mail-runs/to-post` and dispatch mirroring in `_do_verify`

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/crm_routes.py` | insert endpoint after `mail_gap_report` ends at `:1213`, i.e. ABOVE `/mail-runs/{run_id}` at `:1265`; edit `_do_verify` `:1484-1551` |
| modify | `frontend/src/lib/api.js` | `mailRuns` object `:387-405` |
| create | `backend/tests/test_to_post_endpoint.py` | new |

### Interfaces

**Consumes:** `_schools_visibility_or(email)` `:3486`, `_contacts_visibility_or(email)` `:4563`,
`_merge_or(query, or_clause)` `:4577`, `get_team(user)` (rbac `:58`),
`_do_verify(run_id, user, body)` `:1484`, `VERIFY_STATUSES` (B1).

**Produces:** `GET /mail-runs/to-post?status=&sequence_id=&owner=&from=&to=&q=&as_of=` →
```json
{"rows": [{"touch_id": "", "run_id": "", "run_name": "", "sequence_id": "", "sequence_name": "",
           "school_id": "", "school_name": "", "address_ok": true,
           "contact_ids": [], "recipient_names": [], "item_name": "", "piece_type": "",
           "planned_date": "", "overdue_days": 0, "verify_status": "", "posted_at": null,
           "reason": "", "owner": ""}],
 "totals": {"pending": 0, "needs_address": 0, "sent": 0, "not_sent": 0, "skipped": 0,
            "overdue": 0, "shown": 0, "capped": false},
 "as_of": "YYYY-MM-DD"}
```
Cap 2,000 rows, sorted overdue-first. `_do_verify` additionally writes `sent_date` +
`courier_name` onto every `physical_dispatches` row whose `touch_id` matches, and clears them
on undo. Front-end client: `mailRuns.toPost(params)`.

### Steps

**1. Failing test first.** Create `backend/tests/test_to_post_endpoint.py`:

```python
"""B3: the cross-run To-post queue (D5) and the dispatch mirror (D4)."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.schools.insert_many([
        {"school_id": "s1", "school_name": "DPS", "address": "Rohini", "city": "Delhi",
         "pincode": "110085", "assigned_to": "parul@smartshape.in", "is_deleted": False},
        {"school_id": "s2", "school_name": "Lotus", "address": "", "city": "", "pincode": "",
         "assigned_to": "bde@smartshape.in", "is_deleted": False},
    ])
    await db.mail_runs.insert_many([
        {"run_id": "r1", "name": "Pitch - brochure - 2026-09-01", "is_drip_run": True,
         "sequence_id": "seq1", "sequence_name": "Principal Pitch", "piece_type": "brochure",
         "courier": "DTDC", "school_ids": ["s1"], "counts": {}},
        {"run_id": "r2", "name": "Manual list", "is_drip_run": False, "piece_type": "sample",
         "school_ids": ["s2"], "counts": {}},
    ])
    await db.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "r1", "school_id": "s1", "piece_type": "brochure",
         "item_name": "2026 Catalogue", "planned_date": "2026-09-01",
         "verify_status": "pending", "owner": "parul@smartshape.in",
         "contact_ids": ["c1"], "recipient_names": ["R Sharma"], "dispatch_ids": ["pd_1"],
         "sequence_id": "seq1", "posted_at": None, "reason": ""},
        {"touch_id": "t2", "run_id": "r2", "school_id": "s2", "piece_type": "sample",
         "item_name": "Sample kit", "planned_date": "2026-12-31",
         "verify_status": "pending", "owner": "bde@smartshape.in",
         "contact_ids": [], "recipient_names": [], "dispatch_ids": [],
         "sequence_id": "", "posted_at": None, "reason": ""},
        {"touch_id": "t3", "run_id": "r1", "school_id": "", "piece_type": "brochure",
         "item_name": "Quiz flyer", "planned_date": "2026-09-02",
         "verify_status": "needs_address", "owner": "bde@smartshape.in",
         "contact_ids": ["c9"], "recipient_names": ["No School"], "dispatch_ids": ["pd_2"],
         "sequence_id": "seq1", "posted_at": None, "reason": ""},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c1", "name": "R Sharma", "school_id": "s1",
         "assigned_to": "parul@smartshape.in"},
        {"contact_id": "c9", "name": "No School", "school_id": "",
         "assigned_to": "bde@smartshape.in"},
    ])
    await db.physical_dispatches.insert_many([
        {"dispatch_id": "pd_1", "touch_id": "t1", "auto_from_drip": True,
         "sent_date": "", "courier_name": ""},
        {"dispatch_id": "pd_2", "touch_id": "t3", "auto_from_drip": True,
         "sent_date": "", "courier_name": ""},
    ])


def test_the_queue_spans_every_run_and_leads_with_the_overdue(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.mail_to_post(FakeRequest(params={"as_of": "2026-09-22"}))
        ids = [r["touch_id"] for r in out["rows"]]
        assert set(ids) == {"t1", "t2", "t3"}, "D5: cross-run, not one run"
        assert ids[0] == "t1", "most overdue first"
        assert out["totals"]["pending"] == 2
        assert out["totals"]["needs_address"] == 1
        assert out["totals"]["overdue"] == 2
    _run(go())


def test_rows_carry_recipients_sequence_and_address_state(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.mail_to_post(FakeRequest(params={"as_of": "2026-09-22"}))
        by = {r["touch_id"]: r for r in out["rows"]}
        assert by["t1"]["recipient_names"] == ["R Sharma"]
        assert by["t1"]["sequence_name"] == "Principal Pitch"
        assert by["t1"]["run_name"] == "Pitch - brochure - 2026-09-01"
        assert by["t1"]["school_name"] == "DPS"
        assert by["t1"]["address_ok"] is True
        assert by["t1"]["overdue_days"] == 21
        assert by["t2"]["address_ok"] is False, "Lotus has no address"
        assert by["t2"]["overdue_days"] == 0
        assert by["t3"]["verify_status"] == "needs_address"
        assert by["t3"]["school_name"] == ""
    _run(go())


def test_status_sequence_owner_and_search_filters(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        only_flagged = await crm.mail_to_post(FakeRequest(params={"status": "needs_address"}))
        assert [r["touch_id"] for r in only_flagged["rows"]] == ["t3"]
        by_seq = await crm.mail_to_post(FakeRequest(params={"sequence_id": "seq1"}))
        assert {r["touch_id"] for r in by_seq["rows"]} == {"t1", "t3"}
        by_owner = await crm.mail_to_post(FakeRequest(params={"owner": "parul@smartshape.in"}))
        assert [r["touch_id"] for r in by_owner["rows"]] == ["t1"]
        by_q = await crm.mail_to_post(FakeRequest(params={"q": "sharma"}))
        assert [r["touch_id"] for r in by_q["rows"]] == ["t1"]
        overdue = await crm.mail_to_post(FakeRequest(params={"status": "overdue",
                                                             "as_of": "2026-09-22"}))
        assert {r["touch_id"] for r in overdue["rows"]} == {"t1", "t3"}
    _run(go())


def test_a_rep_sees_only_touches_at_schools_she_can_see(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.mail_to_post(FakeRequest(params={}))
        ids = {r["touch_id"] for r in out["rows"]}
        assert ids == {"t1"}, f"rep saw {ids} - s2 is not hers and c9 is not hers"
    _run(go())


def test_ticking_in_the_queue_sets_the_touch_and_the_dispatch(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "sent", "posted_date": "2026-09-20"}]})
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "sent"
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d["sent_date"] == "2026-09-20", "D4: the dispatch is updated FROM the touch"
        assert d["courier_name"] == "DTDC"
    _run(go())


def test_undo_clears_the_dispatch_too(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "sent", "posted_date": "2026-09-20"}]})
        await crm._do_verify("r1", ADMIN, {"undo": True, "touch_ids": ["t1"]})
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d["sent_date"] == ""
    _run(go())
```

**2. Run it — expect `AttributeError: module 'routes.crm_routes' has no attribute 'mail_to_post'`.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_to_post_endpoint.py -q
```

**3. Implement the endpoint.** In `backend/routes/crm_routes.py`, insert immediately after
`mail_gap_report` ends (`:1213`) and before the `/mail-runs/analytics` note at `:1216`:

```python
# NOTE: this static path MUST stay above /mail-runs/{run_id} (:1265) or FastAPI
# matches "to-post" as a run_id and this endpoint is never reached.
_TO_POST_CAP = 2000


def _addr_ok(school: dict) -> bool:
    """A piece can only be posted if there is somewhere to post it to."""
    return bool((school.get("address") or "").strip()
                and ((school.get("pincode") or "").strip()
                     or (school.get("city") or "").strip()))


def _overdue_days(planned: str, as_of: str) -> int:
    """Whole days a piece is past its planned posting date, never negative."""
    if not planned:
        return 0
    try:
        p = datetime.strptime(planned[:10], "%Y-%m-%d")
        a = datetime.strptime(as_of[:10], "%Y-%m-%d")
    except ValueError:
        return 0
    return max(0, (a - p).days)


@router.get("/mail-runs/to-post")
async def mail_to_post(request: Request):
    """D5: everything owed to the post office, across every run and every drip.

    One list, one tick. A rep sees only pieces going to schools she can see
    (`_schools_visibility_or`) plus flagged pieces for her own contacts
    (`_contacts_visibility_or`); an admin sees all. Sorted overdue-first because
    that is the order the work actually matters in."""
    user = await get_current_user(request)
    qp = request.query_params
    today = qp.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    status = (qp.get("status") or "").strip()
    filt = {}
    if status == "overdue":
        filt["verify_status"] = {"$in": ["pending", "needs_address"]}
        filt["planned_date"] = {"$lt": today, "$ne": ""}
    elif status:
        filt["verify_status"] = status
    else:
        filt["verify_status"] = {"$in": ["pending", "needs_address"]}
    d_from, d_to = qp.get("from"), qp.get("to")
    if d_from or d_to:
        rng = filt.get("planned_date") if isinstance(filt.get("planned_date"), dict) else {}
        if d_from:
            rng["$gte"] = d_from
        if d_to:
            rng["$lte"] = d_to
        filt["planned_date"] = rng
    if qp.get("owner"):
        filt["owner"] = qp["owner"]

    touches = await db.mail_touches.find(filt, {"_id": 0}).to_list(None)
    runs = {r["run_id"]: r for r in await db.mail_runs.find({}, {"_id": 0}).to_list(None)}

    if qp.get("sequence_id"):
        want = qp["sequence_id"]
        touches = [t for t in touches
                   if (t.get("sequence_id")
                       or runs.get(t.get("run_id"), {}).get("sequence_id", "")) == want]

    school_ids = [t["school_id"] for t in touches if t.get("school_id")]
    schools = {s["school_id"]: s for s in await db.schools.find(
        {"school_id": {"$in": school_ids}}, {"_id": 0}).to_list(None)}

    # Visibility. Reps are scoped by the SAME helpers the CRM lists use, so a
    # piece a rep can tick here is exactly a piece she can see elsewhere - never
    # a silent "skipped". A school-less (needs_address) piece is scoped by its
    # contacts instead, since there is no school to scope it by.
    if get_team(user) != "admin" and user.get("role") != "admin":
        email = user["email"]
        vis_schools = {s["school_id"] for s in await db.schools.find(
            _merge_or({}, await _schools_visibility_or(email)),
            {"_id": 0, "school_id": 1}).to_list(None)}
        vis_contacts = {c["contact_id"] for c in await db.contacts.find(
            _merge_or({}, await _contacts_visibility_or(email)),
            {"_id": 0, "contact_id": 1}).to_list(None)}
        touches = [t for t in touches
                   if (t.get("school_id") and t["school_id"] in vis_schools)
                   or (not t.get("school_id")
                       and set(t.get("contact_ids") or []) & vis_contacts)]

    q = (qp.get("q") or "").strip().lower()
    rows = []
    for t in touches:
        run = runs.get(t.get("run_id"), {})
        school = schools.get(t.get("school_id", ""), {})
        row = {
            "touch_id": t.get("touch_id", ""),
            "run_id": t.get("run_id", ""),
            "run_name": run.get("name", "(deleted run)"),
            "sequence_id": t.get("sequence_id") or run.get("sequence_id", ""),
            "sequence_name": run.get("sequence_name", ""),
            "school_id": t.get("school_id", ""),
            "school_name": school.get("school_name", "") if t.get("school_id") else "",
            "address_ok": _addr_ok(school) if t.get("school_id") else False,
            "contact_ids": t.get("contact_ids") or [],
            "recipient_names": t.get("recipient_names") or [],
            "item_name": t.get("item_name", "") or t.get("piece_type", ""),
            "piece_type": t.get("piece_type", "") or run.get("piece_type", ""),
            "planned_date": t.get("planned_date", "") or "",
            "overdue_days": _overdue_days(t.get("planned_date", ""), today),
            "verify_status": t.get("verify_status", "pending"),
            "posted_at": t.get("posted_at"),
            "reason": t.get("reason", ""),
            "owner": t.get("owner", ""),
        }
        if q:
            hay = " ".join([row["school_name"], row["item_name"], row["sequence_name"],
                            row["run_name"], row["owner"], *row["recipient_names"]]).lower()
            if q not in hay:
                continue
        rows.append(row)

    rows.sort(key=lambda r: (-r["overdue_days"], r["planned_date"] or "9999-99-99",
                             r["school_name"]))
    capped = len(rows) > _TO_POST_CAP
    shown = rows[:_TO_POST_CAP]

    totals = {s: 0 for s in VERIFY_STATUSES}
    for r in rows:
        totals[r["verify_status"]] = totals.get(r["verify_status"], 0) + 1
    totals["overdue"] = sum(1 for r in rows if r["overdue_days"] > 0)
    totals["shown"] = len(shown)
    totals["capped"] = capped
    return {"rows": shown, "totals": totals, "as_of": today}
```

**4. Mirror verification onto the dispatch.** In `_do_verify` (`:1484`), in the undo branch,
immediately after the `update_many` on touches (`:1493-1496`) and before the
`engagement_events.delete_many` loop, add:

```python
        # D4: the dispatch is updated FROM the touch, never the other way round.
        await db.physical_dispatches.update_many(
            {"touch_id": {"$in": ids}}, {"$set": {"sent_date": "", "courier_name": ""}})
```

and in the per-row loop, immediately after
`await db.mail_touches.update_one({"touch_id": tid}, {"$set": _set})` (`:1528`), add:

```python
        if status == "sent":
            await db.physical_dispatches.update_many(
                {"touch_id": tid},
                {"$set": {"sent_date": str(_set["posted_at"] or "")[:10],
                          "courier_name": run.get("courier", "") or ""}})
        else:
            await db.physical_dispatches.update_many(
                {"touch_id": tid}, {"$set": {"sent_date": ""}})
```

**5. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_to_post_endpoint.py tests/test_to_post_linking.py -q
```

**6. Add the API client.** In `frontend/src/lib/api.js`, inside `mailRuns` (`:387-405`),
immediately after the `gapReport` line, add:

```js
  // D5: everything owed to the post office, across every run and every drip.
  // params: {status, sequence_id, owner, from, to, q}
  toPost: (params = {}) => API.get('/mail-runs/to-post', { params }),
```

**7. Commit.**
```
git add backend/routes/crm_routes.py frontend/src/lib/api.js
git add -f backend/tests/test_to_post_endpoint.py
git commit -m "feat(mail): cross-run To-post queue; verification mirrors onto the dispatch"
```

---

## Task B4 — UI: the "To post" tab with per-envelope ticks

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `frontend/src/components/mail/ToPostQueue.js` | patterns: `VerifyPostTable.js:78,95,110,118,139,140,143,148`; `SchoolsBulkBar.js:98,111` |
| create | `frontend/src/components/mail/__tests__/ToPostQueue.test.js` | pattern: `frontend/src/components/crm/__tests__/ContactsTab.test.js:6-14,125-145` |
| modify | `frontend/src/pages/admin/OfflineMail.js` | tab strip around the body at `:175`; `TodayPostQueue` render `:176` |
| modify | `frontend/src/pages/admin/DispatchTracking.js` | `markReceived` `:61` — read "sent" from the linked touch |

### Interfaces

**Consumes:** `mailRuns.toPost(params)` (B3), `mailRuns.verify(runId, payload)` (`api.js:401`),
`mailRuns.undoVerify(runId, touchIds)` (`api.js:402`), `mailRuns.stickers(runId, params)`
(`api.js:397`), `useBulkSelect(items, getId, allItems)` →
`{selectedIds, count, isSelected, toggle, toggleAll, allSelected, clear, hiddenCount, visibleIds}`
(`frontend/src/hooks/useBulkSelect.js:41`).

**Produces:** `<ToPostQueue onOpenSchool={(schoolId) => void} />`. It groups the selected
`touch_id`s by `run_id` and issues one `mailRuns.verify` per run (D5: no second verification
path). Test ids: `to-post-row-{touch_id}`, `to-post-check-{touch_id}`, `to-post-check-all`,
`to-post-bar`, `to-post-mark-posted`, `to-post-not-posted`, `to-post-undo`,
`to-post-print-stickers`, `to-post-posted-date`, `to-post-reason`,
`to-post-chip-{status}`, `to-post-filter-sequence`, `to-post-filter-owner`,
`to-post-from`, `to-post-to`, `to-post-search`, `to-post-needs-address-{touch_id}`.

### Steps

**1. Failing test first.** Create `frontend/src/components/mail/__tests__/ToPostQueue.test.js`:

```js
// The cross-run To-post queue: one tick per envelope, grouped by run when it
// posts (D5). Rendered into jsdom via react-dom/client (no @testing-library here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ToPostQueue from '../ToPostQueue';
import { mailRuns } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  mailRuns: {
    toPost: jest.fn(),
    verify: jest.fn(),
    undoVerify: jest.fn(),
    stickers: jest.fn(),
  },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock('../../../lib/dataSync', () => ({ useDataSync: () => {} }));

const ROWS = [
  { touch_id: 't1', run_id: 'r1', run_name: 'Pitch', sequence_id: 'seq1',
    sequence_name: 'Principal Pitch', school_id: 's1', school_name: 'DPS',
    address_ok: true, contact_ids: ['c1'], recipient_names: ['R Sharma'],
    item_name: '2026 Catalogue', piece_type: 'brochure', planned_date: '2026-09-01',
    overdue_days: 21, verify_status: 'pending', posted_at: null, reason: '',
    owner: 'parul@smartshape.in' },
  { touch_id: 't2', run_id: 'r2', run_name: 'Manual list', sequence_id: '',
    sequence_name: '', school_id: 's2', school_name: 'Lotus', address_ok: false,
    contact_ids: [], recipient_names: [], item_name: 'Sample kit',
    piece_type: 'sample', planned_date: '2026-12-31', overdue_days: 0,
    verify_status: 'pending', posted_at: null, reason: '', owner: 'bde@smartshape.in' },
  { touch_id: 't3', run_id: 'r1', run_name: 'Pitch', sequence_id: 'seq1',
    sequence_name: 'Principal Pitch', school_id: '', school_name: '', address_ok: false,
    contact_ids: ['c9'], recipient_names: ['No School'], item_name: 'Quiz flyer',
    piece_type: 'brochure', planned_date: '2026-09-02', overdue_days: 20,
    verify_status: 'needs_address', posted_at: null, reason: '',
    owner: 'bde@smartshape.in' },
];
const TOTALS = { pending: 2, needs_address: 1, sent: 0, not_sent: 0, skipped: 0,
                 overdue: 2, shown: 3, capped: false };

beforeEach(() => {
  mailRuns.toPost.mockImplementation(() =>
    Promise.resolve({ data: { rows: ROWS, totals: TOTALS, as_of: '2026-09-22' } }));
  mailRuns.verify.mockImplementation(() => Promise.resolve({ data: {} }));
  mailRuns.undoVerify.mockImplementation(() => Promise.resolve({ data: {} }));
});

async function render(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ToPostQueue onOpenSchool={jest.fn()} {...props} />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    rowIds: () => Array.from(container.querySelectorAll('[data-testid^="to-post-row-"]'))
      .map(el => el.getAttribute('data-testid').replace('to-post-row-', '')),
    unmount: () => act(() => root.unmount()),
  };
}

test('lists every pending and flagged piece across runs', async () => {
  const v = await render();
  expect(v.rowIds()).toEqual(['t1', 't2', 't3']);
  v.unmount();
});

test('a needs_address row carries its badge', async () => {
  const v = await render();
  expect(v.q('to-post-needs-address-t3')).not.toBeNull();
  expect(v.q('to-post-needs-address-t1')).toBeNull();
  v.unmount();
});

test('the recipient names show on the envelope, not the school alone', async () => {
  const v = await render();
  expect(v.q('to-post-row-t1').textContent).toContain('R Sharma');
  v.unmount();
});

test('marking selected posted sends ONE verify call per run', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => { v.q('to-post-check-t3').click(); });
  act(() => { v.q('to-post-check-t2').click(); });
  await act(async () => {
    v.q('to-post-mark-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.verify).toHaveBeenCalledTimes(2);           // r1 and r2
  const byRun = Object.fromEntries(mailRuns.verify.mock.calls.map(([id, p]) => [id, p]));
  expect(byRun.r1.rows.map(r => r.touch_id).sort()).toEqual(['t1', 't3']);
  expect(byRun.r2.rows.map(r => r.touch_id)).toEqual(['t2']);
  expect(byRun.r1.rows[0].verify_status).toBe('sent');
  v.unmount();
});

test('not posted sends the reason with the rows', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  act(() => {
    const el = v.q('to-post-reason');
    el.value = 'no envelopes left';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    v.q('to-post-not-posted').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const [, payload] = mailRuns.verify.mock.calls[0];
  expect(payload.rows[0].verify_status).toBe('not_sent');
  expect(payload.rows[0].reason).toBe('no envelopes left');
  v.unmount();
});

test('undo groups by run too', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-t1').click(); });
  await act(async () => {
    v.q('to-post-undo').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailRuns.undoVerify).toHaveBeenCalledWith('r1', ['t1']);
  v.unmount();
});

test('the header checkbox ticks every visible row', async () => {
  const v = await render();
  act(() => { v.q('to-post-check-all').click(); });
  expect(v.q('to-post-bar').textContent).toContain('3 selected');
  v.unmount();
});

test('a status chip refetches with that status', async () => {
  const v = await render();
  await act(async () => {
    v.q('to-post-chip-needs_address').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const last = mailRuns.toPost.mock.calls[mailRuns.toPost.mock.calls.length - 1][0];
  expect(last.status).toBe('needs_address');
  v.unmount();
});

test('search and sequence filters are sent to the server', async () => {
  const v = await render();
  await act(async () => {
    const s = v.q('to-post-search');
    s.value = 'sharma';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  const last = mailRuns.toPost.mock.calls[mailRuns.toPost.mock.calls.length - 1][0];
  expect(last.q).toBe('sharma');
  v.unmount();
});
```

**2. Run it — expect "Cannot find module '../ToPostQueue'".**
```
cd frontend && npx craco test --watchAll=false --testPathPattern "ToPostQueue"
```

**3. Implement `frontend/src/components/mail/ToPostQueue.js`:**

```jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { mailRuns } from '../../lib/api';
import { useDataSync } from '../../lib/dataSync';
import useBulkSelect from '../../hooks/useBulkSelect';
import { Printer, Undo2, MapPinOff, Search } from 'lucide-react';

// D5: ONE cross-run list of everything owed to the post office, and one tick.
// A tick here is exactly POST /mail-runs/{run_id}/verify -> _do_verify, the same
// call the per-run Verify tab makes; the only extra work is grouping the chosen
// touch ids by their run, because verification is still addressed per run.
const CHIPS = [
  ['', 'To post'],
  ['pending', 'Pending'],
  ['needs_address', 'Needs address'],
  ['overdue', 'Overdue'],
  ['sent', 'Sent'],
  ['not_sent', 'Not sent'],
];

const today = () => new Date().toISOString().slice(0, 10);

export default function ToPostQueue({ onOpenSchool }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [owner, setOwner] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [postedDate, setPostedDate] = useState(today());
  const [reason, setReason] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mailRuns.toPost({
        status, sequence_id: sequenceId, owner, from, to, q: debouncedQ,
      });
      setRows(r.data?.rows || []);
      setTotals(r.data?.totals || {});
    } catch { toast.error('Could not load the posting queue'); }
    finally { setLoading(false); }
  }, [status, sequenceId, owner, from, to, debouncedQ]);
  useEffect(() => { load(); }, [load]);
  useDataSync('mail', load);

  const sel = useBulkSelect(rows, (r) => r.touch_id, rows);
  const byId = useMemo(
    () => Object.fromEntries(rows.map(r => [r.touch_id, r])), [rows]);

  // Every distinct sequence / owner currently in the queue, for the filters.
  const sequences = useMemo(() => {
    const m = new Map();
    rows.forEach(r => { if (r.sequence_id) m.set(r.sequence_id, r.sequence_name || r.sequence_id); });
    return Array.from(m, ([v, label]) => ({ v, label }));
  }, [rows]);
  const owners = useMemo(
    () => Array.from(new Set(rows.map(r => r.owner).filter(Boolean))), [rows]);

  // The chosen touches, split by the run that owns them. One call per run.
  const groupByRun = (ids) => {
    const out = {};
    ids.forEach(id => {
      const row = byId[id];
      if (!row) return;
      (out[row.run_id] = out[row.run_id] || []).push(id);
    });
    return out;
  };

  const applyStatus = async (verify_status) => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the envelopes you posted first'); return; }
    setBusy(true);
    try {
      const groups = groupByRun(ids);
      await Promise.all(Object.entries(groups).map(([run_id, touchIds]) =>
        mailRuns.verify(run_id, {
          posted_date: postedDate,
          rows: touchIds.map(touch_id => ({
            touch_id, verify_status,
            ...(verify_status === 'not_sent' ? { reason: reason.trim() } : {}),
          })),
        })));
      toast.success(`${ids.length} piece${ids.length === 1 ? '' : 's'} marked `
        + (verify_status === 'sent' ? 'posted' : 'not posted'));
      sel.clear();
      setReason('');
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not record that'); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the rows to undo first'); return; }
    setBusy(true);
    try {
      const groups = groupByRun(ids);
      await Promise.all(Object.entries(groups).map(([run_id, touchIds]) =>
        mailRuns.undoVerify(run_id, touchIds)));
      toast.success('Reverted to pending');
      sel.clear();
      await load();
    } catch { toast.error('Undo failed'); }
    finally { setBusy(false); }
  };

  const printStickers = async () => {
    const ids = sel.visibleIds;
    if (!ids.length) { toast.error('Tick the envelopes to print first'); return; }
    const groups = groupByRun(ids);
    try {
      for (const [run_id, touchIds] of Object.entries(groups)) {
        const r = await mailRuns.stickers(run_id, { touch_ids: touchIds.join(',') });
        const url = URL.createObjectURL(r.data);
        const a = document.createElement('a');
        a.href = url; a.download = `stickers-${run_id}.pdf`; a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);   // must be in the DOM to download in Firefox/Safari
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch { toast.error('Could not print stickers'); }
  };

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const inp = 'h-9 rounded-lg px-2.5 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const act = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] disabled:opacity-50';

  const recipients = (r) => (r.recipient_names || []).join(', ')
    || (r.school_name ? 'The Principal' : '—');

  return (
    <div className={`${card} p-5`} data-testid="to-post-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">To post</h2>
        <span className="text-[11px] font-mono text-[var(--text-muted)]">
          {totals.overdue ? `${totals.overdue} overdue · ` : ''}{totals.shown ?? 0} shown
          {totals.capped ? ' (capped at 2,000 — narrow the filters)' : ''}
        </span>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-3">
        Everything owed to the post office, across every run and every drip. One tick covers one
        envelope — if several people at a school are in the same plan, they share it.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {CHIPS.map(([v, label]) => (
          <button key={v || 'all'} onClick={() => setStatus(v)} data-testid={`to-post-chip-${v || 'all'}`}
            className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${
              status === v ? 'bg-[#e94560] text-white border-[#e94560]'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
            {label}{v && totals[v] != null ? ` · ${totals[v]}` : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className={inp} value={sequenceId} onChange={e => setSequenceId(e.target.value)}
          data-testid="to-post-filter-sequence">
          <option value="">All sequences</option>
          {sequences.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select className={inp} value={owner} onChange={e => setOwner(e.target.value)}
          data-testid="to-post-filter-owner">
          <option value="">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)}
          data-testid="to-post-from" aria-label="Due from" />
        <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)}
          data-testid="to-post-to" aria-label="Due to" />
        <div className="relative flex-1 min-w-[160px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input className={`${inp} w-full pl-8`} placeholder="School, person, item…"
            value={q} onChange={e => setQ(e.target.value)} data-testid="to-post-search" />
        </div>
      </div>

      {sel.count > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 p-2.5 mb-2 rounded-lg bg-[var(--bg-primary)] border border-[#e94560]/40"
          data-testid="to-post-bar">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            {sel.count} selected{sel.hiddenCount ? ` (${sel.hiddenCount} hidden by filter)` : ''}
          </span>
          <input type="date" className={inp} value={postedDate} data-testid="to-post-posted-date"
            onChange={e => setPostedDate(e.target.value)} aria-label="Posted on" />
          <button className={act} disabled={busy} onClick={() => applyStatus('sent')}
            data-testid="to-post-mark-posted">Mark posted</button>
          <input className={`${inp} w-44`} placeholder="Reason (if not posted)" value={reason}
            onChange={e => setReason(e.target.value)} data-testid="to-post-reason" />
          <button className={act} disabled={busy} onClick={() => applyStatus('not_sent')}
            data-testid="to-post-not-posted">Not posted</button>
          <button className={act} disabled={busy} onClick={undo} data-testid="to-post-undo">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button className={act} onClick={printStickers} data-testid="to-post-print-stickers">
            <Printer className="h-3.5 w-3.5" /> Print stickers for selected
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">
          Nothing is waiting for the post office. 
        </p>
      ) : (
        <>
          {/* Mobile: the same checkbox, as cards */}
          <div className="sm:hidden grid gap-2">
            {rows.map(r => (
              <div key={r.touch_id} data-testid={`to-post-row-${r.touch_id}`}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={sel.isSelected(r.touch_id)}
                    onChange={() => sel.toggle(r.touch_id)}
                    data-testid={`to-post-check-${r.touch_id}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {r.school_name || recipients(r)}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)] truncate">{recipients(r)}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {r.item_name} · {r.sequence_name || r.run_name} · due {r.planned_date || '—'}
                      {r.overdue_days ? ` · ${r.overdue_days}d late` : ''}
                    </p>
                    {r.verify_status === 'needs_address' && (
                      <button onClick={() => onOpenSchool && onOpenSchool(r.school_id, r.contact_ids)}
                        data-testid={`to-post-needs-address-${r.touch_id}`}
                        className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#9A6A15]/15 text-[#9A6A15]">
                        <MapPinOff className="h-3 w-3" /> Needs address
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                  <th className="py-2 pr-2 w-8">
                    <input type="checkbox" checked={sel.allSelected} onChange={sel.toggleAll}
                      data-testid="to-post-check-all" aria-label="Select all" />
                  </th>
                  <th className="py-2 pr-3">School</th><th className="py-2 pr-3">Recipients</th>
                  <th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Sequence</th>
                  <th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.touch_id} data-testid={`to-post-row-${r.touch_id}`}
                    className="border-t border-[var(--border-color)]">
                    <td className="py-2 pr-2">
                      <input type="checkbox" checked={sel.isSelected(r.touch_id)}
                        onChange={(e) => sel.toggle(r.touch_id, { shift: e.nativeEvent.shiftKey })}
                        data-testid={`to-post-check-${r.touch_id}`} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-primary)] font-medium">
                      {r.school_id ? (
                        <button onClick={() => onOpenSchool && onOpenSchool(r.school_id)}
                          className="hover:text-[#e94560] hover:underline text-left">
                          {r.school_name}
                        </button>
                      ) : <span className="text-[var(--text-muted)]">(no school)</span>}
                      {!r.address_ok && r.school_id && (
                        <span className="ml-1.5 text-[10px] text-[#9A6A15]">no address</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{recipients(r)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.item_name}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {r.sequence_name || r.run_name}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">
                      {r.planned_date || '—'}
                      {r.overdue_days ? <span className="text-[#C4402E]"> +{r.overdue_days}d</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {r.verify_status === 'needs_address' ? (
                        <button onClick={() => onOpenSchool && onOpenSchool(r.school_id, r.contact_ids)}
                          data-testid={`to-post-needs-address-${r.touch_id}`}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#9A6A15]/15 text-[#9A6A15]">
                          <MapPinOff className="h-3 w-3" /> Needs address
                        </button>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--text-secondary)] capitalize">
                          {(r.verify_status || '').replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-muted)] text-[11px]">{r.owner || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

**4. Run — expect green.**
```
cd frontend && npx craco test --watchAll=false --testPathPattern "ToPostQueue"
```

**5. Wire it into the page.** In `frontend/src/pages/admin/OfflineMail.js`:

- add the import beside the other mail components (`:7-10`):
  `import ToPostQueue from '../../components/mail/ToPostQueue';`
- add `const [tab, setTab] = useState('to-post');` beside the other state (`:19-31`)
- replace the body that starts at `:175` (`<div className="grid gap-6">`) so the tab strip comes
  first and `To post` is the first tab:

```jsx
          <div className="grid gap-6">
            <div className="flex items-center gap-1 border-b border-[var(--border-color)]">
              {[['to-post', 'To post'], ['runs', 'Runs & areas'], ['materials', 'Materials']].map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} data-testid={`offline-mail-tab-${k}`}
                  className={`h-9 px-3.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                    tab === k ? 'border-[#e94560] text-[#e94560]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'to-post' && (
              <ToPostQueue onOpenSchool={(schoolId) => schoolId && navigate(`/school-profile/${schoolId}`)} />
            )}
            {tab === 'materials' && <MaterialsPanel />}
            {tab === 'runs' && (<>
              {/* everything that is here today, unchanged: TodayPostQueue, hot leads,
                  Campaign Performance, GapReportPanel, Areas, Mail Runs */}
            </>)}
          </div>
```
(`MaterialsPanel` arrives in task C2; until then render nothing for that tab.)

**6. Dispatch Tracking reads "sent" from the touch.** In
`frontend/src/pages/admin/DispatchTracking.js`, the rows now carry the derived `verify_status`
and a `sent_date` copied from the touch (B1 step 3). Replace whatever renders the sent state with:

```jsx
  const sentLabel = (d) => (
    d.verify_status === 'sent' ? `posted ${d.sent_date || ''}`.trim()
      : d.verify_status === 'needs_address' ? 'needs address'
      : d.verify_status === 'not_sent' ? `not posted${d.reason ? ` — ${d.reason}` : ''}`
      : d.needs_dispatch ? 'to post'
      : d.sent_date ? `sent ${d.sent_date}` : '—');
```
`markReceived` (`:61`) is unchanged — receiving is still a dispatch-level fact.

**7. Commit.**
```
git add frontend/src/components/mail/ToPostQueue.js frontend/src/components/mail/__tests__/ToPostQueue.test.js frontend/src/pages/admin/OfflineMail.js frontend/src/pages/admin/DispatchTracking.js
git commit -m "feat(mail): To post tab with per-envelope ticks across every run"
```

---

## Task C1 — `mail_materials`: collection, CRUD, seed

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/crm_routes.py` | insert beside the mail-areas CRUD at `:734-762` |
| modify | `backend/database.py` | index block (after the B1 additions) |
| modify | `frontend/src/lib/api.js` | new `mailMaterials` export next to `mailAreas` `:379-385` |
| create | `backend/tests/test_mail_materials.py` | new |

### Interfaces

**Consumes:** `get_current_user(request)`, `require_module(user, "leads", "read_write")`
(rbac `:108`), `db.mail_materials`.

**Produces:**
- collection `mail_materials` doc: `{material_id, name, piece_type, active, created_by, created_at}`
- `GET /mail-materials?include_inactive=` → `[{material_id, name, piece_type, active, created_by,
  created_at}]`, sorted by `name`, seeded on first read.
- `POST /mail-materials` body `{name, piece_type}` → the created doc; 400 on a blank name,
  409 on a case-insensitive duplicate name.
- `PUT /mail-materials/{material_id}` body `{name?, piece_type?, active?}` → the updated doc.
- `DELETE /mail-materials/{material_id}` → `{"message": "Material deactivated",
  "material_id": ...}` — a soft deactivate, never a hard delete (D3: legacy steps keep working).
- `async def _seed_materials() -> None`
- front-end client `mailMaterials.{getAll, create, update, deactivate}`.

### Steps

**1. Failing test first.** Create `backend/tests/test_mail_materials.py`:

```python
"""C1: one shared Materials list (D3) behind both dropdowns."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales",
       "module_permissions": {"leads": {"level": "read"}}}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def test_the_list_seeds_the_union_of_both_old_hardcoded_lists(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        names = {r["piece_type"] for r in rows}
        # DripsTab.js:525-530 had brochure|sample|catalogue|kit|gift;
        # OfflineMail.js:15 had brochure|sample|newsletter|other.
        assert names == {"brochure", "sample", "catalogue", "kit",
                         "newsletter", "gift", "other"}
        assert all(r["active"] for r in rows)
        assert [r["name"] for r in rows] == sorted(r["name"] for r in rows)
    _run(go())


def test_seeding_is_idempotent(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        await crm.get_mail_materials(FakeRequest())
        assert await db.mail_materials.count_documents({}) == 7
    _run(go())


def test_create_update_and_deactivate(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        made = await crm.create_mail_material(
            FakeRequest({"name": "2026 Die Catalogue", "piece_type": "catalogue"}))
        assert made["piece_type"] == "catalogue" and made["active"] is True

        edited = await crm.update_mail_material(
            made["material_id"], FakeRequest({"name": "2026 Die Catalogue v2"}))
        assert edited["name"] == "2026 Die Catalogue v2"
        assert edited["piece_type"] == "catalogue", "an un-sent field must not be wiped"

        out = await crm.delete_mail_material(made["material_id"], FakeRequest())
        assert out["material_id"] == made["material_id"]
        gone = await db.mail_materials.find_one({"material_id": made["material_id"]}, {"_id": 0})
        assert gone is not None, "deactivate, never delete - legacy steps still name it"
        assert gone["active"] is False

        active_only = await crm.get_mail_materials(FakeRequest())
        assert made["material_id"] not in [r["material_id"] for r in active_only]
        everything = await crm.get_mail_materials(FakeRequest(params={"include_inactive": "1"}))
        assert made["material_id"] in [r["material_id"] for r in everything]
    _run(go())


def test_a_blank_name_is_refused_and_a_duplicate_is_409(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        with pytest.raises(HTTPException) as e1:
            await crm.create_mail_material(FakeRequest({"name": "   "}))
        assert e1.value.status_code == 400
        with pytest.raises(HTTPException) as e2:
            await crm.create_mail_material(FakeRequest({"name": "brochure"}))
        assert e2.value.status_code == 409
    _run(go())


def test_a_read_only_rep_can_list_but_not_write(db, monkeypatch):
    async def go():
        _as(monkeypatch, REP)
        rows = await crm.get_mail_materials(FakeRequest())
        assert len(rows) == 7
        with pytest.raises(HTTPException) as e:
            await crm.create_mail_material(FakeRequest({"name": "Sneaky", "piece_type": "other"}))
        assert e.value.status_code == 403
    _run(go())
```

**2. Run — expect failure.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_mail_materials.py -q
```

**3. Implement.** In `backend/routes/crm_routes.py`, insert immediately above
`@router.get("/mail-areas")` (`:734`):

```python
# ==================== MAIL MATERIALS (D3) ====================
# One shared list behind BOTH the drip step editor's `material_type` (was a
# literal list in DripsTab.js:525-530) and the mail run's `piece_type` (was a
# DIFFERENT literal list in OfflineMail.js:15 / ManualMailRunBuilder.js:6).
# The two disagreed: catalogue|kit|gift could not be chosen on a manual run and
# newsletter could not be chosen on a drip step. Seeded with the union.
_DEFAULT_MATERIALS = [
    ("Brochure", "brochure"),
    ("Sample", "sample"),
    ("Catalogue", "catalogue"),
    ("Kit", "kit"),
    ("Newsletter", "newsletter"),
    ("Gift", "gift"),
    ("Other", "other"),
]


async def _seed_materials() -> None:
    """Idempotent: matched on `piece_type`, so renaming a seeded material in the
    UI does not resurrect a twin on the next read."""
    for name, piece in _DEFAULT_MATERIALS:
        if await db.mail_materials.find_one({"piece_type": piece}, {"_id": 0, "material_id": 1}):
            continue
        await db.mail_materials.insert_one({
            "material_id": f"mm_{uuid.uuid4().hex[:10]}",
            "name": name, "piece_type": piece, "active": True,
            "created_by": "system",
            "created_at": datetime.now(timezone.utc).isoformat()})


@router.get("/mail-materials")
async def get_mail_materials(request: Request):
    """The catalogue both authoring surfaces read. `?include_inactive=1` for the
    admin editor, which must still show (and be able to re-activate) a retired
    material that old drip steps still name."""
    await get_current_user(request)
    await _seed_materials()
    q = {} if request.query_params.get("include_inactive") else {"active": True}
    return await db.mail_materials.find(q, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/mail-materials")
async def create_mail_material(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the material a name")
    clash = await db.mail_materials.find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        {"_id": 0, "material_id": 1})
    if clash:
        raise HTTPException(status_code=409, detail=f'A material called "{name}" already exists')
    material_id = f"mm_{uuid.uuid4().hex[:10]}"
    await db.mail_materials.insert_one({
        "material_id": material_id, "name": name,
        "piece_type": (body.get("piece_type") or "other").strip().lower(),
        "active": True, "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat()})
    return await db.mail_materials.find_one({"material_id": material_id}, {"_id": 0})


@router.put("/mail-materials/{material_id}")
async def update_mail_material(material_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    _set = {}
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Give the material a name")
        _set["name"] = name
    if "piece_type" in body:
        _set["piece_type"] = (body.get("piece_type") or "other").strip().lower()
    if "active" in body:
        _set["active"] = bool(body["active"])
    if not _set:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.mail_materials.update_one({"material_id": material_id}, {"$set": _set})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Material not found")
    return await db.mail_materials.find_one({"material_id": material_id}, {"_id": 0})


@router.delete("/mail-materials/{material_id}")
async def delete_mail_material(material_id: str, request: Request):
    """Deactivate, never delete. D3: a drip step whose `material_type` names this
    material must keep firing, and its history must keep reading back."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    res = await db.mail_materials.update_one({"material_id": material_id},
                                             {"$set": {"active": False}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Material not found")
    return {"message": "Material deactivated", "material_id": material_id}
```

Confirm `re` is already imported at the top of `crm_routes.py`
(`grep -n "^import re" backend/routes/crm_routes.py`); if it is not, add `import re` to the
existing stdlib import block — it is stdlib, so constraint 5 is satisfied.

In `backend/database.py`, alongside the B1 indexes add:

```python
    await _i(db.mail_materials.create_index("material_id", unique=True, background=True))
    await _i(db.mail_materials.create_index("piece_type", background=True))
```

In `frontend/src/lib/api.js`, immediately after the `mailAreas` export (`:385`):

```js
// D3: one shared Materials list behind the drip step editor AND the mail-run
// piece picker. `deactivate` is a soft delete — legacy steps keep working.
export const mailMaterials = {
  getAll: (params = {}) => API.get('/mail-materials', { params }),
  create: (data) => API.post('/mail-materials', data),
  update: (id, data) => API.put(`/mail-materials/${id}`, data),
  deactivate: (id) => API.delete(`/mail-materials/${id}`),
};
```

**4. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_mail_materials.py -q
```

**5. Commit.**
```
git add backend/routes/crm_routes.py backend/database.py frontend/src/lib/api.js
git add -f backend/tests/test_mail_materials.py
git commit -m "feat(mail): shared mail_materials catalogue with CRUD and seed"
```

---

## Task C2 — Both dropdowns read the catalogue; Materials panel; the Offline-Mail note

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `frontend/src/components/mail/MaterialsPanel.js` | pattern: Areas block `OfflineMail.js:233-269` |
| create | `frontend/src/hooks/useMailMaterials.js` | new |
| create | `frontend/src/components/mail/__tests__/MaterialsPanel.test.js` | new |
| create | `frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js` | new |
| modify | `frontend/src/components/marketing/DripsTab.js` | material select `:518-538`; step block ends `:547` |
| modify | `frontend/src/components/crm/SequenceEnrollDialog.js` | `BLANK_STEP:15`, post-step fields around `:196-230` |
| modify | `frontend/src/pages/admin/OfflineMail.js` | `PIECES` const `:15`; run-piece select `:396-398`; Materials tab (B4) |
| modify | `frontend/src/components/mail/ManualMailRunBuilder.js` | `PIECES` const `:6`; select `:136-137` |
| modify | `frontend/src/lib/marketingUtils.js` | `mapSeq` `:112-142` — carry `material_type`/`material_name` (A2 prerequisite; if Sub-project A already shipped it, verify and skip) |

### Interfaces

**Consumes:** `mailMaterials.getAll()` (C1) → `[{material_id, name, piece_type, active}]`.

**Produces:**
- `useMailMaterials()` → `{materials, loading, reload}` where `materials` is the active list.
- `<MaterialsPanel />` — admin CRUD. Test ids: `materials-panel`, `material-row-{material_id}`,
  `material-new-name`, `material-new-piece`, `material-add`, `material-deactivate-{id}`.
- `DripsTab` step material select emits `material_type` = the chosen material's `piece_type`;
  an unknown legacy value stays selected and is flagged.
- Under any post step in both authoring dialogs, the note:
  *"On day N this creates a mailer in Offline Mail → To post. Post it and tick it there."*

### Steps

**1. Failing tests first.**

`frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js`:

```js
// C2: the drip step editor's material picker reads the shared catalogue (D3),
// keeps a legacy free-text value working, and says where the mailer will land.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DripsTab from '../DripsTab';
import { mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('../../../lib/api', () => ({
  dripSequences: { getAll: jest.fn(), create: jest.fn(), update: jest.fn(), deliveries: jest.fn() },
  mailMaterials: { getAll: jest.fn() },
  mailRuns: { getAll: jest.fn(() => Promise.resolve({ data: [] })) },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock('../RichMessageEditor', () => () => null);

const MATERIALS = [
  { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: 'mm2', name: 'Newsletter', piece_type: 'newsletter', active: true },
  { material_id: 'mm3', name: 'Catalogue', piece_type: 'catalogue', active: true },
];

beforeEach(() => {
  mailMaterials.getAll.mockImplementation(() => Promise.resolve({ data: MATERIALS }));
});

async function renderTab(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<DripsTab drips={[]} onRefresh={jest.fn()} user={{ email: 'info@smartshape.in', role: 'admin' }} {...props} />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    unmount: () => act(() => root.unmount()),
  };
}

async function openNewWithPostStep(v) {
  await act(async () => {
    v.q('drip-new-btn').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  act(() => {
    const sel = v.q('step-type-0');
    sel.value = 'physical_material';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('the material dropdown lists the shared catalogue, newsletter included', async () => {
  const v = await renderTab();
  await openNewWithPostStep(v);
  const opts = Array.from(v.q('step-material-0').querySelectorAll('option'))
    .map(o => o.value);
  expect(opts).toEqual(expect.arrayContaining(['brochure', 'newsletter', 'catalogue']));
  expect(opts).toContain('__other__');
  v.unmount();
});

test('a legacy value not in the catalogue stays selected and is flagged', async () => {
  const v = await renderTab({
    drips: [{ id: 'seq1', sequence_id: 'seq1', name: 'Legacy', is_active: true,
      steps: [{ step_number: 1, delay_days: 0, message_type: 'physical_material',
                material_type: 'poster', material_name: 'Old poster' }] }],
  });
  await act(async () => {
    v.q('drip-edit-seq1').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(v.q('step-material-0').value).toBe('poster');
  expect(v.q('step-material-legacy-0')).not.toBeNull();
  v.unmount();
});

test('a post step says where the mailer will appear', async () => {
  const v = await renderTab();
  await openNewWithPostStep(v);
  expect(v.q('step-mailer-note-0').textContent)
    .toContain('Offline Mail');
  expect(v.q('step-mailer-note-0').textContent).toContain('To post');
  v.unmount();
});
```

`frontend/src/components/mail/__tests__/MaterialsPanel.test.js`:

```js
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MaterialsPanel from '../MaterialsPanel';
import { mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  mailMaterials: { getAll: jest.fn(), create: jest.fn(), update: jest.fn(), deactivate: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const ROWS = [
  { material_id: 'mm1', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: 'mm2', name: 'Retired thing', piece_type: 'other', active: false },
];

beforeEach(() => {
  mailMaterials.getAll.mockImplementation(() => Promise.resolve({ data: ROWS }));
  mailMaterials.create.mockImplementation(() => Promise.resolve({
    data: { material_id: 'mm3', name: 'Kit', piece_type: 'kit', active: true } }));
  mailMaterials.deactivate.mockImplementation(() => Promise.resolve({ data: {} }));
});

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MaterialsPanel />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    unmount: () => act(() => root.unmount()),
  };
}

test('shows active and retired materials', async () => {
  const v = await render();
  expect(mailMaterials.getAll).toHaveBeenCalledWith({ include_inactive: 1 });
  expect(v.q('material-row-mm1')).not.toBeNull();
  expect(v.q('material-row-mm2').textContent).toContain('retired');
  v.unmount();
});

test('adding a material posts name and piece type', async () => {
  const v = await render();
  act(() => {
    const n = v.q('material-new-name');
    n.value = 'Kit';
    n.dispatchEvent(new Event('input', { bubbles: true }));
    const p = v.q('material-new-piece');
    p.value = 'kit';
    p.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    v.q('material-add').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailMaterials.create).toHaveBeenCalledWith({ name: 'Kit', piece_type: 'kit' });
  v.unmount();
});

test('deactivating asks first and calls the soft delete', async () => {
  window.confirm = jest.fn(() => true);
  const v = await render();
  await act(async () => {
    v.q('material-deactivate-mm1').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(mailMaterials.deactivate).toHaveBeenCalledWith('mm1');
  v.unmount();
});
```

**2. Run both — expect failure.**
```
cd frontend && npx craco test --watchAll=false --testPathPattern "MaterialsPanel|DripsTabMaterial"
```

**3. Implement the hook** `frontend/src/hooks/useMailMaterials.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { mailMaterials } from '../lib/api';

// D3: one shared list, fetched once per mounting surface. A failure falls back
// to the seeded union rather than leaving the picker empty — authoring a post
// step must never be blocked by a slow/failed catalogue read.
const FALLBACK = [
  { material_id: '_brochure', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: '_sample', name: 'Sample', piece_type: 'sample', active: true },
  { material_id: '_catalogue', name: 'Catalogue', piece_type: 'catalogue', active: true },
  { material_id: '_kit', name: 'Kit', piece_type: 'kit', active: true },
  { material_id: '_newsletter', name: 'Newsletter', piece_type: 'newsletter', active: true },
  { material_id: '_gift', name: 'Gift', piece_type: 'gift', active: true },
  { material_id: '_other', name: 'Other', piece_type: 'other', active: true },
];

export default function useMailMaterials() {
  const [materials, setMaterials] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mailMaterials.getAll();
      const rows = Array.isArray(r.data) ? r.data.filter(m => m.active !== false) : [];
      setMaterials(rows.length ? rows : FALLBACK);
    } catch { setMaterials(FALLBACK); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return { materials, loading, reload };
}
```

**4. Implement `frontend/src/components/mail/MaterialsPanel.js`:**

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailMaterials } from '../../lib/api';
import { Package, Plus, Archive, RotateCcw } from 'lucide-react';

// D3: the one place the Materials list is edited. Retiring a material never
// deletes it — drip steps that name it must keep firing and keep reading back.
export default function MaterialsPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', piece_type: 'other' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await mailMaterials.getAll({ include_inactive: 1 });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch { toast.error('Could not load materials'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.name.trim()) { toast.error('Give the material a name'); return; }
    setBusy(true);
    try {
      await mailMaterials.create({ name: form.name.trim(), piece_type: form.piece_type.trim() });
      toast.success('Material added');
      setForm({ name: '', piece_type: 'other' });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not add it'); }
    finally { setBusy(false); }
  };

  const setActive = async (m, active) => {
    if (!active && !window.confirm(
      `Retire "${m.name}"?\n\nSequences already using it keep working — it just stops being offered.`)) return;
    try {
      if (active) await mailMaterials.update(m.material_id, { active: true });
      else await mailMaterials.deactivate(m.material_id);
      load();
    } catch { toast.error('Update failed'); }
  };

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const inp = 'h-10 w-full rounded-lg px-3 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btnP = 'inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50';

  return (
    <div className={`${card} p-5`} data-testid="materials-panel">
      <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2 mb-1">
        <Package className="h-4 w-4 text-[#e94560]" /> Materials
      </h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">
        One list for everything you post. Drip steps and manual mail runs both pick from here,
        so a catalogue you can plan is a catalogue you can actually post.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input className={inp} placeholder="Material name (e.g. 2026 Die Catalogue)"
          value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          data-testid="material-new-name" />
        <input className={inp} placeholder="Piece type (e.g. catalogue)"
          value={form.piece_type} onChange={e => setForm(p => ({ ...p, piece_type: e.target.value }))}
          data-testid="material-new-piece" />
        <button className={btnP} disabled={busy} onClick={add} data-testid="material-add">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(m => (
          <div key={m.material_id} data-testid={`material-row-${m.material_id}`}
            className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {m.name}{m.active === false ? <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">retired</span> : null}
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">{m.piece_type}</p>
            </div>
            {m.active === false ? (
              <button title="Bring back" onClick={() => setActive(m, true)}
                data-testid={`material-restore-${m.material_id}`}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[#e94560]">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button title="Retire" onClick={() => setActive(m, false)}
                data-testid={`material-deactivate-${m.material_id}`}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-500">
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center sm:col-span-2">
            No materials yet.
          </p>
        )}
      </div>
    </div>
  );
}
```

**5. Rewire `DripsTab.js`.** Add the import and hook:

```js
import useMailMaterials from '../../hooks/useMailMaterials';
// …inside the component, beside the other hooks:
const { materials } = useMailMaterials();
```

Replace the physical-material block at `:518-538` with:

```jsx
                      {s.message_type === 'physical_material' && (() => {
                        const known = materials.some(m => m.piece_type === (s.material_type || 'brochure'));
                        return (
                          <>
                            <select
                              value={known ? (s.material_type || 'brochure') : (s.material_type || '')}
                              onChange={e => {
                                const v = e.target.value;
                                setForm(p => ({ ...p, steps: p.steps.map((ss, ii) =>
                                  ii === i ? { ...ss, material_type: v === '__other__' ? '' : v } : ss) }));
                              }}
                              className="h-9 px-2 rounded text-sm bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                              data-testid={`step-material-${i}`}>
                              {materials.map(m => (
                                <option key={m.material_id} value={m.piece_type}>{m.name}</option>
                              ))}
                              {/* D3: a legacy free-text value keeps working — it is shown
                                  as-is rather than being silently rewritten to "brochure". */}
                              {!known && s.material_type ? (
                                <option value={s.material_type}>{s.material_type} (not in Materials)</option>
                              ) : null}
                              <option value="__other__">Other…</option>
                            </select>
                            {!known && s.material_type ? (
                              <span data-testid={`step-material-legacy-${i}`}
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#9A6A15]/15 text-[#9A6A15]">
                                not in Materials
                              </span>
                            ) : null}
                            {(!known || !s.material_type) && (
                              <input
                                value={s.material_type || ''}
                                onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) =>
                                  ii === i ? { ...ss, material_type: e.target.value } : ss) }))}
                                className="h-9 px-2 rounded text-sm bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] w-32"
                                placeholder="Piece type"
                                data-testid={`step-material-other-${i}`} />
                            )}
                            <input
                              value={s.material_name || ''}
                              onChange={e => setForm(p => ({ ...p, steps: p.steps.map((ss, ii) =>
                                ii === i ? { ...ss, material_name: e.target.value } : ss) }))}
                              className="h-9 px-2 rounded text-sm bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] flex-1 min-w-[160px]"
                              placeholder="Item name — what are you sending? (e.g. 2026 Die Catalogue + Sample Kit)"
                              data-testid={`step-material-name-${i}`} />
                          </>
                        );
                      })()}
```

and immediately after that block's closing `)}` — still inside the step card, before the
`{s.message_type !== 'physical_material' && (` at `:540` — add the note:

```jsx
                    {s.message_type === 'physical_material' && (
                      <p className={`px-3 pb-2 text-[11px] ${tk.tm}`} data-testid={`step-mailer-note-${i}`}>
                        On day {s.delay_days ?? 0} this creates a mailer in <b>Offline Mail → To post</b>.
                        Post it and tick it there.
                      </p>
                    )}
```

**6. Rewire `SequenceEnrollDialog.js`.** Add `import useMailMaterials from '../../hooks/useMailMaterials';`
and `const { materials } = useMailMaterials();` inside the component. Replace the post-step
material input with the same select shape, and add the note under a post step:

```jsx
                    {isPost && (
                      <>
                        <select className={sm + ' w-full mt-2'} value={s.material_type || 'brochure'}
                          onChange={e => setStep(i, { material_type: e.target.value })}
                          data-testid={`seq-step-material-${i}`}>
                          {materials.map(m => (
                            <option key={m.material_id} value={m.piece_type}>{m.name}</option>
                          ))}
                          {!materials.some(m => m.piece_type === (s.material_type || 'brochure')) && s.material_type ? (
                            <option value={s.material_type}>{s.material_type} (not in Materials)</option>
                          ) : null}
                        </select>
                        <input className={sm + ' w-full mt-2'} value={s.material_name || ''}
                          onChange={e => setStep(i, { material_name: e.target.value })}
                          placeholder="What are you sending?"
                          data-testid={`seq-step-material-name-${i}`} />
                        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]"
                          data-testid={`seq-step-mailer-note-${i}`}>
                          On day {s.delay_days || 0} this creates a mailer in <b>Offline Mail → To post</b>.
                          Post it and tick it there.
                        </p>
                      </>
                    )}
```

**7. Rewire the two `PIECES` lists.**
- `frontend/src/pages/admin/OfflineMail.js`: delete `const PIECES = [...]` (`:15`), add
  `const { materials } = useMailMaterials();`, and change the run-piece select (`:396-398`) to
  `{materials.map(m => <option key={m.material_id} value={m.piece_type}>{m.name}</option>)}`.
  Render `<MaterialsPanel />` for the `materials` tab added in B4.
- `frontend/src/components/mail/ManualMailRunBuilder.js`: delete `const PIECES = [...]` (`:6`),
  add the hook, and change the select at `:136-137` the same way.

**8. Verify `mapSeq` carries the material (A2).** `frontend/src/lib/marketingUtils.js:112-142`
drops `material_type`/`material_name`. If Sub-project A has not landed, add them to the mapped
step in the same commit — otherwise editing any sequence wipes every post step's material and
this task's picker has nothing to show:

```js
      material_type: s.material_type || '',
      material_name: s.material_name || '',
      ...(s.attachment_id ? { attachment_id: s.attachment_id } : {}),
```

**9. Backend test that a legacy value still fires.** Append to
`backend/tests/test_mail_materials.py`:

```python
def test_a_step_with_a_legacy_material_value_still_fires(db, monkeypatch):
    """D3: `material_type: "poster"` is not in the catalogue and never will be —
    it must still produce a mailer, not a crash or a silent skip."""
    async def go():
        _as(monkeypatch, ADMIN)
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                     "is_deleted": False})
        await crm.create_physical_from_drip(
            {"lead_id": "l1", "contact_name": "R Sharma", "company_name": "DPS",
             "school_id": "s1", "assigned_to": "parul@smartshape.in"},
            "poster", "Legacy plan", material_name="Old poster",
            sequence_id="seqL", enrollment_id="eL", step_number=1,
            planned_date="2026-09-01")
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t is not None and t["piece_type"] == "poster"
        assert t["item_name"] == "Old poster"
    _run(go())
```

**10. Run both suites — expect green.**
```
cd frontend && npx craco test --watchAll=false --testPathPattern "MaterialsPanel|DripsTabMaterial"
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_mail_materials.py -q
```

**11. Commit.**
```
git add frontend/src/hooks/useMailMaterials.js frontend/src/components/mail/MaterialsPanel.js frontend/src/components/mail/__tests__/MaterialsPanel.test.js frontend/src/components/marketing/DripsTab.js frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js frontend/src/components/crm/SequenceEnrollDialog.js frontend/src/pages/admin/OfflineMail.js frontend/src/components/mail/ManualMailRunBuilder.js frontend/src/lib/marketingUtils.js backend/tests/test_mail_materials.py
git commit -m "feat(marketing): drip steps and mail runs pick from one shared Materials list"
```

---

## Task D1 — `GET /reports/marketing-sent` with `group_by` and CSV

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/crm_routes.py` | insert after `reports_hub` ends at `:1122`, before the gap-report note at `:1125` |
| modify | `frontend/src/lib/api.js` | `reports` object (`hub` at `:1070`) |
| create | `backend/tests/test_marketing_sent_report.py` | new |

### Interfaces

**Consumes:** `db.drip_step_logs` (`{enrollment_id, sequence_id, lead_id, contact_id,
step_number, message_type, status, error, fired_at}`, written `scheduler.py:644-655`),
`db.mail_touches`, `db.drip_sequences`, `db.leads`, `db.contacts`, `db.schools`,
`_schools_visibility_or` `:3486`, `_contacts_visibility_or` `:4563`, `_merge_or` `:4577`,
`get_team` (rbac), `_CHANNEL_OF`-equivalent mapping (local copy — `crm_routes.py` must not import
from `drip_routes.py`, which imports from it).

**Produces:**
`GET /reports/marketing-sent?group_by=school|contact|sequence&from=&to=&sequence_id=&owner=&channel=&format=csv`
→ JSON:
```json
{"group_by": "school",
 "rows": [{"key": "s1", "label": "DPS", "owner": "parul@smartshape.in",
           "sequences": ["Principal Pitch"],
           "sent_by_channel": {"whatsapp": 0, "email": 0, "call": 0, "post": 1},
           "post": {"verified_sent": 1, "pending": 0, "not_sent": 0, "needs_address": 0},
           "last_sent_at": "2026-09-20",
           "responses": {"qr_scans": 0, "interest": 0}}],
 "totals": {"rows": 1, "sent_by_channel": {...}, "post": {...},
            "responses": {"qr_scans": 0, "interest": 0}},
 "from": "", "to": ""}
```
`?format=csv` streams the same rows as `text/csv` with header
`key,label,owner,sequences,whatsapp,email,call,post,post_verified_sent,post_pending,post_not_sent,post_needs_address,last_sent_at,qr_scans,interest`
and `Content-Disposition: attachment; filename=marketing_sent_{group_by}.csv`.
Front-end client: `reports.marketingSent(params)` and `reports.marketingSentCsv(params)`.

**Counting rule (must be identical in all three `group_by` modes so their totals agree):**
a POST channel send is counted from `mail_touches`, never from `drip_step_logs` — a fired
physical step writes both, and counting both would double every posted piece.
`sent_by_channel.post` is touches with `verify_status == "sent"`. WhatsApp / email / call are
`drip_step_logs` rows with `status == "sent"` and the matching `message_type`.

### Steps

**1. Failing test first.** Create `backend/tests/test_marketing_sent_report.py`:

```python
"""D6: one endpoint, three group_by modes, and a CSV that matches the JSON."""
import asyncio
import csv
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.schools.insert_many([
        {"school_id": "s1", "school_name": "DPS", "assigned_to": "parul@smartshape.in",
         "is_deleted": False},
        {"school_id": "s2", "school_name": "Lotus", "assigned_to": "bde@smartshape.in",
         "is_deleted": False},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c1", "name": "R Sharma", "school_id": "s1",
         "assigned_to": "parul@smartshape.in"},
        {"contact_id": "c2", "name": "A Menon", "school_id": "s2",
         "assigned_to": "bde@smartshape.in"},
    ])
    await db.leads.insert_one({"lead_id": "l1", "contact_id": "c1", "school_id": "s1",
                               "contact_name": "R Sharma", "assigned_to": "parul@smartshape.in"})
    await db.drip_sequences.insert_many([
        {"sequence_id": "seq1", "name": "Principal Pitch"},
        {"sequence_id": "seq2", "name": "Quiz Engage"},
    ])
    # s1: one WhatsApp step sent, one post step VERIFIED sent.
    await db.drip_step_logs.insert_many([
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "contact_id": "",
         "step_number": 1, "message_type": "whatsapp", "status": "sent",
         "fired_at": "2026-09-10T06:00:00+00:00"},
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "contact_id": "",
         "step_number": 2, "message_type": "physical_material", "status": "sent",
         "fired_at": "2026-09-12T06:00:00+00:00"},
        # s2: one post step fired but NOT yet verified, and a failed email.
        {"enrollment_id": "e2", "sequence_id": "seq2", "lead_id": "", "contact_id": "c2",
         "step_number": 1, "message_type": "physical_material", "status": "sent",
         "fired_at": "2026-09-14T06:00:00+00:00"},
        {"enrollment_id": "e2", "sequence_id": "seq2", "lead_id": "", "contact_id": "c2",
         "step_number": 2, "message_type": "email", "status": "failed",
         "fired_at": "2026-09-15T06:00:00+00:00"},
    ])
    await db.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "r1", "school_id": "s1", "sequence_id": "seq1",
         "enrollment_id": "e1", "step_number": 2, "piece_type": "brochure",
         "verify_status": "sent", "posted_at": "2026-09-13T00:00:00+00:00",
         "planned_date": "2026-09-12", "owner": "parul@smartshape.in",
         "contact_ids": ["c1"], "recipient_names": ["R Sharma"],
         "responded": True, "interested": True},
        {"touch_id": "t2", "run_id": "r2", "school_id": "s2", "sequence_id": "seq2",
         "enrollment_id": "e2", "step_number": 1, "piece_type": "brochure",
         "verify_status": "pending", "posted_at": None, "planned_date": "2026-09-14",
         "owner": "bde@smartshape.in", "contact_ids": ["c2"],
         "recipient_names": ["A Menon"], "responded": False, "interested": False},
    ])


def test_group_by_school_splits_sent_from_merely_queued(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        by = {r["key"]: r for r in out["rows"]}
        assert by["s1"]["label"] == "DPS"
        assert by["s1"]["sent_by_channel"] == {"whatsapp": 1, "email": 0, "call": 0, "post": 1}
        assert by["s1"]["post"]["verified_sent"] == 1
        assert by["s1"]["last_sent_at"] == "2026-09-13"
        assert by["s1"]["responses"] == {"qr_scans": 1, "interest": 1}
        assert by["s1"]["sequences"] == ["Principal Pitch"]
        # s2 was reached only by post, and that post has NOT been verified yet.
        assert by["s2"]["post"]["pending"] == 1
        assert by["s2"]["post"]["verified_sent"] == 0
        assert by["s2"]["sent_by_channel"]["post"] == 0, \
            "queued is not sent - the piece is still on someone's desk"
        assert by["s2"]["sent_by_channel"]["email"] == 0, "a failed email is not a send"
    _run(go())


def test_verifying_moves_a_school_from_pending_to_verified_sent(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await db.mail_touches.update_one({"touch_id": "t2"}, {"$set": {
            "verify_status": "sent", "posted_at": "2026-09-16T00:00:00+00:00"}})
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        s2 = next(r for r in out["rows"] if r["key"] == "s2")
        assert s2["post"] == {"verified_sent": 1, "pending": 0, "not_sent": 0,
                              "needs_address": 0}
        assert s2["sent_by_channel"]["post"] == 1
        assert s2["last_sent_at"] == "2026-09-16"
    _run(go())


def test_the_three_modes_agree_on_their_totals(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        outs = {}
        for g in ("school", "contact", "sequence"):
            outs[g] = await crm.marketing_sent_report(FakeRequest(params={"group_by": g}))
        base = outs["school"]["totals"]
        for g in ("contact", "sequence"):
            assert outs[g]["totals"]["sent_by_channel"] == base["sent_by_channel"], g
            assert outs[g]["totals"]["post"] == base["post"], g
            assert outs[g]["totals"]["responses"] == base["responses"], g
    _run(go())


def test_group_by_contact_and_sequence_key_and_label(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        by_contact = await crm.marketing_sent_report(FakeRequest(params={"group_by": "contact"}))
        keys = {r["key"]: r["label"] for r in by_contact["rows"]}
        assert keys == {"c1": "R Sharma", "c2": "A Menon"}
        by_seq = await crm.marketing_sent_report(FakeRequest(params={"group_by": "sequence"}))
        keys = {r["key"]: r["label"] for r in by_seq["rows"]}
        assert keys == {"seq1": "Principal Pitch", "seq2": "Quiz Engage"}
    _run(go())


def test_date_sequence_owner_and_channel_filters(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        only_seq1 = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "sequence_id": "seq1"}))
        assert [r["key"] for r in only_seq1["rows"]] == ["s1"]
        only_mine = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "owner": "parul@smartshape.in"}))
        assert [r["key"] for r in only_mine["rows"]] == ["s1"]
        post_only = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "channel": "post"}))
        assert all(r["sent_by_channel"]["whatsapp"] == 0 for r in post_only["rows"])
        late = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "from": "2026-09-13"}))
        assert [r["key"] for r in late["rows"]] == ["s2"]
    _run(go())


def test_a_rep_sees_only_her_schools(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        assert [r["key"] for r in out["rows"]] == ["s1"]
    _run(go())


def test_csv_has_the_same_rows_as_json(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        js = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        resp = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "format": "csv"}))
        body = b"".join([chunk async for chunk in resp.body_iterator]) \
            if hasattr(resp, "body_iterator") else resp.body
        text = body.decode() if isinstance(body, (bytes, bytearray)) else body
        rows = list(csv.DictReader(io.StringIO(text)))
        assert len(rows) == len(js["rows"])
        assert [r["key"] for r in rows] == [r["key"] for r in js["rows"]]
        first = rows[0]
        assert first["label"] == js["rows"][0]["label"]
        assert int(first["post"]) == js["rows"][0]["sent_by_channel"]["post"]
        assert int(first["qr_scans"]) == js["rows"][0]["responses"]["qr_scans"]
    _run(go())
```

**2. Run — expect failure.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_marketing_sent_report.py -q
```

**3. Implement.** In `backend/routes/crm_routes.py`, insert immediately after `reports_hub`
ends (`:1122`) and before the gap-report path note at `:1125`:

```python
# D6: ONE endpoint with a group_by. School / contact / sequence roll-ups are the
# same query grouped differently — so the three views can never disagree about
# how much marketing actually went out. No new collection: everything comes from
# drip_step_logs + mail_touches, which already carry sequence_id, enrollment_id,
# step_number, school_id, contact_id and touch_id.
_MS_CHANNELS = ("whatsapp", "email", "call", "post")
# `drip_step_logs.message_type` -> report channel. Mirrors drip_routes._CHANNEL_OF
# (:912); duplicated deliberately, because drip_routes imports FROM this module.
_MS_CHANNEL_OF = {"whatsapp": "whatsapp", "email": "email",
                  "physical_material": "post", "call_task": "call"}
_MS_CSV_FIELDS = ["key", "label", "owner", "sequences", "whatsapp", "email", "call", "post",
                  "post_verified_sent", "post_pending", "post_not_sent", "post_needs_address",
                  "last_sent_at", "qr_scans", "interest"]


def _ms_blank(key, label, owner):
    return {"key": key, "label": label, "owner": owner, "sequences": [],
            "sent_by_channel": {c: 0 for c in _MS_CHANNELS},
            "post": {"verified_sent": 0, "pending": 0, "not_sent": 0, "needs_address": 0},
            "last_sent_at": "", "responses": {"qr_scans": 0, "interest": 0}}


@router.get("/reports/marketing-sent")
async def marketing_sent_report(request: Request):
    """Every school / contact / sequence we have actually reached, and by what.

    A POST send is counted from `mail_touches`, NOT from `drip_step_logs`: a fired
    physical step writes both rows, so counting both would double every posted
    piece and make the three group_by modes disagree. "Sent" for post means
    VERIFIED sent — a piece the drip queued but nobody carried to the counter is
    `post.pending`, not a send."""
    user = await get_current_user(request)
    qp = request.query_params
    group_by = qp.get("group_by") or "school"
    if group_by not in ("school", "contact", "sequence"):
        raise HTTPException(status_code=400, detail="group_by must be school, contact or sequence")
    d_from, d_to = (qp.get("from") or "").strip(), (qp.get("to") or "").strip()
    want_seq = (qp.get("sequence_id") or "").strip()
    want_owner = (qp.get("owner") or "").strip()
    want_channel = (qp.get("channel") or "").strip()

    def _in_range(day: str) -> bool:
        if not day:
            return not (d_from or d_to)
        if d_from and day < d_from:
            return False
        if d_to and day > d_to:
            return False
        return True

    seqs = {s["sequence_id"]: s.get("name", "") for s in await db.drip_sequences.find(
        {}, {"_id": 0, "sequence_id": 1, "name": 1}).to_list(None)}
    leads = {l["lead_id"]: l for l in await db.leads.find(
        {}, {"_id": 0, "lead_id": 1, "contact_id": 1, "school_id": 1,
             "contact_name": 1, "assigned_to": 1}).to_list(None)}
    contacts = {c["contact_id"]: c for c in await db.contacts.find(
        {}, {"_id": 0, "contact_id": 1, "name": 1, "school_id": 1,
             "assigned_to": 1}).to_list(None)}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1, "assigned_to": 1}).to_list(None)}

    # Visibility — the SAME helpers the CRM lists use, so a rep's report agrees
    # with the rows she can open.
    vis_schools = vis_contacts = None
    if get_team(user) != "admin" and user.get("role") != "admin":
        email = user["email"]
        vis_schools = {s["school_id"] for s in await db.schools.find(
            _merge_or({}, await _schools_visibility_or(email)),
            {"_id": 0, "school_id": 1}).to_list(None)}
        vis_contacts = {c["contact_id"] for c in await db.contacts.find(
            _merge_or({}, await _contacts_visibility_or(email)),
            {"_id": 0, "contact_id": 1}).to_list(None)}

    def _resolve(lead_id, contact_id, touch=None):
        """(school_id, contact_id, owner) for one delivery row, whichever key it has."""
        lead = leads.get(lead_id or "", {})
        cid = contact_id or lead.get("contact_id") or ""
        if touch and not cid:
            cid = (touch.get("contact_ids") or [""])[0]
        contact = contacts.get(cid, {})
        sid = lead.get("school_id") or contact.get("school_id") or \
            (touch or {}).get("school_id") or ""
        owner = lead.get("assigned_to") or contact.get("assigned_to") \
            or schools.get(sid, {}).get("assigned_to", "") or (touch or {}).get("owner", "")
        return sid, cid, owner

    def _visible(sid, cid):
        if vis_schools is None:
            return True
        return (sid and sid in vis_schools) or (cid and cid in vis_contacts)

    def _key_of(sid, cid, sequence_id):
        if group_by == "school":
            return (sid or "_none",
                    schools.get(sid, {}).get("school_name") or "(no school)")
        if group_by == "contact":
            return (cid or "_none", contacts.get(cid, {}).get("name") or "(no contact)")
        return (sequence_id or "_none", seqs.get(sequence_id) or "(deleted sequence)")

    groups = {}

    def _bucket(sid, cid, sequence_id, owner):
        key, label = _key_of(sid, cid, sequence_id)
        g = groups.get(key)
        if g is None:
            g = groups[key] = _ms_blank(key, label, owner)
        elif not g["owner"] and owner:
            g["owner"] = owner
        name = seqs.get(sequence_id)
        if name and name not in g["sequences"]:
            g["sequences"].append(name)
        return g

    # ── Non-post channels: the step log is the record ──────────────────────
    for lg in await db.drip_step_logs.find({}, {"_id": 0}).to_list(20000):
        ch = _MS_CHANNEL_OF.get(lg.get("message_type", ""), "")
        if ch in ("", "post"):
            continue                      # post is counted from mail_touches
        if lg.get("status") != "sent":
            continue                      # failed / skipped is not a send
        sequence_id = lg.get("sequence_id", "")
        if want_seq and sequence_id != want_seq:
            continue
        if want_channel and want_channel != ch:
            continue
        day = str(lg.get("fired_at") or "")[:10]
        if not _in_range(day):
            continue
        sid, cid, owner = _resolve(lg.get("lead_id"), lg.get("contact_id"))
        if want_owner and owner != want_owner:
            continue
        if not _visible(sid, cid):
            continue
        g = _bucket(sid, cid, sequence_id, owner)
        g["sent_by_channel"][ch] += 1
        if day > g["last_sent_at"]:
            g["last_sent_at"] = day

    # ── Post: the mail touch is the record of truth (D4) ───────────────────
    runs = {r["run_id"]: r for r in await db.mail_runs.find(
        {}, {"_id": 0, "run_id": 1, "sequence_id": 1}).to_list(None)}
    for t in await db.mail_touches.find({}, {"_id": 0}).to_list(20000):
        sequence_id = t.get("sequence_id") or runs.get(t.get("run_id"), {}).get("sequence_id", "")
        if want_seq and sequence_id != want_seq:
            continue
        if want_channel and want_channel != "post":
            continue
        status = t.get("verify_status", "pending")
        day = str(t.get("posted_at") or "")[:10] or (t.get("planned_date") or "")
        if not _in_range(day):
            continue
        sid, cid, owner = _resolve(t.get("lead_id"), t.get("contact_id"), t)
        if want_owner and owner != want_owner:
            continue
        if not _visible(sid, cid):
            continue
        g = _bucket(sid, cid, sequence_id, owner)
        if status == "sent":
            g["sent_by_channel"]["post"] += 1
            g["post"]["verified_sent"] += 1
            posted_day = str(t.get("posted_at") or "")[:10]
            if posted_day > g["last_sent_at"]:
                g["last_sent_at"] = posted_day
        elif status == "not_sent":
            g["post"]["not_sent"] += 1
        elif status == "needs_address":
            g["post"]["needs_address"] += 1
        else:
            g["post"]["pending"] += 1
        if t.get("responded"):
            g["responses"]["qr_scans"] += 1
        if t.get("interested"):
            g["responses"]["interest"] += 1

    rows = sorted(groups.values(),
                  key=lambda r: (-sum(r["sent_by_channel"].values()), r["label"]))
    totals = {
        "rows": len(rows),
        "sent_by_channel": {c: sum(r["sent_by_channel"][c] for r in rows) for c in _MS_CHANNELS},
        "post": {k: sum(r["post"][k] for r in rows)
                 for k in ("verified_sent", "pending", "not_sent", "needs_address")},
        "responses": {k: sum(r["responses"][k] for r in rows) for k in ("qr_scans", "interest")},
    }

    if (qp.get("format") or "").lower() == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(_MS_CSV_FIELDS)
        for r in rows:
            writer.writerow([
                r["key"], r["label"], r["owner"], "|".join(r["sequences"]),
                r["sent_by_channel"]["whatsapp"], r["sent_by_channel"]["email"],
                r["sent_by_channel"]["call"], r["sent_by_channel"]["post"],
                r["post"]["verified_sent"], r["post"]["pending"],
                r["post"]["not_sent"], r["post"]["needs_address"],
                r["last_sent_at"], r["responses"]["qr_scans"], r["responses"]["interest"],
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]), media_type="text/csv",
            headers={"Content-Disposition":
                     f"attachment; filename=marketing_sent_{group_by}.csv"})

    return {"group_by": group_by, "rows": rows, "totals": totals,
            "from": d_from, "to": d_to}
```

Confirm `csv`, `io` and `StreamingResponse` are already imported in `crm_routes.py`
(`grep -n "^import csv\|^import io\|StreamingResponse" backend/routes/crm_routes.py`); add the
stdlib ones to the existing import block if missing (constraint 5 allows stdlib only).

**4. Add the API client.** In `frontend/src/lib/api.js`, inside the `reports` object
(next to `hub: () => API.get('/reports/hub')` at `:1070`):

```js
  // D6: one endpoint, three roll-ups. params: {group_by, from, to, sequence_id, owner, channel}
  marketingSent: (params = {}) => API.get('/reports/marketing-sent', { params }),
  marketingSentCsv: (params = {}) => API.get('/reports/marketing-sent',
    { params: { ...params, format: 'csv' }, responseType: 'blob' }),
```

**5. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_marketing_sent_report.py -q
```

**6. Commit.**
```
git add backend/routes/crm_routes.py frontend/src/lib/api.js
git add -f backend/tests/test_marketing_sent_report.py
git commit -m "feat(reports): GET /reports/marketing-sent with school/contact/sequence roll-ups and CSV"
```

---

## Task D2 — Reports hub entry and the "Marketing sent" page

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/crm_routes.py` | `REPORT_CATALOGUE` marketing section `:1033-1042`; `reports_hub` metrics `:1067-1106` |
| create | `frontend/src/pages/admin/MarketingSentReport.js` | pattern: `ReportsHub.js:33-104` |
| create | `frontend/src/pages/admin/__tests__/MarketingSentReport.test.js` | new |
| modify | `frontend/src/App.js` | `ReportsHub` lazy import `:87`; route `:271` |
| modify | `backend/tests/test_marketing_sent_report.py` | add the hub-catalogue assertion |

### Interfaces

**Consumes:** `reports.marketingSent(params)` / `reports.marketingSentCsv(params)` (D1),
`reports.hub()` (`api.js:1070`).

**Produces:**
- `REPORT_CATALOGUE` marketing section gains
  `("marketing_sent", "Marketing sent", "Every school, contact and sequence we have actually reached.", "/reports/marketing-sent", False)`
  and `metrics["marketing_sent"] = {"label": "schools reached", "value": <int>, "tone": "neutral"}`
  where the value is `len(distinct school_id on mail_touches with verify_status "sent")`.
- route `/reports/marketing-sent` → `<MarketingSentReport />`.
- Test ids: `ms-tab-school`, `ms-tab-contact`, `ms-tab-sequence`, `ms-row-{key}`,
  `ms-export`, `ms-from`, `ms-to`, `ms-owner`, `ms-channel`, `ms-totals`.

### Steps

**1. Failing tests first.**

Append to `backend/tests/test_marketing_sent_report.py`:

```python
def test_the_report_appears_in_the_hub_catalogue(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        hub = await crm.reports_hub(FakeRequest())
        marketing = next(s for s in hub["sections"] if s["key"] == "marketing")
        row = next(r for r in marketing["reports"] if r["key"] == "marketing_sent")
        assert row["title"] == "Marketing sent"
        assert row["route"] == "/reports/marketing-sent"
        assert row["metric"]["value"] == 1, "one school has a verified-sent piece"
    _run(go())
```

Create `frontend/src/pages/admin/__tests__/MarketingSentReport.test.js`:

```js
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MarketingSentReport from '../MarketingSentReport';
import { reports } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../components/layouts/AdminLayout', () => ({ children }) => <div>{children}</div>);
jest.mock('../../../lib/api', () => ({
  reports: { marketingSent: jest.fn(), marketingSentCsv: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const PAYLOAD = {
  group_by: 'school',
  rows: [
    { key: 's1', label: 'DPS', owner: 'parul@smartshape.in', sequences: ['Principal Pitch'],
      sent_by_channel: { whatsapp: 1, email: 0, call: 0, post: 1 },
      post: { verified_sent: 1, pending: 0, not_sent: 0, needs_address: 0 },
      last_sent_at: '2026-09-13', responses: { qr_scans: 1, interest: 1 } },
    { key: 's2', label: 'Lotus', owner: 'bde@smartshape.in', sequences: ['Quiz Engage'],
      sent_by_channel: { whatsapp: 0, email: 0, call: 0, post: 0 },
      post: { verified_sent: 0, pending: 1, not_sent: 0, needs_address: 0 },
      last_sent_at: '', responses: { qr_scans: 0, interest: 0 } },
  ],
  totals: { rows: 2, sent_by_channel: { whatsapp: 1, email: 0, call: 0, post: 1 },
            post: { verified_sent: 1, pending: 1, not_sent: 0, needs_address: 0 },
            responses: { qr_scans: 1, interest: 1 } },
  from: '', to: '',
};

beforeEach(() => {
  reports.marketingSent.mockImplementation(() => Promise.resolve({ data: PAYLOAD }));
  reports.marketingSentCsv.mockImplementation(() =>
    Promise.resolve({ data: new Blob(['key,label\n']) }));
});

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarketingSentReport />);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return {
    container,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    rowKeys: () => Array.from(container.querySelectorAll('[data-testid^="ms-row-"]'))
      .map(el => el.getAttribute('data-testid').replace('ms-row-', '')),
    unmount: () => act(() => root.unmount()),
  };
}

test('loads the school roll-up by default', async () => {
  const v = await render();
  expect(reports.marketingSent.mock.calls[0][0].group_by).toBe('school');
  expect(v.rowKeys()).toEqual(['s1', 's2']);
  v.unmount();
});

test('a school reached only by post shows pending, not sent', async () => {
  const v = await render();
  const row = v.q('ms-row-s2').textContent;
  expect(row).toContain('Lotus');
  expect(row).toContain('1 pending');
  v.unmount();
});

test('switching the toggle refetches with the new group_by', async () => {
  const v = await render();
  await act(async () => {
    v.q('ms-tab-contact').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const last = reports.marketingSent.mock.calls.pop()[0];
  expect(last.group_by).toBe('contact');
  v.unmount();
});

test('export asks for the same rows as CSV', async () => {
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
  const v = await render();
  await act(async () => {
    v.q('ms-export').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(reports.marketingSentCsv).toHaveBeenCalledWith(
    expect.objectContaining({ group_by: 'school' }));
  v.unmount();
});
```

**2. Run both — expect failure.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_marketing_sent_report.py -q
cd frontend && npx craco test --watchAll=false --testPathPattern "MarketingSentReport"
```

**3. Implement the hub entry.** In `backend/routes/crm_routes.py`, in the `"marketing"` section of
`REPORT_CATALOGUE` (`:1033-1042`), insert after the `("drip", …)` tuple:

```python
        ("marketing_sent", "Marketing sent",
         "Every school, contact and sequence we have actually reached.",
         "/reports/marketing-sent", False),
```

In `reports_hub`, beside the other counters (`:1067-1081`) add:

```python
    reached = await _safe(db.mail_touches.distinct("school_id", {"verify_status": "sent"}), [])
    schools_reached = len([s for s in reached if s]) if isinstance(reached, list) else 0
```

and in the `metrics` dict (`:1086-1106`), after the `"mail_gap"` entry:

```python
        "marketing_sent": {"label": "schools reached", "value": schools_reached,
                           "tone": "neutral"},
```

**4. Implement `frontend/src/pages/admin/MarketingSentReport.js`:**

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import AdminLayout from '../../components/layouts/AdminLayout';
import { reports } from '../../lib/api';
import { Send, Download, RefreshCw } from 'lucide-react';

// D6: the three roll-ups are the SAME query grouped differently, so the toggle
// changes one parameter and nothing else. "Sent" for post means verified sent —
// a piece the drip queued but nobody posted shows as pending, deliberately.
const MODES = [['school', 'School'], ['contact', 'Contact'], ['sequence', 'Sequence']];
const CHANNELS = [['', 'All channels'], ['whatsapp', 'WhatsApp'], ['email', 'Email'],
                  ['call', 'Call'], ['post', 'Post']];

export default function MarketingSentReport() {
  const [groupBy, setGroupBy] = useState('school');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [channel, setChannel] = useState('');
  const [data, setData] = useState({ rows: [], totals: {} });
  const [loading, setLoading] = useState(true);

  const params = useCallback(
    () => ({ group_by: groupBy, from, to, owner, channel }),
    [groupBy, from, to, owner, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await reports.marketingSent(params());
      setData(r.data || { rows: [], totals: {} });
    } catch { toast.error('Could not load the report'); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => { load(); }, [load]);

  const owners = Array.from(new Set((data.rows || []).map(r => r.owner).filter(Boolean)));

  const exportCsv = async () => {
    try {
      const r = await reports.marketingSentCsv(params());
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `marketing-sent-${groupBy}.csv`; a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);   // must be in the DOM to download in Firefox/Safari
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error('Export failed'); }
  };

  const card = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
  const inp = 'h-9 rounded-lg px-2.5 text-[13px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const t = data.totals || {};
  const ch = t.sent_by_channel || {};
  const po = t.post || {};

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
              <Send className="h-6 w-6 text-[#e94560]" /> Marketing sent
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Everyone we have actually reached, and by what. A posted piece only counts once
              someone has ticked it in <b>Offline Mail → To post</b>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={exportCsv} data-testid="ms-export"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-sm font-semibold">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={load} disabled={loading}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] text-sm font-semibold disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex items-center gap-1">
              {MODES.map(([k, label]) => (
                <button key={k} onClick={() => setGroupBy(k)} data-testid={`ms-tab-${k}`}
                  className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${
                    groupBy === k ? 'bg-[#e94560] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)}
              data-testid="ms-from" aria-label="From" />
            <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)}
              data-testid="ms-to" aria-label="To" />
            <select className={inp} value={owner} onChange={e => setOwner(e.target.value)}
              data-testid="ms-owner">
              <option value="">All owners</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className={inp} value={channel} onChange={e => setChannel(e.target.value)}
              data-testid="ms-channel">
              {CHANNELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap gap-3 mb-4 text-[11px] font-mono text-[var(--text-secondary)]"
            data-testid="ms-totals">
            <span>WhatsApp <b className="text-[var(--text-primary)]">{ch.whatsapp ?? 0}</b></span>
            <span>Email <b className="text-[var(--text-primary)]">{ch.email ?? 0}</b></span>
            <span>Call <b className="text-[var(--text-primary)]">{ch.call ?? 0}</b></span>
            <span>Post <b className="text-[var(--text-primary)]">{ch.post ?? 0}</b></span>
            <span className="text-[#9A6A15]">still to post <b>{(po.pending ?? 0) + (po.needs_address ?? 0)}</b></span>
            <span className="text-[#e94560]">responses <b>{(t.responses || {}).qr_scans ?? 0}</b></span>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
                    <th className="py-2 pr-3">{MODES.find(m => m[0] === groupBy)[1]}</th>
                    <th className="py-2 pr-3">Owner</th><th className="py-2 pr-3">Sequences</th>
                    <th className="py-2 pr-3">WA</th><th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Call</th><th className="py-2 pr-3">Post</th>
                    <th className="py-2 pr-3">Still to post</th>
                    <th className="py-2 pr-3">Last sent</th><th className="py-2 pr-3">Responses</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map(r => {
                    const owed = (r.post?.pending || 0) + (r.post?.needs_address || 0);
                    return (
                      <tr key={r.key} data-testid={`ms-row-${r.key}`}
                        className="border-t border-[var(--border-color)]">
                        <td className="py-2 pr-3 text-[var(--text-primary)] font-medium">{r.label}</td>
                        <td className="py-2 pr-3 text-[11px] text-[var(--text-muted)]">{r.owner || '—'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">
                          {(r.sequences || []).join(', ') || '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.whatsapp ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.email ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.call ?? 0}</td>
                        <td className="py-2 pr-3 font-mono">{r.sent_by_channel?.post ?? 0}</td>
                        <td className="py-2 pr-3 font-mono" style={{ color: owed ? '#9A6A15' : 'inherit' }}>
                          {owed ? `${owed} pending` : '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">
                          {r.last_sent_at || '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[#e94560]">
                          {r.responses?.qr_scans ?? 0}
                          {r.responses?.interest ? ` (${r.responses.interest} interested)` : ''}
                        </td>
                      </tr>
                    );
                  })}
                  {(data.rows || []).length === 0 && (
                    <tr><td colSpan="10" className="py-10 text-center text-[var(--text-muted)]">
                      Nothing has gone out in this window yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
```

**5. Register the route.** In `frontend/src/App.js`, beside the `ReportsHub` lazy import (`:87`):

```js
const MarketingSentReport = lazyRoute(() => import('./pages/admin/MarketingSentReport'));
```

and beside the `/reports` route (`:271`):

```jsx
      <Route path="/reports/marketing-sent" element={<ProtectedRoute><MarketingSentReport /></ProtectedRoute>} />
```

**6. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_marketing_sent_report.py -q
cd frontend && npx craco test --watchAll=false --testPathPattern "MarketingSentReport"
```

**7. Commit.**
```
git add backend/routes/crm_routes.py backend/tests/test_marketing_sent_report.py frontend/src/pages/admin/MarketingSentReport.js frontend/src/pages/admin/__tests__/MarketingSentReport.test.js frontend/src/App.js
git commit -m "feat(reports): Marketing sent page and Reports hub entry"
```

---

## Task D3 — Deliveries drill-down gains Contact, Owner and Export

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/drip_routes.py` | `sequence_deliveries` `:950-1046`; row build `:1022-1032`; filters `:1034-1040` |
| modify | `frontend/src/components/marketing/DripsTab.js` | drill-down header `:352-357`, body `:360-385`, buttons `:325-334` |
| create | `backend/tests/test_sequence_deliveries_columns.py` | new |
| modify | `frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js` | add the drill-down column test |

### Interfaces

**Consumes:** `dripSequences.deliveries(id, params)` (`api.js:549`).

**Produces:** each `sequence_deliveries` row gains `recipient_name: str` and
`recipient_kind: "lead"|"contact"`; a new `owner` query filter. The drill-down table gains
Contact and Owner columns (9 total) and an Export button producing a client-side CSV with
header `school,contact,owner,step,channel,item,planned,actual,status`.

### Steps

**1. Failing test first.** Create `backend/tests/test_sequence_deliveries_columns.py`:

```python
"""D: the deliveries drill-down must name the PERSON, not just the school."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.drip_routes as drip
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(drip, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(drip, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "Principal Pitch",
        "steps": [{"step_number": 1, "delay_days": 0, "message_type": "physical_material",
                   "material_type": "catalogue", "material_name": "2026 Catalogue"}]})
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                 "assigned_to": "parul@smartshape.in"})
    await db.leads.insert_one({"lead_id": "l1", "school_id": "s1", "contact_name": "R Sharma",
                               "company_name": "DPS", "assigned_to": "parul@smartshape.in"})
    await db.contacts.insert_one({"contact_id": "c2", "name": "A Menon", "school_id": "s1",
                                  "company": "DPS", "assigned_to": "bde@smartshape.in"})
    await db.drip_enrollments.insert_many([
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "status": "active",
         "enrolled_at": "2026-09-10T00:00:00+00:00", "current_step": 0},
        {"enrollment_id": "e2", "sequence_id": "seq1", "contact_id": "c2", "status": "active",
         "enrolled_at": "2026-09-10T00:00:00+00:00", "current_step": 0},
    ])


def test_every_row_names_the_person_and_the_owner(db):
    async def go():
        await _seed(db)
        out = await drip.sequence_deliveries("seq1", FakeRequest())
        by = {r["enrollment_id"]: r for r in out["rows"]}
        assert by["e1"]["recipient_name"] == "R Sharma"
        assert by["e1"]["recipient_kind"] == "lead"
        assert by["e1"]["owner"] == "parul@smartshape.in"
        assert by["e2"]["recipient_name"] == "A Menon"
        assert by["e2"]["recipient_kind"] == "contact"
        assert by["e2"]["owner"] == "bde@smartshape.in"
    _run(go())


def test_the_owner_filter_narrows_the_rows(db):
    async def go():
        await _seed(db)
        out = await drip.sequence_deliveries(
            "seq1", FakeRequest(params={"owner": "bde@smartshape.in"}))
        assert [r["enrollment_id"] for r in out["rows"]] == ["e2"]
    _run(go())
```

**2. Run — expect failure.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_sequence_deliveries_columns.py -q
```

**3. Implement.** In `backend/routes/drip_routes.py`, `sequence_deliveries`:

- the contacts projection at `:970-974` already fetches `name`; add `"contact_name": 1` to the
  leads fetch if it is projected away (it is a full `{"_id": 0}` fetch today, so nothing to do).
- in the per-enrolment branch (`:993-1001`), set the recipient alongside `sid`/`owner`:

```python
        if lead or not enr.get("contact_id"):   # lead-keyed (as before)
            sid = lead.get("school_id", "")
            school_name = schools.get(sid, {}).get("school_name") or lead.get("company_name", "")
            owner = lead.get("assigned_to", "")
            recipient_kind, recipient_name = "lead", lead.get("contact_name", "")
        else:
            sid = contact.get("school_id") or enr.get("school_id") or ""
            school_name = schools.get(sid, {}).get("school_name") or contact.get("company", "")
            owner = contact.get("assigned_to") or schools.get(sid, {}).get("assigned_to", "")
            recipient_kind, recipient_name = "contact", contact.get("name", "")
```

- in the row dict (`:1022-1032`), after `"owner": owner,` add:

```python
                # The drill-down is the "who did we actually reach" screen; a
                # school name alone cannot answer it once contacts are enrolled
                # directly (a contact-keyed drip has no lead at all).
                "recipient_kind": recipient_kind,
                "recipient_name": recipient_name,
```

- in the filter block (`:1034-1040`), after the `channel` filter add:

```python
    if qp.get("owner"):
        rows = [r for r in rows if r["owner"] == qp["owner"]]
```

**4. Front end.** In `frontend/src/components/marketing/DripsTab.js`:

- add an Export button next to the drill-down totals chips (after the chips `div` closing at
  `:348`):

```jsx
                        <button onClick={() => exportDeliveries(d)} data-testid={`deliveries-export-${d.id}`}
                          className={`ml-auto h-7 px-2.5 rounded-lg border ${tk.bdr} text-[11px] ${tk.tm} ${tk.hov} inline-flex items-center gap-1`}>
                          <Download className="h-3 w-3" /> Export
                        </button>
```
  (wrap the chips row and this button in a `flex items-center gap-1.5 mb-2` container, and add
  `Download` to the existing `lucide-react` import.)

- add the exporter beside the other handlers:

```jsx
  // Client-side CSV of exactly the rows on screen — the drill-down is already
  // filtered, so exporting anything else would not match what was asked for.
  const exportDeliveries = (d) => {
    const rows = deliveries?.rows || [];
    const head = ['school', 'contact', 'owner', 'step', 'channel', 'item',
                  'planned', 'actual', 'status'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(',')].concat(rows.map(r => [
      r.school_name, r.recipient_name, r.owner, r.step_number, r.channel,
      r.item, r.planned_date, r.actual_date, r.status,
    ].map(esc).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(d.name || 'sequence').replace(/[^\w-]+/g, '-')}-deliveries.csv`;
    a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);      // must be in the DOM for .click() in Firefox/Safari
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
```

- the header row (`:352-357`) becomes 9 columns:

```jsx
                                <th className="py-1.5 pr-2">School</th>
                                <th className="py-1.5 pr-2">Contact</th>
                                <th className="py-1.5 pr-2">Owner</th>
                                <th className="py-1.5 pr-2">Step</th>
                                <th className="py-1.5 pr-2">Channel</th><th className="py-1.5 pr-2">Item</th>
                                <th className="py-1.5 pr-2">Planned</th><th className="py-1.5 pr-2">Actual</th>
                                <th className="py-1.5 pr-2">Status</th>
```

- add the two cells after the School cell (`:369`):

```jsx
                                  <td className={`py-1.5 pr-2 ${tk.t1}`}>{r.recipient_name || '—'}</td>
                                  <td className={`py-1.5 pr-2 text-[10px] ${tk.tm}`}>{r.owner || '—'}</td>
```

- change the empty-state `colSpan="7"` (`:383`) to `colSpan="9"`.

**5. Append the front-end assertion** to
`frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js`:

```js
test('the deliveries drill-down names the contact and the owner', async () => {
  const { dripSequences } = jest.requireMock('../../../lib/api');
  dripSequences.deliveries.mockImplementation(() => Promise.resolve({ data: {
    rows: [{ enrollment_id: 'e1', school_id: 's1', school_name: 'DPS',
             recipient_name: 'R Sharma', recipient_kind: 'lead',
             owner: 'parul@smartshape.in', step_number: 1, channel: 'mail',
             item: '2026 Catalogue', planned_date: '2026-09-10', actual_date: '',
             status: 'queued' }],
    totals: { queued: 1 } } }));
  const v = await renderTab({
    drips: [{ id: 'seq1', sequence_id: 'seq1', name: 'Pitch', is_active: true, steps: [] }],
  });
  await act(async () => {
    v.q('deliveries-seq1').click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  const table = v.q('deliveries-table').textContent;
  expect(table).toContain('R Sharma');
  expect(table).toContain('parul@smartshape.in');
  expect(v.q('deliveries-export-seq1')).not.toBeNull();
  v.unmount();
});
```

**6. Run — expect green.**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_sequence_deliveries_columns.py -q
cd frontend && npx craco test --watchAll=false --testPathPattern "DripsTabMaterial"
```

**7. Commit.**
```
git add backend/routes/drip_routes.py frontend/src/components/marketing/DripsTab.js frontend/src/components/marketing/__tests__/DripsTabMaterial.test.js
git add -f backend/tests/test_sequence_deliveries_columns.py
git commit -m "feat(marketing): deliveries drill-down names the contact and owner, with export"
```

---

## Task 10 — Deployment: bundle, migration order, smoke checks

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `frontend/build/**` | current live bundle `main.cc2f3835.js` (`frontend/build/index.html`) |
| run | `backend/migrations/link_dispatches_to_touches.py` | task B2 |

### Interfaces

**Consumes:** every artefact from B1–D3.
**Produces:** a merge commit on `main` (which the VPS timer auto-deploys, ~100 s), a rebuilt
`frontend/build/` with a new `main.*.js` hash, and a `--apply`ed production backfill.

### Steps

**1. Full backend suite for everything touched (never a bare `pytest tests/`).**
```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest \
  tests/test_to_post_linking.py \
  tests/test_link_dispatches_migration.py \
  tests/test_to_post_endpoint.py \
  tests/test_mail_materials.py \
  tests/test_marketing_sent_report.py \
  tests/test_sequence_deliveries_columns.py \
  tests/test_drip_physical_mailer.py \
  tests/test_drip_to_offline_mail_chain.py \
  tests/test_contact_drip_enrol.py \
  tests/test_contact_drip_executor.py \
  tests/test_contact_drip_integrity.py \
  tests/test_drip_enroll_scoping.py \
  tests/test_drip_executor_concurrency.py \
  tests/test_drip_resume_guard.py \
  -q
```
All must pass. The four neighbouring drip suites are in the list because B1 changed
`create_physical_from_drip`'s write shape and `scheduler.py`'s executor entry.

**2. Full frontend suite.**
```
cd frontend && npx craco test --watchAll=false
```

**3. Rebuild the bundle (constraint 7).**
```
cd frontend && npx craco build
```
If the build fails on the pre-existing `react-hooks/exhaustive-deps` eslint rule rather than on
new code, that is the known repo quirk — confirm the failure names a file this branch did not
touch before working around it; do NOT "fix" unrelated hooks in this branch.

Confirm a NEW hash landed:
```
git status --short frontend/build
grep -o 'static/js/main\.[a-z0-9]*\.js' frontend/build/index.html
```
The hash must differ from `main.cc2f3835.js`. Then:
```
git add frontend/build
git commit -m "chore(frontend): rebuild bundle for To-post queue, Materials and Marketing sent"
```

**4. Dry-run the migration against production — and stop.**
```
cd backend && python migrations/link_dispatches_to_touches.py
```
Read the output back to the owner in plain words: how many dispatches get linked, how many
`needs_address` mailers get created (expect ~39 given the 2026-09-22 snapshot), how many touches
get flagged, how many `needs_dispatch` flags get unset. **Wait for an explicit yes.**

**5. Apply, only after that yes.**
```
cd backend && python migrations/link_dispatches_to_touches.py --apply
```
Re-run the dry-run afterwards; it must report `linked: 0, touches_created: 0` (idempotent).

**6. Push and let the VPS timer deploy.**
```
git checkout main && git merge --no-ff feat/drip-offline-mail-bcd
git push origin main
```
Prod auto-deploys from `origin/main` (~1-2 min). Do not build on the VPS and do not rebuild the
committed bundle off a drifted `main` — that is exactly what caused the 2026-06-25 outage.

**7. Smoke checks on the live site, in this order.**

| # | Check | Expected |
|---|---|---|
| 1 | `/offline-mail` opens | **To post** is the first tab and is selected |
| 2 | The To post table | rows across more than one run; overdue rows at the top |
| 3 | A school-less row | shows a **Needs address** badge, not a blank school |
| 4 | Tick one row → **Mark posted** | the row leaves Pending; `/physical-dispatches` for that lead now shows `sent_date` |
| 5 | **Undo** on the same row | back to pending, and the dispatch's `sent_date` is blank again |
| 6 | Offline Mail → **Materials** | seven seeded materials; adding one succeeds; a duplicate name 409s with a readable message |
| 7 | Marketing → New sequence → post step | the material dropdown lists Newsletter (it could not before) and the note names *Offline Mail → To post* |
| 8 | Schools → Start Marketing Plan → Build a new one → Post something | same list, same note |
| 9 | Offline Mail → Runs & areas → Pick manually | the piece dropdown lists Catalogue/Kit/Gift (it could not before) |
| 10 | Edit an existing sequence with a post step, save, reopen | the material name survives (A2 / C2 step 8) |
| 11 | `/reports` | "Marketing sent" appears under Marketing with a live number |
| 12 | `/reports/marketing-sent` | School / Contact / Sequence toggles all load; their channel totals are identical |
| 13 | Export on that page | CSV downloads with the same number of rows as the table |
| 14 | Marketing → a sequence → "What was sent, and where" | Contact and Owner columns present; Export downloads |
| 15 | As a sales rep login | the To post queue and the report show only her schools |

**8. If anything is wrong,** revert the merge commit on `main` and push — the bundle is committed,
so a revert restores the previous working front end in one deploy. The migration is *not*
reverted by that: it only adds links and flagged rows, both of which the old code ignores
(`needs_dispatch` was read nowhere, and an extra `mail_touches` row with an unknown
`verify_status` is simply not counted as pending by the old `_recompute_run_counts`).

---

## Self-review

### Spec coverage

| Spec requirement | Task |
|---|---|
| B/Data: `mail_touches` gains `contact_ids`, `recipient_names`, `dispatch_ids` | B1 |
| B/Data: `VERIFY_STATUSES` gains `needs_address` | B1 |
| B/Data: `physical_dispatches` gains `touch_id`, written on both sides in the same call | B1 |
| B/Data: school-less contact still creates the touch, `needs_address` (D2) | B1 |
| B/Data: `needs_dispatch` derived, not stored (D4) | B1 (derive on read), B2 (`$unset`) |
| B/Data: `needs_address` → `pending` on the next executor pass (D2) | B1 (`repair_needs_address_touches`, called from `scheduler.py`) |
| B/Data: backfill migration, dry-run default, `--apply` | B2 |
| B/Endpoint: `GET /mail-runs/to-post` with the 18 named fields + totals | B3 |
| B/Endpoint: reps scoped by `_schools_visibility_or`; admins see all | B3 |
| B/Endpoint: cap 2,000, overdue-first | B3 |
| B/Endpoint: verification reuses `POST /mail-runs/{id}/verify`, grouped by run (D5) | B3 (server), B4 (`groupByRun`) |
| B/Endpoint: `_do_verify` mirrors `sent_date`/`courier` onto the dispatch (D4) | B3 |
| B/UI: To post tab, first tab | B4 (tab strip), C2 (Materials tab beside it) |
| B/UI: columns School · Recipients · Item · Sequence · Due · Status · Owner | B4 |
| B/UI: `useBulkSelect` — one-by-one, header, shift-range, hidden count | B4 |
| B/UI: sticky bar — Mark posted (date) · Not posted (reason) · Undo · Print stickers | B4 |
| B/UI: filters — status chips, sequence, owner, date range, search | B4 |
| B/UI: `needs_address` badge linking to the school/contact | B4 |
| B/UI: mobile card list with the same checkbox | B4 |
| B/UI: Dispatch Tracking "sent" reads from the linked touch | B4 step 6 |
| C: `mail_materials` collection + CRUD under Offline Mail → Materials, `leads:read_write` | C1 (backend), C2 (panel) |
| C: seeded per D3 with the union + `other` | C1 |
| C: legacy free-text value shown as-is and flagged | C2 |
| C: drip step `material_type` becomes a select + "Other…" | C2 |
| C: `SequenceEnrollDialog` "Post something" uses the same list | C2 |
| C: manual mail-run `piece_type` uses the same list | C2 (both `PIECES` lists) |
| C: the dialog note "On day N this creates a mailer…" | C2 |
| C: `_CHANNEL_OF` and the executor unchanged | C2 (no change made to either) |
| D: `GET /reports/marketing-sent` with `group_by`, `from`, `to`, `sequence_id`, `owner`, `channel` | D1 |
| D: rows carry key/name/owner, `sequences`, `sent_by_channel`, `post`, `last_sent_at`, `responses` | D1 |
| D: grand totals | D1 |
| D: reps scoped by the same visibility helpers | D1 |
| D: `?format=csv` streams the same rows | D1 |
| D: Reports hub entry "Marketing sent" | D2 |
| D: School / Contact / Sequence toggle, filters, export | D2 |
| D: deliveries drill-down gains Contact + Owner columns and Export | D3 |
| Testing/B: fired post step writes touch + dispatch linked both ways | B1 test 1 |
| Testing/B: three contacts at one school → one touch, three names | B1 test 2 |
| Testing/B: school-less → `needs_address`, visible in `/to-post`, `pending` after gaining a school | B1 tests 3+5, B3 test 1 |
| Testing/B: ticking in To post sets the touch AND the dispatch | B3 test 5 |
| Testing/B: reps see only their schools | B3 test 4 |
| Testing/B: backfill dry-run writes nothing | B2 test 1 |
| Testing/C: materials CRUD | C1 test 3 |
| Testing/C: a step with a legacy value still fires | C2 step 9 |
| Testing/C: both dropdowns read the same list | C2 (shared `useMailMaterials`; asserted in the DripsTab test, and the manual builder uses the identical hook) |
| Testing/D: the three `group_by` modes agree | D1 test 3 |
| Testing/D: post-only school shows `post.pending` until verified, then `verified_sent` | D1 tests 1+2 |
| Testing/D: CSV has the same rows as JSON | D1 test 7 |
| Testing: all tests mock SMTP / WhatsApp / push | B1 fixture (`_send_wa`, `_smtp_send` raise); the other suites never reach the executor |
| Rollout: B and C ship together, D last; backfill dry-run then `--apply`; bundle rebuild | Deployment task |

Not covered here, by design: Sub-project A (separate branch), and everything in the spec's
**Out of scope** list. C2 step 8 carries A2's `mapSeq` fix as a *prerequisite check* only — if
Sub-project A has already landed it, that step is a verification, not an edit.

### Placeholder scan

Searched every task for `TODO`, `FIXME`, `...`, "add validation", "similar to", "as above",
"etc.", "and so on", "left as an exercise":
- **0** occurrences of `TODO` / `FIXME` / "add validation" / "left as an exercise".
- "similar to" / "same as task N": **0**. Where two surfaces share behaviour (the material select
  in `DripsTab.js` and `SequenceEnrollDialog.js`; the two `PIECES` lists) the JSX is written out
  separately for each, and the shared logic is a named module (`useMailMaterials`) rather than a
  cross-reference.
- One deliberate elision: B4 step 5's `{tab === 'runs' && (<>…</>)}` block, which says *"everything
  that is here today, unchanged"* rather than reproducing ~200 lines of `OfflineMail.js` verbatim.
  That is a move, not new code — the named line refs (`:176`, `:178-200`, `:203-227`, `:230`,
  `:233-269`, `:272-378`) identify exactly what moves inside it.
- Every test file is complete and runnable; every implementation block is paste-ready except the
  three places that explicitly say *verify before writing*: `_days_late`'s argument order (B3),
  `re` (C1) and `csv`/`io`/`StreamingResponse` (D1) already being imported.

### Type and name consistency across tasks

| Name | Defined | Consumed | Agrees? |
|---|---|---|---|
| `verify_status` value `"needs_address"` | B1 (`VERIFY_STATUSES`) | B2 (migration writes it), B3 (filter + totals), B4 (chip + badge), D1 (`post.needs_address`), D2 (page "still to post") | yes |
| `mail_touches.contact_ids: [str]` | B1 | B2 (`$addToSet`/insert), B3 (visibility + row), D1 (`_resolve` fallback) | yes — always a list, never a scalar; the `{"contact_ids": cid}` query form is a Mongo array-contains match, not a shape change |
| `mail_touches.recipient_names: [str]` | B1 | B2, B3 (row), B4 (`recipients(r)`) | yes |
| `mail_touches.dispatch_ids: [str]` | B1 | B2 (`$addToSet`) | yes |
| `physical_dispatches.touch_id: str` | B1 | B2 (match filter), B3 (`_do_verify` mirror), B1 (derived `needs_dispatch`) | yes — `""` when unlinked, never `None` |
| `repair_needs_address_touches() -> {"repaired": int}` | B1 | `scheduler.py` executor entry (B1) | yes |
| `mail_to_post` response `rows[].overdue_days: int >= 0` | B3 | B4 (`+Nd` badge, sort already server-side) | yes |
| `mail_to_post` `totals` keys | B3 (`VERIFY_STATUSES` + overdue/shown/capped) | B4 chips read `totals[v]` for each chip value | yes — chip values `pending`/`needs_address`/`sent`/`not_sent` are all `VERIFY_STATUSES` members; the `overdue` chip reads `totals.overdue`; the `''` chip shows no count |
| `mailRuns.toPost(params)` | B3 | B4 | yes |
| `mail_materials` doc `{material_id, name, piece_type, active, created_by, created_at}` | C1 | C2 (`useMailMaterials`, `MaterialsPanel`), the two piece selects | yes |
| step `material_type` = a material's `piece_type` (not its `name`, not its `material_id`) | C2 | B1 (`piece = material_type`), C1 seed, D1 (`piece_type` on the touch) | yes — the select's `value` is `m.piece_type` in all three places it appears |
| `mailMaterials.{getAll, create, update, deactivate}` | C1 | C2 | yes |
| `_MS_CHANNELS = ("whatsapp","email","call","post")` | D1 | D2 (table columns, totals strip), D1 CSV header | yes |
| report row `post` keys `verified_sent/pending/not_sent/needs_address` | D1 | D2 ("still to post" = `pending + needs_address`), D1 CSV | yes |
| `reports.marketingSent` / `marketingSentCsv` | D1 | D2 | yes |
| deliveries row `recipient_name` / `recipient_kind` | D3 (`drip_routes`) | D3 (DripsTab cells, CSV) | yes — note `GET /schools/{id}/drips` (`drip_routes.py:~918`) already uses these two field names for the same meaning, so the vocabulary is consistent across both drip screens |
| `_merge_or(query, or_clause)` | existing `crm_routes.py:4577` | B3, D1 | yes — both pass a fresh `{}` as `query`, so the `$and` branch never fires |
| test fixture shape (`FakeRequest`, monkeypatched `db`, `_run`) | `test_drip_to_offline_mail_chain.py:29-56` | all six new backend test files | yes |
| frontend test shape (`createRoot` + `act`, `jest.mock`, no testing-library) | `ContactsTab.test.js:6-14,125-145` | all four new frontend test files | yes |

One naming choice worth flagging for review: B1 adds **both** a scalar `enrollment_id` (kept from
today's schema, so `sequence_deliveries`' `touches[(enrollment_id, step_number)]` lookup at
`drip_routes.py:~980` keeps working) **and** an `enrollment_ids` array (so a shared envelope
remembers every enrolment that contributed to it). They are deliberately redundant; the scalar
stays the first contributor's id and is never rewritten.
