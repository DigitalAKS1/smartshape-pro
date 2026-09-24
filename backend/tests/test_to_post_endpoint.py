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

    async def body(self):
        import json as _json
        return _json.dumps(self._body).encode()

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


def test_the_chip_counts_survive_the_status_filter(db, monkeypatch):
    """`totals_all` is independent of the status filter, so a chip never reads 0
    merely because a different chip is the one currently selected."""
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.mail_to_post(FakeRequest(params={"status": "needs_address",
                                                         "as_of": "2026-09-22"}))
        assert [r["touch_id"] for r in out["rows"]] == ["t3"]
        assert out["totals"]["needs_address"] == 1        # what is shown
        assert out["totals_all"]["pending"] == 2          # what the chips read
        assert out["totals_all"]["needs_address"] == 1
        assert out["totals_all"]["overdue"] == 2
    _run(go())


def test_the_chip_counts_still_obey_the_other_filters(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.mail_to_post(FakeRequest(params={"owner": "parul@smartshape.in"}))
        assert out["totals_all"]["pending"] == 1
        assert out["totals_all"]["needs_address"] == 0
    _run(go())


def test_a_sent_piece_is_reachable_by_its_own_chip(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "sent", "posted_date": "2026-09-20"}]})
        out = await crm.mail_to_post(FakeRequest(params={"status": "sent",
                                                         "as_of": "2026-09-22"}))
        assert [r["touch_id"] for r in out["rows"]] == ["t1"]
        assert out["totals_all"]["sent"] == 1
        assert out["totals_all"]["overdue"] == 1, "a posted piece is no longer overdue"
        default = await crm.mail_to_post(FakeRequest(params={"as_of": "2026-09-22"}))
        assert {r["touch_id"] for r in default["rows"]} == {"t2", "t3"}
    _run(go())


def test_the_date_range_narrows_the_queue(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.mail_to_post(FakeRequest(params={"from": "2026-09-02",
                                                         "to": "2026-09-30"}))
        assert [r["touch_id"] for r in out["rows"]] == ["t3"]
    _run(go())


def test_a_rep_sees_only_touches_at_schools_she_can_see(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.mail_to_post(FakeRequest(params={}))
        ids = {r["touch_id"] for r in out["rows"]}
        assert ids == {"t1"}, f"rep saw {ids} - s2 is not hers and c9 is not hers"
    _run(go())


def test_a_rep_sees_her_own_school_less_piece(db, monkeypatch):
    """D2: a flagged piece is scoped by its CONTACTS, since it has no school —
    otherwise the rep who must fix the address would never see the row."""
    async def go():
        await _seed(db)
        await db.contacts.update_one({"contact_id": "c9"},
                                     {"$set": {"assigned_to": "parul@smartshape.in"}})
        _as(monkeypatch, REP)
        out = await crm.mail_to_post(FakeRequest(params={}))
        assert {r["touch_id"] for r in out["rows"]} == {"t1", "t3"}
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


def test_marking_not_sent_clears_the_dispatch_sent_date_and_courier(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "sent", "posted_date": "2026-09-20"}]})
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "not_sent", "reason": "no envelopes"}]})
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d["sent_date"] == ""
        assert d["courier_name"] == "", "a piece that never went out has no courier"
    _run(go())


def test_the_dispatch_list_carries_the_reason_from_the_touch(db, monkeypatch):
    """Dispatch Tracking can only say 'not posted - <why>' if the why comes
    down with the row (D4: the touch is the record of truth)."""
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "not_sent", "reason": "school shut"}]})
        rows = await crm.get_physical_dispatches(FakeRequest(params={}))
        by = {d["dispatch_id"]: d for d in rows}
        assert by["pd_1"]["verify_status"] == "not_sent"
        assert by["pd_1"]["reason"] == "school shut"
        assert by["pd_2"]["reason"] == "", "a pending piece has no reason"
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


# ── POST /mail-runs/verify-touches — one call for a cross-run selection ───────

def test_verify_touches_groups_the_selection_by_run(db, monkeypatch):
    """The queue ticks pieces from several runs at once; the SERVER groups them
    by run and calls the one verification path (D5) — the UI makes one call."""
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.verify_touches(FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t1", "verify_status": "sent"},
                     {"touch_id": "t3", "verify_status": "sent"},
                     {"touch_id": "t2", "verify_status": "sent"}]}))
        assert out["updated"] == 3
        assert {r["run_id"] for r in out["results"]} == {"r1", "r2"}
        by_run = {r["run_id"]: r for r in out["results"]}
        assert by_run["r1"]["touch_ids"] == ["t1", "t3"]
        assert by_run["r2"]["touch_ids"] == ["t2"]
        assert by_run["r1"]["run"]["run_id"] == "r1"   # the recomputed run comes back
        for tid in ("t1", "t2", "t3"):
            t = await db.mail_touches.find_one({"touch_id": tid}, {"_id": 0})
            assert t["verify_status"] == "sent", tid
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d["sent_date"] == "2026-09-20"
    _run(go())


