"""Phase 2 — Import safety (A-safe). No prod DB access.

Covers P2.1–P2.5:
  - text-safe parse (integral floats -> str(int), ISO dates)
  - normalize_phone() + phone_norm storage + sci-notation flagging
  - assigned_to name -> email resolution on import (reuse _resolve_owner)
  - import_date / assigned_date stamping (import + _assign_school_cascade)
  - ID round-trip upsert; honor a well-formed supplied id on create

Uses mongomock_motor (in-memory async Mongo). Run with:
    python -m pytest tests/test_import_safety.py -q
"""

import asyncio
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from openpyxl import Workbook

import import_engine as ie


IMPORTER = {"email": "importer@smartshape.in", "name": "Importer"}


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


# ── P2.2  normalize_phone ──────────────────────────────────────────────────

def test_normalize_phone_strips_dot_zero():
    assert ie.normalize_phone("917709261234.0") == "917709261234"


def test_normalize_phone_float_input():
    assert ie.normalize_phone(917709261234.0) == "917709261234"


def test_normalize_phone_preserves_single_leading_plus():
    assert ie.normalize_phone("+91 97709 12345") == "+919770912345"


def test_normalize_phone_drops_parens_dashes_spaces():
    assert ie.normalize_phone("(0120) 421-3000") == "01204213000"


def test_normalize_phone_blank():
    assert ie.normalize_phone("") == ""
    assert ie.normalize_phone(None) == ""


def test_phone_is_lossy_flags_scientific_notation():
    assert ie.phone_is_lossy("9.17709E+11") is True
    assert ie.phone_is_lossy("9.17709e+11") is True
    assert ie.phone_is_lossy("917709261234") is False
    assert ie.phone_is_lossy("+919770912345") is False
    assert ie.phone_is_lossy("917709261234.0") is False  # recoverable, not sci


# ── P2.1  text-safe parse ──────────────────────────────────────────────────

