# Master Directory Caller-Lookup & Routing

Date: 2026-06-24
Module: CRM (`backend/routes/crm_routes.py`, `frontend/src/.../crm`)

## Problem
Admin bulk-uploads all schools + contacts. A salesperson gets a call from a school
that may or may not be theirs. Today, search is RBAC-scoped (a rep only finds their
own records), so they can't look a caller up across the master directory, and there's
no flow to claim an unassigned account or route a call to its real owner.

## Confirmed decisions
- **Unassigned match → claim instantly** + create the lead (no approval gate).
- **Owned by another rep → notify the owner (in-app) + log the inbound call**; the
  current rep does NOT take the lead (they forward the call).
- **Visibility → full record**: any sales user can VIEW a matched account's full
  profile (read-only). Mutations stay owner/admin-gated.
- **Two entry points**: a dedicated Caller Lookup widget AND the same search embedded
  in the New Lead flow (duplicate-guard).
- Notifications are in-app (mirrors the Delegation pattern). No telephony integration.

## Backend (`crm_routes.py`)

### 1. Cross-owner directory search — `GET /directory/search?q=&limit=`
Searches **schools + contacts + leads** by name / phone / email / city, ignoring the
normal sales scoping (the one deliberate exception; accounts/store still denied).
Each result carries `ownership` relative to the caller:
- `mine` (owner == me), `unassigned` (no owner), `other` (owner is someone else, with `owner_name`).
Result item: `{ kind: 'school'|'contact'|'lead', ref_id, school_id, title, subtitle, phone, email, owner_email, owner_name, ownership }`.
Deduped/capped (default 20).

### 2. Claim — `POST /directory/claim`  `{ school_id? , contact_id? }`
- School: only if currently **unassigned** (or caller is admin) → set owner to caller
  and cascade ownership onto **only the unassigned** contacts/leads under it (never
  steals already-owned children). New helper `_claim_unassigned_cascade()`.
- Standalone contact (no school): set `assigned_to` to caller if unassigned.
- 409 if already owned by someone else (non-admin).

### 3. CRM notifications (new — CRM has none today)
- Collection `crm_notifications`: `{ notif_id, email (recipient), type, title, body, ref_type, ref_id, from_name, is_read, created_at }`.
- Helper `_crm_notify(email, type, title, body, ref_type, ref_id, from_name)`.
- `GET /crm/notifications?unread_only=`, `POST /crm/notifications/{id}/read`, `POST /crm/notifications/read-all` (scoped to current user's email).

### 4. Inbound-call log + forward — `POST /directory/inbound-call`
Body `{ kind, ref_id, school_id?, caller_phone, note? }`.
- Writes an `inbound_call_logs` entry `{ log_id, caller_phone, kind, ref_id, school_id, school_name, owner_email, owner_name, received_by_email, received_by_name, outcome, note, created_at }`.
- If the matched record is owned by **another** user → `outcome='forwarded'` and
  `_crm_notify(owner, 'incoming_call', …)` with caller number + who took it.
- Otherwise `outcome='mine'`.

### 5. Relax profile read — `GET /schools/{school_id}/profile`
Allow read for any admin/sales user (block accounts/store), so a directory match opens
the full profile. Deliberate broadening per the "full record" decision; edits unchanged.

## Frontend
- `lib/api.js`: `directory.search/claim/inboundCall`, `crmNotifications.list/read/readAll`.
- `components/crm/CallerLookup.js` (new): modal — phone/name search → results with
  ownership badge (Mine / Unassigned / Owner: X) and per-state action:
  - `unassigned` → **Claim & create lead** (calls claim, then opens New Lead prefilled, assigned to me)
  - `mine` → **Create lead** (opens New Lead prefilled)
  - `other` → **Forward & notify** (calls inbound-call; toast "Owner notified") + shows owner name; "View" opens read-only profile
- `LeadsCRM.js` header: a **Caller Lookup** button + a **CRM notifications bell**
  (lists incoming-call notifications, mark read).
- `LeadFormDialog.js`: a directory-match **banner** — when the typed phone/school
  matches an existing account, surface it (owned-by warning / link to claim/forward)
  so reps don't create duplicates. Reuses the same `directory.search`.

## Build sequence
1. Backend §1–§5 (compile-check).
2. Frontend api.js methods.
3. CallerLookup widget + wire claim/forward + open existing LeadFormDialog prefilled.
4. CRM notifications bell.
5. New Lead duplicate-guard banner.
6. Build verification.

## Out of scope
- Telephony/click-to-call (manual forward).
- Rebuilding bulk import (contacts + leads CSV already exist; schools auto-create on import).
- Transfer-request/approval when owned by another (chosen: notify only).
