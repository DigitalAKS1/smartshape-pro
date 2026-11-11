"""reorder_drip.py — the opt-in "you bought before, here are new dies" drip.

Once a day, every school that services/reorder.py says is due to buy again
(its usual gap since its last order has passed — app orders AND old orders
count) is enrolled into each ACTIVE drip sequence whose trigger is
"reorder_due". Nothing happens until someone creates such a sequence.

Guards against nagging:
  - reorder_candidates already skips a school with an open Reorder/New Dies deal
    (and enrolment opens one, so tomorrow it is skipped);
  - a school enrolled in the same sequence in the last REENROLL_AFTER_DAYS is
    never enrolled again, whatever happened to the deal;
  - MAX_PER_RUN caps one day's batch.
"""
from datetime import datetime, timedelta, timezone

from services.reorder import reorder_candidates

TRIGGER = "reorder_due"
REENROLL_AFTER_DAYS = 180
MAX_PER_RUN = 200
ACTOR = "system:reorder_due"


async def run_reorder_drip(db, *, dry_run: bool = False) -> dict:
    seqs = [s async for s in db.drip_sequences.find({"trigger": TRIGGER, "is_active": True}, {"_id": 0})
            if s.get("steps")]
    if not seqs:
        return {"sequences": 0, "due": 0, "enrolled": 0}
    due = [c["school_id"] for c in await reorder_candidates(db)]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=REENROLL_AFTER_DAYS)).isoformat()
    from routes.drip_routes import enroll_schools_core      # lazy: avoid an import cycle
    enrolled = 0
    per_sequence = []
    for seq in seqs:
        recent = {e["school_id"] async for e in db.drip_enrollments.find(
            {"sequence_id": seq["sequence_id"], "school_id": {"$in": due}, "enrolled_at": {"$gte": cutoff}},
            {"_id": 0, "school_id": 1}) if e.get("school_id")}
        todo = [sid for sid in due if sid not in recent][:MAX_PER_RUN]
        if dry_run or not todo:
            per_sequence.append({"sequence_id": seq["sequence_id"], "name": seq.get("name", ""), "would_enroll": len(todo)})
            continue
        out = await enroll_schools_core(seq, todo, actor_email=ACTOR)
        enrolled += out["enrolled"]
        per_sequence.append({"sequence_id": seq["sequence_id"], "name": seq.get("name", ""), "enrolled": out["enrolled"]})
    return {"sequences": len(seqs), "due": len(due), "enrolled": enrolled, "per_sequence": per_sequence}
