"""CRM upsert for public form submissions.

Match an existing contact by normalized phone, then email. Existing contacts
get FILL-BLANKS-ONLY updates (never overwrite CRM data). New contacts are
tagged source="form" + source_form_id so junk from a public form is always
one filter away from bulk cleanup. Never raises — a CRM failure must not
lose the registration.
"""
import re, uuid, logging
from datetime import datetime, timezone

from import_engine import normalize_phone

log = logging.getLogger("forms.crm")


def _now():
    return datetime.now(timezone.utc).isoformat()


async def upsert_contact(db, mapped: dict, form_id: str):
    """mapped: any subset of {name,email,phone,school,designation,city}.
    Returns (contact_id | None, school_id | None)."""
    try:
        name = (mapped.get("name") or "").strip()
        email = (mapped.get("email") or "").strip().lower()
        phone = (mapped.get("phone") or "").strip()
        if not (phone or ("@" in email)):
            return None, None
        norm = normalize_phone(phone) if phone else ""

        school_id, school_name = None, (mapped.get("school") or "").strip()
        if school_name:
            school = await db.schools.find_one(
                {"school_name": {"$regex": f"^{re.escape(school_name)}$", "$options": "i"}},
                {"_id": 0, "school_id": 1})
            school_id = (school or {}).get("school_id")

        # Phone match takes priority over email match (two different existing
        # contacts could each match one criterion — phone wins).
        existing = None
        if norm:
            existing = await db.contacts.find_one(
                {"$or": [{"phone_norm": norm}, {"phone": phone}],
                 "is_deleted": {"$ne": True}}, {"_id": 0})
        if not existing and "@" in email:
            existing = await db.contacts.find_one(
                {"email": email, "is_deleted": {"$ne": True}}, {"_id": 0})

        if existing:
            fill = {}
            if "@" in email and not (existing.get("email") or "").strip():
                fill["email"] = email
            if phone and not (existing.get("phone") or "").strip():
                fill["phone"], fill["phone_norm"] = phone, norm
            for src, dst in (("designation", "designation"), ("city", "city")):
                v = (mapped.get(src) or "").strip()
                if v and not (existing.get(dst) or "").strip():
                    fill[dst] = v
            if school_id and not existing.get("school_id"):
                fill["school_id"] = school_id
            if school_name and not (existing.get("school_name") or "").strip():
                fill["school_name"] = school_name
            if fill:
                fill["updated_at"] = _now()
                await db.contacts.update_one(
                    {"contact_id": existing["contact_id"]}, {"$set": fill})
            return existing["contact_id"], school_id

        contact_id = f"con_{uuid.uuid4().hex[:12]}"
        await db.contacts.insert_one({
            "contact_id": contact_id, "name": name,
            "phone": phone, "phone_norm": norm, "email": email,
            "designation": (mapped.get("designation") or "").strip(),
            "city": (mapped.get("city") or "").strip(),
            "school_id": school_id, "school_name": school_name,
            "company": school_name, "notes": "", "status": "active",
            "is_deleted": False,
            "converted_to_lead": False, "lead_id": None,
            "source": "form", "source_form_id": form_id,
            "created_by": "public_form", "created_at": _now(),
        })
        return contact_id, school_id
    except Exception as exc:
        log.warning("[form-crm] upsert failed: %s", exc)
        return None, None
