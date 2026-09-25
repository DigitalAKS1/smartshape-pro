"""SP5 — reminders & recurring obligations. Live test server; self-cleaning ('RemTest').

SEND-SAFE: run the server with the auto-loop OFF so run-due is the only dispatcher:
  cd backend && DB_NAME=smartshape_test REMINDERS_DISABLE_LOOP=1 \
    python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning
  REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp5_reminders.py -v
The fixture disables email config and uses fake recipients, so nothing is ever delivered.
"""
import os, uuid, datetime as dt
import pytest, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
PFX = "RemTest"
FAKE_EMAIL = "remtest@test.invalid"
FAKE_PHONE = "19999999999"


class TestSP5:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = requests.Session()
        self.s.headers.update({"Content-Type": "application/json"})
        r = self.s.post(f"{BASE}/api/auth/login",
                        json={"email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, r.text
        tok = self.s.cookies.get("access_token")
        if tok:
            self.s.headers.update({"Authorization": f"Bearer {tok}"})
        self.s.post(f"{BASE}/api/delegation/sync-users", json={})
        # disable email delivery so enqueued rows can NEVER send during tests
        self._prev_email = self.s.get(f"{BASE}/api/settings/email").json()
        self.s.post(f"{BASE}/api/settings/email", json={
            "sender_name": "T", "sender_email": "", "gmail_app_password": "", "enabled": False})
        self._ids = []
        yield
        for rid in self._ids:
            try:
                self.s.delete(f"{BASE}/api/delegation/reminders/{rid}")
            except Exception:
                pass
        self.s.post(f"{BASE}/api/settings/email", json=self._prev_email)

    def _create(self, **over):
        body = {"title": f"{PFX} {uuid.uuid4().hex[:6]}", "category": "subscription",
                "amount": 4200, "recurrence": "monthly",
                "due_date": "2026-07-05", "due_time": "09:00",
                "lead_offsets": [{"value": 1, "unit": "day"}, {"value": 2, "unit": "hour"}],
                "channels": {"email": True, "whatsapp": True},
                "recipients": [{"type": "email", "email": FAKE_EMAIL, "phone": FAKE_PHONE}]}
        body.update(over)
        r = self.s.post(f"{BASE}/api/delegation/reminders", json=body)
        if r.status_code == 200:
            self._ids.append(r.json()["reminder_id"])
        return r

    def _run_due(self):
        return self.s.post(f"{BASE}/api/delegation/reminders/run-due", json={})

    # ── CRUD + validation ────────────────────────────────────────────────────
    def test_01_create_defaults(self):
        r = self._create()
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["channels"] == {"email": True, "whatsapp": True}
        assert len(d["lead_offsets"]) == 2
        assert d["status"] == "active"
        # creator auto-added as a recipient
        assert any(rc.get("type") == "user" for rc in d["recipients"])

    def test_02_validation(self):
        assert self.s.post(f"{BASE}/api/delegation/reminders",
                           json={"due_date": "2026-07-05", "recurrence": "monthly"}).status_code == 400
        assert self._create(recurrence="weekly").status_code == 400
        assert self._create(channels={"email": False, "whatsapp": False}).status_code == 400

    def test_03_list_returns_own(self):
        r = self._create()
        rid = r.json()["reminder_id"]
        lst = self.s.get(f"{BASE}/api/delegation/reminders").json()["reminders"]
        assert any(x["reminder_id"] == rid for x in lst)

    # ── dispatcher ───────────────────────────────────────────────────────────
    def test_04_run_due_fires_in_window(self):
        # due tomorrow → within the 1-day lead window NOW → should fire
        today = dt.date.today().isoformat()
        r = self._create(recurrence="once", due_date=today, due_time="23:59",
                         lead_offsets=[{"value": 1, "unit": "day"}])
        rid = r.json()["reminder_id"]
        out = self._run_due().json()
        assert any(f["reminder_id"] == rid for f in out["fired"]), out
        # idempotent: second pass does NOT re-fire this reminder
        out2 = self._run_due().json()
        assert not any(f["reminder_id"] == rid for f in out2["fired"]), out2

    def test_05_run_due_outside_window_silent(self):
        # due far in the future, only a 2-hour lead → nothing now
        future = (dt.date.today() + dt.timedelta(days=40)).isoformat()
        r = self._create(recurrence="once", due_date=future, due_time="09:00",
                         lead_offsets=[{"value": 2, "unit": "hour"}])
        rid = r.json()["reminder_id"]
        out = self._run_due().json()
        assert not any(f["reminder_id"] == rid for f in out["fired"]), out

    def test_06_enqueues_pending_rows(self):
        today = dt.date.today().isoformat()
        r = self._create(recurrence="once", due_date=today, due_time="23:59",
                         lead_offsets=[{"value": 1, "unit": "day"}])
        out = self._run_due().json()
        # email disabled in fixture → loop can't drain → rows persist for assertion
        assert out["enqueued_email"] >= 1
        assert out["enqueued_wa"] >= 1

    def test_07_paused_does_not_fire(self):
        today = dt.date.today().isoformat()
        r = self._create(recurrence="once", due_date=today, due_time="23:59",
                         lead_offsets=[{"value": 1, "unit": "day"}])
        rid = r.json()["reminder_id"]
        self.s.post(f"{BASE}/api/delegation/reminders/{rid}/pause", json={})
        out = self._run_due().json()
        assert not any(f["reminder_id"] == rid for f in out["fired"])

    # ── agenda integration ───────────────────────────────────────────────────
    def test_08_agenda_shows_reminder(self):
        r = self._create(recurrence="yearly", due_date="2026-12-15", due_time="10:00")
        rid = r.json()["reminder_id"]
        ag = self.s.get(f"{BASE}/api/delegation/agenda",
                        params={"from": "2026-12-01", "to": "2026-12-31"}).json()
        item = next((e for e in ag["events"]
                     if e["source"] == "reminder" and e["entity_id"] == rid), None)
        assert item and item["date"] == "2026-12-15"
        assert item["meta"]["category"] == "subscription"

    # ── next occurrence ──────────────────────────────────────────────────────
    def test_10_next_occurrence_future_for_past_anchor(self):
        # monthly anchored on a PAST date → next_occurrence must be today-or-later
        r = self._create(recurrence="monthly", due_date="2020-01-15", due_time="09:00")
        rid = r.json()["reminder_id"]
        lst = self.s.get(f"{BASE}/api/delegation/reminders").json()["reminders"]
        rem = next(x for x in lst if x["reminder_id"] == rid)
        assert rem["next_occurrence"] >= dt.date.today().isoformat(), rem["next_occurrence"]
        assert rem["next_occurrence"].endswith("-15")

    # ── in-app channel ───────────────────────────────────────────────────────
    def test_11_inapp_notification_for_creator(self):
        # creator is an internal user → reminder also fires an in-app notification
        today = dt.date.today().isoformat()
        r = self._create(recurrence="once", due_date=today, due_time="23:59",
                         lead_offsets=[{"value": 1, "unit": "day"}])
        out = self._run_due().json()
        assert out["enqueued_inapp"] >= 1, out

    # ── bulk import ──────────────────────────────────────────────────────────
    def test_09_bulk_import(self):
        rows = [
            {"title": f"{PFX} bulk-A", "recurrence": "monthly", "due_date": "2026-08-01",
             "channels": {"email": True, "whatsapp": False},
             "recipients": [{"type": "email", "email": FAKE_EMAIL}]},
            {"title": f"{PFX} bulk-B", "recurrence": "yearly", "due_date": "2026-09-09",
             "recipients": [{"type": "email", "email": FAKE_EMAIL}]},
            {"recurrence": "monthly", "due_date": "2026-08-01"},  # bad: no title
        ]
        r = self.s.post(f"{BASE}/api/delegation/reminders/bulk", json={"rows": rows})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2
        assert len(d["errors"]) == 1 and d["errors"][0]["row"] == 2
        # cleanup the two created
        for x in self.s.get(f"{BASE}/api/delegation/reminders").json()["reminders"]:
            if x["title"].startswith(f"{PFX} bulk"):
                self._ids.append(x["reminder_id"])