def _xlsx_bytes(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_xlsx_integral_float_becomes_plain_string():
    import datetime as _dt
    content = _xlsx_bytes([
        ["School/Institute Name", "Phone Number", "Birthday (Principal/Director)"],
        ["Rohini Public", 917709261234, _dt.datetime(2020, 5, 1)],
    ])
    headers, rows = ie.parse_table("x.xlsx", content)
    assert rows[0]["Phone Number"] == "917709261234"       # not "917709261234.0"
    assert rows[0]["Birthday (Principal/Director)"].startswith("2020-05-01")  # ISO


# ── P2.5  propose_mapping control keys ─────────────────────────────────────

def test_propose_mapping_recognizes_id_control_keys(db):
    async def go():
        await _seed_fields(db)
        mapping = await ie.propose_mapping(db, ["School ID", "Contact ID", "Lead ID"])
        keys = {m["source"]: m["key"] for m in mapping}
        assert keys["School ID"] == "school_id"
        assert keys["Contact ID"] == "contact_id"
        assert keys["Lead ID"] == "lead_id"
    _run(go())


async def _seed_fields(db):
    import field_registry as fr
    await fr.seed_field_definitions(db)


# ── P2.3  assigned_to name -> email ────────────────────────────────────────

def test_import_resolves_owner_name_to_email(db):
    async def go():
        await db.salespersons.insert_one(
            {"email": "bde@smartshape.in", "name": "Parul Kanchan", "is_active": True}
        )
        row = {
            "school_name": "Rohini Public School",
            "city": "Delhi",
            "name": "Mr Rao",
            "phone": "9770912345",
            "assign_to": "Parul Kanchan",   # a NAME, not an email
        }
        res = await ie.commit_row(db, row, IMPORTER, create_leads=True)
        sch = await db.schools.find_one({"school_id": res["school_id"]}, {"_id": 0})
        con = await db.contacts.find_one({"contact_id": res["contact_id"]}, {"_id": 0})
        lead = await db.leads.find_one({"lead_id": res["lead_id"]}, {"_id": 0})
        assert sch["assigned_to"] == "bde@smartshape.in"
        assert sch["assigned_name"] == "Parul Kanchan"
        assert con["assigned_to"] == "bde@smartshape.in"
        assert lead["assigned_to"] == "bde@smartshape.in"
        assert lead["assigned_name"] == "Parul Kanchan"
    _run(go())


def test_import_never_stores_name_in_assigned_to_when_unresolved(db):
    async def go():
        row = {"school_name": "Nowhere School", "assign_to": "Ghost Person"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=True)
        sch = await db.schools.find_one({"school_id": res["school_id"]}, {"_id": 0})
        assert sch.get("assigned_to", "") == ""            # never a name
        assert sch.get("assigned_name") == "Ghost Person"  # kept as label
        # no owner email -> no lead created
        assert res["lead_id"] is None
    _run(go())


# ── P2.2 / P2.1  phone stored normalized; sci-notation flagged ─────────────

def test_import_stores_phone_norm(db):
    async def go():
        row = {"school_name": "Alpha", "name": "A", "phone": "+91 97709 12345"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        con = await db.contacts.find_one({"contact_id": res["contact_id"]}, {"_id": 0})
        assert con["phone_norm"] == "+919770912345"
    _run(go())


def test_import_flags_lossy_sci_phone_and_does_not_store_norm(db):
    async def go():
        row = {"school_name": "Beta", "name": "B", "phone": "9.17709E+11"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        assert res.get("warnings"), "sci-notation phone must produce a warning"
        con = await db.contacts.find_one({"contact_id": res["contact_id"]}, {"_id": 0})
        assert con.get("phone_norm", "") == ""   # garbage not stored as a match key
    _run(go())


# ── P2.5  supplied id honored / round-trip ─────────────────────────────────

def test_supplied_school_id_honored_on_create(db):
    async def go():
        row = {"school_id": "sch_custom0001", "school_name": "Gamma Intl", "city": "Pune"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        assert res["action"] == "create"
        assert res["school_id"] == "sch_custom0001"      # NOT a freshly minted id
        got = await db.schools.find_one({"school_id": "sch_custom0001"}, {"_id": 0})
        assert got is not None
    _run(go())


def test_school_id_round_trip_updates_in_place(db):
    async def go():
        row = {"school_id": "sch_rt1", "school_name": "Delta", "city": "Goa"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)
        row2 = {"school_id": "sch_rt1", "school_name": "Delta Renamed", "city": "Goa"}
        res2 = await ie.commit_row(db, row2, IMPORTER, create_leads=False)
        assert res2["action"] == "update"
        n = await db.schools.count_documents({"school_id": "sch_rt1"})
        assert n == 1
        got = await db.schools.find_one({"school_id": "sch_rt1"}, {"_id": 0})
        assert got["school_name"] == "Delta Renamed"
    _run(go())


def test_supplied_contact_id_honored(db):
    async def go():
        row = {"school_name": "Eps", "contact_id": "con_custom01",
               "name": "C", "phone": "9990001111"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        assert res["contact_id"] == "con_custom01"
    _run(go())


def test_supplied_lead_id_honored(db):
    async def go():
        await db.salespersons.insert_one(
            {"email": "rep@smartshape.in", "name": "Rep One", "is_active": True})
        row = {"school_name": "Zeta", "lead_id": "lead_custom01",
               "assign_to": "rep@smartshape.in"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=True)
        assert res["lead_id"] == "lead_custom01"
    _run(go())


# ── P2.4  import_date / assigned_date ──────────────────────────────────────

def test_import_date_written_on_all_entities(db):
    async def go():
        await db.salespersons.insert_one(
            {"email": "rep@smartshape.in", "name": "Rep", "is_active": True})
        row = {"school_name": "Eta", "name": "E", "phone": "9770912345",
               "assign_to": "rep@smartshape.in"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=True)
        sch = await db.schools.find_one({"school_id": res["school_id"]}, {"_id": 0})
        con = await db.contacts.find_one({"contact_id": res["contact_id"]}, {"_id": 0})
        lead = await db.leads.find_one({"lead_id": res["lead_id"]}, {"_id": 0})
        assert sch.get("import_date")
        assert con.get("import_date")
        assert lead.get("import_date")
    _run(go())


def test_assigned_date_written_when_owner_set(db):
    async def go():
        await db.salespersons.insert_one(
            {"email": "rep@smartshape.in", "name": "Rep", "is_active": True})
        row = {"school_name": "Theta", "name": "T", "phone": "9770912345",
               "assign_to": "rep@smartshape.in"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=True)
        sch = await db.schools.find_one({"school_id": res["school_id"]}, {"_id": 0})
        lead = await db.leads.find_one({"lead_id": res["lead_id"]}, {"_id": 0})
        assert sch.get("assigned_date")
        assert lead.get("assigned_date")
    _run(go())


def test_assign_school_cascade_stamps_assigned_date(monkeypatch, db):
    import routes.crm_routes as crm
    monkeypatch.setattr(crm, "db", db)

    async def go():
        await db.schools.insert_one({"school_id": "s_c", "school_name": "Cascade"})
        await db.contacts.insert_one(
            {"contact_id": "c_c", "school_id": "s_c", "is_deleted": False})
        await db.leads.insert_one(
            {"lead_id": "l_c", "school_id": "s_c", "is_deleted": False,
             "assigned_to": "old@smartshape.in"})
        await crm._assign_school_cascade(
            "s_c", "new@smartshape.in", "New Rep", {"email": "boss@smartshape.in", "name": "Boss"})
        sch = await db.schools.find_one({"school_id": "s_c"}, {"_id": 0})
        con = await db.contacts.find_one({"contact_id": "c_c"}, {"_id": 0})
        lead = await db.leads.find_one({"lead_id": "l_c"}, {"_id": 0})
        assert sch.get("assigned_date")
        assert con.get("assigned_date")
        assert lead.get("assigned_date")
    _run(go())
