"""field_registry.py — Field definition model, seed data, and normalization helpers.

This module owns the `field_definitions` collection: a user-extensible registry
of importable fields for schools, contacts, and leads.  Every startup call to
seed_field_definitions() is safe to run multiple times (idempotent by key).
"""

import re
import uuid
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_field_id() -> str:
    return f"fld_{uuid.uuid4().hex[:12]}"


def normalize_header(s: str) -> str:
    """Lowercase, strip, remove apostrophes/dots, collapse non-alphanum to spaces."""
    s = (s or "").strip().lower()
    s = s.replace("'", "").replace("/", " ").replace(".", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# (key, label, entity, type, maps_to, group, [aliases...])
SEED_FIELDS = [
    ("title",              "Title",                              "contact", "text",   "title",                "Contact", ["title"]),
    ("name",               "Name",                               "contact", "text",   "name",                 "Contact", ["name", "contact name"]),
    ("phone",              "Phone Number",                       "contact", "phone",  "phone",                "Contact", ["phone number", "mobile", "contact phone"]),
    ("email",              "Mail ID",                            "contact", "email",  "email",                "Contact", ["mail id", "email", "contact email"]),
    ("designation",        "Group/Designation",                  "contact", "text",   "designation",          "Contact", ["group designation", "designation", "group"]),
    ("birthday",           "Birthday (Principal/Director)",      "contact", "date",   "birthday",             "Contact", ["birthday principaldirector", "birthday", "dob"]),
    ("anniversary",        "Anniversary (Principal/Director)",   "contact", "date",   None,                   "Contact", ["anniversary principaldirector", "anniversary"]),
    ("school_name",        "School/Institute Name",              "school",  "text",   "school_name",          "School",  ["school institute name", "school name", "institute name", "school", "company"]),
    ("address",            "School Full Address",                "school",  "text",   "address",              "School",  ["school full address", "address"]),
    ("city",               "City",                               "school",  "text",   "city",                 "School",  ["city"]),
    ("state",              "State",                              "school",  "text",   "state",                "School",  ["state"]),
    ("pincode",            "Pin Code",                           "school",  "text",   "pincode",              "School",  ["pin code", "pincode", "pin"]),
    ("board",              "Affiliated Board",                   "school",  "text",   "board",                "School",  ["affiliated to which board", "board", "affiliated board"]),
    ("std_classes",        "STD (Classes)",                      "school",  "text",   None,                   "School",  ["std", "classes", "standard"]),
    ("school_phone",       "School's Phone Number",              "school",  "phone",  "phone",                "School",  ["schools phone number", "school phone"]),
    ("school_email",       "School's Mail",                      "school",  "email",  "email",                "School",  ["schools mail", "school email", "school mail"]),
    ("annual_fees",        "Annual Fees",                        "school",  "text",   "annual_budget_range",  "School",  ["annual fees", "fees", "annual budget"]),
    ("campus_area",        "Campus Area",                        "school",  "text",   None,                   "School",  ["campus area"]),
    ("teacher_strength",   "Teacher's Strength",                 "school",  "number", None,                   "School",  ["teachers strength", "teacher strength"]),
    ("classrooms",         "No. of Classrooms",                  "school",  "number", None,                   "School",  ["no of classrooms", "classrooms"]),
    ("school_strength",    "Student's Strength",                 "school",  "number", "school_strength",      "School",  ["students strength", "student strength", "strength"]),
    ("website",            "School Website",                     "school",  "url",    "website",              "School",  ["school website", "website"]),
    ("instagram_url",      "School Instagram",                   "school",  "url",    "instagram_url",        "School",  ["school instagram", "instagram"]),
    ("linkedin_url",       "School LinkedIn",                    "school",  "url",    "linkedin_url",         "School",  ["school linkedin", "linkedin"]),
    ("principal_linkedin", "Principal/Director LinkedIn",        "school",  "url",    None,                   "School",  ["principal director linkedin", "principal linkedin"]),
    ("former_principal",   "Former Principal",                   "school",  "text",   None,                   "School",  ["former principal"]),
    ("current_principal",  "Current Principal",                  "school",  "text",   "primary_contact_name", "School",  ["current principal", "principal"]),
    ("assign_to",          "Assign To",                          "lead",    "text",   "assigned_to",          "Lead",    ["assign to", "assigned to", "owner"]),
]


def _doc(key: str, label: str, entity: str, ftype: str, maps_to, group: str, aliases: list, order: int) -> dict:
    return {
        "field_id":   new_field_id(),
        "key":        key,
        "label":      label,
        "entity":     entity,
        "type":       ftype,
        "options":    [],
        "required":   False,
        "is_unique":  False,
        "is_core":    True,
        "maps_to":    maps_to,
        "aliases":    aliases,
        "group":      group,
        "order":      order,
        "is_active":  True,
        "created_by": "system",
        "created_at": _now(),
    }


async def seed_field_definitions(db) -> None:
    """Upsert all SEED_FIELDS into field_definitions.

    Idempotent: skips any key that already exists; inserts missing ones.
    Sets the app_meta guard after the first full run, but subsequent calls
    still backfill any keys that were manually deleted.
    """
    existing = {d["key"] async for d in db.field_definitions.find({}, {"key": 1})}
    for i, (key, label, entity, ftype, maps_to, group, aliases) in enumerate(SEED_FIELDS):
        if key in existing:
            continue
        await db.field_definitions.insert_one(
            _doc(key, label, entity, ftype, maps_to, group, aliases, i * 10)
        )
    # Mark seeded (upsert so re-runs don't duplicate)
    await db.app_meta.update_one(
        {"_id": "field_definitions_seeded"},
        {"$setOnInsert": {"value": True}},
        upsert=True,
    )


async def list_fields(db, entity: str = None) -> list:
    """Return active field definitions, optionally filtered by entity."""
    q = {"is_active": True}
    if entity:
        q["entity"] = entity
    return [d async for d in db.field_definitions.find(q, {"_id": 0}).sort("order", 1)]


# ---------------------------------------------------------------------------
# Task 2: Field CRUD + merge_fields
# ---------------------------------------------------------------------------

def _key_from_label(label: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", (label or "").strip().lower()).strip("_")
    return k or f"field_{uuid.uuid4().hex[:6]}"


async def create_field(db, payload: dict, user: dict) -> dict:
    """Insert a new custom (non-core) field definition.

    Raises ValueError if a field with the derived key already exists.
    """
    key = payload.get("key") or _key_from_label(payload["label"])
    if await db.field_definitions.find_one({"key": key}):
        raise ValueError(f"field key exists: {key}")
    doc = {
        "field_id":   new_field_id(),
        "key":        key,
        "label":      payload["label"],
        "entity":     payload.get("entity", "school"),
        "type":       payload.get("type", "text"),
        "options":    payload.get("options", []),
        "required":   bool(payload.get("required")),
        "is_unique":  False,
        "is_core":    False,
        "maps_to":    None,
        "aliases":    [normalize_header(payload["label"])],
        "group":      payload.get("group", "Custom"),
        "order":      900,
        "is_active":  True,
        "created_by": user.get("email", "?"),
        "created_at": _now(),
    }
    await db.field_definitions.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def update_field(db, field_id: str, patch: dict) -> dict:
    """Update an existing field definition.

    Core fields may only have label/options/group/order/required changed.
    Custom fields additionally allow type changes.
    Raises ValueError if the field is not found.
    """
    f = await db.field_definitions.find_one({"field_id": field_id})
    if not f:
        raise ValueError("not found")
    allowed = {"label", "options", "group", "order", "required"}
    if not f["is_core"]:
        allowed |= {"type"}
    upd = {k: v for k, v in patch.items() if k in allowed}
    if upd:
        await db.field_definitions.update_one({"field_id": field_id}, {"$set": upd})
    result = {**f, **upd}
    result.pop("_id", None)
    return result


async def soft_delete_field(db, field_id: str) -> None:
    """Mark a custom field as inactive (is_active=False).

    Raises ValueError for core fields — they cannot be deleted.
    Raises ValueError if the field is not found.
    """
    f = await db.field_definitions.find_one({"field_id": field_id})
    if not f:
        raise ValueError("not found")
    if f["is_core"]:
        raise ValueError("cannot delete core field")
    await db.field_definitions.update_one(
        {"field_id": field_id}, {"$set": {"is_active": False}}
    )


def merge_fields(doc: dict) -> dict:
    """Flatten custom_fields dict onto the top-level document dict.

    Strips _id and custom_fields keys from the result.
    """
    out = {k: v for k, v in doc.items() if k not in ("custom_fields", "_id")}
    out.update(doc.get("custom_fields") or {})
    return out
