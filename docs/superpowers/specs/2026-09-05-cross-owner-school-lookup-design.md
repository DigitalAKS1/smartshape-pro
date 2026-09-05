# Cross-owner school lookup — design

**Date:** 2026-09-05
**Status:** approved, implementing

## The problem

A sales rep with `own` scope sees only their own schools. `GET /schools`
narrows to schools they own, created, or hold a lead on. Both places where a
rep starts new work read that same list:

- the school dropdown on the lead form (`LeadFormDialog`)
- the school autocomplete on the quotation builder (`useCreateQuotation`)

So when Parul goes to quote **Delhi Public School** and it belongs to Amit, it
is not in her list at all. Not greyed out, not flagged — absent. Her only way
forward is "add new school", and she creates a second Delhi Public School.

This is the manufacturing step for duplicate schools. Everything downstream —
the fuzzy merge tool, the Data Health panel, the periodic cleanups, the ~516
blank junk schools — is cleanup after this moment. The fix belongs here.

## Decisions

Settled with the owner before designing:

| Question | Decision |
|---|---|
| Picking another rep's school | **Use it, notify the owner.** Never blocked, never transferred. |
| Where cross-owner search applies | **The two pickers only.** The CRM Schools tab stays own-territory. |
| What is visible of another's school | **Name, city, owner's name.** No phone, email, address or contacts. |
| What "Auto Sync" controls | **Per-user: notify me when someone works on my school.** Default on. |

## Prerequisite: the notification channel is broken

`db.notifications` has readers and no writers. `db.crm_notifications` has three
writers and no readers.

- `GET /notifications` and the two mark-read endpoints read `db.notifications`.
  Nothing in the backend writes to it.
- `crm_routes` (mailer-QR hot lead), `telephony_routes` and `scheduler` (drip)
  all insert into `db.crm_notifications`. Nothing reads it.

The two halves were never joined, so those three features have been posting
into a void. "Notify the owner" cannot be built on that, so joining them is
part of this work and fixes the three existing callers as a side effect.

**`notify_user(email, *, type, title, body, ref_type, ref_id, from_name)`** in
a shared module, writing to `db.notifications` with `assigned_to = email` —
the field `_notif_scope_query` matches on. The three existing writers are
redirected to it.

## The lookup endpoint

`GET /schools/lookup?q=<text>`

- Requires `leads: read_write` (the grant that already governs school writes).
- `q` must be ≥ 2 characters; results capped at 20; matches name or city.
- Returns a deliberately thin row so ownership still protects something:

```json
{ "school_id": "...", "school_name": "...", "city": "...",
  "assigned_to": "amit@…", "assigned_name": "Amit Rao", "is_mine": false }
```

No phone, email, address, contacts or strength. Enough to recognise the school
and know who to talk to; not enough to work the account.

A user with `all` scope gets the same shape, with `is_mine` reflecting
ownership — one code path, no branching in the UI.

## The pickers

Both merge two sources: the full-detail schools the user already has, then the
lookup's cross-owner rows under a divider.

- **Lead form** — the plain `<select>` becomes a search box, because a dropdown
  cannot express two groups or a "belongs to Amit" label.
- **Quotation builder** — already an autocomplete over `filteredSchools`;
  extend it with the lookup results.

Rows read `Delhi Public School · Rohini — Amit Rao`. Selecting one shows an
inline note: *"Belongs to Amit Rao — he'll be notified."* Said before the save,
not after, so it is never a surprise.

## On save

When a lead or quotation is created against a school whose `assigned_to` is
non-empty and is not the creator:

1. The lead/quotation belongs to the creator. Ownership of the school does not
   move.
2. `notify_user(owner, …)` — unless the owner has Auto Sync off.
3. The school's activity timeline records it either way, so the work is never
   invisible; Auto Sync governs the interruption, not the record.

Creating a lead already makes the school visible to Parul afterwards: the
own-scope query in `GET /schools` includes schools holding her leads. Quotations
carry `school_id` too, so the same clause is extended to quotations, and the two
paths behave alike.

## Auto Sync

`notify_on_cross_owner` on the user document, default `true` (absent reads as
on, so existing users keep the safer behaviour). Editable by the user on their
own profile and by an admin on the user form.

## Testing

Backend:
- the lookup omits phone/email/address/contacts
- a short `q` returns nothing (no enumeration)
- a rep without `leads: read_write` is refused
- `is_mine` is true for own schools, false for others
- a cross-owner lead create notifies the owner; a same-owner create does not
- Auto Sync off suppresses the bell but not the timeline entry
- the notification lands in the collection the bell actually reads
- own-scope `GET /schools` includes a school the user only holds a quotation on

Frontend:
- the picker lists own schools, then others, labelled with the owner
- selecting another rep's school shows the notice
- a school with no owner is not treated as cross-owner

## Out of scope

Ownership transfer, access requests, approval flows, and any change to the CRM
Schools tab's own-territory view.
