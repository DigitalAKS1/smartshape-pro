import io, os, pytest, pytest_asyncio
import import_engine as ie
import field_registry as fr
from motor.motor_asyncio import AsyncIOMotorClient
from openpyxl import Workbook


@pytest_asyncio.fixture
async def db():
    name = os.getenv("DB_NAME", "smartshape_test")
    assert name.endswith("_test") or name == "mtt_ci", f"refusing non-test DB: {name}"
    client = AsyncIOMotorClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    d = client[name]
    yield d
    # Teardown: wipe test data
    await d.field_definitions.delete_many({})
    await d.app_meta.delete_many({"_id": "field_definitions_seeded"})


def test_parse_csv():
    content = b"School Name,City\nDPS,Delhi\nRyan,Mumbai\n"
    headers, rows = ie.parse_table("a.csv", content)
    assert headers == ["School Name", "City"]
    assert rows[0] == {"School Name": "DPS", "City": "Delhi"} and len(rows) == 2


def test_parse_xlsx():
    wb = Workbook(); ws = wb.active
    ws.append(["School Name", "City"]); ws.append(["DPS", "Delhi"])
    buf = io.BytesIO(); wb.save(buf)
    headers, rows = ie.parse_table("a.xlsx", buf.getvalue())
    assert headers == ["School Name", "City"]
    assert rows[0]["School Name"] == "DPS" and rows[0]["City"] == "Delhi"


@pytest.mark.asyncio
async def test_propose_mapping_alias_and_fuzzy(db):
    await fr.seed_field_definitions(db)
    m = await ie.propose_mapping(db, ["School's Mail", "Studnt Strength", "Totally Unknown"])
    # order is preserved (one result per input header, same order)
    assert [x["source"] for x in m] == ["School's Mail", "Studnt Strength", "Totally Unknown"]
    by = {x["source"]: x for x in m}
    assert by["School's Mail"]["key"] == "school_email" and by["School's Mail"]["confidence"] == "high"
    assert by["Studnt Strength"]["key"] == "school_strength" and by["Studnt Strength"]["confidence"] == "medium"
    assert by["Totally Unknown"]["confidence"] == "none" and by["Totally Unknown"]["key"] is None


@pytest.mark.asyncio
async def test_propose_mapping_empty_headers(db):
    await fr.seed_field_definitions(db)
    assert await ie.propose_mapping(db, []) == []
