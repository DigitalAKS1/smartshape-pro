"""Phase 4: which schools are worth a rep's time — from evidence, not a hunch.

Fit scoring is where CRMs invent astrology: someone picks weights, the product
prints "Fit: 73", and people act on a number nobody can justify. So nothing here
is invented. Every rate is measured from schools that actually bought, the
sample size travels with the number, and a segment too small to mean anything
refuses to produce a score at all.

`account_status` (Phase 2) supplies who converted; the same order history
supplies what they were worth. mongomock.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import services.fit as fit


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def _run(coro):
    return asyncio.run(coro)


async def _school(db, sid, *, board=None, school_type=None, strength=None,
                  status="prospect", ltv=0):
    doc = {"school_id": sid, "school_name": sid, "is_deleted": False,
           "account_status": status, "lifetime_value": ltv}
    if board is not None:
        doc["board"] = board
    if school_type is not None:
        doc["school_type"] = school_type
    if strength is not None:
        doc["school_strength"] = strength
    await db.schools.insert_one(doc)


# ── The evidence: who actually converts ─────────────────────────────────────

def test_conversion_is_measured_per_segment_not_assumed(db):
    async def go():
        for i in range(6):
            await _school(db, f"cbse_win{i}", board="CBSE", status="customer", ltv=50000)
        for i in range(4):
            await _school(db, f"cbse_no{i}", board="CBSE", status="prospect")
        for i in range(10):
            await _school(db, f"state_no{i}", board="State Board", status="prospect")

        rows = await fit.segment_performance(db, "board", min_sample=5)
        by = {r["value"]: r for r in rows}
        assert by["CBSE"]["total"] == 10
        assert by["CBSE"]["customers"] == 6
        assert by["CBSE"]["conversion_rate"] == 60.0
        assert by["State Board"]["conversion_rate"] == 0.0
    _run(go())


def test_a_dormant_customer_still_counts_as_having_converted(db):
    # They bought. That the relationship went quiet is a different question
    # from whether this kind of school buys at all.
    async def go():
        for i in range(5):
            await _school(db, f"d{i}", board="ICSE", status="dormant", ltv=1000)
        rows = await fit.segment_performance(db, "board", min_sample=5)
        assert rows[0]["conversion_rate"] == 100.0
    _run(go())


def test_a_segment_too_small_to_mean_anything_says_so(db):
    async def go():
        await _school(db, "a", board="IB", status="customer", ltv=99999)
        await _school(db, "b", board="IB", status="prospect")
        rows = await fit.segment_performance(db, "board", min_sample=5)
        ib = next(r for r in rows if r["value"] == "IB")
        assert ib["total"] == 2
        assert ib["reliable"] is False, \
            "a 50% conversion rate off two schools is noise wearing a number"
    _run(go())


def test_segments_carry_what_the_wins_were_worth(db):
    async def go():
        for i in range(5):
            await _school(db, f"w{i}", board="CBSE", status="customer", ltv=100000)
        for i in range(5):
            await _school(db, f"l{i}", board="CBSE", status="prospect")
        row = (await fit.segment_performance(db, "board", min_sample=5))[0]
        assert row["avg_customer_value"] == 100000
    _run(go())


def test_the_best_segment_comes_first(db):
    async def go():
        for i in range(10):
            await _school(db, f"good{i}", board="CBSE",
                          status="customer" if i < 7 else "prospect", ltv=1)
        for i in range(10):
            await _school(db, f"bad{i}", board="State Board",
                          status="customer" if i < 1 else "prospect", ltv=1)
        rows = await fit.segment_performance(db, "board", min_sample=5)
        assert [r["value"] for r in rows] == ["CBSE", "State Board"]
    _run(go())


def test_schools_missing_the_attribute_are_not_invented_into_a_segment(db):
    async def go():
        await _school(db, "known", board="CBSE", status="customer", ltv=1)
        await _school(db, "blank", status="prospect")          # no board at all
        rows = await fit.segment_performance(db, "board", min_sample=1)
        assert [r["value"] for r in rows] == ["CBSE"]
    _run(go())


def test_strength_becomes_bands_because_exact_headcounts_are_not_a_segment(db):
    async def go():
        for i in range(5):
            await _school(db, f"big{i}", strength=1400 + i, status="customer", ltv=1)
        for i in range(5):
            await _school(db, f"small{i}", strength=180 + i, status="prospect")
        rows = await fit.segment_performance(db, "strength_band", min_sample=5)
        bands = {r["value"] for r in rows}
        assert bands == {"1000+", "Under 250"}
    _run(go())


# ── The score, and its refusal to guess ─────────────────────────────────────

def test_a_prospect_that_looks_like_your_customers_scores_high(db):
    async def go():
        for i in range(9):
            await _school(db, f"c{i}", board="CBSE", strength=1200, status="customer", ltv=50000)
        await _school(db, "p_bad", board="State Board", strength=200, status="prospect")
        for i in range(9):
            await _school(db, f"s{i}", board="State Board", strength=200, status="prospect")
        await _school(db, "p_good", board="CBSE", strength=1200, status="prospect")

        scores = await fit.fit_scores(db, min_sample=5)
        assert scores["p_good"]["fit_rate"] > scores["p_bad"]["fit_rate"]
    _run(go())


def test_the_score_explains_itself(db):
    async def go():
        for i in range(9):
            await _school(db, f"c{i}", board="CBSE", status="customer", ltv=1)
        await _school(db, "p", board="CBSE", status="prospect")
        scores = await fit.fit_scores(db, min_sample=5)
        basis = scores["p"]["fit_basis"]
        assert any("CBSE" in b for b in basis), \
            "a score nobody can question is a score nobody should trust"
    _run(go())


def test_a_school_with_no_reliable_segment_gets_no_score_at_all(db):
    # Better to say "not enough evidence" than to print a confident number.
    async def go():
        await _school(db, "lonely", board="IB", status="prospect")
        scores = await fit.fit_scores(db, min_sample=5)
        assert scores["lonely"]["fit_rate"] is None
        assert scores["lonely"]["fit_basis"] == []
    _run(go())


def test_scores_are_written_back_to_the_schools(db):
    async def go():
        for i in range(9):
            await _school(db, f"c{i}", board="CBSE", status="customer", ltv=1)
        await _school(db, "p", board="CBSE", status="prospect")
        await fit.refresh_all(db, min_sample=5)
        p = await db.schools.find_one({"school_id": "p"})
        assert p["fit_rate"] is not None
        assert isinstance(p["fit_basis"], list)
    _run(go())


def test_refreshing_twice_changes_nothing(db):
    async def go():
        for i in range(9):
            await _school(db, f"c{i}", board="CBSE", status="customer", ltv=1)
        await _school(db, "p", board="CBSE", status="prospect")
        a = await fit.refresh_all(db, min_sample=5)
        b = await fit.refresh_all(db, min_sample=5)
        assert a == b
    _run(go())


def test_an_empty_database_produces_no_scores_and_does_not_fall_over(db):
    async def go():
        assert await fit.segment_performance(db, "board") == []
        assert await fit.fit_scores(db) == {}
        assert (await fit.refresh_all(db))["scored"] == 0
    _run(go())
