"""run_auto_reminders() must never touch drip_enrollments.

It used to be a second drip executor: it found due drip_enrollments and, for
a WhatsApp step, only inserted a whatsapp_logs row (status: "queued") without
ever delivering anything, then advanced current_step/next_step_at as if the
step had gone out. Because it looped every 60s versus the real executor's
(scheduler.py) hourly cadence, it nearly always reached a due step first and
consumed it — producing 131 stuck-"queued" drip whatsapp_logs rows in
production and marking sequences complete without sending. The drip block
was removed from this function; everything else it does (overdue tasks,
stale leads, pending quotations, birthdays/anniversaries, scheduled
WhatsApp, greeting rules, delegation overdue) must keep working. mongomock.
"""
import asyncio
import inspect
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.admin_routes as admin


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(admin, "db", d, raising=False)
    return d


# ── Source-level guard ──────────────────────────────────────────────────────

def test_run_auto_reminders_source_never_mentions_drip_enrollments():
    src = inspect.getsource(admin.run_auto_reminders)
    assert "drip_enrollments" not in src
    assert "drip_sequences" not in src


# ── Runtime: one loop iteration must leave drip_enrollments untouched ──────

class _StopLoop(Exception):
    pass


async def _run_one_iteration(monkeypatch):
    """run_auto_reminders() is an infinite `while True` loop that sleeps 60s
    between passes. Make the sleep raise after the first pass so the test can
    observe exactly one iteration's effect."""
    calls = {"n": 0}

    async def fake_sleep(_seconds):
        calls["n"] += 1
        raise _StopLoop()

    monkeypatch.setattr(admin.asyncio, "sleep", fake_sleep)
    with pytest.raises(_StopLoop):
        await admin.run_auto_reminders()


def test_an_active_due_drip_enrollment_is_left_completely_untouched(db, monkeypatch):
    async def go():
        await db.drip_sequences.insert_one({
            "sequence_id": "seq1", "name": "Welcome", "is_active": True,
            "steps": [{"step_number": 1, "message_type": "whatsapp",
                       "message_template": "hi", "delay_days": 1}],
        })
        await db.leads.insert_one({
            "lead_id": "lead1", "contact_phone": "9800000000",
            "company_name": "X", "stage": "new",
            "updated_at": "2026-09-11T00:00:00+00:00",
        })
        due_at = "2020-01-01T00:00:00+00:00"  # long overdue
        await db.drip_enrollments.insert_one({
            "enrollment_id": "enr1", "lead_id": "lead1", "sequence_id": "seq1",
            "status": "active", "current_step": 0, "next_step_at": due_at,
        })

        await _run_one_iteration(monkeypatch)

        enr = await db.drip_enrollments.find_one({"enrollment_id": "enr1"})
        assert enr["status"] == "active"
        assert enr["current_step"] == 0
        assert enr["next_step_at"] == due_at
        assert await db.whatsapp_logs.count_documents({"send_mode": "drip"}) == 0
        assert await db.call_notes.count_documents({}) == 0
    _run(go())


def test_greetings_and_delegation_alerts_still_fire(db, monkeypatch):
    # Non-drip behavior in the same loop must be unaffected by removing the
    # drip block.
    #
    # `_push`/`_push_admins` route through routes.push_routes, whose module-
    # level `db` is imported straight from `database` and is NOT the
    # mongomock `db` this fixture patches onto `admin`. If an earlier test
    # module already loaded backend/.env into the environment, push_routes'
    # `db` is the REAL production database — letting this test's delegation-
    # overdue alert run unpatched would read the real admin list and push a
    # live "Delegation Overdue" notification to their browsers. Neutralise
    # both push entry points with no-op recorders so this test has zero
    # outward side effects, and assert on the recordings instead.
    push_calls = []
    push_admin_calls = []

    async def fake_push(email, title, body, url="/today", tag="general"):
        push_calls.append({"email": email, "title": title, "body": body, "url": url, "tag": tag})

    async def fake_push_admins(title, body, url="/today", tag="admin"):
        push_admin_calls.append({"title": title, "body": body, "url": url, "tag": tag})

    monkeypatch.setattr(admin, "_push", fake_push)
    monkeypatch.setattr(admin, "_push_admins", fake_push_admins)

    async def go():
        from datetime import datetime, timezone
        today_mmdd = datetime.now(timezone.utc).strftime("%m-%d")
        await db.greeting_rules.insert_one({
            "rule_id": "gr1", "is_active": True, "trigger": "fixed_date",
            "fixed_date": today_mmdd, "audience": "all_contacts",
            "template_body": "Happy day {name}!", "sent_total": 0,
        })
        await db.contacts.insert_one({
            "contact_id": "c1", "name": "Ravi", "phone": "9811111111",
        })
        past_due = "2020-01-01"
        await db.del_task_instances.insert_one({
            "instance_id": "di1", "status": "pending", "due_date": past_due,
            "task_title": "Follow up", "emp_name": "Ravi",
        })

        await _run_one_iteration(monkeypatch)

        assert await db.greeting_logs.count_documents({"rule_id": "gr1"}) == 1
        assert await db.whatsapp_scheduled.count_documents({"rule_id": "gr1"}) == 1
        note = await db.notifications.find_one({"type": "delegation_overdue"})
        assert note is not None
        # The delegation-overdue push must have gone through the patched
        # recorder, not a real push_routes call.
        assert any(c["tag"] == "delegation_overdue" for c in push_admin_calls)
    _run(go())


def test_a_completed_enrollment_status_is_also_left_alone(db, monkeypatch):
    # Guards against any residual code path re-touching a "completed" record.
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "enr2", "lead_id": "lead2", "sequence_id": "seq1",
            "status": "completed", "current_step": 1,
            "next_step_at": "2020-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:00:00+00:00",
        })
        await _run_one_iteration(monkeypatch)
        enr = await db.drip_enrollments.find_one({"enrollment_id": "enr2"})
        assert enr["status"] == "completed"
        assert enr["completed_at"] == "2026-01-01T00:00:00+00:00"
    _run(go())
