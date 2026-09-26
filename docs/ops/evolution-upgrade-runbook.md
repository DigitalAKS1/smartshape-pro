# Evolution API upgrade runbook — v2.2.3 → v2.3.7 (WhatsApp, W1a)

Read this together, owner and operator, before starting. WhatsApp sending/receiving is down for about 30 minutes while this runs; the rest of the app (CRM, orders, email) is unaffected. Every step below is a real command run as root on the VPS, in `/var/www/smartshape`. Stop at the first "If this fails →" you hit and go to **Rollback**.

**Starting facts, verified by SSH on 2026-09-26 (do not assume the spec's numbers instead):** container `smartshape_evolution` runs `atendai/evolution-api:v2.2.3`; `smartshape_postgres_wa` is Postgres 15; port `8080/tcp` is bound to `0.0.0.0:8080` — **public on the internet today**; `CONFIG_SESSION_PHONE_VERSION=2.3000.1041267924` is set; the one instance `smartshape` is `connectionStatus: connecting` (never linked); the backend's `EVOLUTION_API_URL` points at the public IP. This runbook closes the public port and fixes all of that.

**Why v2.3.7, why the image renamed, why the stale env var matters.** At v2.3.0 the project moved its official Docker image from `atendai/evolution-api` (frozen at 2.2.3) to `evoapicloud/evolution-api`; v2.3.7 (2025-12-05) is the current stable tag. `CONFIG_SESSION_PHONE_VERSION` was **removed upstream in v2.3.1** (2025-07-29) after a stale pin silently broke sending — likely why `smartshape` is stuck "connecting": community reports describe this exact symptom tied to a stale phone-version pin. There is **no published upgrade/rollback doc** for 2.2.3 → 2.3.x — Evolution runs Prisma migrations automatically on container start with no documented way back — which is why step 2 backs up Postgres first. Per-instance RAM is not vendor-documented; community estimates are ~300–500 MB per linked Baileys session, so on this 3.9 GB VPS the app itself refuses to link a new number below 500 MB free (`RAM_HEADROOM_MIN_MB` in `backend/services/wa_config.py`) — treat that as the real go/no-go number in step 6, and again via the health probe installed in step 13. Sources: [releases](https://github.com/EvolutionAPI/evolution-api/releases), [CHANGELOG](https://github.com/EvolutionAPI/evolution-api/blob/main/CHANGELOG.md), [#1761](https://github.com/EvolutionAPI/evolution-api/issues/1761), [#1014](https://github.com/EvolutionAPI/evolution-api/issues/1014), [#1634](https://github.com/EvolutionAPI/evolution-api/issues/1634), [RAM estimate](https://horadecodar.com.br/requisitos-vps-evolution-api-ram-cpu-custos/).

## Step 0 — make the auto-deploy able to pull (5 min)

The VPS's tracked `docker-compose.evolution.yml` was hand-edited outside git in the past. If it's dirty, pulling the new file (commit A, pushed to `main` by Task 13) will fail and can strand later deploys of the whole app.

```bash
cd /var/www/smartshape
D=$(date +%F)
git status --short
cp docker-compose.evolution.yml /root/docker-compose.evolution.yml.bak.$D
cp .env.evolution /root/.env.evolution.bak.$D
cp backend/.env /root/backend.env.bak.$D
git checkout -- docker-compose.evolution.yml .env.evolution.example 2>/dev/null
git status --short
```

**Expected:** the three `.bak.$D` files exist and are non-empty; final `git status --short` is empty (or shows only files unrelated to this stack). **If this fails →** (checkout refuses because of a merge conflict): do not force — hand-diff the dirty file against `.bak.$D` first, then retry.

Only now let commit A reach `main` (Task 13 does the push). Wait ~2 minutes for the auto-deploy (`tail -f /var/log/ss-autodeploy.log`), then `git log -1 --oneline` shows commit A. **This does not touch any running container** — it only updates the tracked file on disk.

## Step 1 — record what's actually running (5 min)

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | tee /root/wa-before-$D.txt
docker inspect smartshape_evolution --format 'image={{.Config.Image}} project={{index .Config.Labels "com.docker.compose.project"}}'
docker inspect smartshape_evolution --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
docker inspect smartshape-backend --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
free -m
KEY=$(grep '^AUTHENTICATION_API_KEY=' .env.evolution | cut -d= -f2-)
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances | python3 -m json.tool | grep -E '"name"|connectionStatus|ownerJid|profileName|"token"'
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/proxy/find/smartshape; echo
```

**Expected:** write down compose **project** name, **volume** names on `/evolution/instances` and `/evolution/store`, the backend's **network** name, `smartshape`'s `ownerJid`, and its `token` field (empty is normal today — it has never been created/linked; capture it for every instance once there is more than one). Ask the owner: is the number about to be linked the company SIM (expect the "Tours And Travel" number)?

```bash
export EVO_PROJECT=<project from above> APP_NETWORK=<backend network from above>
```

**If this fails →** (`fetchInstances` returns nothing or errors): the API key is wrong — recheck `.env.evolution`, do not proceed past this step.

## Step 2 — back up Postgres and the instances volume (5 min)

No rollback is published for this image bump; this backup is the only way back.

```bash
mkdir -p /var/backups
docker exec smartshape_postgres_wa pg_dump -U evolution -d evolution -Fc > /var/backups/evolution-$D.dump
docker exec smartshape_postgres_wa pg_dump -U evolution -d evolution > /var/backups/evolution-$D.sql
INST_VOL=<the volume mounted on /evolution/instances, from step 1>
docker run --rm -v "$INST_VOL":/src:ro -v /var/backups:/dst alpine tar czf /dst/evolution-instances-$D.tgz -C /src .
ls -lh /var/backups/evolution-*$D*
docker exec -i smartshape_postgres_wa pg_restore -l < /var/backups/evolution-$D.dump | head
```

**Expected:** all files > 0 bytes; the `pg_restore -l` listing shows tables like `"Instance"`. **If this fails →** (dump is 0 bytes or `pg_restore -l` errors): stop — do not touch the image until a real backup exists.

## Step 3 — rewrite `.env.evolution` in place (5 min)

Keeps the secrets, drops the stale pin, turns off the global webhook and websocket.

```bash
setenv() { grep -q "^$1=" .env.evolution && sed -i "s|^$1=.*|$1=$2|" .env.evolution || echo "$1=$2" >> .env.evolution; }
sed -i '/^CONFIG_SESSION_PHONE_VERSION=/d;/^PROXY_HOST=/d;/^PROXY_PORT=/d;/^PROXY_USER=/d;/^PROXY_PASS=/d' .env.evolution
setenv SERVER_URL http://smartshape_evolution:8080
setenv AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES false
setenv CACHE_REDIS_ENABLED true
setenv CACHE_REDIS_URI redis://smartshape-redis:6379/6
setenv DATABASE_SAVE_DATA_HISTORIC true
setenv SYNC_FULL_HISTORY true
setenv QRCODE_LIMIT 30
setenv WEBHOOK_GLOBAL_ENABLED false
setenv WEBHOOK_GLOBAL_URL ""
setenv WEBHOOK_EVENTS_MESSAGES_UPSERT true
setenv WEBSOCKET_ENABLED false
setenv DEL_INSTANCE false
grep -E 'CONFIG_SESSION_PHONE_VERSION|WEBHOOK_GLOBAL_ENABLED|WEBSOCKET_ENABLED|SYNC_FULL_HISTORY|CACHE_REDIS_URI|SERVER_URL' .env.evolution
```

**Expected:** no `CONFIG_SESSION_PHONE_VERSION` line printed; `WEBHOOK_GLOBAL_ENABLED=false`; `WEBSOCKET_ENABLED=false`; `CACHE_REDIS_URI` now points at `smartshape-redis`. **If this fails →** (`AUTHENTICATION_API_KEY` or `DATABASE_CONNECTION_URI` look different from step 1's values): stop — something else edited this file; do not proceed.

## Step 4 — confirm the new image's healthcheck tool before pulling it for real (3 min)

`docker-compose.evolution.yml`'s healthcheck runs `wget`. Confirm the v2.3.7 image actually has it before relying on it.

```bash
docker run --rm --entrypoint sh evoapicloud/evolution-api:v2.3.7 -c 'command -v wget || command -v curl'
```

**Expected:** a path is printed (e.g. `/usr/bin/wget`) — the shipped healthcheck already uses `wget`, nothing to change. **If this fails →** (only a `curl` path prints, or nothing at all): on the VPS, before step 5, edit `docker-compose.evolution.yml`'s `evolution-api.healthcheck.test` to `["CMD", "curl", "-f", "http://localhost:8080"]` (curl) — or delete the `healthcheck:` block entirely if neither tool exists — then `docker compose -f docker-compose.evolution.yml config -q` to confirm it still parses.

## Step 5 — swap the stack; WhatsApp goes down here (5 min)

```bash
docker stop smartshape_tor_sidecar smartshape_warp 2>/dev/null; docker rm smartshape_tor_sidecar smartshape_warp 2>/dev/null
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml config -q && echo "config ok"
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml pull evolution-api
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d postgres evolution-api
sleep 45
docker ps --filter name=smartshape_evolution --format '{{.Image}} {{.Status}} {{.Ports}}'
docker volume ls | grep -E "${EVO_PROJECT}_(postgres_data|evolution_instances)"
```

**Expected:** `evoapicloud/evolution-api:v2.3.7  Up ... (healthy)  127.0.0.1:8080->8080/tcp` — no `0.0.0.0`. `docker volume ls` shows the **existing** volume names from step 1, not new ones. **If this fails →** (a brand-new, empty volume appears): the project name is wrong — **stop, go to Rollback** before Evolution starts writing to an empty database.

## Step 6 — verify the swap (5 min)

```bash
curl -s http://127.0.0.1:8080/ | python3 -m json.tool | grep -i version          # expect "2.3.7"
PUB=$(curl -s -m 5 ifconfig.me); curl -s -m 5 "http://$PUB:8080/"; echo " public exit=$?"   # must fail
docker exec smartshape-backend python -c "import httpx; print(httpx.get('http://smartshape_evolution:8080/', timeout=5).json().get('version'))"
docker logs --since 5m smartshape_evolution 2>&1 | grep -iE 'error|decodeFrame|migrat|redis' | tail -20
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances | python3 -m json.tool | grep -E '"name"|connectionStatus|ownerJid'
free -m
docker stop smartshape_redis_wa 2>/dev/null; docker rm smartshape_redis_wa 2>/dev/null    # old Evolution-only Redis; volume kept
```

**Expected:** `2.3.7` printed twice (host and from inside the backend container); the public curl **fails** (exit 7/28 — refused/timed out, since the port is now `127.0.0.1`-only); no `decodeFrame` errors; `smartshape` still listed; free memory ≥ 500 MB. **If this fails →** (public curl succeeds): the port bind didn't take — re-check step 5's `docker ps` output and the compose file's `ports:` line; do not proceed while the API is public. **If free memory < 500 MB → STOP.** Do NOT run step 7. Stop here and tell Aman. Options: free RAM (`docker system prune`, stop non-essential containers) or upgrade the VPS — do not link a number onto a server that's already short on memory.

## Step 7 — link the company number (10 min, owner present)

The app code that auto-registers webhooks on link (`wa_link_company` / Task 13) is not deployed yet at this point — this step uses Evolution directly. Open an SSH tunnel **from the owner's laptop**, not the VPS shell: `ssh -L 8080:127.0.0.1:8080 root@srv1667373.hstgr.cloud`, then browse `http://localhost:8080/manager` and log in with `$KEY`.

- `smartshape` shows **open** and step 1's `ownerJid` was already the company SIM: nothing to do.
- Open on the **wrong** number: Manager → Logout on `smartshape` (or `curl -s -X DELETE -H "apikey: $KEY" http://127.0.0.1:8080/instance/logout/smartshape`), then Connect → scan with the company SIM.
- Closed/connecting (today's actual state): Connect → scan with the company SIM (WhatsApp → Settings → Linked devices → Link a device).

```bash
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/connectionState/smartshape; echo   # expect "state":"open"
```

**Expected:** `"state":"open"`. **If this fails →** (the QR never turns green): check `/proxy/find/smartshape` from step 1 — a Decodo proxy set before survives the image swap in Evolution's own DB; if empty and linking still fails, set one (`POST /proxy/set/smartshape`) and retry. **Cleanup for a failed attempt (ruling f):** a partial link can leave Evolution holding an instance with no matching `wa_instances` row (expected right now, pre-W1b — that collection isn't written until Task 13's code links it). If a retried attempt left a *second*, differently-named instance in `fetchInstances`, delete the stray one: `curl -s -X DELETE -H "apikey: $KEY" http://127.0.0.1:8080/instance/delete/<stray-name>`.

## Step 8 — one test message (2 min)

```bash
OWNER_PHONE=91XXXXXXXXXX   # the owner's own mobile, as the owner dictates it
curl -s -X POST -H "apikey: $KEY" -H 'Content-Type: application/json' \
  http://127.0.0.1:8080/message/sendText/smartshape \
  -d "{\"number\":\"$OWNER_PHONE\",\"text\":\"SmartShape WhatsApp upgrade test $(date +%H:%M)\"}" | python3 -m json.tool | head -20
```

**Expected:** the owner confirms the message arrived showing the company number as sender. **If this fails →** (a 4xx): the instance isn't actually `open` yet — recheck step 7.

## Step 9 — point the backend at the new stack (5 min)

Harmless to run now — the backend code already deployed reads these same variable names.

```bash
BE=backend/.env
setbe() { grep -q "^$1=" $BE && sed -i "s|^$1=.*|$1=$2|" $BE || echo "$1=$2" >> $BE; }
setbe EVOLUTION_API_URL http://smartshape_evolution:8080
setbe EVOLUTION_API_KEY "$KEY"
setbe WHATSAPP_INSTANCE smartshape
setbe WA_WEBHOOK_SECRET "$(openssl rand -hex 24)"
setbe WA_WEBHOOK_BASE https://app.smartshape.in
docker compose -f docker-compose.prod.yml up -d backend        # recreate with the new env, no rebuild
sleep 20
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://app.smartshape.in/api/auth/login   # expect 422
grep -E '^(EVOLUTION_API_URL|WHATSAPP_INSTANCE|WA_WEBHOOK_BASE)=' $BE
```

**Expected:** `422` from the login probe (the app is up); the three lines print the new values. **If this fails →** (the app returns 502 after the recreate): the backend container failed to start on the new env — `docker logs smartshape-backend --tail 50`; if unresolved in a few minutes, restore `backend.env.bak.$D` and `docker compose -f docker-compose.prod.yml up -d backend` again.

---

## Steps 10–14 run AFTER Task 13 ships the W1 backend code (not part of W1a)

By this point Task 13's backend deploy has shipped `WA_WEBHOOK_APIKEY_CHECK` (env, default on) and the admin routes `POST /api/wa/instances/{name}/rewebhook` / `POST /api/wa/instances/rewebhook-all` (re-register a webhook with the current secret header, no relink) — see `backend/routes/wa_routes.py`. The owner has run Settings → WhatsApp → Link company number, which calls `wa_link_company` and registers the webhook automatically.

## Step 10 — confirm the webhook, nginx logging, and the hairpin path (ruling a) (10 min)

```bash
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/webhook/find/smartshape | python3 -m json.tool
grep -n "log_format" /etc/nginx/nginx.conf /etc/nginx/sites-enabled/* 2>/dev/null
docker exec smartshape_evolution wget -qO- https://app.smartshape.in/api/auth/login -S 2>&1 | head -1
```

**Expected:** the webhook URL is `.../api/webhooks/whatsapp/smartshape` (a `?t=` suffix means it was registered before the header existed) with all five events `true`; the `wget` line prints an HTTP status line (e.g. `HTTP/1.1 422`) — this is the **hairpin check**: Evolution calls the public `https://app.smartshape.in` hostname from *inside* the same docker host, which some networks/NAT setups block. **If this fails →** (a `?t=` suffix, or `log_format` is absent on the VPS, meaning the default `combined` format is logging the query string too): rotate the secret and re-register every instance without a relink:

```bash
setbe WA_WEBHOOK_SECRET "$(openssl rand -hex 24)"
docker compose -f docker-compose.prod.yml up -d backend
read -s -p "Owner password: " WA_PW; echo
curl -s -c /tmp/wa.cookies -H 'Content-Type: application/json' \
  -d "$(printf '{"email":"info@smartshape.in","password":"%s"}' "$WA_PW")" \
  https://app.smartshape.in/api/auth/login >/dev/null
unset WA_PW
curl -s -b /tmp/wa.cookies -X POST https://app.smartshape.in/api/wa/instances/rewebhook-all | python3 -m json.tool
rm -f /tmp/wa.cookies
```

**Never paste the password into the command itself** — `read -s` keeps it off the screen, out of `~/.bash_history`, and out of `ps`. (If JSON-escaping a password with a `"` or `\` in it worries you, build the body with `python3 -c 'import json,os;print(json.dumps({"email":"info@smartshape.in","password":os.environ["WA_PW"]}))'` against an *exported* `WA_PW` instead of `printf` — either is fine, just use one approach.) **If the hairpin `wget` fails/times out →** add the host's public IP to the compose file's `evolution-api` service on the VPS: `extra_hosts: ["app.smartshape.in:<VPS_PUBLIC_IP>"]`, then `docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d evolution-api` to apply it, and re-run this step.

## Step 11 — verify Evolution sends the per-instance `apikey` (ruling b) (5 min)

Trigger a real event (send yourself a WhatsApp message to `smartshape`), then:

```bash
docker logs --since 2m smartshape-backend 2>&1 | grep -i "wa-webhook"
```

**Expected:** no `"apikey does not match the token"` line. **If this fails →** (that line appears): Evolution is very likely sending its *global* `AUTHENTICATION_API_KEY`, not this instance's per-instance token. Primary fix — turn the compare off, keep the shared-secret header check: `BE=backend/.env; grep -q '^WA_WEBHOOK_APIKEY_CHECK=' $BE && sed -i 's|^WA_WEBHOOK_APIKEY_CHECK=.*|WA_WEBHOOK_APIKEY_CHECK=off|' $BE || echo 'WA_WEBHOOK_APIKEY_CHECK=off' >> $BE; docker compose -f docker-compose.prod.yml up -d backend`. Confirm: `docker logs --since 1m smartshape-backend 2>&1 | grep -i "apikey check is"` should print `OFF`. Last resort only, if the switch itself misbehaves: clear the instance's stored token so the compare is skipped — `docker exec smartshape-backend python -c "import asyncio,database; asyncio.run(database.db.wa_instances.update_one({'instance_name':'smartshape'}, {'\$set':{'instance_token':''}}))"`.

## Step 12 — set a higher daily cap if a number has already been sending (ruling c) (2 min)

Adopting an already-open number counts it as warmed (Task 7) — nothing else is required. To raise the cap above the warm-up ramp: in the app, Settings → WhatsApp → that number → **Limit** → enter 1–2000. **Expected:** the number's card shows the new limit immediately. **If this fails →** (a 400 "must be 1-2000"): clear the field instead to return it to the automatic warm-up ramp — this calls `PUT /api/wa/instances/{name}` with `daily_cap_override`.

## Step 13 — install the 15-minute host health cron (ruling d) (3 min)

```bash
chmod +x /var/www/smartshape/scripts/ss-wa-health.sh
/var/www/smartshape/scripts/ss-wa-health.sh                     # prints avail/total/evolution MB once
echo '*/15 * * * * root /var/www/smartshape/scripts/ss-wa-health.sh >> /var/log/ss-wa-health.log 2>&1' > /etc/cron.d/ss-wa-health
```

**Expected:** the manual run prints three numbers (avail/total/evolution MB); Settings → WhatsApp shows "Server memory: … MB free" within 15 minutes. **If this fails →** (the manual run errors): re-check `BACKEND_CONTAINER`/`EVOLUTION_CONTAINER` names inside the script match `docker ps` (they default to `smartshape-backend`/`smartshape_evolution`). Note: the script's own header comment and Task 13's brief both say hourly (`7 * * * *`); this installs it every 15 minutes per the explicit ruling for this task.

## Step 14 — recount the `whatsapp_scheduled` backlog before the Task 9 deploy (ruling e) (2 min)

```bash
docker exec smartshape-backend python -c "import asyncio,database; print(asyncio.run(database.db.whatsapp_scheduled.count_documents({'status':'pending'})))"
```

**Expected:** roughly 164 campaign + 2 drip rows (~166 total). **If this fails →** (the count is wildly different, or the command errors): stop and compare against the campaign/drip dashboards before the deploy — `scheduler.expire_legacy_wa_backlog` runs once (guarded by `settings{type:"wa_queue_migrated"}`) on the first drainer pass after that deploy and marks any pending row older than 24 h `expired` without sending it; re-run this count after that pass to see the drop.

---

## Rollback (any failed check in steps 0–9; WhatsApp only — the rest of the app is unaffected)

```bash
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml down          # NO -v: keep volumes
cp /root/docker-compose.evolution.yml.bak.$D docker-compose.evolution.yml
cp /root/.env.evolution.bak.$D .env.evolution
cp /root/backend.env.bak.$D backend/.env
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d         # the previous image+services

# Only if the OLD image refuses to start because 2.3.7 already migrated the schema forward:
docker exec -i smartshape_postgres_wa psql -U evolution -d postgres -c 'DROP DATABASE evolution;' -c 'CREATE DATABASE evolution OWNER evolution;'
docker exec -i smartshape_postgres_wa pg_restore -U evolution -d evolution < /var/backups/evolution-$D.dump
docker run --rm -v "$INST_VOL":/dst -v /var/backups:/src alpine sh -c "rm -rf /dst/* && tar xzf /src/evolution-instances-$D.tgz -C /dst"
docker restart smartshape_evolution
docker compose -f docker-compose.prod.yml up -d backend
git checkout -- docker-compose.evolution.yml       # leave the tracked file clean for the next auto-deploy
```

**Verify:** `curl -s http://127.0.0.1:8080/` reports the old version again, and `fetchInstances` lists `smartshape` exactly as it was in step 1's `/root/wa-before-$D.txt`.

## Final checklist

- [ ] Step 0: local edits backed up, `git status --short` clean before commit A auto-deploys
- [ ] Step 1: project/volume/network/token values recorded; owner confirmed the SIM
- [ ] Step 2: `.dump`, `.sql`, `.tgz` backups exist and `pg_restore -l` lists real tables
- [ ] Step 3: `CONFIG_SESSION_PHONE_VERSION` gone; global webhook and websocket off
- [ ] Step 4: healthcheck tool confirmed present in the v2.3.7 image (or compose edited to match)
- [ ] Step 5: `evoapicloud/evolution-api:v2.3.7` healthy on the **same** volumes
- [ ] Step 6: version confirmed twice; public port curl **fails**; free memory ≥ 500 MB (else STOP)
- [ ] Step 7: company number `state: open`; no stray Evolution instance left behind
- [ ] Step 8: owner confirmed the test message arrived
- [ ] Step 9: backend recreated on the new env; login probe returns 422
- [ ] Steps 10–14: done after Task 13's backend deploy, not before
