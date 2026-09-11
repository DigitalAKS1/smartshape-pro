"""Cancel every drip enrolment the duplicate executor (removed in
run_auto_reminders(), see routes/admin_routes.py) may have consumed.

The old executor walked production enrolments forward every 60s without
ever actually delivering anything (no WhatsApp provider was configured) —
it only inserted a `whatsapp_logs` row with status "queued" and advanced
current_step/next_step_at as if the step had gone out. That leaves:
  - "completed" enrolments that never really completed.
  - "active" enrolments that would resume mid-sequence having skipped
    whatever steps were faked.

The owner's call: cancel them ALL and start fresh. Nobody should receive a
message automatically from these; whoever he still wants to reach gets
deliberately re-enrolled into sequences written for now — some of these
were enrolled in June, and a months-late "following up on your enquiry"
would read as broken.

Scope:
  - Every enrolment with status "active" or "completed" -> "cancelled".
  - Records WHY: cancel_reason (plain English), cancelled_at, and the
    PREVIOUS status in status_before_cancel, so a genuine completion is
    never silently indistinguishable from a false one.
  - Enrolments already "cancelled" are left completely untouched (no
    cancel_reason/status_before_cancel is added retroactively — we cannot
    know why they were really cancelled).
  - Does NOT touch whatsapp_logs.

Idempotent: a second run cancels zero (nothing left matching status
active/completed).
"""

_REASON = (
    "Consumed by a duplicate drip executor (run_auto_reminders in "
    "admin_routes.py, running every 60s) with no WhatsApp provider "
    "configured, so nothing was ever actually delivered. Cancelled in bulk "
    "so no stale/months-late message goes out automatically; re-enrol "
    "deliberately into a current sequence if still relevant."
)


async def cancel_stale_drip_enrollments(db) -> dict:
    from datetime import datetime, timezone

    now_iso = datetime.now(timezone.utc).isoformat()
    counts = {"active": 0, "completed": 0}

    for prev_status in ("active", "completed"):
        cursor = db.drip_enrollments.find(
            {"status": prev_status}, {"_id": 1}
        )
        async for doc in cursor:
            await db.drip_enrollments.update_one(
                {"_id": doc["_id"]},
                {"$set": {
                    "status": "cancelled",
                    "status_before_cancel": prev_status,
                    "cancel_reason": _REASON,
                    "cancelled_at": now_iso,
                }},
            )
            counts[prev_status] += 1

    return {
        "cancelled_from_active": counts["active"],
        "cancelled_from_completed": counts["completed"],
        "total_cancelled": counts["active"] + counts["completed"],
    }


if __name__ == "__main__":
    import asyncio
    from database import db

    print(asyncio.run(cancel_stale_drip_enrollments(db)))
