# Collaborative Calendar — Program Handoff

A "Collaborative Calendar" program inside the Delegation module, decomposed into 4
sub-projects. The unified Calendar itself (Phases 1–5: Month/Week/Day, hour-by-hour
day planner with personal plan-blocks + drag, click→act EventActionDrawer, team-member
picker) is **already BUILT and LIVE**.

## Status

| Sub-project | Scope | Status |
|---|---|---|
| **SP1** | Collaborative Events + Click-to-Add: click a slot → personal block OR shared event; events have collaborators (teammates + any external email); appear on every collaborator's calendar (agenda source `event`); creator Edit/Cancel, collaborators Accept/Decline. | ✅ DONE & LIVE |
| **SP3 (pull core)** | Per-event `.ics` "Add to calendar": `GET /delegation/events/{id}.ics` returns a VEVENT; drawer has an "Add to calendar" link (Google/Apple/Outlook). | ✅ DONE & LIVE |
| **SP3 (REST)** | Auto-email an ICS invite (METHOD:REQUEST, ORGANIZER+ATTENDEE, SEQUENCE for updates, METHOD:CANCEL on cancel) to collaborators when an event is created/updated/cancelled, **PLUS** a per-user subscribe feed endpoint (tokenized `GET /delegation/calendar.ics?token=…` that calendar apps subscribe to by URL — covers Apple). | ⏭️ NEXT |
| **SP2** | Calendar visual polish (frontend-design skill). | ⏭️ Planned |
| **SP4** | Google + Microsoft OAuth two-way sync (BIG; Apple has NO OAuth calendar API → Apple stays on the SP3 subscribe feed). Needs USER setup: Google Cloud project (OAuth consent screen + calendar-scope verification, ~weeks) and Azure app registration + privacy-policy URL. | ⏭️ Planned |

### ⚠️ SP3 REST is OUTWARD-FACING
It emails real people incl. external clients. Build **SEND-SAFE**:
- An explicit "Send invites" action (not silent auto-blast).
- A test path that sends only to a safe test address — NEVER email real collaborators
  during testing.
- Reuse the existing email helper (`_send_email` in
  `backend/routes/customer_routes.py:171`).
- The `cal_events` doc already has a reserved `ext_sync: {}` field to store ICS
  uid/sequence.

## Key files

- **Spec (SP1):** `docs/superpowers/specs/2026-06-07-collaborative-calendar-events-design.md`
  (program decomposition + cal_events model).
- **Calendar specs/plans:** `docs/superpowers/specs/2026-06-06-delegation-calendar-planner-design.md`
  and `docs/superpowers/plans/2026-06-0X-delegation-calendar-phase*.md`.
- **Backend:** `backend/routes/delegation_routes.py` — unified agenda (`get_agenda` +
  `_agenda_*` normalizers + `_ev` event-builder + `AGENDA_COLORS`), plan-blocks,
  reassignment/notifications, AND cal_events (`create_event`/`update_event`/
  `cancel_event`/`respond_event`, `_agenda_events`, `_build_collaborators`,
  `event_ics`). Helpers: `now_iso`, `gen_id`, `_resolve_actor`.
- **Email helper:** `backend/routes/customer_routes.py:171` —
  `async def _send_email(sender_email, app_password, sender_name, to_list, cc_list, subject, body_plain)`,
  Gmail `SMTP_SSL`. Settings doc: `db.settings.find_one({"type": "email"})`
  (`sender_email`, `gmail_app_password`, `sender_name`, `enabled`).
- **Frontend:** `frontend/src/hooks/useDelegationCalendar.js` (state + agenda fetch +
  runAction dispatcher + createEvent/updateEvent + plan-block actions);
  `frontend/src/components/delegation/calendar/` (DelegationCalendar,
  CalendarMonth/Week-as-AgendaList/Day, EventActionDrawer, DayPlanBlockDialog,
  EventDialog, CollaboratorPicker); `frontend/src/lib/api.js`
  (delegation.events / planBlocks / agenda; training; etc.).

## Conventions & gotchas

- Branch off `main` per sub-project; deploy is main-based.
- **Backend tests** = live-server integration tests in `backend/tests/` (gitignored),
  self-cleaning with a prefix. Run against an ISOLATED test DB to avoid prod impact AND
  to stop the marketing schedulers from sending real email/WhatsApp:
  `cd backend && DB_NAME=smartshape_test python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning`,
  then `REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/<file> -v`.
  Login `info@smartshape.in` / `admin123`; grab the `access_token` cookie and set it as
  a Bearer header (the cookie is httponly+Secure, won't resend over http). STOP the
  server right after.
- Uvicorn has NO reliable `--reload` on this Windows box → after editing routes, restart
  the server before running tests.
- **Frontend verify:** `cd frontend && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build`
  (a pre-existing react-hooks/exhaustive-deps eslint-plugin issue breaks the normal
  build). Then `rm -rf build`.
- **Deploy** (manual; CI auto-deploy is broken): merge to main + push, then SSH via
  Python paramiko to the VPS (see memory `vps_credentials.md`: srv1667373.hstgr.cloud,
  root, /var/www/smartshape) and run:
  `cd /var/www/smartshape && git pull origin main && REACT_APP_BACKEND_URL=https://app.smartshape.in docker compose -f docker-compose.prod.yml build --no-cache backend frontend && docker compose -f docker-compose.prod.yml up -d backend frontend`.
  Do NOT pass `--remove-orphans` (a separate WA/Tor stack shares the project).
  Frontend-only changes → rebuild just `frontend`. Capture the current commit first as a
  rollback point. Delete any temp file holding the SSH password afterward. Verify live: a
  protected route returns 401, and `curl https://app.smartshape.in/` shows the new
  `main.<hash>.js` bundle; user must hard-refresh (Ctrl+Shift+R) — there's a service
  worker.
- ⚠️ A concurrent session sometimes rebases/moves shared branches mid-flight. Before
  deploying, verify main actually contains the latest commits
  (`git merge-base --is-ancestor`) and that the working tree has the files; recover
  orphaned commits by SHA if needed.
- The browser/Playwright MCP connects/disconnects intermittently; if down, verify via
  endpoint-contract audit + backend tests + production build, and ask the user to
  click-through.
