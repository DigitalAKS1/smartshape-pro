"""fit.py — which schools resemble the ones that actually bought.

Fit scoring is where CRMs invent astrology. Someone picks weights, the product
prints "Fit: 73", and a sales team reorders its week around a number nobody can
justify. Nothing here is invented:

  * Every rate is MEASURED — what share of schools with this board, this type,
    this size have actually become customers.
  * The sample size travels with the rate, because 50% of two schools is noise
    wearing a number.
  * A segment below the threshold is marked unreliable and takes no part in a
    score, and a school with no reliable segment gets NO score rather than a
    confident-looking one.
  * The score is a predicted conversion RATE — a number with a meaning — not a
    unitless 0-100, and it arrives with the reasons that produced it.

`account_status` from account_lifecycle supplies who converted (a dormant
customer still bought), and the same order history supplies what they were worth.
"""

CONVERTED_STATUSES = {"customer", "dormant"}

# Segments worth measuring. Exact headcounts are not a segment, so strength is
# banded; the bands are the ones a rep would actually say out loud.
ATTRIBUTES = ("board", "school_type", "strength_band", "city")

DEFAULT_MIN_SAMPLE = 8   # below this a rate is noise, not evidence

STRENGTH_BANDS = (
    (1000, "1000+"),
    (500, "500–999"),
    (250, "250–499"),
    (0, "Under 250"),
)


def strength_band(value) -> str | None:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    for floor, label in STRENGTH_BANDS:
        if n >= floor:
            return label
    return None


def attribute_of(school: dict, attribute: str) -> str | None:
    """The school's value for a segment, or None if it simply isn't recorded.

    Blank is not a segment — grouping every school with no board recorded into a
    "" bucket would produce a confident rate about a data-entry gap.
    """
    if attribute == "strength_band":
        return strength_band(school.get("school_strength"))
    v = (school.get(attribute) or "").strip()
    return v or None


async def _live_schools(db) -> list:
    return [s async for s in db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "board": 1, "school_type": 1, "city": 1,
         "school_strength": 1, "account_status": 1, "lifetime_value": 1})]


def _tally(schools: list, attribute: str, min_sample: int) -> list:
    buckets: dict = {}
    for s in schools:
        val = attribute_of(s, attribute)
        if val is None:
            continue
        b = buckets.setdefault(val, {"total": 0, "customers": 0, "value": 0.0})
        b["total"] += 1
        if (s.get("account_status") or "") in CONVERTED_STATUSES:
            b["customers"] += 1
            b["value"] += float(s.get("lifetime_value", 0) or 0)

    rows = []
    for val, b in buckets.items():
        rate = round(b["customers"] / b["total"] * 100, 1) if b["total"] else 0.0
        rows.append({
            "attribute": attribute,
            "value": val,
            "total": b["total"],
            "customers": b["customers"],
            "conversion_rate": rate,
            "avg_customer_value": round(b["value"] / b["customers"], 2) if b["customers"] else 0.0,
            # Said out loud so a reader can discount it, rather than hidden.
            "reliable": b["total"] >= min_sample,
        })
    rows.sort(key=lambda r: (r["conversion_rate"], r["total"]), reverse=True)
    return rows


async def segment_performance(db, attribute: str = "board",
                              min_sample: int = DEFAULT_MIN_SAMPLE) -> list:
    """Conversion by one attribute: total, customers, rate, average win value.

    This is the report that turns "we do well with big CBSE schools" from an
    opinion into a number — and, just as usefully, shows where the belief is
    built on four data points.
    """
    if attribute not in ATTRIBUTES:
        return []
    return _tally(await _live_schools(db), attribute, min_sample)


async def fit_scores(db, min_sample: int = DEFAULT_MIN_SAMPLE) -> dict:
    """school_id -> {fit_rate, fit_basis}.

    fit_rate is the share of comparable schools that became customers, averaged
    across whichever of a school's attributes have enough evidence behind them
    and weighted by how much evidence that is. No reliable segment means no
    score: "not enough evidence" is a more useful answer than a number.
    """
    schools = await _live_schools(db)
    if not schools:
        return {}

    lookup = {a: {r["value"]: r for r in _tally(schools, a, min_sample) if r["reliable"]}
              for a in ATTRIBUTES}

    out = {}
    for s in schools:
        weighted_sum = 0.0
        weight = 0
        basis = []
        for a in ATTRIBUTES:
            val = attribute_of(s, a)
            row = lookup[a].get(val) if val else None
            if not row:
                continue
            weighted_sum += row["conversion_rate"] * row["total"]
            weight += row["total"]
            basis.append(f"{val}: {row['conversion_rate']}% of {row['total']}")
        out[s["school_id"]] = {
            "fit_rate": round(weighted_sum / weight, 1) if weight else None,
            "fit_basis": basis,
        }
    return out


async def refresh_all(db, min_sample: int = DEFAULT_MIN_SAMPLE) -> dict:
    """Store every school's fit rate. Idempotent."""
    scores = await fit_scores(db, min_sample)
    scored = 0
    for sid, val in scores.items():
        await db.schools.update_one({"school_id": sid}, {"$set": val})
        if val["fit_rate"] is not None:
            scored += 1
    return {"schools": len(scores), "scored": scored}
