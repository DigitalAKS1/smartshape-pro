# CRM Performance Redesign — Deployment Checklist

**Plan:** `docs/superpowers/plans/2026-09-08-crm-performance-redesign.md`
**Scope:** Redis cache, compound indexes, paginated `GET /leads`, lead details, batch
import, streaming export, CRM hooks.
**Last verified against the tree:** 2026-09-08 (HEAD `3ee7a47`, 10 commits ahead of
`origin/main` `296b1cf`).

> Read Section 0 before anything else. As of the date above this change set is
> **NOT deployable as-is** — four items must be closed first. Everything after
> Section 0 assumes they are closed.

---

## 0. Release blockers (must be closed before Section 1)

These are not hypothetical; each was verified against the working tree.

- [ ] **B1 — Redis does not exist in production.** Task 1 added the `redis` service to
      `docker-compose.yml` (dev/local only). Production deploys with
      `docker-compose.prod.yml` (`deploy.sh:40-42`), which has **no redis service**.
      → Add the `redis` service + `redis_data` volume to `docker-compose.prod.yml`, and
      add `depends_on: redis` to the `backend` service.
- [ ] **B2 — Backend is not pointed at Redis.** `backend/cache.py:12-13` defaults to
      `REDIS_HOST=localhost`. Inside the backend container `localhost` is the backend
      itself, not the Redis container. There is no `REDIS_*` key in `backend/.env`.
      → Set `REDIS_HOST=redis` and `REDIS_PORT=6379` in `backend/.env` on the VPS.
      Without B1+B2 every cache call silently no-ops (by design, see `cache.py:30-36`)
      and **none of the caching performance targets will be met in production** — the
      app will work, it will just be as slow as before.
- [ ] **B3 — Blocking Redis client in async request paths.** `backend/cache.py:5,11` uses
      the synchronous `redis.Redis`, called from `async def` handlers
      (`cache.py:26,44,62,77`). This was raised as a CRITICAL gate in the Task 2 review
      ("must be done before Task 4 ships"); Task 4 shipped in `02ff14b` with the gate
      still open. With `socket_connect_timeout=5`, a reachable-but-slow Redis stalls the
      **entire event loop** for up to 5s per call. Paradoxically this risk only becomes
      live once B1/B2 are fixed.
      → Swap to `redis.asyncio` and `await` the calls before enabling Redis in prod.
- [ ] **B4 — Uncommitted work.** Tasks 5/6/7 (lead details, batch import, streaming
      export) are sitting in the working tree, not in any commit:
      `backend/routes/admin_routes.py` (+481), `backend/routes/crm_routes.py` (+106),
      `backend/tests/test_crm_pagination.py` (+184). `backend/tests/test_import_performance.py`
      and `backend/tests/test_export_streaming.py` are **untracked**.
      → Commit them, or they will not deploy and will not run in CI.

**Known-incomplete, not blocking:**
- Task 11 (LeadsCRM component refactor) is **BLOCKED** — there is no new lead-list UI.
  Section 5 is written accordingly.
- Task 12 (`backend/tests/test_performance_benchmarks.py`) **does not exist**, so the
  <500ms / <200ms / >75% hit-rate targets have no automated gate. Section 1 uses the
  test suites that do exist.

---

## 1. Pre-deployment tests (30 min) — run locally, never against prod

**Never point pytest at the live DB.** `backend/.env` has `MONGO_URL`/`DB_NAME` set to
the live Atlas cluster (`smartshape_prod`), and conftest wipes collections. Always
override both on the command line.

- [ ] Backend perf/CRM suites green:
      ```bash
      cd backend
      DB_NAME=mtt_ci MONGO_URL="mongodb://localhost:27017" \
        python -m pytest tests/test_crm_pagination.py tests/test_import_performance.py \
                         tests/test_export_streaming.py -q
      ```
      Last actual run: **40 passed in 15.30s** (500 schools + 2 tags each -> 1.11s).
