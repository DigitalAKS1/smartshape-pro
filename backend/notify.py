"""notify.py — the one way to put something in a user's notification bell.

There were two halves of a notification system that had never been joined:
`db.notifications` had readers (GET /notifications, the mark-read endpoints,
the bell) and no writers anywhere in the backend, while `db.crm_notifications`
had three writers — the mailer-QR hot lead, the forwarded call, the stalled
drip — and no readers at all. Every one of those pings went into a collection
nothing displays.

So this module exists to make "tell that user" mean one thing. It writes to
`db.notifications` with `assigned_to` set to the recipient, because that is the
field `_notif_scope_query` in admin_routes matches on; a notification written
any other way is invisible no matter how correct its contents.

Deliberately domain-free (it imports only the db handle) so routes, the
scheduler and services can all use it without an import cycle.
"""

import uuid
from datetime import datetime, timezone

from database import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def notify_user(email: str, *, type: str, title: str, body: str = "",
                      ref_type: str = "", ref_id: str = "", from_name: str = "",
                      dedup_key: str = "") -> str | None:
    """Put one notification in `email`'s bell. Returns its id, or None.

    Returns None without writing when there is no recipient, or when
    *dedup_key* matches an existing unread notification — a stalled drip
    re-checked every hour should be one bell entry, not twenty-four a day.
    """
    email = (email or "").strip()
    if not email:
        return None

    if dedup_key:
        existing = await db.notifications.find_one(
            {"assigned_to": email, "dedup_key": dedup_key, "is_read": False},
            {"_id": 0, "notif_id": 1})
        if existing:
            return existing.get("notif_id")

    notif_id = f"ntf_{uuid.uuid4().hex[:10]}"
    await db.notifications.insert_one({
        "notif_id": notif_id,
        # The bell scopes on assigned_to. `email` is kept alongside it because
        # the three redirected callers already wrote that key and their
        # existing rows are read back by the same code.
        "assigned_to": email,
        "email": email,
        "type": type,
        "title": title,
        "body": body,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "from_name": from_name,
        "dedup_key": dedup_key,
        "is_read": False,
        "created_at": _now(),
    })
    return notif_id
