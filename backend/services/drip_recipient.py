"""drip_recipient.py — who a drip enrolment is sending to, in one place.

An enrolment used to carry only `lead_id`, and everything that ran or showed a
sequence read the recipient straight off the lead. The owner's marketing
audience is CONTACTS (98 people tagged GSLC 2026), so an enrolment now carries
`lead_id` OR `contact_id` (spec 2026-09-11, D5) — and no lead is invented to
enrol a person.

`resolve_drip_recipient` is the one rule for turning an enrolment into a
recipient. The executor calls it; nothing else re-derives it.

The duplicate guard lives here too: the same human must never get a sequence
twice, and a contact and the lead it converted into are the same human.

No third-party imports: prod does not reliably install new pip packages.
"""

# Written onto an enrolment the executor has to cancel because the person it
# was sending to is gone (lead and contact both deleted or missing). Plain
# English — the owner reads it on the enrolment.
RECIPIENT_GONE_REASON = (
    "Recipient no longer exists — the lead and contact this enrolment was "
    "sending to were deleted, so the sequence was stopped."
)

# Written onto a contact's running enrolments when the contact is archived.
CONTACT_DELETED_REASON = "The contact was deleted, so the sequence was stopped."

_LIVE = {"is_deleted": {"$ne": True}}


def _blank(v) -> bool:
    return v is None or v == ""


async def resolve_drip_recipient(db, enrollment: dict):
    """Return the recipient of `enrollment`, or None if there is nobody to send to.

    Order: the lead if `lead_id` is set and that lead exists and is not deleted;
    otherwise the contact (not deleted), with its school looked up for the
    company name. None when neither resolves — the caller cancels the enrolment
    with a reason rather than crashing on a missing key.

    The result carries the neutral keys
        name, company, phone, email, school_id, assigned_to, assigned_name,
        lead_id, contact_id, wa_consent (only when the record has one)
    AND the lead-shaped aliases contact_name, contact_phone, contact_email,
    company_name — so `create_physical_from_drip`, `_wa_consent_ok` and every
    executor branch take it unchanged. For a lead the whole lead document is
    kept underneath, so a lead-keyed enrolment reads exactly what it read
    before this module existed.
    """
    enrollment = enrollment or {}
    lead_id = enrollment.get("lead_id")
    if not _blank(lead_id):
        lead = await db.leads.find_one({"lead_id": lead_id, **_LIVE}, {"_id": 0})
        if lead:
            rec = dict(lead)
            rec.update({
                "recipient_kind": "lead",
                "name": lead.get("contact_name", ""),
                "company": lead.get("company_name", ""),
                "phone": lead.get("contact_phone", ""),
                "email": lead.get("contact_email", ""),
            })
            return rec

    contact_id = enrollment.get("contact_id")
    if _blank(contact_id):
        return None
    contact = await db.contacts.find_one({"contact_id": contact_id, **_LIVE}, {"_id": 0})
    if not contact:
        return None

    school_id = contact.get("school_id") or enrollment.get("school_id") or ""
    school = {}
    if school_id:
        school = await db.schools.find_one(
            {"school_id": school_id},
            {"_id": 0, "school_name": 1, "assigned_to": 1, "assigned_name": 1}) or {}
    company = school.get("school_name") or contact.get("company") or ""
    # A contact nobody owns still has a sales agent: the school's. Without the
    # fallback a call step would land on nobody's plate.
    assigned_to = contact.get("assigned_to") or school.get("assigned_to") or ""
    assigned_name = (contact.get("assigned_name") if contact.get("assigned_to")
                     else school.get("assigned_name")) or ""
    name = contact.get("name", "") or ""
    phone = contact.get("phone", "") or ""
    email = contact.get("email", "") or ""
    rec = {
        "recipient_kind": "contact",
        "name": name, "company": company, "phone": phone, "email": email,
        "school_id": school_id,
        "assigned_to": assigned_to, "assigned_name": assigned_name,
        # A contact-keyed enrolment has no lead, even if the contact was later
        # converted: this enrolment is the person's, not the deal's.
        "lead_id": None,
        "contact_id": contact_id,
        # lead-shaped aliases
        "contact_name": name, "contact_phone": phone, "contact_email": email,
        "company_name": company,
    }
    # Contacts carry no wa_consent today; leaving the key unset makes
    # _wa_consent_ok fall back to the school's consent, exactly as it does for
    # a lead without one.
    if contact.get("wa_consent") is not None:
        rec["wa_consent"] = contact["wa_consent"]
    return rec


