"""Package Type field + die CSV import category from the product_category master (Phase 1)."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.inventory_routes as inv
import routes.lookup_routes as lk

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


class FakeUpload:
    def __init__(self, text):
        self._b = text.encode("utf-8")

    async def read(self):
        return self._b


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(inv, "db", d)
    monkeypatch.setattr(lk, "db", d)

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(inv, "get_current_user", _me)
    monkeypatch.setattr(lk, "get_current_user", _me)
    monkeypatch.setattr(inv, "require_module", lambda *a, **k: None)
    return d


def test_create_package_with_type(db):
    out = _run(inv.create_package(FakeRequest({"display_name": "Kit", "package_type": "dies only"})))
    assert out["package_type"] == "Dies Only"


def test_update_package_type(db):
    _run(db.packages.insert_one({"package_id": "p1", "display_name": "Kit"}))
    out = _run(inv.update_package("p1", FakeRequest({"package_type": "machine only"})))
    assert out["package_type"] == "Machine Only"


def _import(rows):
    csv_text = "code,name,category\n" + "\n".join(rows) + "\n"
    return _run(inv.import_dies_csv(FakeUpload(csv_text), FakeRequest()))


def test_die_import_accepts_new_master_category(db):
    _run(lk.create_lookup("product_category", FakeRequest({"name": "Vehicles"})))
    _import(["V1,Car,Vehicles"])
    d = _run(db.dies.find_one({"code": "V1"}))
    assert d["category"] == "vehicles"


def test_die_import_unknown_category_falls_back(db):
    _import(["Z1,Thing,zzz"])
    assert _run(db.dies.find_one({"code": "Z1"}))["category"] == "decorative"


def test_die_import_label_match(db):
    _import(['A1,Parrot,"Animals & Birds"', "F1,Rose,3D Flowers"])
    assert _run(db.dies.find_one({"code": "A1"}))["category"] == "animals_birds"
    assert _run(db.dies.find_one({"code": "F1"}))["category"] == "3d_flowers"