def test_verify_touches_carries_the_reason_through(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm.verify_touches(FakeRequest(body={
            "rows": [{"touch_id": "t1", "verify_status": "not_sent",
                      "reason": "no envelopes left"}]}))
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "not_sent"
        assert t["reason"] == "no envelopes left"
    _run(go())


def test_verify_touches_undoes_a_cross_run_selection_in_one_call(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm.verify_touches(FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t1", "verify_status": "sent"},
                     {"touch_id": "t2", "verify_status": "sent"}]}))
        out = await crm.verify_touches(FakeRequest(body={
            "undo": True, "touch_ids": ["t1", "t2"]}))
        assert {r["run_id"] for r in out["results"]} == {"r1", "r2"}
        for tid in ("t1", "t2"):
            t = await db.mail_touches.find_one({"touch_id": tid}, {"_id": 0})
            assert t["verify_status"] == "pending", tid
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d["sent_date"] == ""
    _run(go())


def test_verify_touches_reports_an_unknown_touch_instead_of_failing(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.verify_touches(FakeRequest(body={
            "rows": [{"touch_id": "t1", "verify_status": "sent"},
                     {"touch_id": "ghost", "verify_status": "sent"}]}))
        assert out["not_found"] == ["ghost"]
        assert out["not_visible"] == []
        assert out["updated"] == 1
    _run(go())


# ── A caller may only tick what she can see ──────────────────────────────────

def test_a_rep_cannot_tick_a_colleagues_envelope(db, monkeypatch):
    """The write path is scoped exactly like the read path: an id a rep could
    only reach by guessing is reported, never written."""
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.verify_touches(FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t1", "verify_status": "sent"},
                     {"touch_id": "t2", "verify_status": "sent"},
                     {"touch_id": "t3", "verify_status": "sent"}]}))
        assert out["not_visible"] == ["t2", "t3"]
        assert out["updated"] == 1
        assert [r["run_id"] for r in out["results"]] == ["r1"]
        for tid in ("t2", "t3"):
            t = await db.mail_touches.find_one({"touch_id": tid}, {"_id": 0})
            assert t["verify_status"] != "sent", f"{tid} written by someone who cannot see it"
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t1["verify_status"] == "sent"
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_2"}, {"_id": 0})
        assert d["sent_date"] == "", "the out-of-scope dispatch was not mirrored either"
    _run(go())