# ── The same human, never twice in one sequence ──────────────────────────────

async def linked_people(db, *, lead_id=None, contact_id=None):
    """Every lead id and contact id that are the same person as the one given.

    A contact and a lead are linked by `contact.lead_id` (the lead it was
    converted into), `lead.contact_id` (the canonical link) and
    `lead.converted_from_contact` (the legacy convert link). Returns
    `(lead_ids, contact_ids)` — both sets include the ids passed in.
    """
    lead_ids, contact_ids = set(), set()
    if not _blank(lead_id):
        lead_ids.add(lead_id)
        lead = await db.leads.find_one(
            {"lead_id": lead_id}, {"_id": 0, "contact_id": 1, "converted_from_contact": 1}) or {}
        for k in ("contact_id", "converted_from_contact"):
            if not _blank(lead.get(k)):
                contact_ids.add(lead[k])
        async for c in db.contacts.find({"lead_id": lead_id}, {"_id": 0, "contact_id": 1}):
            if not _blank(c.get("contact_id")):
                contact_ids.add(c["contact_id"])
    if not _blank(contact_id):
        contact_ids.add(contact_id)
        contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "lead_id": 1}) or {}
        if not _blank(contact.get("lead_id")):
            lead_ids.add(contact["lead_id"])
        async for lead in db.leads.find(
                {"$or": [{"contact_id": contact_id}, {"converted_from_contact": contact_id}]},
                {"_id": 0, "lead_id": 1}):
            if not _blank(lead.get("lead_id")):
                lead_ids.add(lead["lead_id"])
    return lead_ids, contact_ids


async def find_active_duplicate(db, sequence_id, *, lead_id=None, contact_id=None,
                                exclude_enrollment_id=None):
    """The ACTIVE enrolment in `sequence_id` that already reaches this person, or None.

    Blocks a second enrolment for the same lead, the same contact, and the cross
    case — a contact whose linked lead is already running the sequence, or a
    lead whose contact is.
    """
    lead_ids, contact_ids = await linked_people(db, lead_id=lead_id, contact_id=contact_id)
    ors = []
    if lead_ids:
        ors.append({"lead_id": {"$in": list(lead_ids)}})
    if contact_ids:
        ors.append({"contact_id": {"$in": list(contact_ids)}})
    if not ors:
        return None
    q = {"sequence_id": sequence_id, "status": "active", "$or": ors}
    if exclude_enrollment_id:
        q["enrollment_id"] = {"$ne": exclude_enrollment_id}
    return await db.drip_enrollments.find_one(q, {"_id": 0})


async def contacts_already_enrolled(db, sequence_id, contacts: list) -> set:
    """Batch form of the duplicate guard for many contacts at once.

    `contacts` are contact documents (need `contact_id`, `lead_id`). Returns the
    contact ids already reached by an ACTIVE enrolment in `sequence_id` —
    directly, or through a linked lead. Three queries whatever the batch size.
    """
    cids = [c["contact_id"] for c in contacts if not _blank(c.get("contact_id"))]
    if not cids:
        return set()
    linked = {cid: set() for cid in cids}          # contact_id -> its lead ids
    for c in contacts:
        if not _blank(c.get("contact_id")) and not _blank(c.get("lead_id")):
            linked[c["contact_id"]].add(c["lead_id"])
    async for lead in db.leads.find(
            {"$or": [{"contact_id": {"$in": cids}}, {"converted_from_contact": {"$in": cids}}]},
            {"_id": 0, "lead_id": 1, "contact_id": 1, "converted_from_contact": 1}):
        if _blank(lead.get("lead_id")):
            continue
        for k in ("contact_id", "converted_from_contact"):
            if lead.get(k) in linked:
                linked[lead[k]].add(lead["lead_id"])
    all_lead_ids = list({lid for s in linked.values() for lid in s})

    ors = [{"contact_id": {"$in": cids}}]
    if all_lead_ids:
        ors.append({"lead_id": {"$in": all_lead_ids}})
    enrolled_contacts, enrolled_leads = set(), set()
    async for e in db.drip_enrollments.find(
            {"sequence_id": sequence_id, "status": "active", "$or": ors},
            {"_id": 0, "contact_id": 1, "lead_id": 1}):
        if not _blank(e.get("contact_id")):
            enrolled_contacts.add(e["contact_id"])
        if not _blank(e.get("lead_id")):
            enrolled_leads.add(e["lead_id"])
    return {cid for cid in cids
            if cid in enrolled_contacts or (linked[cid] & enrolled_leads)}
