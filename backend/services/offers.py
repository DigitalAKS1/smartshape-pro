"""offers.py — which product offers are live, and what each die / package gets.

An offer is a `promotions` doc with a `discount_pct` > 0 and a scope:
  applies_to_all  — every product
  categories      — product_category values (dies.category)
  die_ids         — hand-picked products
  package_ids     — packages (offered when quoting that package; not a die badge)
It is live when is_active and today is inside [valid_from, valid_until]
(either end may be blank). Where several offers fit, the biggest discount wins.
"""
from datetime import datetime, timezone

IST_OFFSET_HOURS = 5.5


def _today() -> str:
    from datetime import timedelta
    return (datetime.now(timezone.utc) + timedelta(hours=IST_OFFSET_HOURS)).strftime("%Y-%m-%d")


def _public(o: dict) -> dict:
    return {"promo_id": o.get("promo_id"), "title": o.get("title", ""),
            "discount_pct": float(o.get("discount_pct") or 0), "valid_until": o.get("valid_until") or ""}


async def active_offers(db) -> list:
    today = _today()
    out = []
    async for o in db.promotions.find({"is_active": {"$ne": False}}, {"_id": 0}):
        if float(o.get("discount_pct") or 0) <= 0:
            continue
        if (o.get("valid_from") or "") and o["valid_from"] > today:
            continue
        if (o.get("valid_until") or "") and o["valid_until"] < today:
            continue
        out.append(o)
    out.sort(key=lambda o: -float(o.get("discount_pct") or 0))
    return out


def _fits_die(o: dict, die: dict) -> bool:
    return bool(o.get("applies_to_all")
                or die.get("die_id") in (o.get("die_ids") or [])
                or (die.get("category") and die.get("category") in (o.get("categories") or [])))


async def offers_by_die(db, dies: list) -> dict:
    """{die_id: {promo_id, title, discount_pct, valid_until}} — best live offer per die."""
    offers = await active_offers(db)
    if not offers:
        return {}
    out = {}
    for d in dies or []:
        for o in offers:                      # already best-first
            if _fits_die(o, d):
                out[d["die_id"]] = _public(o)
                break
    return out


async def offers_for_package(db, package_id: str) -> list:
    """Live offers a quote for this package can use: package-specific or whole-range."""
    return [_public(o) for o in await active_offers(db)
            if o.get("applies_to_all") or package_id in (o.get("package_ids") or [])]
