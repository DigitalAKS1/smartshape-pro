"""Build cascade-delete plans for a School or a Contact and its CRM+ERP footprint.

A plan is a list of (collection, query) pairs consumed by audit_backup. We resolve the
id sets first (leads, contacts, quotations, orders, dispatches, FMS flows) then express
the delete as one query per collection so nothing is double-counted.

Linking keys in this codebase: school_id (+ school_name on quotations/invoices),
lead_id, contact_id, order_id, quotation_id, selection_id (catalogue_selections PK,
referenced as catalogue_selection_id on items), flow_id, stage_id.

Notes / deliberate exclusions:
- activity_logs are NOT deleted — they are our internal audit trail; the audit_backups
  bundle already preserves the deleted records.
- Already-dispatched stock is NOT restored. order_items get deleted, so live "committed"
  demand drops; callers run recompute_reservations() afterward to heal dies.reserved_qty.
  dies.stock_qty is never touched here, so shipped goods stay deducted.
"""

from database import db

_CAP = 100000


async def _ids(coll: str, query: dict, field: str):
    docs = await db[coll].find(query, {"_id": 0, field: 1}).to_list(_CAP)
    return [d[field] for d in docs if d.get(field)]


async def build_school_plan(school: dict):
    """Return (plan, label, touches_orders) for a full school nuke."""
    sid = school["school_id"]
    name = (school.get("school_name") or "").strip()

    lead_ids = await _ids("leads", {"school_id": sid}, "lead_id")
    contact_ids = await _ids("contacts", {"school_id": sid}, "contact_id")

    quot_or = [{"school_id": sid}] + ([{"school_name": name}] if name else [])
    quotation_ids = await _ids("quotations", {"$or": quot_or}, "quotation_id")

    order_ids = await _ids(
        "orders", {"$or": [{"school_id": sid}, {"quotation_id": {"$in": quotation_ids}}]}, "order_id")
    selection_ids = await _ids(
        "catalogue_selections", {"quotation_id": {"$in": quotation_ids}}, "selection_id")
    flow_ids = await _ids(
        "fms_flows", {"$or": [{"school_id": sid}, {"lead_id": {"$in": lead_ids}}]}, "flow_id")

    lead_in = {"$in": lead_ids}
    contact_in = {"$in": contact_ids}
    quot_in = {"$in": quotation_ids}
    order_in = {"$in": order_ids}
    flow_in = {"$in": flow_ids}

    inv_or = [{"school_id": sid}, {"order_id": order_in}] + ([{"school_name": name}] if name else [])

    plan = [
        # CRM core
        ("schools", {"school_id": sid}),
        ("leads", {"school_id": sid}),
        ("contacts", {"school_id": sid}),
        # quotations + catalogue
        ("quotations", {"quotation_id": quot_in}),
        ("catalogue_selections", {"quotation_id": quot_in}),
        ("catalogue_selection_items", {"catalogue_selection_id": {"$in": selection_ids}}),
        ("quotation_edit_history", {"quotation_id": quot_in}),
        # orders + ERP children
        ("orders", {"order_id": order_in}),
        ("order_items", {"order_id": order_in}),
        ("order_timeline", {"order_id": order_in}),
        ("payments", {"order_id": order_in}),
        ("dispatches", {"$or": [{"order_id": order_in}, {"school_id": sid}]}),
        ("invoices", {"$or": inv_or}),
        # lead activity
        ("visit_plans", {"$or": [{"school_id": sid}, {"lead_id": lead_in}]}),
        ("followups", {"lead_id": lead_in}),
        ("call_notes", {"lead_id": lead_in}),
        ("tasks", {"lead_id": lead_in}),
        ("physical_dispatches", {"lead_id": lead_in}),
        ("drip_enrollments", {"lead_id": lead_in}),
        ("whatsapp_logs", {"lead_id": lead_in}),
        ("greeting_logs", {"contact_id": contact_in}),
        # school portal
        ("school_notifications", {"school_id": sid}),
        ("school_requests", {"school_id": sid}),
        ("teachers", {"school_id": sid}),
        # FMS
        ("fms_flows", {"flow_id": flow_in}),
        ("fms_stages", {"flow_id": flow_in}),
        ("fms_notifications", {"flow_id": flow_in}),
        ("fms_action_logs", {"flow_id": flow_in}),
        ("fms_payments", {"flow_id": flow_in}),
    ]
    return plan, (name or sid), bool(order_ids)


async def build_contact_plan(contact: dict):
    """Return (plan, label, touches_orders) for a contact + its own lead chain.

    Narrower than a school nuke: deletes the contact, the lead(s) it became / is
    referenced by, and that lead's activity + quotations + orders. Sibling contacts and
    school-wide records are left intact (use the school cascade to remove everything).
    """
    cid = contact["contact_id"]

    lead_or = [{"converted_from_contact": cid}, {"referred_by_contact_id": cid}]
    if contact.get("lead_id"):
        lead_or.append({"lead_id": contact["lead_id"]})
    lead_ids = await _ids("leads", {"$or": lead_or}, "lead_id")

    quotation_ids = await _ids("quotations", {"lead_id": {"$in": lead_ids}}, "quotation_id")
    order_ids = await _ids(
        "orders", {"$or": [{"lead_id": {"$in": lead_ids}}, {"quotation_id": {"$in": quotation_ids}}]}, "order_id")
    selection_ids = await _ids(
        "catalogue_selections", {"quotation_id": {"$in": quotation_ids}}, "selection_id")

    lead_in = {"$in": lead_ids}
    quot_in = {"$in": quotation_ids}
    order_in = {"$in": order_ids}

    plan = [
        ("contacts", {"contact_id": cid}),
        ("leads", {"lead_id": lead_in}),
        ("quotations", {"quotation_id": quot_in}),
        ("catalogue_selections", {"quotation_id": quot_in}),
        ("catalogue_selection_items", {"catalogue_selection_id": {"$in": selection_ids}}),
        ("quotation_edit_history", {"quotation_id": quot_in}),
        ("orders", {"order_id": order_in}),
        ("order_items", {"order_id": order_in}),
        ("order_timeline", {"order_id": order_in}),
        ("payments", {"order_id": order_in}),
        ("dispatches", {"order_id": order_in}),
        ("visit_plans", {"lead_id": lead_in}),
        ("followups", {"lead_id": lead_in}),
        ("call_notes", {"lead_id": lead_in}),
        ("tasks", {"lead_id": lead_in}),
        ("call_notes", {"contact_id": cid}),
        ("followups", {"contact_id": cid}),
        ("tasks", {"contact_id": cid}),
        ("physical_dispatches", {"lead_id": lead_in}),
        ("drip_enrollments", {"lead_id": lead_in}),
        ("whatsapp_logs", {"lead_id": lead_in}),
        ("greeting_logs", {"contact_id": cid}),
    ]
    return plan, (contact.get("name") or cid), bool(order_ids)