def test_a_rep_cannot_undo_a_colleagues_envelope(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm.verify_touches(FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t2", "verify_status": "sent"}]}))
        _as(monkeypatch, REP)
        out = await crm.verify_touches(FakeRequest(body={"undo": True, "touch_ids": ["t2"]}))
        assert out["not_visible"] == ["t2"]
        assert out["updated"] == 0
        t = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t["verify_status"] == "sent", "undone by someone who cannot see it"
    _run(go())


def test_an_admin_still_ticks_everything(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.verify_touches(FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": t, "verify_status": "sent"} for t in ("t1", "t2", "t3")]}))
        assert out["not_visible"] == []
        assert out["updated"] == 3
    _run(go())


def test_a_rep_cannot_print_a_colleagues_sticker(db, monkeypatch):
    seen = {}

    def _fake_pdf(touches, *a, **kw):
        seen["ids"] = [t["touch_id"] for t in touches]
        return b"%PDF-1.4 fake"

    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        monkeypatch.setattr(crm, "_build_stickers_pdf", _fake_pdf)
        await crm.mail_queue_stickers(FakeRequest(params={"touch_ids": "t1,t2,t3"}))
        assert seen["ids"] == ["t1"]
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert not t2.get("printed_at"), "a colleague's piece was stamped printed"
    _run(go())


def test_verify_touches_rejects_a_bad_status(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        with pytest.raises(crm.HTTPException) as e:
            await crm.verify_touches(FakeRequest(body={
                "rows": [{"touch_id": "t1", "verify_status": "posted-ish"}]}))
        assert e.value.status_code == 400
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "pending", "nothing written on a rejected batch"
    _run(go())


def test_queue_stickers_prints_only_the_selected_envelopes(db, monkeypatch):
    """Print stickers for SELECTED: the day's combined sticker route takes the
    chosen touch ids, so one print covers a cross-run selection."""
    seen = {}

    def _fake_pdf(touches, *a, **kw):
        seen["ids"] = [t["touch_id"] for t in touches]
        return b"%PDF-1.4 fake"

    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        monkeypatch.setattr(crm, "_build_stickers_pdf", _fake_pdf)
        await crm.mail_queue_stickers(FakeRequest(params={"touch_ids": "t2,t1"}))
        assert sorted(seen["ids"]) == ["t1", "t2"], "not the whole day's queue"
        # and the selection is honoured even when a piece is not due yet
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t2["printed_at"], "printing IS the event, for the selection too"
    _run(go())


# ── Fix round 2: the OLDER routes are scoped too ─────────────────────────────
# Every route that records a posting funnels through _do_verify, so the scope
# lives there; these prove the per-run route and "mark run posted" honour it.

def test_a_rep_cannot_tick_a_colleagues_touch_via_the_per_run_route(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.verify_mail_run("r1", FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t1", "verify_status": "sent"},
                     {"touch_id": "t3", "verify_status": "sent"}]}))
        assert out["not_visible"] == ["t3"]
        t3 = await db.mail_touches.find_one({"touch_id": "t3"}, {"_id": 0})
        assert t3["verify_status"] == "needs_address", "written by someone who cannot see it"
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_2"}, {"_id": 0})
        assert d["sent_date"] == ""
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t1["verify_status"] == "sent", "her own piece still ticks"
    _run(go())


def test_a_rep_cannot_undo_a_colleagues_touch_via_the_per_run_route(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm.verify_mail_run("r2", FakeRequest(body={
            "posted_date": "2026-09-20",
            "rows": [{"touch_id": "t2", "verify_status": "sent"}]}))
        _as(monkeypatch, REP)
        out = await crm.verify_mail_run("r2", FakeRequest(body={
            "undo": True, "touch_ids": ["t2"]}))
        assert out["not_visible"] == ["t2"]
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t2["verify_status"] == "sent", "undone by someone who cannot see it"
    _run(go())


def test_marking_a_run_posted_as_a_rep_marks_only_her_pieces(db, monkeypatch):
    async def go():
        await _seed(db)
        # A colleague's pending piece in the SAME run.
        await db.mail_touches.insert_one(
            {"touch_id": "t4", "run_id": "r1", "school_id": "s2", "piece_type": "brochure",
             "planned_date": "2026-09-01", "verify_status": "pending",
             "owner": "bde@smartshape.in", "contact_ids": [], "posted_at": None})
        _as(monkeypatch, REP)
        out = await crm.update_mail_run_status("r1", FakeRequest(body={"status": "posted"}))
        assert out["not_visible"] == ["t4"]
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        t4 = await db.mail_touches.find_one({"touch_id": "t4"}, {"_id": 0})
        assert t1["verify_status"] == "sent"
        assert t4["verify_status"] == "pending", "a colleague's piece was marked posted"
        assert out["status"] == "planned", "the run is not posted while t4 is still owed"
    _run(go())


def test_an_admin_marking_a_run_posted_is_unscoped(db, monkeypatch):
    async def go():
        await _seed(db)
        await db.mail_touches.insert_one(
            {"touch_id": "t4", "run_id": "r1", "school_id": "s2", "piece_type": "brochure",
             "planned_date": "2026-09-01", "verify_status": "pending",
             "owner": "bde@smartshape.in", "contact_ids": [], "posted_at": None})
        _as(monkeypatch, ADMIN)
        out = await crm.update_mail_run_status("r1", FakeRequest(body={"status": "posted"}))
        assert out["not_visible"] == []
        t4 = await db.mail_touches.find_one({"touch_id": "t4"}, {"_id": 0})
        assert t4["verify_status"] == "sent"
    _run(go())


def test_the_today_queue_shows_a_rep_only_her_due_pieces(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.mail_today_queue(FakeRequest(params={"date": "2026-12-31"}))
        ids = [tid for g in out["groups"] for tid in g["touch_ids"]]
        assert ids == ["t1"], f"rep saw {ids}"
        assert out["total"] == 1
        _as(monkeypatch, ADMIN)
        out = await crm.mail_today_queue(FakeRequest(params={"date": "2026-12-31"}))
        assert sorted(tid for g in out["groups"] for tid in g["touch_ids"]) == ["t1", "t2"]
    _run(go())


def test_the_days_sticker_print_is_scoped_and_stamps_only_hers(db, monkeypatch):
    seen = {}

    def _fake_pdf(touches, *a, **kw):
        seen["ids"] = [t["touch_id"] for t in touches]
        return b"%PDF-1.4 fake"

    async def go():
        await _seed(db)
        monkeypatch.setattr(crm, "_build_stickers_pdf", _fake_pdf)
        _as(monkeypatch, REP)
        await crm.mail_queue_stickers(FakeRequest(params={"date": "2026-12-31"}))
        assert seen["ids"] == ["t1"]
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t1.get("printed_at")
        assert not t2.get("printed_at"), "a colleague's piece was stamped printed"
    _run(go())


def test_the_summary_overdue_count_ignores_resolved_pieces(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await crm._do_verify("r1", ADMIN, {"rows": [
            {"touch_id": "t1", "verify_status": "sent", "posted_date": "2026-09-20"}]})
        out = await crm.mail_to_post(FakeRequest(params={"status": "sent",
                                                         "as_of": "2026-09-22"}))
        assert [r["touch_id"] for r in out["rows"]] == ["t1"]
        assert out["totals"]["overdue"] == 0, "a posted piece is not late"
    _run(go())