- [ ] Full backend suite green (catches regressions the perf suites don't):
      ```bash
      cd backend
      DB_NAME=mtt_ci MONGO_URL="mongodb://localhost:27017" python -m pytest -q
      ```
- [ ] Frontend tests green: `cd frontend && yarn test --watchAll=false`
- [ ] Frontend build succeeds: `bash scripts/build-frontend.sh`
      (needs `DISABLE_ESLINT_PLUGIN=true` + `NODE_OPTIONS=--max-old-space-size=4096`;
      if building from a worktree, pass `REACT_APP_BACKEND_URL=https://app.smartshape.in`
      **inline** or the bundle ships with an undefined API base and every page 404s.)
- [ ] `frontend/build/index.html` exists and is committed — `deploy.sh:29-33` hard-fails
      without it (the VPS OOMs if it tries to run webpack itself).
- [ ] Verify the committed bundle is the one you just built (compare the hash in
      `frontend/build/asset-manifest.json`, not the timestamp).
- [ ] `git status` clean except intended files. **Never `git add -A`** in the deploy
      worktree.

---

## 2. Infrastructure — Redis (5 min, on the VPS)

Only meaningful after B1/B2/B3 are closed.

- [ ] Service defined in the file production actually uses:
      `grep -n redis docker-compose.prod.yml`
- [ ] Container up: `docker compose -f docker-compose.prod.yml ps | grep redis`
- [ ] Responds: `docker exec smartshape-redis redis-cli ping` → `PONG`
- [ ] Backend can reach it *by the name it will use*:
      `docker exec smartshape-backend python -c "import redis,os; print(redis.Redis(host=os.environ.get('REDIS_HOST','localhost')).ping())"` → `True`
- [ ] Port stays bound to loopback (`127.0.0.1:6379:6379`) — Redis has no auth here, so
      it must never be exposed publicly. Confirm: `ss -lntp | grep 6379`.
- [ ] No `Cache get error` / `Cache set error` lines in
      `docker compose -f docker-compose.prod.yml logs --tail=200 backend`.

---

## 3. Database — indexes (10 min)

Indexes are created two ways: automatically at boot via `connect_db()` in
`backend/database.py` (wrapped in the non-fatal `_i()` helper so a duplicate-data
collision cannot crash startup), and manually via `backend/ensure_indexes.py`.

- [ ] **Back up Atlas first** (index builds are additive and safe, but you are about to
      touch prod — take the snapshot anyway).
- [ ] Dry-run against a scratch DB:
      `cd backend && DB_NAME=mtt_ci MONGO_URL="mongodb://localhost:27017" python ensure_indexes.py --compound`
- [ ] Apply to production **deliberately** — the script refuses production-looking targets
      unless you opt in (`ensure_indexes.py:146-152`):
      `python ensure_indexes.py --compound --yes-production`
- [ ] Read its summary line: `N created, M already present, 0 errors`. Any non-zero error
      count → stop and investigate before deploying backend code that assumes the index.
- [ ] Builds are `background=True`, so they will not lock the collection, but on a large
      `schools`/`leads` collection they still take time. Confirm they finished:
      `db.leads.getIndexes()` / `db.schools.getIndexes()`.
- [ ] Spot-check the plan for the hot query — filter+sort on leads should report
      `IXSCAN`, not `COLLSCAN`:
      `db.leads.find({is_deleted:{$ne:true}, stage:"negotiation"}).sort({created_at:-1}).explain("executionStats")`
- [ ] Note: the tag field on `leads`/`schools` is `tags`, not `tag_ids` (fixed in
      `4cf1b89`). If you hand-write an index, match the real field or it will never be used.

---

## 4. Backend deploy (15 min)

Production auto-deploys from `origin/main` — a systemd timer on the VPS runs `deploy.sh`
roughly every 1-2 minutes. Pushing to main *is* the deploy.

- [ ] Push the reviewed commits to `origin/main`.
- [ ] Watch it land (or run `bash deploy.sh` on the VPS to do it now).
- [ ] **Do not `pkill -f deploy.sh`** — on this 1-vCPU box that kills your own SSH session.
      The 15s health-check wait in `deploy.sh:53` false-negatives on a slow box; let it
      finish and read the outcome.
- [ ] Health: `curl -sf https://app.smartshape.in/api/health`
- [ ] Endpoints answer (as a logged-in user, not anonymously):
      - [ ] `GET /api/leads?page=1&limit=50` → 200, paginated envelope, and page 2 returns
            a *different* set
      - [ ] `GET /api/leads/{lead_id}/details` → 200
      - [ ] `POST /api/import/execute` → import runs and progress is readable
      - [ ] `GET /api/export/schools` → streams a file, not a timeout
- [ ] Every response body is `_id`-free (all queries project `{"_id": 0}`).
- [ ] Tenant scoping intact — a rep sees only their own leads; an admin sees all.
- [ ] Cache is actually being written (after B1/B2):
      `docker exec smartshape-redis redis-cli --scan --pattern 'leads:*' | head`
      and `docker exec smartshape-redis redis-cli info stats | grep keyspace`
- [ ] Second identical request to `/api/leads` is materially faster than the first.
- [ ] Error rate in `docker compose -f docker-compose.prod.yml logs --tail=300 backend`
      is no worse than before the deploy.

---

## 5. Frontend rollout (all-or-nothing — read this)

There is **no percentage-based rollout mechanism in this stack**. The frontend is a
static CRA bundle committed under `frontend/build/` and served by a single nginx
container; there is no CDN traffic split, no feature-flag service, and no A/B router.
The only real controls are (a) ship the bundle or don't, and (b) revert the bundle
commit. Do not write "10% / 25% / 50%" into a status update — it is not what happens.

Additionally, Task 11 is BLOCKED, so **there is no new lead-list component to roll out**.
This release is backend-only from the user's point of view: the existing CRM screens get
faster because the endpoints behind them got faster.

- [ ] Confirm the deployed bundle hash matches what you built (view-source →
      `main.<hash>.js`, compare to `asset-manifest.json`).
- [ ] Hard-reload once. If users report a blank screen or a chunk-load error after
      deploy, that is the stale-chunk case — the lazyRoute retry+reload handles it, but
      confirm it recovers.
- [ ] Smoke-test the CRM as a **rep** (not just admin): Leads tab loads, filter rail
      works, tag filter returns rows, pagination advances, Schools tab loads.
- [ ] Smoke-test Import Center: upload → preview → execute → progress → result.
- [ ] Smoke-test Export: schools export downloads and opens in Excel.

**If/when Task 11 ships a replacement component**, stage it as: keep the old component
mounted behind a per-user or per-role condition, ship to internal users first, then
widen. That gate has to be built; it does not exist today.

---

## 6. Post-deployment monitoring (20 min, then 24h)

- [ ] Watch backend logs for 20 minutes: `docker compose -f docker-compose.prod.yml logs -f backend`
- [ ] No `Cache get error` / `Cache set error` storms (a steady stream means Redis is
      unreachable and you are running fully uncached).
- [ ] No Mongo slow-query warnings on `leads` / `schools`.
- [ ] Container memory stable — Redis with `appendonly yes` grows; check
      `docker stats --no-stream` and `redis-cli info memory`. Set `maxmemory` +
      `allkeys-lru` if it drifts up.
- [ ] Ask one rep to run their normal morning flow and say whether it feels faster. This
      change set has never met real production data volumes — a real user is the only
      honest benchmark you have today.
- [ ] Re-check the next morning: the nightly scheduler jobs (account lifecycle refresh,
      drip executor) still run and did not start colliding with cache invalidation.
- [ ] Record actual timings observed in prod for `/api/leads` p50/p95 so the targets
      (<500ms list, <200ms tag filter) can be judged against something real.

---

## 7. Rollback

`deploy.sh` already self-rolls-back: it records `PREV_COMMIT` before deploying and, if
the health check fails, resets to it and rebuilds (`deploy.sh:62-71`). That covers a
crash-on-boot. It does **not** cover "it started fine but it's wrong."

**Manual rollback (app is up but broken):**
1. [ ] `git revert <commit>...` on main and push. The timer redeploys. Prefer revert
       over `reset --hard` on a shared branch.
2. [ ] Include the frontend bundle in the revert, or you will ship old JS against a new
       API (or vice versa).
3. [ ] Verify: health check, bundle hash, CRM loads.

**Partial rollback (turn off caching only, keep everything else):**
- [ ] Unset `REDIS_HOST` in `backend/.env` and restart the backend. `cache.py` fails
      silently on connection error, and both route modules wrap the import in a
      try/except no-op fallback (`crm_routes.py:29-41`), so the app degrades cleanly to
      uncached. This is the safest lever and does not require a code change.

**Leave in place on rollback:**
- [ ] **Keep the indexes.** They are additive, cost only disk + a little write overhead,
      and are used by the old query paths too. Dropping them is a destructive operation
      requiring explicit owner approval — do not do it as part of a rollback.
- [ ] **Keep the Redis container.** Idle Redis costs a few MB. Removing the volume
      destroys data; leave it.

**Do not, under any circumstances, as part of a rollback:** drop a collection, delete
documents, or run a "cleanup" script. Nothing in this change set writes destructive
migrations, so there is nothing to undo at the data layer.

---

## Sign-off

| Phase | Owner | Date | Result |
|---|---|---|---|
| 0. Blockers closed | | | |
| 1. Pre-deployment tests | | | |
| 2. Redis infrastructure | | | |
| 3. Database indexes | | | |
| 4. Backend deploy | | | |
| 5. Frontend verification | | | |
| 6. Monitoring (24h) | | | |
