"""reorder.py — which schools are due to buy again.

SmartShape sells a machine once and then dies forever after. The second motion
is where the margin compounds, and the CRM had no way to see it: a school that
buys dies every March only got chased if a rep happened to remember.

This derives the list instead of storing it. Nothing is created, so nothing goes
stale, nothing needs de-duplicating, and the answer is correct the moment an
order lands. A school's own buying history sets its cadence — the median gap
between its orders — and it becomes due once that gap has elapsed again.

Acting on a row creates an ordinary lead with the reorder deal type, so the
whole existing machine (ownership, tags, sequences, tasks, notifications) does
the work. The due list is a report; the pipeline stays the pipeline.
"""

from datetime import datetime, timezone

# A cancelled order never happened, so it must not shape the rhythm either.
NON_REVENUE_ORDER_STATUSES = {"cancelled"}

DEFAULT_INTERVAL_DAYS = 180        # used only when a school has a single order
REORDER_DEAL_TYPES = ("Reorder Dies", "New Dies")


def _parse(iso):
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


def _median(nums):
    s = sorted(nums)
    n = len(s)
    if not n:
        return 0
    mid = n // 2
    return s[mid] if n % 2 else round((s[mid - 1] + s[mid]) / 2)


async def reorder_candidates(db, *, owner_email: str = None,
                             default_interval_days: int = DEFAULT_INTERVAL_DAYS) -> list:
    """Schools whose usual gap between orders has elapsed again.

    `owner_email` limits the list to one rep's accounts. Schools already working
    an open reorder deal are left out — this is work to start, not work under
    way. Most overdue first, because that is the order a rep should call in.
    """
    school_q = {"is_deleted": {"$ne": True}}
    if owner_email:
        school_q["assigned_to"] = owner_email
    schools = {s["school_id"]: s async for s in db.schools.find(
        school_q, {"_id": 0, "school_id": 1, "school_name": 1, "city": 1,
                   "assigned_to": 1, "assigned_name": 1})}
    if not schools:
        return []

    # Orders per school, oldest first.
    history: dict = {}
    async for o in db.orders.find(
        {"school_id": {"$in": list(schools)}, "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "grand_total": 1, "status": 1, "created_at": 1},
    ):
        if (o.get("status") or "") in NON_REVENUE_ORDER_STATUSES:
            continue
        when = _parse(o.get("created_at"))
        if when:
            history.setdefault(o["school_id"], []).append((when, o))

    # Schools already being worked for a reorder are not "to start".
    busy = {l["school_id"] async for l in db.leads.find(
        {"school_id": {"$in": list(schools)},
         "deal_type": {"$in": list(REORDER_DEAL_TYPES)},
         "stage": {"$nin": ["won", "lost"]},
         "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1}) if l.get("school_id")}

    now = datetime.now(timezone.utc)
    out = []
    for sid, rows in history.items():
        if sid in busy:
            continue
        rows.sort(key=lambda r: r[0])
        dates = [r[0] for r in rows]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]

        if gaps:
            cadence = _median(gaps)
            confidence = "measured"
        else:
            # One order tells you they bought, not how often. Say so rather than
            # dressing an assumption up as a measurement.
            cadence = default_interval_days
            confidence = "assumed"

        days_since = (now - dates[-1]).days
        if days_since < cadence:
            continue

        school = schools[sid]
        out.append({
            "school_id": sid,
            "school_name": school.get("school_name", ""),
            "city": school.get("city", ""),
            "assigned_to": school.get("assigned_to", ""),
            "assigned_name": school.get("assigned_name", ""),
            "order_count": len(rows),
            "lifetime_value": round(sum(float(o.get("grand_total", 0) or 0) for _d, o in rows), 2),
            "last_order_at": dates[-1].isoformat(),
            "last_order_value": round(float(rows[-1][1].get("grand_total", 0) or 0), 2),
            "cadence_days": cadence,
            "confidence": confidence,
            "days_since_last_order": days_since,
            "days_overdue": days_since - cadence,
        })

    out.sort(key=lambda r: r["days_overdue"], reverse=True)
    return out
